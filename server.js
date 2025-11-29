const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- MongoDB Bağlantısı ve Modeller (Aynı Bırakıldı) ---
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB bağlantısı başarılı - Domino Game Database'))
.catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

// Mongoose Schemas
const playerSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    photoUrl: { type: String },
    elo: { type: Number, default: 1000 }, // Başlangıç ELO'su 1000 olarak güncellendi
    level: { type: Number, default: 1 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastPlayed: { type: Date, default: Date.now },
    isHidden: { type: Boolean, default: false }
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
    gameType: { type: String, enum: ['ranked', 'private', 'casual'], default: 'ranked' },
    createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);

app.use(cors());
app.use(express.json());

const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map();
const playerToRoomMap = new Map(); // playerId -> roomCode

const ADMIN_TELEGRAM_ID = '976640409'; // Admin Telegram ID'si

// --- ELO ve Level Hesaplama (Aynı Bırakıldı) ---
function calculateElo(winnerElo, loserElo, winnerLevel) {
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13; // 13-20
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10; // 10-15
    }
    
    const loserChange = -Math.floor(winnerChange * 0.7); 
    
    return {
        winnerElo: winnerElo + winnerChange,
        loserElo: Math.max(0, loserElo + loserChange),
        winnerChange,
        loserChange
    };
}

function calculateLevel(elo) {
    const level = Math.floor(elo / 100) + 1;
    return level > 10 ? 10 : level; 
}

// --- API Endpoints (Aynı Bırakıldı) ---
// (API kodları temizlik için kısaltıldı, server.js dosyanızdaki tüm API'ler korunmalıdır.)

app.post('/api/auth/telegram', async (req, res) => { /* ... mevcut auth kodu ... */ 
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
                photoUrl,
                elo: 1000 // Yeni oyuncuya 1000 ELO ver
            });
            await player.save();
        } else {
            // Profil bilgilerini güncelle
            player.username = username;
            player.firstName = firstName;
            player.lastName = lastName;
            player.photoUrl = photoUrl;
            player.lastPlayed = new Date();
            // Level'ı ELO'ya göre güncelle
            player.level = calculateLevel(player.elo); 
            await player.save();
        }
        
        res.json({ success: true, player });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/leaderboard', async (req, res) => { /* ... mevcut leaderboard kodu ... */ 
    try {
        const players = await Player.find({ isHidden: { $ne: true } })
            .sort({ elo: -1 })
            .limit(10) 
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames winStreak');
        
        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Diğer API'ler (admin, stats) mevcut server.js dosyanızdaki gibi korunmalıdır.

const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    clientTracking: true
});

// --- PROFESSIONAL DOMINO 101 GAME LOGIC (DÜZELTİLDİ) ---

