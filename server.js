const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// MongoDB bağlantı bilgileri
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
const DB_NAME = 'domino_game';

let db;
let usersCollection;
let gamesCollection;

// MongoDB'ye bağlan
async function connectDB() {
    try {
        const client = await MongoClient.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        db = client.db(DB_NAME);
        usersCollection = db.collection('users');
        gamesCollection = db.collection('games');
        
        // İndeksler oluştur
        await usersCollection.createIndex({ telegramId: 1 }, { unique: true });
        await usersCollection.createIndex({ elo: -1 });
        
        console.log('MongoDB\'ye bağlandı');
    } catch (error) {
        console.error('MongoDB bağlantı hatası:', error);
    }
}

connectDB();

// Oyun verileri
const connectedUsers = new Map(); // WebSocket -> User
const rankedQueue = new Set(); // Dereceli maç bekleyen oyuncular
const rooms = new Map(); // Oda kodu -> Room
const activeGames = new Map(); // Oyun ID -> Game

// Domino taşları oluştur
function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return tiles;
}

// Taşları karıştır
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Oda kodu oluştur
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Oyun oluştur
function createGame(player1, player2, isRanked = false) {
    const gameId = 'game_' + Date.now() + '_' + Math.random();
    const tiles = shuffleArray(createDominoSet());
    
    // Her oyuncuya 7 taş
    const player1Tiles = tiles.slice(0, 7);
    const player2Tiles = tiles.slice(7, 14);
    const remainingTiles = tiles.slice(14);
    
    const game = {
        id: gameId,
        players: [player1, player2],
        player1Tiles: player1Tiles,
        player2Tiles: player2Tiles,
        remainingTiles: remainingTiles,
        board: [],
        currentPlayer: player1.id,
        isRanked: isRanked,
        startTime: Date.now(),
        moves: []
    };
    
    activeGames.set(gameId, game);
    return game;
}

// Oyun durumunu hazırla (oyuncuya göre)
function getGameState(game, userId) {
    const player = game.players.find(p => p.id === userId);
    const opponent = game.players.find(p => p.id !== userId);
    
    return {
        gameId: game.id,
        board: game.board,
        currentPlayer: game.currentPlayer,
        players: [
            {
                id: player.id,
                username: player.username,
                level: player.level,
                tilesLeft: game.player1Tiles.length
            },
            {
                id: opponent.id,
                username: opponent.username,
                level: opponent.level,
                tilesLeft: game.player2Tiles.length
            }
        ],
        myTiles: userId === game.players[0].id ? game.player1Tiles : game.player2Tiles
    };
}

// Taş oynanabilir mi kontrol et
function canPlayTile(game, tile, position) {
    if (game.board.length === 0) return true;
    
    const leftEnd = game.board[0][0];
    const rightEnd = game.board[game.board.length - 1][1];
    
    if (position === 'left') {
        return tile[0] === leftEnd || tile[1] === leftEnd;
    } else if (position === 'right') {
        return tile[0] === rightEnd || tile[1] === rightEnd;
    }
    
    return false;
}

// Taş oyna
function playTile(game, userId, tile, position) {
    const isPlayer1 = userId === game.players[0].id;
    const playerTiles = isPlayer1 ? game.player1Tiles : game.player2Tiles;
    
    // Taşı oyuncunun elinden çıkar
    const tileIndex = playerTiles.findIndex(t => t[0] === tile[0] && t[1] === tile[1]);
    if (tileIndex === -1) return false;
    
    playerTiles.splice(tileIndex, 1);
    
    // Tahtaya ekle
    if (game.board.length === 0) {
        game.board.push(tile);
    } else {
        if (position === 'left') {
            const leftEnd = game.board[0][0];
            if (tile[1] === leftEnd) {
                game.board.unshift(tile);
            } else {
                game.board.unshift([tile[1], tile[0]]);
            }
        } else if (position === 'right') {
            const rightEnd = game.board[game.board.length - 1][1];
            if (tile[0] === rightEnd) {
                game.board.push(tile);
            } else {
                game.board.push([tile[1], tile[0]]);
            }
        }
    }
    
    // Hareketi kaydet
    game.moves.push({
        player: userId,
        tile: tile,
        position: position,
        time: Date.now()
    });
    
    // Sırayı değiştir
    game.currentPlayer = game.players.find(p => p.id !== userId).id;
    
    return true;
}

// Oyun bitti mi kontrol et
function checkGameEnd(game) {
    const player1Tiles = game.player1Tiles;
    const player2Tiles = game.player2Tiles;
    
    // Biri taşlarını bitirdiyse
    if (player1Tiles.length === 0) {
        return { finished: true, winner: game.players[0].id };
    }
    if (player2Tiles.length === 0) {
        return { finished: true, winner: game.players[1].id };
    }
    
    // Hiç hamle yapılamıyorsa (bloke)
    const leftEnd = game.board.length > 0 ? game.board[0][0] : null;
    const rightEnd = game.board.length > 0 ? game.board[game.board.length - 1][1] : null;
    
    const currentPlayerTiles = game.currentPlayer === game.players[0].id ? player1Tiles : player2Tiles;
    const hasValidMove = currentPlayerTiles.some(tile => 
        tile[0] === leftEnd || tile[1] === leftEnd || 
        tile[0] === rightEnd || tile[1] === rightEnd
    );
    
    if (!hasValidMove && game.board.length > 0) {
        // En az taşı olan kazanır
        const winner = player1Tiles.length < player2Tiles.length ? 
            game.players[0].id : game.players[1].id;
        return { finished: true, winner: winner };
    }
    
    return { finished: false };
}

