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

const broadcastSchema = new mongoose.Schema({
    message: { type: String, required: true },
    senderId: { type: String },
    createdAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true }
});
const Broadcast = mongoose.model('DominoBroadcast', broadcastSchema);

app.use(cors());
app.use(express.json());

const rooms = new Map();
const matchQueues = { '2p': [], '4p': [] };
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
        searchCancelled: 'Axtarış ləğv edildi',
        alreadyInQueue: 'Siz artıq növbədəsiniz!',
        alreadyInGame: 'Hazırda bir oyunda iştirak edirsiniz!',
        telegramInQueue: 'Bu Telegram hesabı artıq növbədədir',
        searchingOpponent: 'Rəqib axtarılır...',
        roomCodeRequired: 'Otaq kodu mütləqdir',
        roomNotFound: 'Otaq tapılmadı',
        roomFull: 'Otaq doludur',
        notYourTurn: 'Növbə sizdə deyil',
        invalidMove: 'Bu gediş yalnışdır!',
        hasPlayableTile: 'Əlinizdə oynana bilən daş var!',
        cantPlayDrawn: 'Daş oynana bilmir, növbə keçir...',
        gameNotFound: 'Oyun tapılmadı və ya vaxtı bitib',
        playerNotInRoom: 'Bu oyunçu otağa aid deyil',
        hasValidMoves: 'Oynaya biləcəyiniz daş var!',
        draw: 'Heç-heçə',
        gameClosed: 'Oyun Bağlandı! Xallar hesablanır...',
        yourScore: 'Sənin xalın',
        opponentScore: 'Rəqibin xalı',
        youWon: 'Qazandınız! 🏆',
        youLost: 'Uduzdunuz! 🚨',
        turnPassed: 'Növbə keçdi',
        opponent: 'Rəqib',
        opponentDisconnected: '⚠️ {name} ayrıldı. 15 saniyə gözlənilir...',
        afkWin: 'Rəqib AFK qaldığı üçün qazandınız! 🏆',
        afkLoss: 'Üst-üstə AFK qaldığınız üçün uduzdunuz! 🚨',
        disconnectWin: 'Rəqib geri dönmədiyi üçün qazandınız! 🏆',
        wantsToPlayAgain: '{name} təkrar oynamaq istəyir! ({count}/{needed})',
        allConfirmed: 'Hamı təsdiqlədi, oyun başlayır!',
        notEnoughPlayers: 'Oyuna başlamaq üçün ən azı 2 nəfər lazımdır!',
        confirmStartEarly: '{count} nəfərlə oyuna başlamaq istəyirsiniz?'
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
    if (elo < 100) return 1;
    if (elo < 200) return 2;
    if (elo < 300) return 3;
    if (elo < 400) return 4;
    if (elo < 500) return 5;
    if (elo < 600) return 6;
    if (elo < 700) return 7;
    if (elo < 800) return 8;
    if (elo < 900) return 9;
    return 10; // Max Level 10
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
            // ELO güncellendiğinde level'i de hesapla
            updatesToApply.level = calculateLevel(updatesToApply.elo);
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
// Admin: Global Broadcast Mesajı Gönderme
app.post('/api/admin/broadcast', async (req, res) => {
    const { adminId, message } = req.body;
    // Basit admin kontrolü (isteğe bağlı olarak secret key eklenebilir)
    if (adminId !== '976640409') return res.status(403).json({ success: false, message: 'Yetkisiz erişim' });

    try {
        // Eski mesajları pasife çek (opsiyonel)
        await Broadcast.updateMany({ isActive: true }, { isActive: false });

        const newBroadcast = new Broadcast({
            message,
            senderId: adminId,
            isActive: true
        });
        await newBroadcast.save();

        // Online olan herkese anlık gönder
        const broadcastData = {
            type: 'broadcastMessage',
            message: message,
            id: newBroadcast._id
        };

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(broadcastData));
            }
        });

        res.json({ success: true, message: 'Duyuru başarıyla gönderildi' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/admin/broadcast/latest', async (req, res) => {
    try {
        const latest = await Broadcast.findOne({ isActive: true }).sort({ createdAt: -1 });
        res.json({ success: true, broadcast: latest });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
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

function initializeGame(roomCode, ...playerIds) {
    const tiles = createDominoSet();
    const room = rooms.get(roomCode);
    const playersCount = playerIds.length;

    const players = {};
    let currentIndex = 0;

    // Her oyuncuya 7 taş dağıt
    playerIds.forEach(pid => {
        players[pid] = {
            hand: tiles.slice(currentIndex * 7, (currentIndex + 1) * 7),
            name: room.players[pid].name,
            score: room.players[pid].score || 0, // Önceki raundlardan gelen skoru koru
            photoUrl: room.players[pid].photoUrl,
            level: room.players[pid].level,
            elo: room.players[pid].elo
        };
        currentIndex++;
    });

    const market = tiles.slice(playersCount * 7);

    // En düşük çifti bul (1|1, 2|2, ..., 6|6)
    let startingPlayer = playerIds[0];
    let foundStartTile = false;

    // Önce çiftleri kontrol et (1:1'den başlayarak)
    for (let d = 1; d <= 6; d++) {
        for (const pid of playerIds) {
            if (players[pid].hand.some(t => t[0] === d && t[1] === d)) {
                startingPlayer = pid;
                foundStartTile = true;
                break;
            }
        }
        if (foundStartTile) break;
    }

    // Çift yoksa özel kural: 3:2 (veya elindeki en küçük taş)
    if (!foundStartTile) {
        for (const pid of playerIds) {
            if (players[pid].hand.some(t => (t[0] === 3 && t[1] === 2) || (t[0] === 2 && t[1] === 3))) {
                startingPlayer = pid;
                foundStartTile = true;
                break;
            }
        }
    }

    const initialBoard = []; // Kullanıcı talebi: Otomatik taş atmasın

    room.gameState = {
        board: initialBoard,
        players: players,
        playerOrder: playerIds,
        market: market,
        currentPlayer: startingPlayer,
        turn: 1,
        lastMove: null,
        turnStartTime: Date.now(),
        turnTimeLimit: 30000
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı (${playersCount} kişi) - Başlayan: ${room.players[startingPlayer].name}`);
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
    // 1. Taşını bitiren var mı? (El kazandı)
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            // Kazanan, diğer oyuncuların elindeki taşların toplamını alır
            let scoreGained = 0;
            for (const otherPlayerId in gameState.players) {
                if (otherPlayerId !== playerId) {
                    scoreGained += gameState.players[otherPlayerId].hand.reduce((s, t) => s + t[0] + t[1], 0);
                }
            }
            return { type: 'HAND_WIN', winnerId: playerId, scoreGained };
        }
    }

    // 2. Oyun tıkandı mı? (Kimse oynayamıyor ve pazar boş)
    const marketEmpty = !gameState.market || gameState.market.length === 0;
    if (marketEmpty) {
        let anyoneCanPlay = false;
        for (const pid of gameState.playerOrder) {
            if (gameState.players[pid].hand.some(tile => canPlayTile(tile, gameState.board))) {
                anyoneCanPlay = true;
                break;
            }
        }

        if (!anyoneCanPlay) {
            // Oyun kilitlendi, elindeki taşların toplamı en az olan kazanır (El kazandı)
            const sums = {};
            let minSum = Infinity;
            let winnerId = null;
            let isDraw = false;

            gameState.playerOrder.forEach(pid => {
                const sum = gameState.players[pid].hand.reduce((s, t) => s + t[0] + t[1], 0);
                sums[pid] = sum;
                if (sum < minSum) {
                    minSum = sum;
                    winnerId = pid;
                    isDraw = false;
                } else if (sum === minSum) {
                    isDraw = true; // Birden fazla oyuncunun aynı minSum'ı varsa beraberlik
                }
            });

            if (isDraw || winnerId === null) {
                return { type: 'BLOCKED', winnerId: 'DRAW', sums };
            } else {
                // Kazanan, diğer oyuncuların elindeki taşların toplamını alır
                let scoreGained = 0;
                for (const otherPlayerId in gameState.players) {
                    if (otherPlayerId !== winnerId) {
                        scoreGained += sums[otherPlayerId];
                    }
                }
                return { type: 'BLOCKED', winnerId: winnerId, scoreGained, sums };
            }
        }
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
        // Oyuncunun kendi elini ve diğer oyuncuların sadece sayısını gönder
        const playersData = {};
        for (const pid in room.gameState.players) {
            if (pid === playerId) {
                playersData[pid] = { ...room.gameState.players[pid], hand: room.gameState.players[pid].hand };
            } else {
                playersData[pid] = { ...room.gameState.players[pid], hand: Array(room.gameState.players[pid].hand.length).fill(null) }; // Sadece taş sayısı
            }
        }

        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: {
                ...room.gameState,
                players: playersData,
                playerId: playerId // Hangi oyuncuya gönderildiğini belirt
            }
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
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
                case 'cancelSearch': handleCancelSearch(ws, data); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'passTurn': handlePass(ws); break;
                case 'leaveGame': handleLeaveGame(ws); break;
                case 'rejoin': handleRejoin(ws, data); break;
                case 'playAgain': handlePlayAgain(ws); break;
                case 'startGameEarly': handleStartGameEarly(ws); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));

    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    ws.language = urlParams.get('lang') || 'az';
    sendMessage(ws, { type: 'connected', message: getMsg(ws.language, 'connected') });

    // Son duyuruyu gönder
    Broadcast.findOne({ isActive: true }).sort({ createdAt: -1 }).then(latest => {
        if (latest) {
            sendMessage(ws, {
                type: 'broadcastMessage',
                message: latest.message,
                id: latest._id
            });
        }
    }).catch(error => {
        console.error('Error fetching latest broadcast for new connection:', error);
    });
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
    let modeInput = String(data.mode || '2');
    const mode = (modeInput === '4' || modeInput === '4p') ? '4p' : '2p';

    // OTOMATİK YENİDEN BAĞLANMA (RECONNECT) KONTROLÜ
    if (ws.playerId || data.telegramId) {
        const tid = data.telegramId;
        const pid = ws.playerId;

        let existingRoom = null;
        let pKey = null;

        for (const [code, r] of rooms.entries()) {
            if (!r.gameState || r.gameState.winner) continue;
            for (const pidInRoom of Object.keys(r.players)) {
                if (pidInRoom === pid || (tid && r.players[pidInRoom].telegramId === tid)) {
                    existingRoom = r;
                    pKey = pidInRoom;
                    break;
                }
            }
            if (existingRoom) break;
        }

        if (existingRoom) {
            console.log(`🔄 Otomatik yeniden bağlanma: ${pKey} (Oda: ${existingRoom.code})`);
            const timer = disconnectGraceTimers.get(pKey);
            if (timer) {
                clearTimeout(timer);
                disconnectGraceTimers.delete(pKey);
            }

            ws.playerId = pKey;
            ws.roomCode = existingRoom.code;
            ws.playerName = existingRoom.players[pKey].name;
            playerConnections.set(pKey, ws);

            // Oyuncuya hemen mevcut durumu gönder
            resetAfkCounter(existingRoom, pKey); // Giriş yapınca AFK sıfırlansın
            setTimeout(() => {
                sendGameState(existingRoom.code, pKey);
                broadcastToRoom(existingRoom.code, { type: 'playerReconnected', playerName: ws.playerName }, pKey);
            }, 500);
            return;
        }
    }

    if (ws.playerId && playerConnections.has(ws.playerId)) {
        const existingInQueue = matchQueues['2p'].find(p => p.playerId === ws.playerId) || matchQueues['4p'].find(p => p.playerId === ws.playerId);
        if (existingInQueue) {
            return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'alreadyInQueue') });
        }
        if (ws.roomCode) {
            return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'alreadyInGame') });
        }
    }

    const playerId = ws.playerId || `guest_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null; // null ise guest
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0; // 0 = guest
    ws.elo = data.elo || 0; // 0 = guest
    ws.isGuest = !data.telegramId; // Telegram yoksa guest

    // Aynı Telegram hesabının ikinci kez kuyruğa girmesini engelle
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegramInQueue = matchQueues['2p'].find(p => p.telegramId === ws.telegramId) || matchQueues['4p'].find(p => p.telegramId === ws.telegramId);
        if (sameTelegramInQueue) {
            return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'telegramInQueue') });
        }
    }

    playerConnections.set(playerId, ws);
    matchQueues[mode].push({
        ws, playerId, playerName: ws.playerName, telegramId: ws.telegramId,
        photoUrl: ws.photoUrl, level: ws.level, elo: ws.elo, isGuest: ws.isGuest
    });

    console.log(`✅ ${ws.playerName} (${mode}p) kuyrukta - Toplam: ${matchQueues[mode].length}/${mode}`);

    const targetSize = parseInt(mode);
    if (matchQueues[mode].length >= targetSize) {
        // TAM OLARAK TARGETSIZE KADAR OYUNCU AL
        const participants = matchQueues[mode].splice(0, targetSize);

        const roomCode = generateRoomCode();
        const players = {};
        const playerIds = participants.map(p => p.playerId);

        participants.forEach(p => {
            players[p.playerId] = {
                name: p.playerName,
                telegramId: p.telegramId,
                photoUrl: p.photoUrl,
                level: p.level,
                elo: p.elo,
                isGuest: p.isGuest,
                score: 0 // Her oyuncunun maç başı 101 puanı 0
            };
            p.ws.roomCode = roomCode;
            p.ws.playerId = p.playerId;
        });

        const gameType = (targetSize === 2 && !participants.some(p => p.isGuest)) ? 'ranked' : 'casual';
        const room = { code: roomCode, players, type: gameType, startTime: Date.now(), capacity: targetSize };
        rooms.set(roomCode, room);

        const gameState = initializeGame(roomCode, ...playerIds);

        participants.forEach(p => {
            const others = playerIds.filter(id => id !== p.playerId).map(id => ({
                id: id,
                name: players[id].name,
                photoUrl: players[id].photoUrl,
                level: players[id].level,
                elo: players[id].elo
            }));
            sendMessage(p.ws, { type: 'matchFound', roomCode, opponents: others, gameType });
        });

        setTimeout(() => {
            playerIds.forEach(pid => {
                const pWs = playerConnections.get(pid);
                if (pWs) {
                    pWs.send(JSON.stringify({ type: 'session', playerId: pid, roomCode }));
                    pWs.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: pid, opponents: playerIds.filter(id => id !== pid).map(id => ({ ...players[id], id })) } }));
                }
            });
            console.log(`✅ Oyun başladı: ${roomCode} (${targetSize} kişi)`);
        }, 4000);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: `Rakip aranıyor... (${matchQueues[mode].length}/${targetSize})` });
    }
}