function generateRoomCode() { /* ... aynı kaldı ... */
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createDominoSet() { /* ... aynı kaldı ... */
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return tiles;
}

function shuffleArray(array) { /* ... aynı kaldı ... */
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

/**
 * Oyunu Başlatır ve İlk Hamleyi Yapanı Belirler
 * @param {string} roomCode 
 * @param {string} player1Id 
 * @param {string} player2Id 
 * @returns {object} Yeni Oyun Durumu
 */
async function initializeGame(roomCode, player1Id, player2Id) {
    const allTiles = shuffleArray(createDominoSet());
    const player1Hand = allTiles.slice(0, 7); 
    const player2Hand = allTiles.slice(7, 14); 
    const market = allTiles.slice(14); 

    const room = rooms.get(roomCode);
    
    let startingPlayer = player1Id;
    let highestDouble = -1;
    let highestDoubleTile = null;
    
    // 1. En yüksek çifti bul
    for (const [playerId, hand] of [[player1Id, player1Hand], [player2Id, player2Hand]]) {
        for (let tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                highestDoubleTile = tile;
                startingPlayer = playerId;
            }
        }
    }

    // 2. İlk hamle: En yüksek çift taşa sahip oyuncu tahtaya bu taşı atar.
    let initialBoard = [];
    if (highestDouble !== -1) {
        // Taşı elden çıkar
        const handToUpdate = startingPlayer === player1Id ? player1Hand : player2Hand;
        const tileIndex = handToUpdate.findIndex(t => t[0] === highestDoubleTile[0] && t[1] === highestDoubleTile[1]);
        if (tileIndex !== -1) {
            handToUpdate.splice(tileIndex, 1);
        }
        initialBoard.push(highestDoubleTile);
    } 
    // Not: Global domino kurallarında başlangıçta en yüksek çift taş varsa oynanır, yoksa en yüksek değere sahip taş oynanır.
    // Şimdilik sadece çift taş kuralını uyguluyoruz. Çift taş yoksa, rastgele birine verilir, ilk taşı kendisi oynar.
    else {
         // Çift taş yoksa, rastgele başlayan oyuncu elindeki en büyük taşı oynayabilir (Client oynayacak).
        startingPlayer = Math.random() < 0.5 ? player1Id : player2Id;
    }
    
    // DB'den oyuncu verilerini çek
    const p1Data = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
    const p2Data = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

    room.gameState = {
        board: initialBoard,
        status: 'playing',
        market: market,
        currentPlayer: startingPlayer,
        players: {
            [player1Id]: { 
                hand: player1Hand, 
                name: room.players[player1Id].name,
                photoUrl: room.players[player1Id].photoUrl,
                elo: p1Data ? p1Data.elo : 1000,
                level: p1Data ? p1Data.level : 1,
                telegramId: room.players[player1Id].telegramId
            },
            [player2Id]: { 
                hand: player2Hand, 
                name: room.players[player2Id].name,
                photoUrl: room.players[player2Id].photoUrl,
                elo: p2Data ? p2Data.elo : 1000,
                level: p2Data ? p2Data.level : 1,
                telegramId: room.players[player2Id].telegramId
            }
        },
        turn: 1,
        startTime: Date.now()
    };
    
    // Eğer ilk taş otomatik atıldıysa, sırayı diğer oyuncuya geçir.
    if (initialBoard.length > 0) {
        const nextPlayer = Object.keys(room.gameState.players).find(id => id !== startingPlayer);
        room.gameState.currentPlayer = nextPlayer;
        room.gameState.turn++;
    }


    rooms.set(roomCode, room);
    console.log(`🎮 Oyun Başlatıldı. Kod: ${roomCode} - Başlayan: ${room.gameState.players[room.gameState.currentPlayer].name}`);
    return room.gameState;
}

// Oynanabilirlik Kontrolü (Düzeltildi)
function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Hamle Konumlarını Alma (Düzeltildi)
function getValidMoves(tile, board) {
    if (board.length === 0) return ['start'];
    
    const moves = [];
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

// Taşı Tahtaya Oynama (Düzeltildi - Taşın Yönünü Korur/Çevirir)
function playTile(tile, position, board) {
    const newBoard = [...board];
    
    if (position === 'start' || newBoard.length === 0) {
        newBoard.push(tile); // İlk taş, olduğu gibi eklenir
    } else if (position === 'left') {
        const leftEnd = newBoard[0][0];
        if (tile[1] === leftEnd) {
            newBoard.unshift(tile); // [X, Y] -> [..., Y, X] doğru
        } else if (tile[0] === leftEnd) {
            newBoard.unshift([tile[1], tile[0]]); // [X, Y] ters çevrilir -> [..., X, Y]
        }
    } else if (position === 'right') {
        const rightEnd = newBoard[newBoard.length - 1][1];
        if (tile[0] === rightEnd) {
            newBoard.push(tile); // [X, Y] -> [X, Y, ...] doğru
        } else if (tile[1] === rightEnd) {
            newBoard.push([tile[1], tile[0]]); // [X, Y] ters çevrilir -> [Y, X, ...]
        }
    }
    
    return newBoard;
}

function checkWinCondition(hand) {
    return hand.length === 0;
}

function checkBlockedGame(gameState) { /* ... aynı kaldı ... */
    const { players, board, market } = gameState;
    
    if (market.length > 0) return false;
    
    // Her oyuncu oynayabilir mi?
    for (let playerId in players) {
        const hand = players[playerId].hand;
        for (let tile of hand) {
            if (canPlayTile(tile, board)) {
                return false;
            }
        }
    }
    
    return true;
}

function calculateHandPoints(hand) {
    return hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
}

// Kilitli oyunda kazananı hesaplar
function calculateBlockedWinner(gameState) {
    const [p1Id, p2Id] = Object.keys(gameState.players);
    const p1Points = calculateHandPoints(gameState.players[p1Id].hand);
    const p2Points = calculateHandPoints(gameState.players[p2Id].hand);
    
    if (p1Points === p2Points) return 'DRAW'; 
    return p1Points < p2Points ? p1Id : p2Id;
}

// --- Yeni Fonksiyon: Maç Sonucu Kaydetme ve ELO Güncelleme ---
async function handleGameEnd(roomCode, winnerId, reason) {
    const room = rooms.get(roomCode);
    if (!room || room.gameState.status === 'finished') return;
    
    room.gameState.status = 'finished';
    
    const [p1Id, p2Id] = Object.keys(room.gameState.players);
    const p1Info = room.gameState.players[p1Id];
    const p2Info = room.gameState.players[p2Id];

    let p1DB = await Player.findOne({ telegramId: p1Info.telegramId });
    let p2DB = await Player.findOne({ telegramId: p2Info.telegramId });

    if (!p1DB || !p2DB) {
        console.log(`⚠️ DB kaydı bulunamadı. Game End (Code: ${roomCode})`);
        return; 
    }

    let p1Change = 0;
    let p2Change = 0;
    let isDraw = winnerId === 'DRAW';
    let winnerDBId = null;

    if (isDraw) {
        p1DB.draws++;
        p2DB.draws++;
        p1DB.winStreak = 0;
        p2DB.winStreak = 0;
    } else {
        const winnerDB = (winnerId === p1Id) ? p1DB : p2DB;
        const loserDB = (winnerId === p1Id) ? p2DB : p1DB;
        winnerDBId = winnerDB._id;

        const { winnerElo: newWinnerElo, loserElo: newLoserElo, winnerChange, loserChange } = calculateElo(winnerDB.elo, loserDB.elo, winnerDB.level);
        
        winnerDB.elo = newWinnerElo;
        loserDB.elo = newLoserElo;

        winnerDB.wins++;
        loserDB.losses++;
        
        winnerDB.winStreak = winnerDB.winStreak + 1;
        winnerDB.bestWinStreak = Math.max(winnerDB.bestWinStreak, winnerDB.winStreak);
        loserDB.winStreak = 0;
        
        if (winnerId === p1Id) {
            p1Change = winnerChange;
            p2Change = loserChange;
        } else {
            p1Change = loserChange;
            p2Change = winnerChange;
        }
    }
    
    p1DB.totalGames++;
    p2DB.totalGames++;
    p1DB.level = calculateLevel(p1DB.elo);
    p2DB.level = calculateLevel(p2DB.elo);
    
    await p1DB.save();
    await p2DB.save();

    // Maç kaydını oluştur
    const newMatch = new Match({
        player1: p1DB._id,
        player2: p2DB._id,
        winner: winnerDBId,
        player1Elo: p1Info.elo,
        player2Elo: p2Info.elo,
        player1EloChange: p1Change,
        player2EloChange: p2Change,
        duration: Date.now() - room.startTime,
        isDraw: isDraw,
        gameType: room.type,
    });
    await newMatch.save();

    console.log(`🏆 Maç Bitti (${roomCode}). Kazanan: ${winnerId} - Sebep: ${reason}`);

    // Oyunculara sonucu gönder
    const p1Ws = playerConnections.get(p1Id);
    const p2Ws = playerConnections.get(p2Id);
    
    sendMessage(p1Ws, { type: 'gameEnd', winner: winnerId, reason, myEloChange: p1Change });
    sendMessage(p2Ws, { type: 'gameEnd', winner: winnerId, reason, myEloChange: p2Change });

    // Odayı ve bağlantıları temizle
    rooms.delete(roomCode);
    playerToRoomMap.delete(p1Id);
    playerToRoomMap.delete(p2Id);
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    for (const playerId of Object.keys(room.gameState.players)) {
        if (playerId === excludePlayer) continue;
        const ws = playerConnections.get(playerId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { 
                // Güncel state'i gönderirken sadece kendi elini göreceği şekilde filtrele
                const sanitizedState = getSanitizedGameStateForPlayer(roomCode, playerId);
                sendMessage(ws, { 
                    type: 'gameUpdate', 
                    gameState: sanitizedState 
                });
            } catch (e) {
                console.error(`Broadcast hatası (${playerId}):`, e.message);
            }
        }
    }
}

function sendMessage(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {}
    }
}

function getSanitizedGameStateForPlayer(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const fullGameState = room.gameState;
    const opponentId = Object.keys(fullGameState.players).find(id => id !== playerId);

    const sanitizedState = {
        board: fullGameState.board,
        marketSize: fullGameState.market.length,
        currentPlayer: fullGameState.currentPlayer,
        isMyTurn: fullGameState.currentPlayer === playerId,
        myHand: fullGameState.players[playerId].hand,
        opponentHandSize: opponentId ? fullGameState.players[opponentId].hand.length : 0,
        status: fullGameState.status,
        roomCode: roomCode,
        myPlayerId: playerId
    };

    return sanitizedState;
}

function getPlayerRoom(playerId) {
    const roomCode = playerToRoomMap.get(playerId);
    return rooms.get(roomCode);
}

// --- WEBSOCKET EVENTLERİ VE HANDLERLAR ---

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'pass': handlePass(ws); break; 
                case 'leaveGame': handleLeaveGame(ws); break;
                // 'rejoinGame', 'createRoom', 'joinRoom' diğer özel durumlar için eklenmelidir.
            }
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
            sendMessage(ws, { type: 'error', message: 'Geçersiz mesaj formatı.' });
        }
    });

    ws.on('close', () => handleDisconnect(ws));
});