// ELO hesapla
function calculateEloChange(game, winnerId) {
    if (!game.isRanked) return { [game.players[0].id]: 0, [game.players[1].id]: 0 };
    
    const winner = game.players.find(p => p.id === winnerId);
    const loser = game.players.find(p => p.id !== winnerId);
    
    const gameDuration = Date.now() - game.startTime;
    const halfGameTime = 5 * 60 * 1000; // 5 dakika
    
    // Oyun yarısından önce çıkış kontrolü
    let eloChange;
    if (gameDuration < halfGameTime) {
        eloChange = Math.floor(12 + Math.random() * 9); // 12-20 arası
    } else {
        eloChange = Math.floor(15 + Math.random() * 6); // 15-20 arası
    }
    
    return {
        [winnerId]: eloChange,
        [loser.id]: -eloChange
    };
}

// Kullanıcıyı güncelle
async function updateUserElo(userId, eloChange) {
    try {
        const user = await usersCollection.findOne({ telegramId: userId });
        if (!user) return null;
        
        const newElo = Math.max(0, user.elo + eloChange);
        const newLevel = Math.min(10, Math.floor(newElo / 100) + 1);
        
        const updateData = {
            elo: newElo,
            level: newLevel
        };
        
        if (eloChange > 0) {
            updateData.wins = (user.wins || 0) + 1;
        } else {
            updateData.losses = (user.losses || 0) + 1;
        }
        
        await usersCollection.updateOne(
            { telegramId: userId },
            { $set: updateData }
        );
        
        return { ...user, ...updateData };
    } catch (error) {
        console.error('ELO güncelleme hatası:', error);
        return null;
    }
}

// WebSocket bağlantıları
wss.on('connection', (ws) => {
    console.log('Yeni bağlantı');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            await handleMessage(ws, data);
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Bir hata oluştu'
            }));
        }
    });
    
    ws.on('close', () => {
        const user = connectedUsers.get(ws);
        if (user) {
            rankedQueue.delete(user.id);
            connectedUsers.delete(ws);
            console.log('Kullanıcı ayrıldı:', user.username);
        }
    });
});

// Mesajları işle
async function handleMessage(ws, data) {
    switch(data.type) {
        case 'register':
            await handleRegister(ws, data.user);
            break;
            
        case 'searchRanked':
            await handleSearchRanked(ws);
            break;
            
        case 'cancelSearch':
            handleCancelSearch(ws);
            break;
            
        case 'createRoom':
            handleCreateRoom(ws);
            break;
            
        case 'joinRoom':
            await handleJoinRoom(ws, data.code);
            break;
            
        case 'playTile':
            await handlePlayTile(ws, data.tile, data.position);
            break;
            
        case 'getLeaderboard':
            await handleGetLeaderboard(ws);
            break;
            
        case 'logout':
            handleLogout(ws);
            break;
    }
}

// Kullanıcı kaydı
async function handleRegister(ws, userData) {
    try {
        // MongoDB'de kullanıcıyı bul veya oluştur
        let user = await usersCollection.findOne({ telegramId: userData.id });
        
        if (!user) {
            user = {
                telegramId: userData.id,
                username: userData.username,
                firstName: userData.firstName,
                level: 1,
                elo: 0,
                wins: 0,
                losses: 0,
                createdAt: new Date()
            };
            await usersCollection.insertOne(user);
        }
        
        connectedUsers.set(ws, {
            id: user.telegramId,
            username: user.username,
            firstName: user.firstName,
            level: user.level,
            elo: user.elo,
            ws: ws
        });
        
        ws.send(JSON.stringify({
            type: 'registered',
            user: {
                id: user.telegramId,
                username: user.username,
                firstName: user.firstName,
                level: user.level,
                elo: user.elo
            }
        }));
    } catch (error) {
        console.error('Kayıt hatası:', error);
    }
}

// Dereceli maç arama
async function handleSearchRanked(ws) {
    const user = connectedUsers.get(ws);
    if (!user) return;
    
    rankedQueue.add(user.id);
    
    // Eşleşme ara
    const queueArray = Array.from(rankedQueue);
    if (queueArray.length >= 2) {
        const player1Id = queueArray[0];
        const player2Id = queueArray[1];
        
        rankedQueue.delete(player1Id);
        rankedQueue.delete(player2Id);
        
        const player1 = Array.from(connectedUsers.values()).find(u => u.id === player1Id);
        const player2 = Array.from(connectedUsers.values()).find(u => u.id === player2Id);
        
        if (player1 && player2) {
            const game = createGame(player1, player2, true);
            
            // Her iki oyuncuya da oyunu başlat
            player1.ws.send(JSON.stringify({
                type: 'matchFound',
                gameState: getGameState(game, player1.id)
            }));
            
            player2.ws.send(JSON.stringify({
                type: 'matchFound',
                gameState: getGameState(game, player2.id)
            }));
        }
    }
}

