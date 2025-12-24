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
    isVisibleInLeaderboard: { type: Boolean, default: true },
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
const playerSessions = new Map(); // telegramId -> player data

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

// Level Calculation - User requested shifts
function calculateLevel(elo) {
    if (elo < 200) return 1; // 0-199 is Level 1
    let lvl = Math.floor(elo / 100); // 200-299 = 2, 300-399 = 3...
    return Math.min(10, lvl); // Max Level 10
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
                id: String(player._id),
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
        const players = await Player.find({ elo: { $gt: 0 }, isVisibleInLeaderboard: { $ne: false } }) // Guest/Yeni oyuncular gözükmesin
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

// --- ADMIN API ---
app.post('/api/admin/players', async (req, res) => {
    try {
        const { adminId } = req.body;
        if (adminId !== '976640409') return res.status(403).json({ error: 'Yetkisiz işlem' });
        
        const players = await Player.find().sort({ createdAt: -1 });
        res.json({ success: true, players });
    } catch (error) {
        console.error('Admin error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/admin/update', async (req, res) => {
    try {
        const { adminId, targetId, updates } = req.body;
        if (adminId !== '976640409') return res.status(403).json({ error: 'Yetkisiz işlem' });

        const player = await Player.findById(targetId);
        if (!player) return res.status(404).json({ error: 'Oyuncu bulunamadı' });

        if (updates.elo !== undefined) {
            player.elo = parseInt(updates.elo);
            player.level = calculateLevel(player.elo);
        }
        if (updates.isVisibleInLeaderboard !== undefined) player.isVisibleInLeaderboard = updates.isVisibleInLeaderboard;

        await player.save();
        res.json({ success: true, player });
    } catch (error) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
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

function dealCardsAndDetermineStart(player1Id, player2Id) {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14);

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
    return { player1Hand, player2Hand, market, startingPlayer, highestDouble };
}

function initializeGame(roomCode, player1Id, player2Id) {
    const { player1Hand, player2Hand, market, startingPlayer, highestDouble } = dealCardsAndDetermineStart(player1Id, player2Id);

    const room = rooms.get(roomCode);

    const getPlayerData = (id, hand) => ({
        hand: hand,
        name: room.players[id].name,
        elo: room.players[id].elo,
        photoUrl: room.players[id].photoUrl,
        level: room.players[id].level,
        timeouts: 0
    });

    room.gameState = {
        board: [],
        players: {
            [player1Id]: getPlayerData(player1Id, player1Hand),
            [player2Id]: getPlayerData(player2Id, player2Hand)
        },
        market: market,
        currentPlayer: startingPlayer, // from dealCardsAndDetermineStart
        turn: 1,
        turnStartTime: Date.now(),
        score: { [player1Id]: 0, [player2Id]: 0 },
        round: 1
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı - Başlayan: ${room.players[startingPlayer].name} (${highestDouble}|${highestDouble})`);
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

function nextTurn(roomCode, previousPlayerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    const nextPlayerId = playerIds.find(id => id !== previousPlayerId);

    gs.currentPlayer = nextPlayerId;
    gs.turnStartTime = Date.now();

    Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
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

    const marketEmpty = !gameState.market || gameState.market.length === 0;

    if (!player1CanPlay && !player2CanPlay && marketEmpty) {
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
            try { ws.send(JSON.stringify(message)); } catch (e) { }
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
        try { ws.send(JSON.stringify(message)); } catch (e) { }
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
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'passTurn': handlePass(ws); break;
                case 'leaveGame': handleLeaveGame(ws); break;
                case 'rejoin': handleRejoin(ws, data); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' });
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
    ws.playerName = data.firstName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null; // null ise guest
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0; // 0 = guest
    ws.elo = data.elo || 0; // 0 = guest
    ws.isGuest = !data.telegramId; // Telegram yoksa guest

    // Aynı Telegram hesabının ikinci kez kuyruğa girmesini engelle
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegramInQueue = matchQueue.find(p => p.telegramId === ws.telegramId);
        if (sameTelegramInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Bu Telegram hesabı zaten eşleşme kuyruğunda' });
        }
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
    console.log(`✅ ${ws.playerName} (${playerType}) kuyrukta`);

    // Uygun rakip bul
    const opponentIndex = matchQueue.findIndex(p => p.playerId !== playerId);

    if (opponentIndex !== -1) {
        const p1 = matchQueue.splice(opponentIndex, 1)[0]; // Rakibi kuyruktan al
        const p2 = matchQueue.pop(); // Kendini kuyruktan al (en son eklenen)

        // Aynı Telegram hesabının kendi kendisiyle eşleşmesini engelle
        if (!p1.isGuest && !p2.isGuest && p1.telegramId && p2.telegramId && p1.telegramId === p2.telegramId) {
            // Her iki oyuncuyu da kuyruğun başına geri koy ve bu eşleşmeyi iptal et
            matchQueue.unshift(p2);
            matchQueue.unshift(p1);
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
            startTime: Date.now(),
            winsNeeded: 3, // Best of 5
        };

        rooms.set(roomCode, room);
        p1.ws.roomCode = roomCode;
        p2.ws.roomCode = roomCode;

        const gameState = initializeGame(roomCode, p1.playerId, p2.playerId);

        sendMessage(p1.ws, { type: 'matchFound', roomCode, opponent: room.players[p2.playerId], gameType });
        sendMessage(p2.ws, { type: 'matchFound', roomCode, opponent: room.players[p1.playerId], gameType });

        // 4 saniye bekleme (Lobi süresi)
        setTimeout(() => {
            const gameStartMsg = { type: 'gameStart', gameState: { ...gameState, playerId: p1.playerId } };
            sendMessage(p1.ws, gameStartMsg);

            const gameStartMsg2 = { type: 'gameStart', gameState: { ...gameState, playerId: p2.playerId } };
            sendMessage(p2.ws, gameStartMsg2);

            sendMessage(p1.ws, { type: 'session', playerId: p1.playerId, roomCode });
            sendMessage(p2.ws, { type: 'session', playerId: p2.playerId, roomCode });
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 4000); // 4 saniye
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
    const roomCode = generateRoomCode(); // generateRoomCode already returns uppercase
    ws.playerName = data.firstName || data.username || 'Guest';
    ws.roomCode = roomCode;

    // Host data with full profile
    const hostData = {
        name: ws.playerName,
        telegramId: data.telegramId || null,
        photoUrl: data.photoUrl || null,
        level: data.level || 0,
        elo: data.elo || 0,
        isGuest: !data.telegramId
    };

    rooms.set(roomCode, {
        code: roomCode,
        players: { [ws.playerId]: hostData },
        type: 'private',
        host: ws.playerId,
        startTime: Date.now(),
        winsNeeded: 3 // EKLENDİ: Özel odalar için de kazanma şartı
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
}

function handleJoinRoom(ws, data) {
    if (!data.roomCode) return sendMessage(ws, { type: 'error', message: 'Oda kodu gerekli' });
    const code = data.roomCode.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı' });
    if (Object.keys(room.players).length >= 2) return sendMessage(ws, { type: 'error', message: 'Oda dolu' });
    if (room.host === ws.playerId) return sendMessage(ws, { type: 'error', message: 'Kendi odanıza bağlanamazsınız' });

    const pid = ws.playerId || generateRoomCode();
    ws.playerId = pid;
    ws.playerName = data.firstName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;
    ws.roomCode = code;
    playerConnections.set(pid, ws);

    // Add player with full data for private rooms too
    room.players[pid] = {
        name: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest
    };

    const hostId = room.host;
    const gameState = initializeGame(code, hostId, pid);

    // Communicate to both players
    const p2Data = room.players[pid];
    const p1Data = room.players[hostId];
    const hostSocket = playerConnections.get(hostId);

    if (hostSocket) {
        sendMessage(hostSocket, { type: 'matchFound', roomCode: code, opponent: p2Data, gameType: 'casual' });
    }
    sendMessage(ws, { type: 'matchFound', roomCode: code, opponent: p1Data, gameType: 'casual' });

    // 4 saniye sonra oyunu başlat
    setTimeout(() => {
        [hostId, pid].forEach(targetId => {
            const socket = playerConnections.get(targetId);
            if (socket) {
                socket.send(JSON.stringify({ type: 'session', playerId: targetId, roomCode: code }));
                socket.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: targetId } }));
            }
        });
        console.log(`✅ Özel oyun başladı: ${code}`);
    }, 4000);
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
    player.timeouts = 0; // Hamle yapınca timeout sıfırla
    gs.moves = (gs.moves || 0) + 1;

    // Taş oynama sesini herkese gönder
    broadcastToRoom(ws.roomCode, { type: 'playSound', sound: 'place' });

    const winner = checkWinner(gs);
    if (winner) {
        processRoundWinner(ws.roomCode, winner, gs);
    } else {
        nextTurn(ws.roomCode, ws.playerId);
    }
}

function processRoundWinner(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const isDraw = winnerId === 'DRAW';
    let roundLoserId = null;

    if (!isDraw) {
        console.log(`📈 Scoring: Current score for ${winnerId} is ${gs.score[winnerId]}`);
        gs.score[winnerId]++;
        console.log(`📈 Score for ${winnerId} incremented to ${gs.score[winnerId]}`);
        roundLoserId = Object.keys(gs.players).find(id => id !== winnerId);
    }

    const winnerName = isDraw ? 'Beraberlik' : (gs.players[winnerId]?.name || 'Bilinmeyen');
    console.log(`ዙ Round bitti: ${winnerName} kazandı. Skor: ${gs.score[Object.keys(gs.players)[0]]}-${gs.score[Object.keys(gs.players)[1]]}`);

    broadcastToRoom(roomCode, { type: 'roundEnd', winnerId, score: gs.score });

    // Maç bitiş kontrolü
    if (!isDraw && gs.score[winnerId] >= room.winsNeeded) {
        console.log(`🏆 Maç bitti! Kazanan: ${winnerName}`);
        setTimeout(() => handleMatchEnd(roomCode, winnerId, gs, 'score'), 5000); // 5 saniye sonra maç sonu ekranı
    } else {
        // Yeni raund başlat
        setTimeout(() => startNewRound(roomCode, roundLoserId), 5000); // 5 saniye sonra yeni raund
    }
}

function startNewRound(roomCode, startingPlayerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    const [p1, p2] = playerIds;
 
    console.log(`New round starting with scores: ${JSON.stringify(gs.score)}`);

    // Yeni raund için kartları dağıt ve başlangıç oyuncusunu belirle
    const { player1Hand, player2Hand, market, startingPlayer: defaultStartingPlayer } = dealCardsAndDetermineStart(p1, p2);
 
    // Oyun durumunu sıfırla ama skorları ve raund sayısını koru
    gs.board = [];
    gs.players[p1].hand = player1Hand;
    gs.players[p2].hand = player2Hand;
    gs.market = market;
    gs.round++;
    // Bir önceki raundu kaybeden başlar, berabereyse veya ilk el ise en yüksek çifti olan başlar
    gs.currentPlayer = startingPlayerId || defaultStartingPlayer; 
    gs.turnStartTime = Date.now();
    gs.winner = null; // Önceki kazananı temizle
 
    console.log(`🔄 Yeni Raund (${gs.round}) başlıyor. Skor: ${gs.score[p1]}-${gs.score[p2]}. Başlayan: ${gs.players[gs.currentPlayer].name}`);
    Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
}

async function handleMatchEnd(roomCode, winnerId, gameState, reason = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Oyuncuların oda bilgisini temizle (Tekrar eşleşme yapabilmeleri için)
    if (room.players) {
        Object.keys(room.players).forEach(pid => {
            const playerWs = playerConnections.get(pid);
            if (playerWs) playerWs.roomCode = null;
        });
    }

    try {
        const playerIds = Object.keys(gameState.players);
        const loserId = isDraw ? null : playerIds.find(id => id !== winnerId);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;

        // Guest kontrolu - Guest varsa ELO guncellemesi yapma
        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
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
                    winnerName: isDraw ? 'Beraberlik' : (gameState.players[winnerId]?.name || 'Bilinmeyen'),
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
            winner: String(winnerId),
            winnerName: isDraw ? 'Beraberlik' : (room.players[winnerId]?.name || 'Rakip'),
            winnerPhoto: isDraw ? null : (room.players[winnerId]?.photoUrl || null),
            loserName: isDraw ? 'Beraberlik' : (room.players[loserId]?.name || 'Rakip'),
            loserPhoto: isDraw ? null : (room.players[loserId]?.photoUrl || null),
            isRanked: isRankedMatch,
            reason: reason,
            eloChanges: eloChanges ? {
                winner: eloChanges.winnerChange,
                loser: eloChanges.loserChange
            } : null
        });
        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, {
            type: 'gameEnd',
            winner: winnerId,
            winnerPhoto: isDraw ? null : (room.players[winnerId]?.photoUrl || null),
            loserPhoto: isDraw ? null : (room.players[loserId]?.photoUrl || null),
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : (gameState.players[winnerId]?.name || 'Bilinmeyen'),
            isRanked: false
        });
        rooms.delete(roomCode);
    }
}

function handlePass(ws) {
    // ws nesnesi zaten oyuncu bilgilerini taşıyor
    if (!ws || !ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room || room.gameState.currentPlayer !== ws.playerId) return;

    // Reset timeouts
    room.gameState.players[ws.playerId].timeouts = 0;

    // Check if player can actually pass (no valid moves)
    const playerHand = room.gameState.players[ws.playerId].hand;
    const canPlayAnyTile = playerHand.some(tile => 
        canPlayTile(tile, room.gameState.board)
    );

    // If market is empty and no valid moves, end the game
    if (!canPlayAnyTile && room.gameState.market.length === 0) {
        // Calculate scores
        const opponentId = Object.keys(room.gameState.players).find(id => id !== ws.playerId);
        const playerScore = playerHand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const opponentHand = room.gameState.players[opponentId].hand;
        const opponentScore = opponentHand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        let winnerIdForCalc = null;
        if (playerScore < opponentScore) winnerIdForCalc = ws.playerId;
        else if (opponentScore < playerScore) winnerIdForCalc = opponentId;
        else winnerIdForCalc = 'DRAW'; // Beraberlik

        // Send calculation lobby message
        broadcastToRoom(room.code, {
            type: 'calculationLobby', // Yeni mesaj tipi
            players: {
                [ws.playerId]: { hand: playerHand, name: room.players[ws.playerId].name, photoUrl: room.players[ws.playerId].photoUrl, score: playerScore },
                [opponentId]: { hand: opponentHand, name: room.players[opponentId].name, photoUrl: room.players[opponentId].photoUrl, score: opponentScore }
            },
            winnerId: winnerIdForCalc, // Hesaplama sonucunda belirlenen kazanan
            duration: 8000
        });

        // End the game after showing scores
        setTimeout(() => {
            processRoundWinner(room.code, winnerIdForCalc, room.gameState);
        }, 8000);
        
        return;
    }

    // If there are tiles in market but player has no valid moves, draw a tile
    if (!canPlayAnyTile && room.gameState.market.length > 0) {
        const drawnTile = room.gameState.market.pop();
        room.gameState.players[ws.playerId].hand.push(drawnTile);
        
        // Check if the drawn tile can be played
        if (!canPlayTile(drawnTile, room.gameState.board)) {
            // If still can't play, switch to next player
            nextTurn(room.code, ws.playerId);
            broadcastToRoom(room.code, { type: 'playSound', sound: 'pass' }); // Play pass sound for all
        }

        Object.keys(room.gameState.players).forEach(pid => sendGameState(room.code, pid));
        return;
    }

    // If player can play but chooses to pass
    if (canPlayAnyTile) {
        sendMessage(ws, {
            type: 'error',
            message: 'Oynayabileceğiniz hamleler var!'
        });
    }
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    player.timeouts = 0; // İşlem yapınca timeout sıfırla

    // Elinde oynanacak taş var mı kontrol et
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board)); // Tahta boş olsa bile oynanabilir taş varsa çekemez
    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var, pazardan çekemezsiniz!' });
    }

    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        nextTurn(ws.roomCode, ws.playerId);
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
            nextTurn(ws.roomCode, ws.playerId);
            // Pas geçildiğini bildir
            broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: player.name });

            // Sıra geçtikten sonra oyun kilitlendi mi kontrol et
            const winner = checkWinner(gs);
            if (winner) {
                processRoundWinner(ws.roomCode, winner, gs);
                return;
            }
        }
    }

    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleRejoin(ws, data) {
    const { playerId, roomCode } = data;
    if (!playerId || !roomCode) return;

    const room = rooms.get(roomCode);
    if (!room || !room.gameState) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı veya süresi dolmuş' });
    }

    if (!room.players[playerId]) {
        return sendMessage(ws, { type: 'error', message: 'Bu oyuncu odaya ait değil' });
    }

    // Bağlantı kopma zamanlayıcısını iptal et
    if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
    }

    // Reattach
    ws.playerId = playerId;
    ws.roomCode = roomCode;
    ws.playerName = room.players[playerId].name;
    playerConnections.set(playerId, ws);

    console.log(`🔄 Oyuncu geri döndü: ${ws.playerName} (Oda: ${roomCode})`);

    // Send full state to rejoining player
    setTimeout(() => {
        sendGameState(roomCode, playerId);
        broadcastToRoom(roomCode, { type: 'playerReconnected', playerName: ws.playerName }, playerId);
    }, 500);
}

async function handleLeaveGame(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || !ws.playerId) {
        return;
    }

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    if (playerIds.length !== 2) {
        rooms.delete(ws.roomCode);
        ws.roomCode = null;
        return;
    }

    const leaverId = String(ws.playerId);
    const winnerId = playerIds.find(id => String(id) !== leaverId);

    await handleMatchEnd(ws.roomCode, winnerId, gs, 'disconnect');

    // Oyun bitti, bu soketin oda bilgisini temizle ki tekrar eşleşme arayabilsin
    ws.roomCode = null;
    // playerId bağlantı için dursun ama aktif oda ilişkisi kalmasın
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);

    if (ws.playerId) playerConnections.delete(ws.playerId);

    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }

    if (ws.roomCode) {
        const room = rooms.get(ws.roomCode);
        if (room) {
            console.log(`🏠 Odadan ayrıldı (Bağlantı kesildi): ${ws.roomCode}`);
            broadcastToRoom(ws.roomCode, { type: 'playerDisconnected', playerName: ws.playerName });

            // Sadece oyun BAŞLAMAMIŞSA veya oda boşsa odayı sil
            // Oyun devam ediyorsa odayı tut ki geri dönebilsin
            const qSize = Object.keys(room.players).length;
            if (!room.gameState) {
                rooms.delete(ws.roomCode);
            } else {
                if (!room.cleanupTimer) {
                    room.cleanupTimer = setTimeout(() => {
                        // Diğer oyuncuyu bul (Kazanan)
                        const winnerId = Object.keys(room.players).find(id => id !== ws.playerId);
                        if (winnerId && room.gameState) {
                            handleMatchEnd(ws.roomCode, winnerId, room.gameState, 'disconnect');
                        } else {
                            rooms.delete(ws.roomCode);
                        }
                    }, 1000); // 1 saniye (Hızlı tepki)
                }
            }
        }
    }
}

// --- TIMEOUT KONTROLÜ ---

setInterval(() => {
    rooms.forEach((room, roomCode) => {
        if (!room.gameState || !room.gameState.turnStartTime || room.gameState.winner) return;
        
        // 30 saniye süre
        const TURN_LIMIT = 30000;
        const elapsed = Date.now() - room.gameState.turnStartTime;
        
        if (elapsed > TURN_LIMIT) {
            handleTurnTimeout(roomCode);
        }
    });
}, 1000);

function handleTurnTimeout(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;
    
    const gs = room.gameState;
    const currentPlayerId = gs.currentPlayer;
    const player = gs.players[currentPlayerId];
    
    // Süre dolunca direkt bitir
    console.log(`⏰ ${player.name} süre doldu. Oyun bitiriliyor.`);
    const winnerId = Object.keys(gs.players).find(id => id !== currentPlayerId);
    gs.winner = winnerId; // Döngüyü durdurmak için
    handleMatchEnd(roomCode, winnerId, gs, 'timeout');
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
