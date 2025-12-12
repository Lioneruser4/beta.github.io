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
const matchQueue = [];
const playerConnections = new Map();
const playerSessions = new Map();

// ELO Calculation
function calculateElo(winnerElo, loserElo, winnerLevel) {
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13;
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10;
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
    return Math.floor(elo / 100) + 1;
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
            .limit(10)
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
    const market = tiles.slice(14);

    const room = rooms.get(roomCode);
    
    let startingPlayer = null;
    let startingDouble = -1;

    for (let i = 1; i <= 6; i++) {
        for (const player of [player1Id, player2Id]) {
            const hand = player === player1Id ? player1Hand : player2Hand;
            if (hand.some(tile => tile[0] === i && tile[1] === i)) {
                startingPlayer = player;
                startingDouble = i;
                break;
            }
        }
        if (startingPlayer) break;
    }
    
    if (!startingPlayer) {
        for (const player of [player1Id, player2Id]) {
            const hand = player === player1Id ? player1Hand : player2Hand;
            if (hand.some(tile => tile[0] === 0 && tile[1] === 0)) {
                startingPlayer = player;
                startingDouble = 0;
                break;
            }
        }
    }
    
    if (!startingPlayer) {
        startingPlayer = [player1Id, player2Id][Math.floor(Math.random() * 2)];
        startingDouble = -1;
        console.log('ℹ️ Kimsede çift taş yok, rastgele başlangıç yapılıyor.');
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
        startingDouble: startingDouble,
        consecutivePasses: 0 // YENİ: Ardışık pas sayacı
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı - Başlayan: ${startingPlayer === player1Id ? room.players[player1Id].name : room.players[player2Id].name} (${startingDouble !== -1 ? startingDouble + '|' + startingDouble : 'Rastgele'})`);
    return room.gameState;
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

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
            board.unshift([tile[1], tile[0]]);
            played = true;
        }
    } 
    
    if (!played && (position === 'right' || position === 'both')) {
        if (tile[0] === rightEnd) {
            board.push(tile);
            played = true;
        } else if (tile[1] === rightEnd) {
            board.push([tile[1], tile[0]]);
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

    const playerIds = Object.keys(gameState.players);
    const player1Id = playerIds[0];
    const player2Id = playerIds[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    // Her iki oyuncu da pas geçti mi? (ardışık 2 pas)
    if (gameState.consecutivePasses >= 2) {
        console.log('ℹ️ İki oyuncu da pas geçti, oyun sonlandırılıyor...');
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        if (player1Sum === player2Sum) return 'DRAW';
        return player1Sum < player2Sum ? player1Id : player2Id;
    }

    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    if (!player1CanPlay && !player2CanPlay && gameState.market.length === 0) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
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

    const gameState = room.gameState;
    const playerSpecificState = {
        board: gameState.board,
        players: gameState.players,
        market: gameState.market,
        currentPlayer: gameState.currentPlayer,
        turn: gameState.turn,
        playerId: playerId,
        marketCount: gameState.market.length
    };

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: playerSpecificState
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {}
    }
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws, data); break;
                case 'pass': handlePass(ws, data); break;
                case 'leaveGame': handleLeaveGame(ws); break;
                case 'reconnectToGame': handleReconnect(ws, data); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız', isReconnect: false });
});

const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// --- OYUN MANTIKLARI ---

function handleFindMatch(ws, data) {
    if (ws.playerId && playerConnections.has(ws.playerId)) {
        const existingInQueue = matchQueue.find(p => p.playerId === ws.playerId);
        if (existingInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
        }
        if (ws.roomCode) {
            return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız' });
        }
    }

    const playerId = ws.playerId || generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;
    
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegramInQueue = matchQueue.find(p => p.telegramId === ws.telegramId);
        if (sameTelegramInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Bu Telegram hesabı zaten eşleşme kuyruğunda' });
        }
    }

    const gameTypeRequest = data.gameType || 'ranked';
    if (gameTypeRequest === 'ranked' && ws.isGuest) {
        return sendMessage(ws, { type: 'error', message: 'Misafir kullanıcılar dereceli maç arayamaz.' });
    }

    playerConnections.set(playerId, ws);
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

    const playerType = ws.isGuest ? 'GUEST' : `LVL ${ws.level}, ELO ${ws.elo}`;
    console.log(`✅ ${ws.playerName} (${playerType}) kuyrukta - Toplam: ${matchQueue.length}`);

    if (matchQueue.length >= 2) {
        const potentialOpponents = matchQueue.filter(p => p.ws !== ws && p.isGuest === ws.isGuest);
        if (potentialOpponents.length === 0) return sendMessage(ws, { type: 'searchStatus', message: 'Uygun rakip bekleniyor...' });
        
        let p1 = matchQueue.splice(matchQueue.findIndex(p => p.ws === ws), 1)[0];
        let p2 = matchQueue.splice(matchQueue.findIndex(p => p.ws === potentialOpponents[0].ws), 1)[0];

        if (!p1.isGuest && !p2.isGuest && p1.telegramId && p2.telegramId && p1.telegramId === p2.telegramId) {
            matchQueue.unshift(p2);
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
                    isGuest: p2.isGuest,
                    isConnected: true
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

        setTimeout(() => {
            sendGameState(roomCode, p1.playerId);
            sendGameState(roomCode, p2.playerId);
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 3000);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti - Kalan: ${matchQueue.length}`);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode();
    ws.playerId = data.telegramId || `guest_${Date.now()}`;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.roomCode = roomCode;
    ws.isGuest = !data.telegramId;
    playerConnections.set(ws.playerId, ws);

    rooms.set(roomCode, {
        code: roomCode,
        players: { 
            [ws.playerId]: { 
                name: ws.playerName,
                telegramId: data.telegramId,
                isGuest: ws.isGuest,
                isConnected: true
            } 
        },
        type: 'private',
        host: ws.playerId
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
    console.log(`🏠 Özel oda oluşturuldu: ${roomCode} - Kurucu: ${ws.playerName}`);
}

function handleJoinRoom(ws, data) {
    const room = rooms.get(data.roomCode);
    if (!room || Object.keys(room.players).length >= 2) {
        return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı veya dolu' });
    }

    ws.playerId = data.telegramId || `guest_${Date.now()}`;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.roomCode = data.roomCode;
    ws.isGuest = !data.telegramId;
    playerConnections.set(ws.playerId, ws);
    room.players[ws.playerId] = { 
        name: ws.playerName,
        telegramId: data.telegramId,
        isGuest: ws.isGuest,
        isConnected: true
    };

    const hostId = room.host;
    const joinerId = ws.playerId;
    const gameState = initializeGame(data.roomCode, hostId, joinerId);

    setTimeout(() => {
        sendGameState(data.roomCode, hostId);
        sendGameState(data.roomCode, joinerId);
        console.log(`✅ ${ws.playerName}, ${room.players[hostId].name}'in odasına katıldı: ${data.roomCode}`);
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

    // İlk hamle kontrolü
    if (gs.board.length === 0 && gs.startingDouble > -1) {
        if (tile[0] !== gs.startingDouble || tile[1] !== gs.startingDouble) {
            return sendMessage(ws, { type: 'error', message: `İlk taş ${gs.startingDouble}-${gs.startingDouble} olmalı!` });
        }
    }

    // Taş oynanabilir mi kontrol et
    if (!canPlayTile(tile, gs.board)) {
        return sendMessage(ws, { type: 'error', message: 'Bu taş oynanamaz!' });
    }

    const success = playTileOnBoard(tile, gs.board, data.position);
    if (!success) {
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz' });
    }

    // Başarıyla oynandı
    player.hand.splice(data.tileIndex, 1);
    gs.moves = (gs.moves || 0) + 1;
    gs.consecutivePasses = 0; // Taş oynandığı için pas sayacını sıfırla

    console.log(`✅ ${player.name} taş oynadı: [${tile}]`);

    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

function handleDrawFromMarket(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    
    // Pazarda taş var mı kontrol et
    if (!gs.market || gs.market.length === 0) {
        console.log(`🎲 ${player.name} pazardan taş çekmek istedi ama pazar boş`);
        
        // Oynayabileceği taş var mı kontrol et
        const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
        
        if (!canPlay) {
            // Oynayabileceği taş yok, pazarda taş yok - PAS
            console.log(`➡️ ${player.name} pas geçiyor (oynanabilir taş yok, pazar boş)`);
            gs.consecutivePasses++;
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
            
            // İki kez art arda pas kontrolü
            const winner = checkWinner(gs);
            if (winner) {
                handleGameEnd(ws.roomCode, winner, gs);
            } else {
                Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
                sendMessage(ws, { type: 'info', message: 'Pazar boş ve oynayabileceğiniz taş yok, sıra rakibe geçti' });
            }
        } else {
            // Oynayabileceği taş var ama çekmeye çalıştı
            sendMessage(ws, { type: 'error', message: 'Oynayabileceğiniz taş var! Pazardan çekmek yerine oynayın.' });
        }
        return;
    }

    // Pazardan taş çek
    const drawnTile = gs.market.shift();
    player.hand.push(drawnTile);
    gs.consecutivePasses = 0; // Taş çektiği için pas sayacını sıfırla
    
    console.log(`🎲 ${player.name} pazardan taş çekti: [${drawnTile}] - Kalan: ${gs.market.length}`);
    
    // Çekilen taş hemen oynanabilir mi?
    const canPlayDrawn = canPlayTile(drawnTile, gs.board);
    
    if (!canPlayDrawn) {
        // Çekilen taş oynanamıyor, elindeki diğer taşları kontrol et
        const hasPlayableInHand = player.hand.some(tile => canPlayTile(tile, gs.board));
        
        if (hasPlayableInHand) {
            // Elinde oynanabilir taş var
            sendMessage(ws, { type: 'info', message: `[${drawnTile}] taşını çektiniz. Elinizde oynanabilir taş var.` });
        } else if (gs.market.length > 0) {
            // Hala pazarda taş var, tekrar çekebilir
            sendMessage(ws, { type: 'info', message: 'Çektiğiniz taş oynanamıyor. Tekrar çekebilirsiniz.' });
        } else {
            // Pazar boş ve hala oynanabilir taş yok - PAS
            console.log(`➡️ ${player.name} pas geçiyor (oynanabilir taş yok, pazar boş)`);
            gs.consecutivePasses++;
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        }
    }
    
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handlePass(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    
    // Oynayabileceği taş var mı kontrol et
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
    
    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Oynayabileceğiniz taş var! Pas geçemezsiniz.' });
    }
    
    // Pazarda taş var mı kontrol et
    if (gs.market && gs.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: 'Önce pazardan taş çekmelisiniz!' });
    }

    // Pas geç
    console.log(`➡️ ${player.name} pas geçti`);
    gs.consecutivePasses++;
    gs.turn++;
    gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
    
    // İki kez art arda pas kontrolü
    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room) return;

    try {
        const playerIds = Object.keys(gameState.players);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;

        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
        const isRankedMatch = room.type === 'ranked' && !player1IsGuest && !player2IsGuest;

        if (isRankedMatch) {
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
                cleanupRoom(roomCode);
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
            } : null,
            reason: isDraw ? 'draw' : 'normal'
        });

        cleanupRoom(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: false
        });
        cleanupRoom(roomCode);
    }
}

function cleanupRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const playerIds = Object.keys(room.players);
    playerIds.forEach(pid => {
        const playerSocket = playerConnections.get(pid);
        if (playerSocket) {
            playerSocket.roomCode = null;
            playerConnections.delete(pid);
        }
    });
    rooms.delete(roomCode);
}

function handleLeaveGame(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || !ws.playerId) {
        return;
    }

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    if (playerIds.length !== 2) {
        cleanupRoom(ws.roomCode);
        return;
    }

    const opponentId = playerIds.find(id => id !== ws.playerId);
    if (opponentId && room.players[opponentId] && room.players[opponentId].disconnectTimer) {
        clearTimeout(room.players[opponentId].disconnectTimer);
        room.players[opponentId].disconnectTimer = null;
        console.log(`ℹ️ ${ws.playerName} oyundan ayrıldığı için ${room.players[opponentId].name}'in bağlantı kesilme zamanlayıcısı iptal edildi.`);
    }

    const leaverId = ws.playerId;
    const winnerId = playerIds.find(id => id !== leaverId);

    handleGameEnd(ws.roomCode, winnerId, gs);
}

function endGameDueToTimeout(roomCode, disconnectedPlayerId) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const playerInfo = room.players[disconnectedPlayerId];
    if (playerInfo && !playerInfo.isConnected) {
        console.log(`⏰ ${playerInfo.name} (${disconnectedPlayerId}) yeniden bağlanmadı. Oyun sonlandırılıyor.`);
        const playerIds = Object.keys(room.players);
        const winnerId = playerIds.find(id => id !== disconnectedPlayerId);
        
        const gameState = room.gameState;
        if (gameState) {
            handleGameEnd(roomCode, winnerId, gameState);
        } else {
            console.log(`⚠️ Oyun durumu bulunamadı, odayı temizliyor: ${roomCode}`);
            cleanupRoom(roomCode);
        }
    } else {
        console.log(`✅ Oyuncu ${disconnectedPlayerId} zaten yeniden bağlanmış veya durumu değişmiş, zamanlayıcı iptal edildi.`);
    }
}

