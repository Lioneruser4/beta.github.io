const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// MongoDB Bağlantısı
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB bağlantısı başarılı - Domino Game Database'))
.catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

// Mongoose Schemas
const playerSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    photoUrl: { type: String },
    elo: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastPlayed: { type: Date, default: Date.now }
});

const matchSchema = new mongoose.Schema({
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'DominoPlayer' },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'DominoPlayer' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'DominoPlayer' },
    player1Elo: { type: Number },
    player2Elo: { type: Number },
    player1EloChange: { type: Number },
    player2EloChange: { type: Number },
    moves: { type: Number, default: 0 },
    duration: { type: Number },
    isDraw: { type: Boolean, default: false },
    gameType: { type: String, enum: ['ranked', 'private'], default: 'ranked' },
    createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);

app.use(cors());
app.use(express.json());

const rooms = new Map();
// Eşleştirme kuyruklarını ayır: Dereceli (Telegram) ve Casual (Guest)
const rankedQueue = [];
const casualQueue = [];
const playerConnections = new Map(); // playerId -> ws
const playerSessions = new Map(); // telegramId -> player data
const disconnectedPlayers = new Map(); // playerId -> { roomCode, timer }

// ELO Calculation - Win-based system
function calculateElo(winnerElo, loserElo, winnerLevel) {
    // Random points between 13-20 for levels 1-5
    // Random points between 10-15 for levels 6+
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13; // 13-20
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10; // 10-15
    }
    
    const loserChange = -Math.floor(winnerChange * 0.7); // Loser loses 70% of winner's gain
    
    return {
        winnerElo: winnerElo + winnerChange,
        loserElo: Math.max(0, loserElo + loserChange),
        winnerChange,
        loserChange
    };
}

// Level Calculation - Every 100 points = 1 level
function calculateLevel(elo) {
    return Math.floor(elo / 100) + 1; // Start at level 1 (0 ELO)
}

