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
    level: { type: mongoose.Schema.Types.Mixed, default: 1 },
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
const playerSessions = new Map(); // telegramId -> player data

// Translations
const translations = {
    en: {
        connected: 'Connected to server',
        alreadyInQueue: 'Already in queue',
        alreadyInGame: 'Already in a game',
        telegramInQueue: 'This Telegram account is already in queue',
        searchingOpponent: 'Searching for opponent...',
        searchCancelled: 'Search cancelled',
        roomCodeRequired: 'Room code required',
        roomNotFound: 'Room not found',
        roomFull: 'Room is full',
        notYourTurn: 'Not your turn',
        invalidMove: 'Invalid move',
        hasPlayableTile: 'You have playable tiles, cannot draw!',
        cantPlayDrawn: 'Drawn tile cannot be played, draw again or wait',
        gameNotFound: 'Game not found or expired',
        playerNotInRoom: 'Player not in room',
        hasValidMoves: 'You have valid moves!',
        draw: 'Draw',
        gameClosed: 'Game Over! Calculating scores...',
        yourScore: 'Your score',
        opponentScore: 'Opponent score',
        youWon: 'You Won!',
        youLost: 'You Lost!',
        turnPassed: 'Turn passed',
        opponent: 'Opponent'
    },
    az: {
        connected: 'Serverə qoşuldunuz',
        alreadyInQueue: 'Artıq növbədəsiniz',
        alreadyInGame: 'Artıq oyundasınız',
        telegramInQueue: 'Bu Telegram hesabı artıq növbədədir',
        searchingOpponent: 'Rəqib axtarılır...',
        searchCancelled: 'Axtarış ləğv edildi',
        roomCodeRequired: 'Otaq kodu tələb olunur',
        roomNotFound: 'Otaq tapılmadı',
        roomFull: 'Otaq doludur',
        notYourTurn: 'Növbə sizdə deyil',
        invalidMove: 'Bu gediş yalnışdır (Mövqe uyğun gəlmir)',
        hasPlayableTile: 'Əlinizdə oynana bilən daş var, bazardan götürə bilməzsiniz!',
        cantPlayDrawn: 'Daş oynana bilmir, yenidən götürün və ya gözləyin',
        gameNotFound: 'Oyun tapılmadı və ya vaxtı bitib',
        playerNotInRoom: 'Bu oyunçu otağa aid deyil',
        hasValidMoves: 'Oynaya biləcəyiniz gedişlər var!',
        draw: 'Heç-heçə',
        gameClosed: 'Oyun Bağlandı! Xallar hesablanır...',
        yourScore: 'Sənin xalın',
        opponentScore: 'Rəqibin xalı',
        youWon: 'Qazandın!',
        youLost: 'Uduzdun!',
        turnPassed: 'Növbə keçdi',
        opponent: 'Rəqib'
    }
};

function getMsg(lang, key) {
    const l = (lang && translations[lang]) ? lang : 'en';
    return translations[l][key] || translations['en'][key] || key;
}

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
    if (elo <= 100) return 1;
    let lvl = Math.ceil((elo - 100) / 100) + 1;
    if (lvl >= 10) return 'PRO';
    return lvl;
}