function handleReconnect(ws, data) {
    const { roomCode, playerId } = data;
    const room = rooms.get(roomCode);

    if (!room) {
        return sendMessage(ws, { 
            type: 'error', 
            message: 'Oda bulunamadı. Lütfen yeni bir oyun başlatın.' 
        });
    }

    const player = room.players[playerId];
    if (!player) {
        return sendMessage(ws, { 
            type: 'error', 
            message: 'Bu oyunda kayıtlı değilsiniz.' 
        });
    }

    if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
        console.log(`✅ Oyuncu ${player.name} (${playerId}) yeniden bağlandı: ${roomCode}`);
    }

    player.isConnected = true;
    ws.playerId = playerId;
    ws.roomCode = roomCode;
    playerConnections.set(playerId, ws);

    sendGameState(roomCode, playerId);

    const otherPlayerId = Object.keys(room.players).find(id => id !== playerId);
    if (otherPlayerId && room.players[otherPlayerId]) {
        const otherWs = playerConnections.get(otherPlayerId);
        if (otherWs) {
            sendMessage(otherWs, { 
                type: 'opponentReconnected', 
                message: `${player.name} oyuna geri döndü.` 
            });
        }
    }

    console.log(`🔄 ${player.name} (${playerId}) oyuna yeniden bağlandı. Oda: ${roomCode}`);
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);
    
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }

    if (ws.roomCode && ws.playerId) {
        const room = rooms.get(ws.roomCode);
        if (room && room.players[ws.playerId]) {
            if (playerConnections.get(ws.playerId) === ws) {
                room.players[ws.playerId].isConnected = false;
                playerConnections.delete(ws.playerId);

                console.log(`⏳ ${ws.playerName} (${ws.playerId}) için 60 saniyelik yeniden bağlanma süresi başladı.`);
                broadcastToRoom(ws.roomCode, { type: 'opponentDisconnected', message: 'Rakibin bağlantısı koptu. Yeniden bağlanması bekleniyor...' }, ws.playerId);

                room.players[ws.playerId].disconnectTimer = setTimeout(() => {
                    endGameDueToTimeout(ws.roomCode, ws.playerId);
                }, 60000);
            } else {
                console.log(`ℹ️ Eski bir WebSocket bağlantısı kapandı, ancak oyuncu ${ws.playerId} zaten yeniden bağlanmış.`);
            }
        }
    } else if (ws.playerId && playerConnections.get(ws.playerId) === ws) {
        playerConnections.delete(ws.playerId);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