// ... pingInterval ve wss.on('close') mevcut server.js dosyanızdaki gibi korunmalıdır.

// --- PROFESSIONAL DOMINO GAME HANDLERS ---

function handlePlayTile(ws, data) {
    const { tileIndex, position } = data;
    const playerId = ws.playerId;
    const room = getPlayerRoom(playerId);
    
    if (!room) return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    
    const gameState = room.gameState;
    
    if (gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    const playerHand = gameState.players[playerId].hand;
    if (tileIndex < 0 || tileIndex >= playerHand.length) {
        return sendMessage(ws, { type: 'error', message: 'Geçersiz taş' });
    }
    
    const tile = playerHand[tileIndex];
    const validMoves = getValidMoves(tile, gameState.board);
    
    if (!validMoves.includes(position)) {
        return sendMessage(ws, { type: 'error', message: 'Bu taşı buraya oynayamazsın' });
    }
    
    // Play the tile
    const newBoard = playTile(tile, position, gameState.board);
    playerHand.splice(tileIndex, 1);
    gameState.board = newBoard;
    
    // Kazanma Durumu Kontrolü (El bitti)
    if (checkWinCondition(playerHand)) {
        handleGameEnd(room.code, playerId, 'no_tiles');
        return;
    }
    
    // Sırayı Değiştir
    const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
    gameState.currentPlayer = nextPlayer;
    gameState.turn++;
    
    // Tahta Kilitlenme Kontrolü (Oynanacak bir taş var mı?)
    if (checkBlockedGame(gameState)) {
        const blockedWinner = calculateBlockedWinner(gameState);
        handleGameEnd(room.code, blockedWinner, 'blocked');
        return;
    }

    // Oyun durumunu yayınla
    broadcastToRoom(room.code, {}); // İçerik boş olsa da, broadcast fonksiyonu güncel state'i gönderecek
}

function handleDrawFromMarket(ws) {
    const playerId = ws.playerId;
    const room = getPlayerRoom(playerId);
    
    if (!room) return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    
    const gameState = room.gameState;
    
    if (gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    if (gameState.market.length === 0) {
        return sendMessage(ws, { type: 'error', message: 'Pazarda taş kalmadı' });
    }
    
    const playerHand = gameState.players[playerId].hand;
    
    // KURAL KONTROLÜ: Elinde oynanabilir taş var mı?
    const hasPlayableTile = playerHand.some(tile => canPlayTile(tile, gameState.board));
    
    if (hasPlayableTile) {
        return sendMessage(ws, { type: 'error', message: 'Elinde oynayabileceğin taş var. Önce onu oynamalısın!' });
    }
    
    // Pazardan taş çek
    const drawnTile = gameState.market.shift();
    playerHand.push(drawnTile);
    
    // Çekilen taş oynanabilir mi?
    if (canPlayTile(drawnTile, gameState.board)) {
        // Oynanabilir, sıra oyuncuda kalır, taşı oynaması beklenir.
        sendMessage(ws, { type: 'gameUpdate', gameState: getSanitizedGameStateForPlayer(room.code, playerId) });
        sendMessage(ws, { type: 'info', message: 'Pazardan taş çektin. Yeni taşını şimdi oyna!' });
    } else {
        // Oynanamaz, sıra diğer oyuncuya geçer
        const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
        gameState.currentPlayer = nextPlayer;
        gameState.turn++;

        // Tahta Kilitlenme Kontrolü
        if (checkBlockedGame(gameState)) {
            const blockedWinner = calculateBlockedWinner(gameState);
            handleGameEnd(room.code, blockedWinner, 'blocked_after_draw');
            return;
        }

        broadcastToRoom(room.code, {}); 
        sendMessage(ws, { type: 'info', message: 'Çektiğin taş uymadı. Sıra rakibe geçti.' });
    }
}

function handlePass(ws) {
    const playerId = ws.playerId;
    const room = getPlayerRoom(playerId);
    
    if (!room) return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    
    const gameState = room.gameState;
    
    if (gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    const playerHand = gameState.players[playerId].hand;
    const hasPlayableTile = playerHand.some(tile => canPlayTile(tile, gameState.board));

    // KURAL KONTROLÜ: Pazarda taş varken pas geçilemez.
    if (gameState.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: 'Pazarda taş varken pas geçemezsin. Önce çekmelisin.' });
    }
    
    // KURAL KONTROLÜ: Oynayacak taş varken pas geçilemez.
    if (hasPlayableTile) {
        return sendMessage(ws, { type: 'error', message: 'Oynayabileceğin taş varken pas geçemezsin.' });
    }
    
    // Pas başarılı, sırayı değiştir
    const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
    gameState.currentPlayer = nextPlayer;
    gameState.turn++;
    
    // Tahta Kilitlenme Kontrolü
    if (checkBlockedGame(gameState)) {
        const blockedWinner = calculateBlockedWinner(gameState);
        handleGameEnd(room.code, blockedWinner, 'blocked_after_pass');
        return;
    }
    
    broadcastToRoom(room.code, {});
    sendMessage(ws, { type: 'info', message: 'Pas geçtin. Sıra rakibe geçti.' });
}

function handleLeaveGame(ws) {
    const playerId = ws.playerId;
    const room = getPlayerRoom(playerId);
    
    if (!room || room.gameState.status === 'finished') {
        return sendMessage(ws, { type: 'error', message: 'Zaten oyundan çıktınız veya oyun bitmişti.' });
    }
    
    // Rakibi bul ve kazanan ilan et
    const opponentId = Object.keys(room.gameState.players).find(id => id !== playerId);
    
    // Rakibe oyunun bittiğini bildir
    sendMessage(playerConnections.get(opponentId), { 
        type: 'gameEnd', 
        winner: opponentId, 
        reason: 'opponent_left' 
    });

    // Maç sonucu kaydetme (Kalan oyuncu kazanır)
    handleGameEnd(room.code, opponentId, 'opponent_left'); 
}

function handleDisconnect(ws) {
    const playerId = ws.playerId;
    if (!playerId) return;

    // Kuyruktan çıkar
    const index = matchQueue.findIndex(p => p.playerId === playerId);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} kuyruktan ayrıldı.`);
    }

    // Odadan çıkar (oyun devam ediyorsa rakip kazanır)
    const room = getPlayerRoom(playerId);
    if (room && room.gameState.status === 'playing') {
        handleLeaveGame(ws);
    }

    playerConnections.delete(playerId);
    playerToRoomMap.delete(playerId);
    console.log(`❌ ${ws.playerName} bağlantısı kesildi.`);
}

async function handleFindMatch(ws, data) {
    // ... Çoğu kodu mevcut server.js dosyanızdaki gibi korunmalıdır ...
    
    // Yeni oyuncu ID'si oluştur veya mevcut olanı kullan
    let playerId = ws.playerId || generateRoomCode();
    
    // Gelen Telegram ID'ye göre DB'den ELO ve Level çek.
    let playerDBData = { elo: 1000, level: 1 };
    if (data.telegramId) {
        const dbPlayer = await Player.findOne({ telegramId: data.telegramId });
        if (dbPlayer) {
            playerDBData.elo = dbPlayer.elo;
            playerDBData.level = dbPlayer.level;
            playerId = dbPlayer._id.toString(); // DB ID'sini kullan
        }
    }

    // WebSocket objesine bilgileri ata
    ws.playerId = playerId;
    ws.playerName = data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = playerDBData.level; 
    ws.elo = playerDBData.elo;
    ws.isGuest = !data.telegramId; 
    
    playerConnections.set(playerId, ws);
    
    const existingInQueue = matchQueue.find(p => p.playerId === playerId);
    if (existingInQueue) {
        return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
    }

    matchQueue.push({ 
        ws, 
        playerId, 
        playerName: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest
    });

    // Eşleştirme Kontrolü
    if (matchQueue.length >= 2) {
        const p1 = matchQueue.shift();
        const p2 = matchQueue.shift();
        const roomCode = generateRoomCode();
        
        const gameType = (p1.isGuest || p2.isGuest) ? 'casual' : 'ranked';

        const room = {
            code: roomCode,
            players: { 
                [p1.playerId]: { 
                    name: p1.playerName, telegramId: p1.telegramId, photoUrl: p1.photoUrl, level: p1.level, elo: p1.elo, isGuest: p1.isGuest
                }, 
                [p2.playerId]: { 
                    name: p2.playerName, telegramId: p2.telegramId, photoUrl: p2.photoUrl, level: p2.level, elo: p2.elo, isGuest: p2.isGuest
                } 
            },
            type: gameType,
            startTime: Date.now()
        };

        rooms.set(roomCode, room);
        playerToRoomMap.set(p1.playerId, roomCode);
        playerToRoomMap.set(p2.playerId, roomCode);

        // Oyunu Başlat
        const gameState = await initializeGame(roomCode, p1.playerId, p2.playerId);

        sendMessage(p1.ws, { type: 'matchFound', roomCode, opponent: room.players[p2.playerId], gameType });
        sendMessage(p2.ws, { type: 'matchFound', roomCode, opponent: room.players[p1.playerId], gameType });

        // CRITICAL FIX: Send gameStart with sanitized state
        setTimeout(() => {
            const p1State = getSanitizedGameStateForPlayer(roomCode, p1.playerId);
            const p2State = getSanitizedGameStateForPlayer(roomCode, p2.playerId);

            sendMessage(p1.ws, { type: 'gameStart', gameState: p1State });
            sendMessage(p2.ws, { type: 'gameStart', gameState: p2State });
        }, 500);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}