// API Endpoints
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName, photoUrl, isGuest = false } = req.body;

        if (!telegramId || !username) {
            return res.status(400).json({ error: 'Telegram ID ve kullanıcı adı gerekli' });
        }

        // Guest kullanıcılar için özel işlem
        if (isGuest) {
            const guestPlayer = {
                telegramId,
                username: `Misafir_${Math.floor(Math.random() * 10000)}`,
                firstName: firstName || 'Misafir',
                lastName: lastName || 'Oyuncu',
                photoUrl: photoUrl || '',
                isGuest: true,
                elo: 0,
                level: 1,
                wins: 0,
                losses: 0,
                draws: 0,
                totalGames: 0,
                winStreak: 0,
                bestWinStreak: 0
            };
            
            // Guest kullanıcıyı sadece bellekte tut, veritabanına kaydetme
            playerSessions.set(telegramId, guestPlayer);
            
            return res.json({
                success: true,
                isGuest: true,
                player: guestPlayer
            });
        }

        // Normal (kayıtlı) kullanıcı işlemleri
        let player = await Player.findOne({ telegramId });

        if (!player) {
            player = new Player({
                telegramId,
                username,
                firstName,
                lastName,
                photoUrl,
                isGuest: false
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
            player.isGuest = false; // Eğer guest'ten kayıtlıya geçtiyse
            await player.save();
        }

        playerSessions.set(telegramId, player);

        res.json({
            success: true,
            isGuest: false,
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
        const players = await Player.find({ elo: { $gt: 0 } }) // Guest/Yeni oyuncular gözükmesin
            .sort({ elo: -1 })
            .limit(10) // Top 10
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames winStreak');

        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Admin paneli için tüm kullanıcıları listeleme
app.get('/api/admin/users', async (req, res) => {
    try {
        // Basit bir güvenlik kontrolü
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== 'YOUR_ADMIN_SECRET') {
            return res.status(403).json({ error: 'Yetkisiz erişim' });
        }

        const users = await Player.find({})
            .sort({ elo: -1 })
            .select('telegramId username firstName lastName elo level wins losses draws totalGames createdAt lastPlayed isVisibleInLeaderboard');
            
        res.json({ success: true, users });
    } catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Admin paneli için kullanıcı güncelleme
app.post('/api/admin/update', async (req, res) => {
    try {
        const { adminId, targetId, updates } = req.body;
        
        // Yetki kontrolü
        if (!adminId || adminId !== '976640409') {
            return res.status(403).json({ success: false, error: 'Yetkisiz işlem' });
        }

        // Güncellenebilir alanlar
        const allowedUpdates = ['elo', 'wins', 'losses', 'draws', 'level', 'isVisibleInLeaderboard'];
        const updatesToApply = {};
        
        // Sadece izin verilen alanları güncelle
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                updatesToApply[key] = updates[key];
            }
        });

        // ELO değerini sayıya çevir
        if (updatesToApply.elo) {
            updatesToApply.elo = parseInt(updatesToApply.elo, 10);
            if (isNaN(updatesToApply.elo)) {
                return res.status(400).json({ success: false, error: 'Geçersiz ELO değeri' });
            }
        }

        // Veritabanını güncelle
        const updatedPlayer = await Player.findOneAndUpdate(
            { _id: targetId },
            { $set: updatesToApply },
            { new: true, runValidators: true }
        );

        if (!updatedPlayer) {
            return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });
        }

        // Eğer oyuncu oyundaysa, oyun durumunu güncelle
        const room = Array.from(rooms.values()).find(r => 
            r.gameState && r.gameState.players && r.gameState.players[targetId]
        );

        if (room && room.gameState.players[targetId]) {
            Object.assign(room.gameState.players[targetId], updatesToApply);
            // Tüm oyunculara güncel durumu gönder
            Object.keys(room.players).forEach(playerId => {
                const playerWs = Array.from(playerConnections.values()).find(
                    ws => ws.playerId === playerId
                );
                if (playerWs) {
                    sendGameState(room.roomCode, playerId);
                }
            });
        }

        res.json({ success: true, player: updatedPlayer });
    } catch (error) {
        console.error('Admin update error:', error);
        res.status(500).json({ success: false, error: 'Güncelleme sırasında hata oluştu' });
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
        startingDouble: highestDouble,
        turnStartTime: Date.now()
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
    
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    ws.language = urlParams.get('lang') || 'en';
    sendMessage(ws, { type: 'connected', message: getMsg(ws.language, 'connected') });
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
    ws.language = data.language || ws.language || 'en';
    if (ws.playerId && playerConnections.has(ws.playerId)) {
        const existingInQueue = matchQueue.find(p => p.playerId === ws.playerId);
        if (existingInQueue) {
            return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'alreadyInQueue') });
        }
        if (ws.roomCode) {
            return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'alreadyInGame') });
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

    // Aynı Telegram hesabının ikinci kez kuyruğa girmesini engelle
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegramInQueue = matchQueue.find(p => p.telegramId === ws.telegramId);
        if (sameTelegramInQueue) {
            return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'telegramInQueue') });
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
    console.log(`✅ ${ws.playerName} (${playerType}) kuyrukta - Toplam: ${matchQueue.length}`);

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
            roundWins: { [p1.playerId]: 0, [p2.playerId]: 0 }, // Raund takibi
            type: gameType,
            startTime: Date.now()
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
        sendMessage(ws, { type: 'searchStatus', message: getMsg(ws.language, 'searchingOpponent') });
    }
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti - Kalan: ${matchQueue.length}`);
        sendMessage(ws, { type: 'searchCancelled', message: getMsg(ws.language, 'searchCancelled') });
    }
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode(); // generateRoomCode already returns uppercase
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.language = data.language || ws.language || 'en';
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
        roundWins: { [ws.playerId]: 0 } // Host için raund başlat
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
}

function handleJoinRoom(ws, data) {
    ws.language = data.language || ws.language || 'en';
    if (!data.roomCode) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'roomCodeRequired') });
    const code = data.roomCode.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'roomNotFound') });
    if (room.host === ws.playerId) {
        // If host is reconnecting or refreshing
        if (room.players[ws.playerId]) {
            // Update existing player connection
            room.players[ws.playerId].ws = ws;
            return sendMessage(ws, { 
                type: 'roomJoined', 
                roomCode: code, 
                isHost: true,
                opponent: Object.values(room.players).find(p => p.telegramId !== ws.telegramId)
            });
        }
        // If host trying to join as second player, allow it for testing
        // return sendMessage(ws, { type: 'error', message: 'Kendi odanıza bağlanamazsınız' });
    }
    if (Object.keys(room.players).length >= 2) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'roomFull') });

    const pid = ws.playerId || generateRoomCode();
    ws.playerId = pid;
    ws.playerName = data.playerName || data.username || 'Guest';
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
    room.roundWins[pid] = 0; // Katılan oyuncu için raund başlat

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
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'notYourTurn') });

    const player = gs.players[ws.playerId];
    const tile = player.hand[data.tileIndex];

    if (!tile) return;

    const boardCopy = JSON.parse(JSON.stringify(gs.board));
    const success = playTileOnBoard(tile, gs.board, data.position);

    if (!success) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'invalidMove') });
    }

    player.hand.splice(data.tileIndex, 1);
    gs.moves = (gs.moves || 0) + 1;

    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs, false);
    } else {
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        gs.turnStartTime = Date.now();

        // AUTO PASS LOGIC
        const nextPlayerId = gs.currentPlayer;
        const nextPlayer = gs.players[nextPlayerId];
        const canNextPlay = nextPlayer.hand.some(t => canPlayTile(t, gs.board));
        
        if (!canNextPlay && gs.market.length === 0) {
            console.log(`⏩ ${nextPlayer.name} otomatik pas geçiliyor (Hamle yok, pazar boş)`);
            broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: nextPlayer.name });
            
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== nextPlayerId);
            gs.turnStartTime = Date.now();

            const blockedWinner = checkWinner(gs);
            if (blockedWinner) return handleGameEnd(ws.roomCode, blockedWinner, gs, false);
        }

        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerId, gameState, isForfeit = false) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Raund skorlarını güncelle
    if (!room.roundWins) room.roundWins = {}; // Güvenlik için
    const playerIds = Object.keys(room.players);
    
    // Eğer beraberlik değilse kazananın skorunu artır
    if (winnerId !== 'DRAW' && !isForfeit) {
        room.roundWins[winnerId] = (room.roundWins[winnerId] || 0) + 1;
    }

    // Skorları al
    const p1Id = playerIds[0];
    const p2Id = playerIds[1];
    const s1 = room.roundWins[p1Id] || 0;
    const s2 = room.roundWins[p2Id] || 0;

    // MAÇ BİTİŞ KONTROLÜ:
    // 1. Hükmen yenilgi (isForfeit) varsa maç biter.
    // 2. Bir oyuncu en az 3 raund kazanmışsa VE fark en az 2 ise maç biter.
    // (Örn: 3-0, 3-1 biter. 3-2 devam eder -> 4-2 biter).
    const isMatchOver = isForfeit || ((s1 >= 3 || s2 >= 3) && Math.abs(s1 - s2) >= 2);

    if (!isMatchOver) {
        // --- MAÇ DEVAM EDİYOR ---
        
        // Oyunculara bu elin bittiğini bildir
        Object.keys(room.players).forEach(pid => {
            const pWs = playerConnections.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
                const lang = pWs.language || 'en';
                const winnerName = winnerId === 'DRAW' ? getMsg(lang, 'draw') : (gameState.players[winnerId]?.name || getMsg(lang, 'opponent'));
                
                // Ara bilgilendirme mesajı
                pWs.send(JSON.stringify({
                    type: 'gameMessage',
                    message: `${winnerName} ${getMsg(lang, 'youWon') ? '' : 'kazandı'}!\n\nSKOR:\n${room.players[p1Id].name}: ${s1}\n${room.players[p2Id].name}: ${s2}\n\nSonraki el başlıyor...`,
                    duration: 4000
                }));
            }
        });

        // 5 saniye sonra yeni eli başlat
        setTimeout(() => {
            // Odayı kontrol et (belki bu sürede herkes çıkmıştır)
            if (!rooms.has(roomCode)) return;
            
            // Yeni oyun state'i oluştur
            const newGameState = initializeGame(roomCode, p1Id, p2Id);
            
            // Oyunculara yeni oyunu gönder
            [p1Id, p2Id].forEach(pid => {
                const ws = playerConnections.get(pid);
                if (ws) {
                    ws.send(JSON.stringify({ 
                        type: 'gameStart', 
                        gameState: { ...newGameState, playerId: pid } 
                    }));
                }
            });
        }, 5000);

        return; // Fonksiyondan çık, odayı silme!
    }

    // --- MAÇ BİTTİ (Aşağıdaki kodlar çalışır ve odayı siler) ---

    // Oyuncuların oda bilgisini temizle (Tekrar eşleşme yapabilmeleri için)
    if (room.players) {
        Object.keys(room.players).forEach(pid => {
            const playerWs = playerConnections.get(pid);
            if (playerWs) playerWs.roomCode = null;
        });
    }

    try {
        const player1Id = p1Id;
        const player2Id = p2Id;

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

        // Send localized game end message
        Object.keys(room.players).forEach(pid => {
            const pWs = playerConnections.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
                const lang = pWs.language || 'en';
                const winnerName = isDraw ? getMsg(lang, 'draw') : (gameState.players[winnerId]?.name || getMsg(lang, 'opponent'));
                
                pWs.send(JSON.stringify({
                    type: 'gameEnd',
                    winner: String(winnerId),
                    winnerName: winnerName,
                    isRanked: isRankedMatch,
                    eloChanges: eloChanges ? {
                        winner: eloChanges.winnerChange,
                        loser: eloChanges.loserChange
                    } : null
                }));
            }
        });
        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        // Fallback for error case
        Object.keys(room.players).forEach(pid => {
            const pWs = playerConnections.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
                const lang = pWs.language || 'en';
                pWs.send(JSON.stringify({
                    type: 'gameEnd',
                    winner: winnerId,
                    winnerName: winnerId === 'DRAW' ? getMsg(lang, 'draw') : gameState.players[winnerId].name,
                    isRanked: false
                }));
            }
        });
        rooms.delete(roomCode);
    }
}

function handlePass(ws) {
    // ws nesnesi zaten oyuncu bilgilerini taşıyor
    if (!ws || !ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room || room.gameState.currentPlayer !== ws.playerId) return;

    // Check if player can actually pass (no valid moves)
    const playerHand = room.gameState.players[ws.playerId].hand;
    const canPlayAnyTile = playerHand.some(tile => 
        canPlayTile(tile, room.gameState.board)
    );

    // If market is empty and no valid moves, end the game
    if (room.gameState.market.length === 0 && !canPlayAnyTile) {
        // Calculate scores
        const opponentId = Object.keys(room.gameState.players).find(id => id !== ws.playerId);
        const playerScore = playerHand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const opponentHand = room.gameState.players[opponentId].hand;
        const opponentScore = opponentHand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        // Determine winner (player with lower score wins)
        const winnerId = playerScore <= opponentScore ? ws.playerId : opponentId;
        
        // Show scores to players for 8 seconds before ending game
        Object.keys(room.players).forEach(pid => {
            const pWs = playerConnections.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
                const lang = pWs.language || 'en';
                const myScore = pid === ws.playerId ? playerScore : opponentScore;
                const opScore = pid === ws.playerId ? opponentScore : playerScore;
                const msgText = `${getMsg(lang, 'gameClosed')}\n\n` +
                    `${getMsg(lang, 'yourScore')}: ${myScore}\n` +
                    `${getMsg(lang, 'opponentScore')}: ${opScore}\n\n` +
                    `${winnerId === pid ? getMsg(lang, 'youWon') : getMsg(lang, 'youLost')}`;
                
                pWs.send(JSON.stringify({
                    type: 'gameMessage',
                    message: msgText,
                    duration: 8000
                }));
            }
        });

        // End the game after showing scores
        setTimeout(() => {
            handleGameEnd(room.code, winnerId, room.gameState, false);
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
            const opponentId = Object.keys(room.gameState.players).find(id => id !== ws.playerId);
            room.gameState.currentPlayer = opponentId;
            room.gameState.turnStartTime = Date.now();
            
            // Play pass sound
            broadcastToRoom(room.code, {
                type: 'playSound',
                sound: 'pass'
            });
        }
        
        sendGameState(room.code);
        return;
    }

    // If player can play but chooses to pass
    if (canPlayAnyTile) {
        sendMessage(ws, {
            type: 'error',
            message: getMsg(ws.language, 'hasValidMoves')
        });
    }
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'notYourTurn') });

    const player = gs.players[ws.playerId];

    // Elinde oynanacak taş var mı kontrol et
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (canPlay && gs.board.length > 0) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'hasPlayableTile') });
    }

    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        gs.turnStartTime = Date.now();
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
            sendMessage(ws, { type: 'info', message: getMsg(ws.language, 'cantPlayDrawn') });
        } else if (!hasPlayable && gs.market.length === 0) {
            // Pazar bitti ve hala oynanabilir taş yok - sıra geç
            console.log(`❌ ${player.name} oynanabilir taş bulamadı - Sıra geçiyor`);
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
            gs.turnStartTime = Date.now();

            // Pas geçildiğini bildir
            broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: player.name });

            // Sıra geçtikten sonra oyun kilitlendi mi kontrol et
            const winner = checkWinner(gs);
            if (winner) {
                handleGameEnd(ws.roomCode, winner, gs, false);
                return;
            }
        }
    }

    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleRejoin(ws, data) {
    const { playerId, roomCode } = data;
    ws.language = data.language || ws.language || 'en';
    if (!playerId || !roomCode) return;

    const room = rooms.get(roomCode);
    if (!room || !room.gameState) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'gameNotFound') });
    }

    if (!room.players[playerId]) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'playerNotInRoom') });
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

function handleLeaveGame(ws) {
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

    handleGameEnd(ws.roomCode, winnerId, gs, true); // true = Forfeit (Hükmen)

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
            console.log(`🏠 Oyuncu odadan ayrıldı: ${ws.playerName} (${ws.roomCode})`);
            
            // Oyun başlamışsa ve oyuncu oyundaysa
            if (room.gameState) {
                // Diğer oyuncuyu bul
                const otherPlayerId = Object.keys(room.players).find(id => id !== ws.playerId);
                
                // Eğer diğer oyuncu hala bağlıysa, oyunu bitir
                if (otherPlayerId && room.players[otherPlayerId]) {
                    console.log(`🏆 Oyun sonlandırılıyor: ${room.players[otherPlayerId].name} kazandı (rakip ayrıldı)`);
                    handleGameEnd(ws.roomCode, otherPlayerId, room.gameState, true); // true = Forfeit
                } else {
                    // İki oyuncu da ayrılmış, odayı temizle
                    console.log(`🗑️ Her iki oyuncu da ayrıldı, oda temizleniyor: ${ws.roomCode}`);
                    rooms.delete(ws.roomCode);
                }
            } else {
                // Oyun başlamamışsa, odayı hemen sil
                console.log(`🚪 Oyun başlamadan oyuncu ayrıldı, oda kaldırılıyor: ${ws.roomCode}`);
                rooms.delete(ws.roomCode);
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

// AFK sayacını tutmak için oda başına
function getOrCreateAfkCounter(room, playerId) {
    if (!room.afkCounters) room.afkCounters = {};
    if (!room.afkCounters[playerId]) room.afkCounters[playerId] = 0;
    return room.afkCounters[playerId];
}

function incrementAfkCounter(room, playerId) {
    if (!room.afkCounters) room.afkCounters = {};
    room.afkCounters[playerId] = (room.afkCounters[playerId] || 0) + 1;
    return room.afkCounters[playerId];
}

function resetAfkCounter(room, playerId) {
    if (room.afkCounters && room.afkCounters[playerId]) {
        room.afkCounters[playerId] = 0;
    }
}

function handleTurnTimeout(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;
    
    const gs = room.gameState;
    const currentPlayerId = gs.currentPlayer;
    const player = gs.players[currentPlayerId];
    
    if (!player) return;

    // AFK sayacını artır
    const afkCount = incrementAfkCounter(room, currentPlayerId);
    console.log(`⏰ ${player.name} için süre doldu! (${afkCount}. kez)`);

    // Eğer 3 kere üst üste zaman aşımına uğradıysa, oyuncu AFK kabul edilir
    const MAX_AFK_COUNT = 3;
    if (afkCount >= MAX_AFK_COUNT) {
        console.log(`🚨 ${player.name} AFK kabul edildi! Oyun sonlandırılıyor...`);
        
        // Diğer oyuncuyu kazanan ilan et
        const otherPlayerId = Object.keys(gs.players).find(id => id !== currentPlayerId);
        if (otherPlayerId) {
            handleGameEnd(roomCode, otherPlayerId, gs, true); // true = Forfeit
        } else {
            // Eğer diğer oyuncu yoksa odayı kapat
            rooms.delete(roomCode);
        }
        return;
    }

    // 1. Oynanabilir taş var mı?
    let validMove = null;
    
    // Eldeki taşları kontrol et
    for (let i = 0; i < player.hand.length; i++) {
        const tile = player.hand[i];
        if (gs.board.length === 0) {
            validMove = { tile, index: i, position: 'left' };
            break;
        }
        
        const leftEnd = gs.board[0][0];
        const rightEnd = gs.board[gs.board.length - 1][1];
        
        if (tile[0] === leftEnd || tile[1] === leftEnd) {
            validMove = { tile, index: i, position: 'left' };
            break;
        }
        if (tile[0] === rightEnd || tile[1] === rightEnd) {
            validMove = { tile, index: i, position: 'right' };
            break;
        }
    }

    if (validMove) {
        // Hamle yap
        const success = playTileOnBoard(validMove.tile, gs.board, validMove.position);
        if (success) {
            player.hand.splice(validMove.index, 1);
            gs.moves = (gs.moves || 0) + 1;
            
            // Kazanan kontrolü
            const winner = checkWinner(gs);
            if (winner) {
                handleGameEnd(roomCode, winner, gs, false);
                return;
            }
            
            // Sıra değiştir ve AFK sayacını sıfırla
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== currentPlayerId);
            gs.turnStartTime = Date.now();
            
            // AFK sayacını sıfırla
            resetAfkCounter(room, currentPlayerId);
            
            Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
            return;
        }
    }

    // 2. Oynanacak taş yoksa pazar kontrolü
    if (gs.market && gs.market.length > 0) {
        const drawnTile = gs.market.shift();
        player.hand.push(drawnTile);
        
        // Çektikten sonra sıra geç ve AFK sayacını sıfırla
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== currentPlayerId);
        gs.turnStartTime = Date.now();
        
        // AFK sayacını sıfırla
        resetAfkCounter(room, currentPlayerId);
        
        Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
        return;
    }

    // 3. Pazar boşsa pas geç
    gs.turn++;
    gs.currentPlayer = Object.keys(gs.players).find(id => id !== currentPlayerId);
    gs.turnStartTime = Date.now();
    
    // AFK sayacını sıfırla
    resetAfkCounter(room, currentPlayerId);
    
    Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