// API Endpoints
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName, photoUrl } = req.body;
        
        if (!telegramId || !username) {
            return res.status(400).json({ error: 'Telegram ID ve kullanıcı adı gerekli' });
        }

        let player = await Player.findOne({ telegramId });
        
        if (!player) {
            player = new Player({
                telegramId,
                username,
                firstName,
                lastName,
                photoUrl
            });
            await player.save();
            console.log(`🆕 Yeni oyuncu kaydedildi: ${username} (${telegramId})`);
        } else {
            // Profil bilgilerini güncelle
            player.username = username;
            player.firstName = firstName;
            player.lastName = lastName;
            player.photoUrl = photoUrl;
            player.lastPlayed = new Date();
            await player.save();
        }

        playerSessions.set(telegramId, player);
        
        res.json({
            success: true,
            player: {
                id: player._id,
                telegramId: player.telegramId,
                username: player.username,
                firstName: player.firstName,
                lastName: player.lastName,
                photoUrl: player.photoUrl,
                elo: player.elo,
                level: player.level,
                wins: player.wins,
                losses: player.losses,
                draws: player.draws,
                totalGames: player.totalGames,
                winStreak: player.winStreak,
                bestWinStreak: player.bestWinStreak
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find()
            .sort({ elo: -1 })
            .limit(10) // Top 10
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames winStreak');
        
        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/player/:telegramId/stats', async (req, res) => {
    try {
        const player = await Player.findOne({ telegramId: req.params.telegramId });
        if (!player) {
            return res.status(404).json({ error: 'Oyuncu bulunamadı' });
        }
        
        const recentMatches = await Match.find({
            $or: [{ player1: player._id }, { player2: player._id }]
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('player1 player2 winner');
        
        res.json({ success: true, player, recentMatches });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/player/:telegramId/matches', async (req, res) => {
    try {
        const player = await Player.findOne({ telegramId: req.params.telegramId });
        if (!player) {
            return res.status(404).json({ error: 'Oyuncu bulunamadı' });
        }
        
        const matches = await Match.find({
            $or: [{ player1: player._id }, { player2: player._id }]
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('player1 player2 winner');
        
        res.json({ success: true, matches });
    } catch (error) {
        console.error('Matches error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Domino WebSocket Server',
        players: playerConnections.size,
        rooms: rooms.size
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    clientTracking: true
});

// --- YARDIMCI FONKSİYONLAR ---

function generateRoomCode() {
    return Math.random().toString(36).substr(2, 4).toUpperCase();
}

function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return shuffleArray(tiles);
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function initializeGame(roomCode, player1Id, player2Id) {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14); // Kalan taşlar pazar

    const room = rooms.get(roomCode);
    
    // En yüksek çifti bul (6|6, 5|5, 4|4, ...)
    let startingPlayer = player1Id;
    let highestDouble = -1;
    
    for (let player of [player1Id, player2Id]) {
        const hand = player === player1Id ? player1Hand : player2Hand;
        for (let tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayer = player;
            }
        }
    }
    
    room.gameState = {
        board: [],
        players: {
            [player1Id]: { hand: player1Hand, name: room.players[player1Id].name },
            [player2Id]: { hand: player2Hand, name: room.players[player2Id].name }
        },
        market: market,
        currentPlayer: startingPlayer,
        turn: 1,
        lastMove: null,
        startingDouble: highestDouble
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı - Başlayan: ${startingPlayer === player1Id ? room.players[player1Id].name : room.players[player2Id].name} (${highestDouble}|${highestDouble})`);
    return room.gameState;
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Bu fonksiyonu TRUE/FALSE dönecek şekilde güncelledim
function playTileOnBoard(tile, board, position) {
    if (board.length === 0) {
        board.push(tile);
        return true;
    }

    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    let played = false;

    if (position === 'left' || position === 'both') {
        if (tile[1] === leftEnd) {
            board.unshift(tile);
            played = true;
        } else if (tile[0] === leftEnd) {
            board.unshift([tile[1], tile[0]]); // Yön değiştir
            played = true;
        }
    } 
    
    // Eğer 'both' seçildiyse ve sol tarafa uymadıysa sağa bakmaya devam etmeli
    // Ancak oyuncu spesifik olarak 'left' dediyse ve uymadıysa buraya girmemeli
    if (!played && (position === 'right' || position === 'both')) {
        if (tile[0] === rightEnd) {
            board.push(tile);
            played = true;
        } else if (tile[1] === rightEnd) {
            board.push([tile[1], tile[0]]); // Yön değiştir
            played = true;
        }
    }

    return played;
}

function checkWinner(gameState) {
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            return playerId;
        }
    }

    const player1Id = Object.keys(gameState.players)[0];
    const player2Id = Object.keys(gameState.players)[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    if (!player1CanPlay && !player2CanPlay) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        // Eşitlik durumunda beraberlik mantığı eklenebilir, şimdilik az puanlı kazanır
        if (player1Sum === player2Sum) return 'DRAW'; 
        return player1Sum < player2Sum ? player1Id : player2Id;
    }

    return null;
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    for (const playerId in room.players) {
        if (playerId === excludePlayer) continue;
        const ws = playerConnections.get(playerId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify(message)); } catch (e) {}
        }
    }
}

function sendGameState(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const ws = playerConnections.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: { ...room.gameState, playerId: playerId }
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {}
    }
}

// --- WEBSOCKET EVENTLERİ ---

const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// --- EŞLEŞTİRME YARDIMCI FONKSİYONLARI ---

function isPlayerActive(telegramId) {
    if (!telegramId) return false;

    // 1. Aktif bir odada mı kontrol et
    for (const room of rooms.values()) {
        for (const player of Object.values(room.players)) {
            if (player.telegramId === telegramId) {
                return true; // Oyuncu zaten bir odada
            }
        }
    }

    // 2. Eşleşme kuyruğunda mı kontrol et
    const inRankedQueue = rankedQueue.some(p => p.telegramId === telegramId);
    return inRankedQueue;
}

// --- OYUN MANTIKLARI ---

function handleFindMatch(ws, data) {
    if (ws.playerId && playerConnections.has(ws.playerId)) {
        const existingInQueue = matchQueue.find(p => p.playerId === ws.playerId);
        if (existingInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
        } // Bu kontrol yeni sistemle gereksiz kalacak ama zararı yok.
        if (ws.roomCode) {
            return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız' });
        }
    }

    const playerId = ws.playerId || generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null; // null ise guest
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0; // 0 = guest
    ws.elo = data.elo || 0; // 0 = guest
    ws.isGuest = !data.telegramId; // Telegram yoksa guest
    
    // TEK OTURUM KONTROLÜ: Aynı Telegram hesabının ikinci kez oyuna girmesini/eşleşme aramasını engelle
    if (!ws.isGuest && ws.telegramId) {
        if (isPlayerActive(ws.telegramId)) {
            return sendMessage(ws, { type: 'error', message: 'Bu hesap zaten aktif bir oyunda veya eşleşme arıyor.' });
        }
    }

    playerConnections.set(playerId, ws);

    const playerInfo = {
        ws, 
        playerId, 
        playerName: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest
    };

    // Oyuncuyu doğru kuyruğa ekle
    if (ws.isGuest) {
        casualQueue.push(playerInfo);
        console.log(`✅ GUEST ${ws.playerName} kuyrukta - Casual Kuyruk: ${casualQueue.length}`);
    } else {
        rankedQueue.push(playerInfo);
        console.log(`✅ RANKED ${ws.playerName} (Lvl ${ws.level}) kuyrukta - Ranked Kuyruk: ${rankedQueue.length}`);
    }

    // Eşleşme kontrolünü her iki kuyruk için de yap
    checkForMatch();
}

function checkForMatch() {
    // Dereceli (Ranked) eşleşme kontrolü
    if (rankedQueue.length >= 2) {
        let p1 = rankedQueue.shift();
        let p2 = rankedQueue.shift();
        createMatch(p1, p2, 'ranked');
    }

    // Misafir (Casual) eşleşme kontrolü
    if (casualQueue.length >= 2) {
        let p1 = casualQueue.shift();
        let p2 = casualQueue.shift();
        createMatch(p1, p2, 'casual');
    }
}

function createMatch(p1, p2, gameType) {
    console.log(`🎮 Maç oluşturuluyor (${gameType.toUpperCase()}): ${p1.playerName} vs ${p2.playerName}`);
    
    const roomCode = generateRoomCode();

    const room = {
        code: roomCode,
        players: { 
            [p1.playerId]: { 
                name: p1.playerName,
                telegramId: p1.telegramId,
                photoUrl: p1.photoUrl,
                level: p1.level,
                elo: p1.elo,
                isGuest: p1.isGuest
            }, 
            [p2.playerId]: { 
                name: p2.playerName,
                telegramId: p2.telegramId,
                photoUrl: p2.photoUrl,
                level: p2.level,
                elo: p2.elo,
                isGuest: p2.isGuest
            } 
        },
        type: gameType,
        startTime: Date.now()
    };

    rooms.set(roomCode, room);
    p1.ws.roomCode = roomCode;
    p2.ws.roomCode = roomCode;

    const gameState = initializeGame(roomCode, p1.playerId, p2.playerId);

    sendMessage(p1.ws, { type: 'matchFound', roomCode, opponent: room.players[p2.playerId], gameType });
    sendMessage(p2.ws, { type: 'matchFound', roomCode, opponent: room.players[p1.playerId], gameType });

    // CRITICAL FIX: Send gameStart immediately to both players
    setTimeout(() => {
        const gameStartMsg = { type: 'gameStart', gameState: { ...gameState, playerId: p1.playerId } };
        sendMessage(p1.ws, gameStartMsg);
        
        const gameStartMsg2 = { type: 'gameStart', gameState: { ...gameState, playerId: p2.playerId } };
        sendMessage(p2.ws, gameStartMsg2);
        
        console.log(`✅ Oyun başladı: ${roomCode}`);
    }, 500);
}

/*

    if (matchQueue.length >= 2) {
        let p1 = matchQueue.shift();
        let p2 = matchQueue.shift();

        // Aynı Telegram hesabının kendi kendisiyle eşleşmesini engelle
        if (!p1.isGuest && !p2.isGuest && p1.telegramId && p2.telegramId && p1.telegramId === p2.telegramId) {
            // İkinci oyuncuyu kuyruğa geri koy ve bu eşleşmeyi iptal et
            matchQueue.unshift(p2);
            // Bu durumda p1 için tekrar rakip beklenir
            console.log('⚠️ Aynı Telegram hesabı kendi kendisiyle eşleşmeye çalıştı, engellendi');
            return;
        }
        const roomCode = generateRoomCode();
        
        const gameType = (p1.isGuest || p2.isGuest) ? 'casual' : 'ranked';
        console.log(`🎮 Maç oluşturuluyor (${gameType.toUpperCase()}): ${p1.playerName} vs ${p2.playerName}`);

        const room = {
            code: roomCode,
            players: { 
                [p1.playerId]: { 
                    name: p1.playerName,
                    telegramId: p1.telegramId,
                    photoUrl: p1.photoUrl,
                    level: p1.level,
                    elo: p1.elo,
                    isGuest: p1.isGuest
                }, 
                [p2.playerId]: { 
                    name: p2.playerName,
                    telegramId: p2.telegramId,
                    photoUrl: p2.photoUrl,
                    level: p2.level,
                    elo: p2.elo,
                    isGuest: p2.isGuest
                } 
            },
            type: gameType,
            startTime: Date.now()
        };

        rooms.set(roomCode, room);
        p1.ws.roomCode = roomCode;
        p2.ws.roomCode = roomCode;

        const gameState = initializeGame(roomCode, p1.playerId, p2.playerId);

        sendMessage(p1.ws, { type: 'matchFound', roomCode, opponent: room.players[p2.playerId], gameType });
        sendMessage(p2.ws, { type: 'matchFound', roomCode, opponent: room.players[p1.playerId], gameType });

        // CRITICAL FIX: Send gameStart immediately to both players
        setTimeout(() => {
            const gameStartMsg = { type: 'gameStart', gameState: { ...gameState, playerId: p1.playerId } };
            sendMessage(p1.ws, gameStartMsg);
            
            const gameStartMsg2 = { type: 'gameStart', gameState: { ...gameState, playerId: p2.playerId } };
            sendMessage(p2.ws, gameStartMsg2);
            
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 500);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}*/

function handleCancelSearch(ws) {
    // Her iki kuyruktan da oyuncuyu bul ve çıkar
    const rankedIndex = rankedQueue.findIndex(p => p.ws === ws);
    if (rankedIndex !== -1) {
        rankedQueue.splice(rankedIndex, 1);
        console.log(`❌ ${ws.playerName} dereceli aramayı iptal etti - Kalan: ${rankedQueue.length}`);
    }

    const casualIndex = casualQueue.findIndex(p => p.ws === ws);
    if (casualIndex !== -1) {
        casualQueue.splice(casualIndex, 1);
        console.log(`❌ ${ws.playerName} casual aramayı iptal etti - Kalan: ${casualQueue.length}`);
    }

    sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode();
    const playerId = generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName;
    ws.roomCode = roomCode;
    playerConnections.set(playerId, ws);

    rooms.set(roomCode, {
        code: roomCode,
        players: { [playerId]: { name: data.playerName } },
        type: 'private',
        host: playerId
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
}

function handleJoinRoom(ws, data) {
    const room = rooms.get(data.roomCode);
    if (!room || Object.keys(room.players).length >= 2) {
        return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı veya dolu' });
    }

    const playerId = generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName;
    ws.roomCode = data.roomCode;
    playerConnections.set(playerId, ws);
    room.players[playerId] = { name: data.playerName };

    const hostId = room.host;
    const gameState = initializeGame(data.roomCode, hostId, playerId);

    setTimeout(() => {
        sendGameState(data.roomCode, hostId);
        sendGameState(data.roomCode, playerId);
        // Herkese oyunun başladığını bildir
        [hostId, playerId].forEach(pid => {
            const socket = playerConnections.get(pid);
            if(socket) socket.send(JSON.stringify({ type: 'gameStart', gameState: {...gameState, playerId: pid} }));
        });
    }, 500);
}

function handlePlayTile(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    const tile = player.hand[data.tileIndex];

    if (!tile) return;

    const boardCopy = JSON.parse(JSON.stringify(gs.board));
    const success = playTileOnBoard(tile, gs.board, data.position);

    if (!success) {
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz (Pozisyon uyuşmuyor)' });
    }

    player.hand.splice(data.tileIndex, 1);
    gs.moves = (gs.moves || 0) + 1;
    
    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

// Oyuncunun oyun sonu istatistiklerini güncelleyen ve gönderen yardımcı fonksiyon
async function sendUpdatedStats(telegramId) {
    if (!telegramId) return;

    const player = await Player.findOne({ telegramId });
    if (!player) return;

    const ws = Array.from(playerConnections.values()).find(client => client.telegramId === telegramId && client.readyState === WebSocket.OPEN);
    if (ws) {
        sendMessage(ws, {
            type: 'statsUpdate',
            player: {
                id: player._id,
                telegramId: player.telegramId,
                username: player.username,
                elo: player.elo,
                level: player.level,
                wins: player.wins,
                losses: player.losses,
                draws: player.draws,
                totalGames: player.totalGames,
                winStreak: player.winStreak,
                bestWinStreak: player.bestWinStreak
            }
        });
    }
}

async function handleGameEnd(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room) return;

    try {
        const playerIds = Object.keys(gameState.players);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const player1TelegramId = room.players[player1Id]?.telegramId;
        const player2TelegramId = room.players[player2Id]?.telegramId;

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;

        // ELO güncellemesi için kontrol: Maç 'ranked' olmalı VE her iki oyuncu da misafir (guest) olmamalı.
        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
        // *** KRİTİK DÜZELTME: Oda tipinin 'ranked' olup olmadığını kontrol et ***
        const isRankedMatch = room.type === 'ranked' && !player1IsGuest && !player2IsGuest;

        if (isRankedMatch) {
            // Her iki oyuncu da Telegram ile girdi - ELO guncelle
            const player1 = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const player2 = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (!player1 || !player2) {
                console.error('❌ Oyuncular MongoDB\'de bulunamadı');
                broadcastToRoom(roomCode, { 
                    type: 'gameEnd',
                    winner: winnerId, 
                    winnerName: isDraw ? 'Beraberlik' : gameState.players[winnerId].name,
                    isRanked: false
                });
                rooms.delete(roomCode);
                return;
            }

            if (!isDraw) {
                const winner = winnerId === player1Id ? player1 : player2;
                const loser = winnerId === player1Id ? player2 : player1;

                eloChanges = calculateElo(winner.elo, loser.elo, winner.level);

                winner.elo = eloChanges.winnerElo;
                winner.level = calculateLevel(winner.elo);
                winner.wins += 1;
                winner.winStreak += 1;
                winner.bestWinStreak = Math.max(winner.bestWinStreak, winner.winStreak);
                winner.totalGames += 1;
                winner.lastPlayed = new Date();

                loser.elo = eloChanges.loserElo;
                loser.level = calculateLevel(loser.elo);
                loser.losses += 1;
                loser.winStreak = 0;
                loser.totalGames += 1;
                loser.lastPlayed = new Date();

                await winner.save();
                await loser.save();

                const match = new Match({
                    player1: player1._id,
                    player2: player2._id,
                    winner: winner._id,
                    player1Elo: winnerId === player1Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player2Elo: winnerId === player2Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player1EloChange: winnerId === player1Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    player2EloChange: winnerId === player2Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    moves: gameState.moves || 0,
                    duration: Math.floor((Date.now() - room.startTime) / 1000),
                    gameType: 'ranked',
                    isDraw: false
                });
                await match.save();

                console.log(`🏆 RANKED Maç bitti: ${winner.username} kazandı! ELO: ${eloChanges.winnerChange > 0 ? '+' : ''}${eloChanges.winnerChange}`);
            } else {
                player1.draws += 1;
                player1.totalGames += 1;
                player1.winStreak = 0;
                player1.lastPlayed = new Date();

                player2.draws += 1;
                player2.totalGames += 1;
                player2.winStreak = 0;
                player2.lastPlayed = new Date();

                await player1.save();
                await player2.save();

                const match = new Match({
                    player1: player1._id,
                    player2: player2._id,
                    player1Elo: player1.elo,
                    player2Elo: player2.elo,
                    player1EloChange: 0,
                    player2EloChange: 0,
                    moves: gameState.moves || 0,
                    duration: Math.floor((Date.now() - room.startTime) / 1000),
                    gameType: 'ranked',
                    isDraw: true
                });
                await match.save();
            }
        } else {
            // Casual (Guest) maç - ELO guncellenmez
            console.log(`🎮 CASUAL Maç bitti: ${isDraw ? 'Beraberlik' : gameState.players[winnerId].name + ' kazandı'}`);
        }

        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: isDraw ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: isRankedMatch,
            eloChanges: eloChanges ? {
                winner: eloChanges.winnerChange,
                loser: eloChanges.loserChange
            } : null
        });

        // Her iki oyuncuya da güncel istatistiklerini gönder
        if (isRankedMatch) {
            await Promise.all([sendUpdatedStats(player1TelegramId), sendUpdatedStats(player2TelegramId)]);
        }

        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: false
        });
        rooms.delete(roomCode);
    }
}

function handlePass(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return;

    const playerHand = gs.players[ws.playerId].hand;
    const canPlay = playerHand.some(tile => canPlayTile(tile, gs.board));

    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var, pas geçemezsiniz!' });
    }

    gs.turn++;
    gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
    
    // Pas geçildiğinde oyunun bitip bitmediğini kontrol et
    const winner = checkWinner(gs); // Bu fonksiyon kilitlenme durumunu kontrol eder
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    // YENİ KONTROL: Oyunun ilk hamlesi yapılmadan pazardan taş çekilemez.
    if (gs.board.length === 0) {
        return sendMessage(ws, { type: 'error', message: 'Oyuna başlamak için önce bir taş oynamalısınız!' });
    }

    const player = gs.players[ws.playerId];
    
    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
        return;
    }

    // Pazardan taş çek
    const drawnTile = gs.market.shift();
    player.hand.push(drawnTile);
    
    console.log(`🎲 ${player.name} pazardan taş çekti: [${drawnTile}] - Kalan: ${gs.market.length}`);
    
    // Çekilen taş oynanabilir mi kontrol et
    const canPlayDrawn = canPlayTile(drawnTile, gs.board);
    
    if (!canPlayDrawn) {
        // Oynanamıyor, tekrar çekmeli mi yoksa sıra geçmeli mi?
        // Domino kurallarına göre: Oynanabilir taş bulana kadar çeker
        const hasPlayable = player.hand.some(tile => canPlayTile(tile, gs.board));
        
        if (!hasPlayable && gs.market.length > 0) {
            // Hala oynanabilir taş yok ve pazar doluysa, oyuncu tekrar çekebilir
            sendMessage(ws, { type: 'info', message: 'Taş oynanamıyor, tekrar çekin veya bekleyin' });
        } else if (!hasPlayable && gs.market.length === 0) {
            // Pazar bitti ve hala oynanabilir taş yok - sıra geç
            console.log(`❌ ${player.name} oynanabilir taş bulamadı - Sıra geçiyor`);
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        }
    }
    
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleLeaveGame(ws) {
    const room = rooms.get(ws.roomCode);
    const roomCode = ws.roomCode; // Oda kodunu sakla
    ws.roomCode = null; // *** KRİTİK: Oyuncunun oda bilgisini hemen temizle ***

    if (!room || !room.gameState || !ws.playerId) {
        // Oyuncu bir odada değilse veya oyun başlamamışsa, sadece bağlantı bilgilerini temizle
        return; // Zaten temizlendi, çık
    }

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    // Eğer oyunda 2 oyuncu yoksa (beklenmedik durum), odayı temizle
    if (playerIds.length !== 2) {
        // Kalan oyuncuya (varsa) ayrılma bilgisi gönder
        broadcastToRoom(roomCode, { type: 'opponentLeft', roomCleared: true });
        rooms.delete(roomCode);
        return;
    }

    const leaverId = ws.playerId;
    const winnerId = playerIds.find(id => id !== leaverId);

    // Kalan oyuncuya haber ver
    const winnerWs = playerConnections.get(winnerId);
    if (winnerWs) {
        sendMessage(winnerWs, { type: 'opponentLeft', roomCleared: true });
        // Kazanan oyuncunun da oda bilgisini temizle ki yeni oyun arayabilsin
        winnerWs.roomCode = null; 
    }

    console.log(`🏃‍♂️ ${room.players[leaverId]?.name} oyundan ayrıldı. Kazanan: ${room.players[winnerId]?.name}`);
    
    // Oyunu sonlandır (ELO hesaplaması vb. için)
    // Not: handleGameEnd fonksiyonu zaten odayı siliyor.
    handleGameEnd(roomCode, winnerId, gs);
}

function handleDisconnect(ws) {
    console.log(`🔌 Bağlantı koptu: ${ws.playerName || ws.playerId || 'Bilinmeyen'}`);

    if (ws.roomCode && rooms.has(ws.roomCode)) {
        const room = rooms.get(ws.roomCode);
        // Oyun başlamışsa yeniden bağlanma sürecini başlat
        if (room.gameState) {
            console.log(`⏳ Oyuncu ${ws.playerId} için yeniden bağlanma süreci başlatıldı.`);
            broadcastToRoom(ws.roomCode, { type: 'opponentDisconnected' }, ws.playerId);

            const timer = setTimeout(() => {
                console.log(`⏰ Oyuncu ${ws.playerId} zamanında bağlanamadı. Oyundan atılıyor.`);
                handleLeaveGame(ws); // Zaman aşımında oyundan at
                disconnectedPlayers.delete(ws.playerId);
            }, 30000); // 30 saniye bekleme süresi

            disconnectedPlayers.set(ws.playerId, { roomCode: ws.roomCode, timer });
            playerConnections.delete(ws.playerId); // Eski bağlantıyı sil
            return; // handleLeaveGame'i hemen çağırma
        }
    }

    // Oyun başlamamışsa veya odada değilse, normal ayrılma işlemi yap
    handleLeaveGame(ws);
    playerConnections.delete(ws.playerId);
    
    const rankedIdx = rankedQueue.findIndex(p => p.ws === ws);
    if (rankedIdx !== -1) {
        rankedQueue.splice(rankedIdx, 1);
        console.log(`❌ Dereceli kuyruktan çıkarıldı - Kalan: ${rankedQueue.length}`);
    }

    const casualIdx = casualQueue.findIndex(p => p.ws === ws);
    if (casualIdx !== -1) {
        casualQueue.splice(casualIdx, 1);
        console.log(`❌ Casual kuyruktan çıkarıldı - Kalan: ${casualQueue.length}`);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