function handleCancelSearch(ws, data) {
    const mode = data.mode || '2p';
    const index = matchQueues[mode].findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueues[mode].splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti (${mode}p) - Kalan: ${matchQueues[mode].length}`);
        sendMessage(ws, { type: 'searchCancelled', message: getMsg(ws.language, 'searchCancelled') });
    }
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode();

    // PlayerId'yi set et
    const playerId = ws.playerId || `guest_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.language = data.language || ws.language || 'en';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;
    ws.roomCode = roomCode;

    playerConnections.set(playerId, ws);

    const hostData = {
        name: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest,
        score: 0
    };

    rooms.set(roomCode, {
        code: roomCode,
        players: { [playerId]: hostData },
        type: 'private',
        host: playerId,
        startTime: Date.now(),
        capacity: data.capacity || 2, // 2 veya 4 kişilik
    });

    console.log(`🏠 Oda oluşturuldu: ${roomCode} - Host: ${ws.playerName} (${data.capacity || 2} kişilik)`);
    sendMessage(ws, { type: 'roomCreated', roomCode, capacity: data.capacity || 2 });
}

function handleJoinRoom(ws, data) {
    ws.language = data.language || ws.language || 'en';
    if (!data.roomCode) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'roomCodeRequired') });

    const code = data.roomCode.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
        console.log(`❌ Oda bulunamadı: ${code}`);
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'roomNotFound') });
    }

    const capacity = room.capacity || 2;
    const currentPlayerCount = Object.keys(room.players).length;

    if (currentPlayerCount >= capacity) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'roomFull') });
    }

    const pid = ws.playerId || `guest_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = pid;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;
    ws.roomCode = code;
    playerConnections.set(pid, ws);

    room.players[pid] = {
        name: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest,
        score: 0
    };

    console.log(`✅ ${ws.playerName} odaya katıldı: ${code} (${currentPlayerCount + 1}/${capacity})`);

    // Tüm oyunculara güncel oda durumunu gönder
    const playerList = Object.keys(room.players).map(id => ({ ...room.players[id], id }));
    Object.keys(room.players).forEach(playerId => {
        const socket = playerConnections.get(playerId);
        if (socket) {
            sendMessage(socket, {
                type: 'roomUpdated',
                players: playerList,
                host: room.host,
                capacity: capacity,
                roomCode: code
            });
        }
    });

    // --- PRIVATE ODALARDA OTOMATİK BAŞLATMA KAPASİTEYE GÖRE ---
    if (Object.keys(room.players).length >= capacity) {
        console.log(`🎮 Oda tam kapasiteye ulaştı: ${code}. Oyun başlıyor...`);
        startPrivateGame(code);
    }
}

function handleStartGameEarly(ws) {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room || room.host !== ws.playerId) return;

    const count = Object.keys(room.players).length;
    if (count < 2) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'notEnoughPlayers') });
    }

    console.log(`🚀 Host oyunu erken başlattı: ${ws.roomCode} (${count} kişi)`);
    startPrivateGame(ws.roomCode);
}

function startPrivateGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const playerIds = Object.keys(room.players);
    const gameState = initializeGame(roomCode, ...playerIds);

    // Önce matchFound gönder
    playerIds.forEach(pid => {
        const socket = playerConnections.get(pid);
        if (socket) {
            const opponents = playerIds.filter(id => id !== pid).map(id => ({
                ...room.players[id],
                id
            }));
            sendMessage(socket, {
                type: 'matchFound',
                roomCode,
                opponents,
                gameType: 'casual'
            });
        }
    });

    // 4 saniye sonra oyunu başlat
    setTimeout(() => {
        playerIds.forEach(pid => {
            const socket = playerConnections.get(pid);
            if (socket) {
                socket.send(JSON.stringify({ type: 'session', playerId: pid, roomCode }));
                socket.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: pid } }));
            }
        });
        console.log(`✅ Özel oyun başladı: ${roomCode} (${playerIds.length} kişi)`);
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
    resetAfkCounter(room, ws.playerId); // Manuel hareket AFK sayacını sıfırlar

    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs, false);
    } else {
        // TURN SIRASI (2 veya 4 oyuncu için uyumlu)
        const currentIdx = gs.playerOrder.indexOf(ws.playerId);
        const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
        gs.currentPlayer = gs.playerOrder[nextIdx];
        gs.turn++;
        gs.turnStartTime = Date.now();

        // AUTO PASS LOGIC
        const nextPlayerId = gs.currentPlayer;
        const nextPlayer = gs.players[nextPlayerId];
        const canNextPlay = nextPlayer.hand.some(t => canPlayTile(t, gs.board));

        if (!canNextPlay && gs.market.length === 0) {
            console.log(`⏩ ${nextPlayer.name} otomatik pas geçiliyor (Hamle yok, pazar boş)`);
            broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: nextPlayer.name });

            // Bir sonraki oyuncuya geç
            const skipIdx = (nextIdx + 1) % gs.playerOrder.length;
            gs.currentPlayer = gs.playerOrder[skipIdx];
            gs.turn++;
            gs.turnStartTime = Date.now();

            const blockedWinner = checkWinner(gs);
            if (blockedWinner) return handleGameEnd(ws.roomCode, blockedWinner, gs, false);
        }

        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerResult, gameState, isForfeit = false, winnerReason = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const playerIds = Object.keys(room.players);
    const winnerId = winnerResult.winnerId || winnerResult; // SCORE_WIN, HAND_WIN, BLOCKED, etc.

    // 101 PUAN HESABI
    if (winnerId !== 'DRAW' && !isForfeit) {
        let handScoreGained = 0;
        playerIds.forEach(pid => {
            if (pid !== winnerId) {
                const hand = gameState.players[pid].hand;
                handScoreGained += hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
            }
        });

        // Puanı kazanana ekle
        room.players[winnerId].score = (room.players[winnerId].score || 0) + handScoreGained;
        console.log(`🎯 ${room.players[winnerId].name} bu elden ${handScoreGained} puan kazandı. Toplam: ${room.players[winnerId].score}`);
    }

    // MAÇ BİTİŞ KONTROLÜ (101 PUAN):
    const matchWinnerId = playerIds.find(pid => (room.players[pid].score || 0) >= 101);
    const isMatchOver = isForfeit || !!matchWinnerId;

    if (!isMatchOver) {
        // --- RAUND BİTTİ, MAÇ DEVAM EDİYOR ---
        Object.keys(room.players).forEach(pid => {
            const pWs = playerConnections.get(pid);
            if (pWs && pWs.readyState === WebSocket.OPEN) {
                const scoreTable = playerIds.map(id => `${room.players[id].name}: ${room.players[id].score}`).join('\n');
                sendMessage(pWs, {
                    type: 'gameMessage',
                    message: `El bitti!\n\n${scoreTable}\n\n101 olan kazanır. Yeni raund başlıyor...`,
                    duration: 5000
                });
            }
        });

        setTimeout(() => {
            if (!rooms.has(roomCode)) return;
            const newGS = initializeGame(roomCode, ...playerIds);
            playerIds.forEach(pid => sendGameState(roomCode, pid));
        }, 5000);

        return; // Fonksiyondan çık, odayı silme!
    }

    // --- MAÇ BİTTİ (Aşağıdaki kodlar çalışır ve odayı siler) ---
    const finalWinnerId = isForfeit ? playerIds.find(id => id !== winnerId) : (matchWinnerId || winnerId);

    // Oyuncuların oda bilgisini temizle (Tekrar eşleşme yapabilmeleri için)
    if (room.players) {
        Object.keys(room.players).forEach(pid => {
            const playerWs = playerConnections.get(pid);
            if (playerWs) playerWs.roomCode = null;
        });
    }

    try {
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];
        const winnerId = finalWinnerId;

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
                    winnerReason: winnerReason,
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
    if (!ws.roomCode || !ws.playerId) return;
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;
    const gs = room.gameState;

    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'notYourTurn') });

    const player = gs.players[ws.playerId];
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));

    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'hasValidMoves') });
    }

    if (gs.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: "Bazarda daş var, pas keçə bilməzsiniz!" });
    }

    console.log(`❌ ${player.name} pas keçdi.`);
    resetAfkCounter(room, ws.playerId);

    const currentIdx = gs.playerOrder.indexOf(ws.playerId);
    const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
    gs.currentPlayer = gs.playerOrder[nextIdx];
    gs.turn++;
    gs.turnStartTime = Date.now();

    broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: player.name });

    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs, false);
    } else {
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
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
    resetAfkCounter(room, ws.playerId); // Manuel pazar hareketi sıfırlar

    console.log(`🎲 ${player.name} bazardan daş çəkdi. Kalan: ${gs.market.length}`);

    // Çekilen taş oynanabilir mi?
    const canPlayDrawn = canPlayTile(drawnTile, gs.board);
    if (!canPlayDrawn && gs.market.length === 0) {
        // Otomatik pas (Pazar bitti ve taş oynanamıyor)
        const currentIdx = gs.playerOrder.indexOf(ws.playerId);
        const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
        gs.currentPlayer = gs.playerOrder[nextIdx];
        gs.turn++;
        gs.turnStartTime = Date.now();
        broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: player.name });
    }

    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleRejoin(ws, data) {
    const { playerId, roomCode } = data;
    ws.language = data.language || ws.language || 'az';
    if (!playerId || !roomCode) return;

    const room = rooms.get(roomCode);
    if (!room || !room.gameState) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'gameNotFound') });
    }

    // Kopma zamanlayıcısını temizle
    const timer = disconnectGraceTimers.get(playerId);
    if (timer) {
        clearTimeout(timer);
        disconnectGraceTimers.delete(playerId);
        console.log(`⏱️ Kopma zamanlayıcısı temizlendi (Rejoin): ${playerId}`);
    }

    if (!room.players[playerId]) {
        return sendMessage(ws, { type: 'error', message: getMsg(ws.language, 'playerNotInRoom') });
    }

    // Reattach
    ws.playerId = playerId;
    ws.roomCode = roomCode;
    ws.playerName = room.players[playerId].name;
    playerConnections.set(playerId, ws);

    resetAfkCounter(room, playerId); // AFK sayacını sıfırla

    console.log(`🔄 Oyuncu geri döndü: ${ws.playerName} (Oda: ${roomCode})`);

    // Send full state to rejoining player
    setTimeout(() => {
        sendGameState(roomCode, playerId);
        broadcastToRoom(roomCode, { type: 'playerReconnected', playerName: ws.playerName }, playerId);
    }, 500);
}

function handlePlayAgain(ws) {
    if (!ws.roomCode || !ws.playerId) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (!room.playAgainVotes) room.playAgainVotes = new Set();
    room.playAgainVotes.add(ws.playerId);

    const needed = Object.keys(room.players).length;
    console.log(`🔄 Tekrar oyna oyu: ${ws.playerName} (${room.playAgainVotes.size}/${needed})`);

    const count = room.playAgainVotes.size;
    broadcastToRoom(ws.roomCode, {
        type: 'gameMessage',
        message: getMsg('az', 'wantsToPlayAgain').replace('{name}', ws.playerName).replace('{count}', count).replace('{needed}', needed),
        duration: 3000
    });

    if (room.playAgainVotes.size >= needed) {
        console.log(`🚀 Tüm oyuncular onayladı, oyun yeniden başlıyor: ${ws.roomCode}`);
        room.playAgainVotes = new Set();

        // Puanları sıfırla (Yeni maç başlasın)
        Object.keys(room.players).forEach(pid => {
            room.players[pid].score = 0;
        });

        const playerIds = Object.keys(room.players);
        const gameState = initializeGame(ws.roomCode, ...playerIds);

        playerIds.forEach(pid => {
            const socket = playerConnections.get(pid);
            if (socket) {
                socket.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: pid } }));
            }
        });
    }
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

const disconnectGraceTimers = new Map();

function handleDisconnect(ws) {
    if (!ws.playerId) return;

    // Eğer bu socket oyuncunun "güncel" socketi değilse (rejoined), hiçbir işlem yapma
    if (playerConnections.get(ws.playerId) !== ws) {
        console.log(`🔌 Eski socket kapatıldı (Replaced): ${ws.playerName}`);
        return;
    }

    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'} (${ws.playerId})`);

    // Kuyruktan çıkar (Eğer varsa)
    ['2p', '4p'].forEach(mode => {
        const qIdx = matchQueues[mode].findIndex(p => p.playerId === ws.playerId);
        if (qIdx !== -1) {
            matchQueues[mode].splice(qIdx, 1);
            console.log(`❌ Kuyruktan çıkarıldı (${mode}) - Kalan: ${matchQueues[mode].length}`);
        }
    });

    playerConnections.delete(ws.playerId);

    if (ws.roomCode) {
        const room = rooms.get(ws.roomCode);
        if (room && room.gameState && !room.gameState.winner) {
            console.log(`🕒 Oyuncu için 15 saniye bekleme başlatıldı: ${ws.playerName}`);

            // Diğer oyuncularlara dillerine göre bildir
            Object.keys(room.players).forEach(pid => {
                const pWs = playerConnections.get(pid);
                if (pWs && pWs.readyState === WebSocket.OPEN) {
                    const lang = pWs.language || 'az';
                    pWs.send(JSON.stringify({
                        type: 'gameMessage',
                        message: getMsg(lang, 'opponentDisconnected').replace('{name}', ws.playerName),
                        duration: 15000
                    }));
                }
            });

            // 15 saniyelik zamanlayıcı kur
            const timer = setTimeout(() => {
                const refreshedRoom = rooms.get(ws.roomCode);
                if (refreshedRoom && refreshedRoom.gameState && !refreshedRoom.gameState.winner) {
                    const otherPlayerId = Object.keys(refreshedRoom.players).find(id => id !== ws.playerId);
                    console.log(`🏆 15 saniye doldu, ${ws.playerName} bağlanmadı. Maç biter.`);
                    handleGameEnd(ws.roomCode, otherPlayerId, refreshedRoom.gameState, true, 'disconnect');
                }
                disconnectGraceTimers.delete(ws.playerId);
            }, 15000);

            disconnectGraceTimers.set(ws.playerId, timer);
        } else if (room && !room.gameState) {
            // Oyun başlamamışsa sadece odadan çıkar ve diğerlerine güncelleme gönder
            delete room.players[ws.playerId];
            if (Object.keys(room.players).length === 0) {
                rooms.delete(ws.roomCode);
            } else {
                if (room.host === ws.playerId) {
                    room.host = Object.keys(room.players)[0];
                }
                const playerList = Object.keys(room.players).map(id => ({ ...room.players[id], id }));
                Object.keys(room.players).forEach(pid => {
                    sendMessage(playerConnections.get(pid), {
                        type: 'roomUpdated',
                        players: playerList,
                        host: room.host,
                        capacity: room.capacity,
                        roomCode: ws.roomCode
                    });
                });
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

    // Kullanıcı talebi: 1. kez AFK kalırsa sistem oynar, 2. kez AFK kalırsa kaybeder.
    const MAX_AFK_COUNT = 2;
    if (afkCount >= MAX_AFK_COUNT) {
        console.log(`🚨 ${player.name} 2. kez AFK kaldı! Oyun sonlandırılıyor...`);

        // Diğer oyuncuyu kazanan ilan et (4 oyuncu varsa ilk diğerini al)
        const otherPlayerId = Object.keys(gs.players).find(id => id !== currentPlayerId);
        if (otherPlayerId) {
            handleGameEnd(roomCode, otherPlayerId, gs, true, 'afk'); // true = Forfeit
        } else {
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

            // Sıra değiştir (AFK durumunda sayaç SIFIRLANMAZ, sadece manuel harekette sıfırlanır)
            const currentIdx = gs.playerOrder.indexOf(currentPlayerId);
            const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
            gs.currentPlayer = gs.playerOrder[nextIdx];
            gs.turn++;
            gs.turnStartTime = Date.now();

            Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
            return;
        }
    }

    // 2. Oynanacak taş yoksa pazar kontrolü
    if (gs.market && gs.market.length > 0) {
        const drawnTile = gs.market.shift();
        player.hand.push(drawnTile);

        const currentIdx = gs.playerOrder.indexOf(currentPlayerId);
        const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
        gs.currentPlayer = gs.playerOrder[nextIdx];
        gs.turn++;
        gs.turnStartTime = Date.now();

        Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
        return;
    }

    // 3. Pazar boşsa pas geç
    const currentIdx = gs.playerOrder.indexOf(currentPlayerId);
    const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
    gs.currentPlayer = gs.playerOrder[nextIdx];
    gs.turn++;
    gs.turnStartTime = Date.now();

    Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