// Aramayı iptal et
function handleCancelSearch(ws) {
    const user = connectedUsers.get(ws);
    if (user) {
        rankedQueue.delete(user.id);
    }
}

// Oda oluştur
function handleCreateRoom(ws) {
    const user = connectedUsers.get(ws);
    if (!user) return;
    
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
        code: roomCode,
        host: user,
        guest: null,
        createdAt: Date.now()
    });
    
    ws.send(JSON.stringify({
        type: 'roomCreated',
        roomCode: roomCode
    }));
}

// Odaya katıl
async function handleJoinRoom(ws, code) {
    const user = connectedUsers.get(ws);
    if (!user) return;
    
    const room = rooms.get(code);
    if (!room) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Oda bulunamadı'
        }));
        return;
    }
    
    if (room.guest) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Oda dolu'
        }));
        return;
    }
    
    room.guest = user;
    
    // Oyunu başlat
    const game = createGame(room.host, room.guest, false);
    
    room.host.ws.send(JSON.stringify({
        type: 'gameStart',
        gameState: getGameState(game, room.host.id)
    }));
    
    room.guest.ws.send(JSON.stringify({
        type: 'gameStart',
        gameState: getGameState(game, room.guest.id)
    }));
    
    // Odayı sil
    rooms.delete(code);
}

// Taş oyna
async function handlePlayTile(ws, tile, position) {
    const user = connectedUsers.get(ws);
    if (!user) return;
    
    // Oyunu bul
    const game = Array.from(activeGames.values()).find(g => 
        g.players.some(p => p.id === user.id) && 
        g.currentPlayer === user.id
    );
    
    if (!game) return;
    
    // Taşı oyna
    if (!canPlayTile(game, tile, position)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Geçersiz hamle'
        }));
        return;
    }
    
    playTile(game, user.id, tile, position);
    
    // Oyun durumunu kontrol et
    const endCheck = checkGameEnd(game);
    
    if (endCheck.finished) {
        // Oyun bitti
        const eloChanges = calculateEloChange(game, endCheck.winner);
        
        // ELO'ları güncelle
        if (game.isRanked) {
            for (const player of game.players) {
                await updateUserElo(player.id, eloChanges[player.id]);
            }
        }
        
        // Her iki oyuncuya da bildir
        for (const player of game.players) {
            const playerWs = connectedUsers.get(player.ws);
            if (playerWs) {
                player.ws.send(JSON.stringify({
                    type: 'gameEnd',
                    winner: endCheck.winner,
                    eloChanges: eloChanges
                }));
            }
        }
        
        // Oyunu sil
        activeGames.delete(game.id);
        
        // Oyunu veritabanına kaydet
        if (game.isRanked) {
            await gamesCollection.insertOne({
                gameId: game.id,
                players: game.players.map(p => p.id),
                winner: endCheck.winner,
                moves: game.moves,
                duration: Date.now() - game.startTime,
                eloChanges: eloChanges,
                finishedAt: new Date()
            });
        }
    } else {
        // Oyun devam ediyor, her iki oyuncuya güncellemeyi gönder
        for (const player of game.players) {
            player.ws.send(JSON.stringify({
                type: 'gameUpdate',
                gameState: getGameState(game, player.id)
            }));
        }
    }
}

// Liderlik tablosunu al
async function handleGetLeaderboard(ws) {
    try {
        const user = connectedUsers.get(ws);
        if (!user) return;
        
        // Top 10'u al
        const top10 = await usersCollection
            .find()
            .sort({ elo: -1 })
            .limit(10)
            .toArray();
        
        // Kullanıcının sıralamasını bul
        const allUsers = await usersCollection
            .find()
            .sort({ elo: -1 })
            .toArray();
        
        const myRankIndex = allUsers.findIndex(u => u.telegramId === user.id);
        
        ws.send(JSON.stringify({
            type: 'leaderboard',
            top10: top10.map(u => ({
                id: u.telegramId,
                username: u.username,
                level: u.level,
                elo: u.elo
            })),
            myRank: myRankIndex >= 10 ? {
                rank: myRankIndex + 1,
                user: {
                    id: allUsers[myRankIndex].telegramId,
                    username: allUsers[myRankIndex].username,
                    level: allUsers[myRankIndex].level,
                    elo: allUsers[myRankIndex].elo
                }
            } : null
        }));
    } catch (error) {
        console.error('Liderlik tablosu hatası:', error);
    }
}

// Çıkış
function handleLogout(ws) {
    const user = connectedUsers.get(ws);
    if (user) {
        rankedQueue.delete(user.id);
        connectedUsers.delete(ws);
    }
}

// Express middleware
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
