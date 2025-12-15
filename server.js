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

const activeGameSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true },
    gameState: Object,
    players: Object,
    telegramIds: [String], // Kolay arama için
    type: String,
    host: String,
    startTime: Number,
    lastUpdated: { type: Date, default: Date.now }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);
const ActiveGame = mongoose.model('DominoActiveGame', activeGameSchema);

app.use(cors());
app.use(express.json());

const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map();
const playerSessions = new Map(); // telegramId -> player data
const activeDisconnects = new Map(); // roomCode -> timeout

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
            try { ws.send(JSON.stringify(message)); } catch (e) { }
        }
    }
}

function sendGameState(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    // Her state gönderiminde veritabanına kaydet
    saveActiveGame(roomCode, room).catch(err => console.error('DB Save Error:', err));

    const ws = playerConnections.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: { ...room.gameState, playerId: playerId }
        }));
    } catch (error) { console.error(error); }
}

async function saveActiveGame(roomCode, room) {
    if (!room || !room.players) return;

    // Telegram ID'lerini topla
    const telegramIds = [];
    Object.values(room.players).forEach(p => {
        if (p.telegramId) telegramIds.push(p.telegramId);
    });

    try {
        await ActiveGame.findOneAndUpdate(
            { roomCode: roomCode },
            {
                roomCode,
                gameState: room.gameState,
                players: room.players,
                telegramIds,
                type: room.type,
                host: room.host,
                startTime: room.startTime,
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error('Oyun kaydetme hatası:', error);
    }
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
                case 'pass': handlePass(ws); break;
                case 'leaveGame': handleLeaveGame(ws); break;
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

// TEK TELEGRAM HESABI KONTROLÜ İÇİN MAP
const activeTelegramSessions = new Map(); // telegramId -> ws

async function handleFindMatch(ws, data) {
    const telegramId = data.telegramId;
    const storedPlayerId = data.playerId; // Client provided stored ID

    console.log(`🔎 Match Request: ${data.username} (TG: ${telegramId}, StoredID: ${storedPlayerId})`);

    // 1. RECONNECT MANTIĞI (ÖNCELİKLİ)
    // Önce bu oyuncu zaten bir odada mı kontrol et
    if (telegramId || storedPlayerId) {
        // A. Memory Kontrolü
        for (const [code, room] of rooms.entries()) {
            let playerEntry = null;
            if (telegramId) {
                // Telegram ID ile ara
                playerEntry = Object.entries(room.players).find(([pid, p]) => p.telegramId === telegramId);
            }
            if (!playerEntry && storedPlayerId && room.players[storedPlayerId]) {
                // Stored ID ile ara (Guest veya DB'den dönen ID)
                playerEntry = [storedPlayerId, room.players[storedPlayerId]];
            }

            if (playerEntry) {
                console.log(`♻️ RECONNECT (Memory): ${data.username} -> Room ${code}`);
                reconnectPlayer(ws, code, playerEntry[0], room);
                return;
            }
        }

        // B. Veritabanı (DB) Kontrolü (Server Restart Sonrası)
        // Eğer memory'de yoksa ama DB'de "devam ediyor" görünüyorsa
        if (telegramId) {
            try {
                const activeGame = await ActiveGame.findOne({ telegramIds: telegramId });
                if (activeGame) {
                    console.log(`♻️ RECONNECT (DB): ${data.username} -> Room ${activeGame.roomCode}`);
                    await restoreGameFromDB(activeGame.roomCode); // Odayı memory'e geri yükle

                    // Tekrar Memory kontrolü yap (artık yüklenmiş olmalı)
                    const room = rooms.get(activeGame.roomCode);
                    if (room) {
                        const pid = Object.keys(room.players).find(id => room.players[id].telegramId === telegramId);
                        if (pid) {
                            reconnectPlayer(ws, activeGame.roomCode, pid, room);
                            return;
                        }
                    }
                }
            } catch (e) { console.error('DB Reconnect Error:', e); }
        }
    }

    // 2. TEK OTURUM KONTROLÜ (Single Session)
    // Eğer oyuncu oyunda değilse (yukarıda return olmadıysa),
    // ama başka bir cihazda bağlantısı açıksa, o bağlantıyı kapatalım.
    if (telegramId) {
        if (activeTelegramSessions.has(telegramId)) {
            const oldWs = activeTelegramSessions.get(telegramId);
            if (oldWs !== ws && oldWs.readyState === WebSocket.OPEN) {
                console.log(`🚫 Eski oturum kapatılıyor: ${telegramId}`);
                sendMessage(oldWs, { type: 'error', message: 'Başka bir cihazdan giriş yapıldığı için bağlantınız kesildi.' });
                oldWs.close(); // Eski bağlantıyı kopar
            }
        }
        activeTelegramSessions.set(telegramId, ws);
    }

    // 3. KUYRUK TEMİZLİĞİ (Zaten kuyrukta mı?)
    const existingQueueIndex = matchQueue.findIndex(p =>
        p.ws === ws ||
        (telegramId && p.telegramId === telegramId) ||
        (storedPlayerId && p.playerId === storedPlayerId)
    );

    if (existingQueueIndex !== -1) {
        // Zaten kuyrukta. Sadece soketi güncelle veya hata ver.
        // Biz soketi güncelleyelim, belki sayfa yeniledi ve tekrar aradı.
        console.log(`⚠️ Zaten kuyrukta, güncelleniyor: ${data.username}`);
        matchQueue[existingQueueIndex].ws = ws;
        sendMessage(ws, { type: 'searchStatus', message: 'Hala rakip aranıyor...' });
        return;
    }

    // 4. YENİ OYUNCU HAZIRLIĞI
    const playerId = storedPlayerId || generateRoomCode(); // Varsa eski ID, yoksa yeni
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !telegramId;

    playerConnections.set(playerId, ws);

    // 5. EŞLEŞTİRME (MATCHMAKING)
    // Kuyruktan uygun birini bul. 
    // Kural: Kendisi olmayan İLK kişi. (Ranked/Casual ayrımı şimdilik kapalı, hızlı eşleşme için)

    // Önce ölü bağlantıları temizle
    for (let i = matchQueue.length - 1; i >= 0; i--) {
        if (matchQueue[i].ws.readyState !== WebSocket.OPEN) {
            matchQueue.splice(i, 1);
        }
    }

    const opponentIndex = matchQueue.findIndex(p => p.ws !== ws && p.telegramId !== (ws.telegramId || 'guest_nomatch'));

    if (opponentIndex !== -1) {
        // RAKİP BULUNDU!
        const opponent = matchQueue.splice(opponentIndex, 1)[0];
        console.log(`✅ MATCH FOUND: ${ws.playerName} vs ${opponent.playerName}`);

        const roomCode = generateRoomCode();
        const gameType = (!ws.isGuest && !opponent.isGuest) ? 'ranked' : 'casual'; // İkisi de üye ise Ranked

        const room = {
            code: roomCode,
            players: {
                [ws.playerId]: {
                    name: ws.playerName,
                    telegramId: ws.telegramId,
                    photoUrl: ws.photoUrl,
                    level: ws.level,
                    elo: ws.elo,
                    isGuest: ws.isGuest
                },
                [opponent.playerId]: {
                    name: opponent.playerName,
                    telegramId: opponent.telegramId,
                    photoUrl: opponent.photoUrl,
                    level: opponent.level,
                    elo: opponent.elo,
                    isGuest: opponent.isGuest
                }
            },
            type: gameType,
            startTime: Date.now()
        };

        rooms.set(roomCode, room);
        ws.roomCode = roomCode;
        opponent.ws.roomCode = roomCode;

        // DB'ye ActiveGame olarak kaydet (Yedek)
        const gameState = initializeGame(roomCode, ws.playerId, opponent.playerId);
        saveActiveGame(roomCode, room);

        // Bildirimler
        sendMessage(ws, { type: 'matchFound', roomCode, opponent: room.players[opponent.playerId], gameType });
        sendMessage(opponent.ws, { type: 'matchFound', roomCode, opponent: room.players[ws.playerId], gameType });

        // 6 saniye sonra oyunu başlat
        setTimeout(() => {
            // Hala bağlılar mı kontrol et
            if (ws.readyState === WebSocket.OPEN) {
                sendMessage(ws, { type: 'gameStart', gameState: { ...gameState, playerId: ws.playerId } });
            }
            if (opponent.ws.readyState === WebSocket.OPEN) {
                sendMessage(opponent.ws, { type: 'gameStart', gameState: { ...gameState, playerId: opponent.playerId } });
            }
        }, 6000);

    } else {
        // RAKİP YOK, KUYRUĞA GİR
        console.log(`⏳ Kuyruğa eklendi: ${ws.playerName}`);
        matchQueue.push({
            ws,
            playerId,
            telegramId: ws.telegramId,
            playerName: ws.playerName,
            photoUrl: ws.photoUrl,
            level: ws.level,
            elo: ws.elo,
            isGuest: ws.isGuest
        });
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

// Yardımcı: DB'den odayı geri yükle
async function restoreGameFromDB(roomCode) {
    if (rooms.has(roomCode)) return; // Zaten memory'de var

    const activeGame = await ActiveGame.findOne({ roomCode });
    if (!activeGame) return;

    rooms.set(roomCode, {
        code: activeGame.roomCode,
        players: activeGame.players,
        gameState: activeGame.gameState,
        type: activeGame.type,
        host: activeGame.host,
        startTime: activeGame.startTime
    });
    console.log(`📂 DB'den oda yüklendi: ${roomCode}`);
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti - Kalan: ${matchQueue.length}`);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function reconnectPlayer(ws, roomCode, playerId, room) {
    // Timeout varsa iptal et
    const timeoutId = activeDisconnects.get(roomCode);
    if (timeoutId) {
        clearTimeout(timeoutId);
        activeDisconnects.delete(roomCode);
        console.log(`✅ Timeout iptal edildi: ${roomCode}`);
    }

    // Eski bağlantıyı temizle
    if (playerConnections.has(playerId)) {
        const oldWs = playerConnections.get(playerId);
        if (oldWs !== ws) {
            try { oldWs.terminate(); } catch (e) { }
        }
    }

    // Yeni bağlantıyı ayarla
    ws.playerId = playerId;
    ws.roomCode = roomCode;
    ws.playerName = room.players[playerId].name;
    ws.telegramId = room.players[playerId].telegramId;
    ws.photoUrl = room.players[playerId].photoUrl;

    playerConnections.set(playerId, ws);

    // Oyunu başlat/devam ettir
    sendMessage(ws, {
        type: 'matchFound',
        roomCode,
        opponent: Object.values(room.players).find(p => p.telegramId !== ws.telegramId) || {},
        gameType: room.type
    });

    // Reconnect case: No 6s delay needed for intro, usually jump straight in.
    // Or maybe show it? Let's show it for consistency but faster. 1s?
    // Actually, if reconnecting, usually user wants to play immediately.
    // Let's keep it fast for reconnect.
    setTimeout(() => {
        const gameStartMsg = { type: 'gameStart', gameState: { ...room.gameState, playerId: playerId } };
        sendMessage(ws, gameStartMsg);

        broadcastToRoom(roomCode, { type: 'opponentReconnected', message: 'Rakip tekrar bağlandı' }, playerId);

        const opponentId = Object.keys(room.players).find(id => id !== playerId);
        if (!playerConnections.has(opponentId)) {
            sendMessage(ws, {
                type: 'playerDisconnected',
                message: 'Rakip bekleniyor (Sunucu Yenilendi)...',
                timeoutSeconds: 20
            });
        }

    }, 500);
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
            if (socket) socket.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: pid } }));
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
        gs.consecutivePasses = 0; // Başarılı hamlede pas sayacı sıfırlanır
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
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


        rooms.delete(roomCode);
        await ActiveGame.deleteOne({ roomCode: roomCode });
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, {
            type: 'gameEnd',
            winner: winnerId,
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: false
        });
        rooms.delete(roomCode);
        ActiveGame.deleteOne({ roomCode: roomCode }).catch(e => { });
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

    // Pas sayacını artır
    gs.consecutivePasses = (gs.consecutivePasses || 0) + 1;

    // Eğer art arda 2 pas yapıldıysa (her iki oyuncu da oynayamıyor) oyun biter
    if (gs.consecutivePasses >= 2) {
        console.log(`🔒 Oyun kilitlendi (2 Pas) - Puanlar hesaplanıyor...`);
        finishGameByScore(ws.roomCode, gs);
        return;
    }

    gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function finishGameByScore(roomCode, gs) {
    const playerIds = Object.keys(gs.players);
    const p1Id = playerIds[0];
    const p2Id = playerIds[1];

    const p1Score = gs.players[p1Id].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
    const p2Score = gs.players[p2Id].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);

    let winnerId;
    if (p1Score < p2Score) winnerId = p1Id;
    else if (p2Score < p1Score) winnerId = p2Id;
    else winnerId = 'DRAW';

    broadcastToRoom(roomCode, {
        type: 'gameLocked',
        message: 'Oyun kilitlendi! Puanlar hesaplanıyor...',
        scoreDetails: {
            [p1Id]: p1Score,
            [p2Id]: p2Score
        }
    });

    // Biraz bekleyip bitir
    setTimeout(() => {
        handleGameEnd(roomCode, winnerId, gs);
    }, 3000);
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];

    // Pazardan taş çekme kuralları
    // 1. Kural: Elinde oynanabilir taş varsa çekemezsin
    const hasPlayable = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (hasPlayable) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var, pazardan çekemezsiniz!' });
    }

    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç (Pas)
        handlePass(ws);
        return;
    }

    // Pazardan taş çek
    const drawnTile = gs.market.shift();
    player.hand.push(drawnTile);

    // İstatistik için move sayma, çekme hamlesi olarak
    // gs.moves++; // İsteğe bağlı

    // Çekilen taş ile oynanabilir mi?
    const canPlayDrawn = canPlayTile(drawnTile, gs.board);

    // Durumu güncelle
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));

    if (canPlayDrawn) {
        sendMessage(ws, { type: 'info', message: 'Çekilen taş oynanabilir!' });
    } else {
        // Otomatik tekrar çekme? Genelde oyuncu manuel çeker.
        // Kullanıcı isteği: "oynamalık taş yoksa pas diger usere gecsin ondada yoksa taslar hesaplansin"
        // Ancak burada oyuncu TEK BİR TAŞ çekti. Hala markette taş varsa ve oynayamıyorsa tekrar çekmeli.
        // Eğer market bittiyse ve oynayamıyorsa o zaman PASS olur.
        if (gs.market.length === 0) {
            sendMessage(ws, { type: 'info', message: 'Pazar bitti ve oynanacak taş yok. Pas geçiliyor.' });
            handlePass(ws);
        }
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

    const leaverId = ws.playerId;
    const winnerId = playerIds.find(id => id !== leaverId);

    handleGameEnd(ws.roomCode, winnerId, gs);

    // Oyun bitti, bu soketin oda bilgisini temizle ki tekrar eşleşme arayabilsin
    ws.roomCode = null;
    // playerId bağlantı için dursun ama aktif oda ilişkisi kalmasın
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);

    if (ws.playerId) playerConnections.delete(ws.playerId);

    // Kuyruktan temizleme: Hem WS referansına hem de TelegramID'ye göre detaylı temizlik
    const qIdx = matchQueue.findIndex(p => p.ws === ws || (ws.telegramId && p.telegramId === ws.telegramId));
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı (Disconnect) - Kalan: ${matchQueue.length}`);
    }

    if (ws.roomCode) {
        console.log(`🏠 Odadan ayrıldı (Kopma): ${ws.roomCode}`);
        broadcastToRoom(ws.roomCode, { type: 'playerDisconnected', message: 'Rakip bağlantısı koptu. Tekrar bağlanması bekleniyor...' });

        // Timeout kaldırıldı - Oyun DB'de kayıtlı kalmalı.
        // Bağlantı kopsa bile ActiveGame silinmiyor.
        // Oyuncu geri geldiğinde ActiveGame'den geri yüklenecek.

        // Sadece server memory'den temizlemeyelim, çünkü oyun "duraklatıldı" modunda memory'de kalabilir 
        // veya memory'den silip DB'den restore edebiliriz.
        // Memory'den silersek, diğer oyuncu ne yapacak?
        // Diğer oyuncu hala bağlı. O zaman odayı silmemeliyiz.
        // Sadece ws bağlantısını kopuk işaretleyelim.
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
