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
    lastPlayed: { type: Date, default: Date.now },
    isVisible: { type: Boolean, default: true } // Admin panel visibility toggle
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
const matchQueues = { 2: [], 4: [] }; // Kuyrukları ayır
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
        const players = await Player.find({ elo: { $gt: 0 }, isVisible: { $ne: false } }) // Guest ve gizli oyuncular gözükmesin
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
app.post('/api/admin/action', async (req, res) => {
    const { adminId, action, targetTelegramId, payload } = req.body;
    
    // Basit güvenlik kontrolü
    if (String(adminId) !== '976640409') {
        return res.status(403).json({ error: 'Yetkisiz işlem' });
    }

    try {
        const player = await Player.findOne({ telegramId: targetTelegramId });
        if (!player) return res.status(404).json({ error: 'Oyuncu bulunamadı' });

        if (action === 'updateElo') {
            const newElo = parseInt(payload.elo);
            player.elo = newElo;
            player.level = calculateLevel(player.elo);

            // İSTEK: ELO 0 olduğunda tüm istatistikleri sıfırla
            if (newElo === 0) {
                player.wins = 0;
                player.losses = 0;
                player.draws = 0;
                player.totalGames = 0;
                player.winStreak = 0;
                player.bestWinStreak = 0;
            }

            // Bellekteki verileri güncelle (Anlık yansıması için)
            for (const [pid, ws] of playerConnections) {
                if (ws.telegramId === targetTelegramId) {
                    ws.elo = player.elo;
                    ws.level = player.level;
                    // İstatistikleri bellekte de sıfırla
                    if (newElo === 0) {
                        ws.wins = 0;
                        ws.losses = 0;
                    }
                    
                    if (ws.roomCode && rooms.has(ws.roomCode)) {
                        const room = rooms.get(ws.roomCode);
                        if (room.players[pid]) {
                            room.players[pid].elo = player.elo;
                            room.players[pid].level = player.level;
                        }
                        if (room.gameState && room.gameState.players[pid]) {
                            room.gameState.players[pid].elo = player.elo;
                            room.gameState.players[pid].level = player.level;
                            sendGameState(ws.roomCode, pid);
                        }
                    }
                }
            }
        }
        if (action === 'toggleVisibility') player.isVisible = payload.isVisible;
        
        await player.save();
        res.json({ success: true, player });
    } catch (error) { res.status(500).json({ error: error.message }); }
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

function dealCardsAndDetermineStart(playerIds) {
    const tiles = createDominoSet();
    const hands = {};
    const playerCount = playerIds.length;
    
    // Herkese 7 taş dağıt
    playerIds.forEach((pid, index) => {
        hands[pid] = tiles.slice(index * 7, (index + 1) * 7);
    });
    
    // Kalan taşlar pazar (4 kişide pazar boş olur)
    const market = tiles.slice(playerCount * 7);

    let startingPlayer = playerIds[0];
    let highestDouble = -1;

    playerIds.forEach(pid => {
        const hand = hands[pid];
        for (let tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayer = pid;
            }
        }
    });
    
    // Eğer kimsede çift yoksa en yüksek toplamı olan başlar (Basitlik için ilk oyuncu kalsın veya eklenebilir)
    
    return { hands, market, startingPlayer, highestDouble };
}

function initializeGame(roomCode, playerIds) {
    const { hands, market, startingPlayer, highestDouble } = dealCardsAndDetermineStart(playerIds);

    const room = rooms.get(roomCode);

    const playersData = {};
    const initialScores = {};
    
    playerIds.forEach(pid => {
        playersData[pid] = {
            hand: hands[pid],
        name: room.players[id].name,
        elo: room.players[id].elo,
        photoUrl: room.players[id].photoUrl,
        level: room.players[id].level,
        timeouts: 0
        };
        initialScores[pid] = 0;
    });

    room.gameState = {
        board: [],
        players: playersData,
        market: market,
        currentPlayer: startingPlayer, // from dealCardsAndDetermineStart
        turn: 1,
        turnStartTime: Date.now(),
        score: initialScores,
        round: 1,
        consecutivePasses: 0 // Oyun kapalı kontrolü için
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

function checkWinner(gameState) {
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            return playerId;
        }
    }

    // Oyun kilitlendi mi? (Pazar boş ve kimse oynayamıyor)
    const marketEmpty = !gameState.market || gameState.market.length === 0;
    const anyPlayerCanPlay = Object.values(gameState.players).some(p => 
        p.hand.some(tile => canPlayTile(tile, gameState.board))
    );

    if (!anyPlayerCanPlay && marketEmpty) {
        // En az puana sahip olan kazanır
        let minScore = Infinity;
        let winnerId = null;
        let isDraw = false;

        for (const pid in gameState.players) {
            const score = gameState.players[pid].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
            if (score < minScore) {
                minScore = score;
                winnerId = pid;
                isDraw = false;
            } else if (score === minScore) {
                isDraw = true;
            }
        }

        if (isDraw) return 'DRAW';
        return winnerId;
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

    // OPTİMİZASYON: Rakibin elini gizle (Veri tasarrufu ve güvenlik)
    const sanitizedGameState = { ...room.gameState, playerId: playerId };
    const players = {};
    
    for (const pid in room.gameState.players) {
        const p = room.gameState.players[pid];
        if (pid === playerId) {
            players[pid] = p; // Kendi verisi tam gider
        } else {
            // Rakip verisi: Elindeki taşların değerlerini sil, sadece sayısını gönder
            players[pid] = {
                ...p,
                hand: p.hand.map(() => [-1, -1]) // Değerleri gizle
            };
        }
    }
    sanitizedGameState.players = players;

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: sanitizedGameState,
            serverTime: Date.now() // Timer senkronizasyonu için sunucu saati
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) { }
    }
}

function nextTurn(roomCode, previousPlayerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    const nextPlayerId = playerIds.find(id => id !== previousPlayerId);

    if (nextPlayerId) {
        gs.currentPlayer = nextPlayerId;
        gs.turnStartTime = Date.now();
        gs.turn = (gs.turn || 0) + 1;
        
        if (gs.players[nextPlayerId]) gs.players[nextPlayerId].timeouts = 0;

        Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
        
        checkAutoPass(roomCode, nextPlayerId);
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
                case 'rematch': handleRematch(ws); break;
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
    const playerCount = parseInt(data.playerCount || 2); // Varsayılan 2 (Sayı olduğundan emin ol)
    const queue = matchQueues[playerCount];

    // 1. ADIM: Oyuncuyu TÜM kuyruklardan temizle (Sayfa yenileme/Hata durumları için)
    // Bu işlem "Zaten kuyru dasınız" ve "Kendi kendine eşleşme" sorunlarını çözer.
    for (const key in matchQueues) {
        const q = matchQueues[key];
        const idx = q.findIndex(p => p.playerId === ws.playerId || (ws.telegramId && p.telegramId === ws.telegramId));
        if (idx !== -1) {
            q.splice(idx, 1);
            console.log(`🧹 ${ws.playerName} eski kuyruktan temizlendi.`);
        }
    }

    // 2. ADIM: Oyuncu zaten aktif bir oyunda mı?
    if (ws.roomCode && rooms.has(ws.roomCode)) {
        const room = rooms.get(ws.roomCode);
        // Eğer oyun bitmemişse, oyuncuyu uyar veya rejoin yapmasını sağla
        if (room.gameState && !room.gameState.winner) {
            return sendMessage(ws, { type: 'error', message: 'Zaten aktif bir oyundasınız. Lütfen sayfayı yenileyin.' });
        } else {
            // Oyun bitmiş ama oda kalmışsa temizle
            ws.roomCode = null;
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

    playerConnections.set(playerId, ws);
    queue.push({
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
    console.log(`✅ ${ws.playerName} (${playerType}) ${playerCount} kişilik kuyrukta - Toplam: ${queue.length}`);

    if (queue.length >= playerCount) {
        const players = [];
        for (let i = 0; i < playerCount; i++) players.push(queue.shift());
        
        // Kendi kendine eşleşme kontrolü (Ekstra Güvenlik)
        const uniqueIds = new Set(players.map(p => p.telegramId || p.playerId));
        if (uniqueIds.size < players.length) {
            console.log('⚠️ Kendi kendine eşleşme algılandı, iptal ediliyor.');
            // Oyuncuları kuyruğun başına geri koy ve işlemi durdur
            players.forEach(p => queue.unshift(p));
            return;
        }

        const roomCode = generateRoomCode();
        const isRanked = players.every(p => !p.isGuest);
        const gameType = isRanked ? 'ranked' : 'casual';
        
        console.log(`🎮 Maç oluşturuluyor (${gameType.toUpperCase()}): ${players.map(p => p.playerName).join(' vs ')}`);

        const playersMap = {};
        players.forEach(p => {
            playersMap[p.playerId] = {
                name: p.playerName,
                telegramId: p.telegramId,
                photoUrl: p.photoUrl,
                level: p.level,
                elo: p.elo,
                isGuest: p.isGuest
            };
            p.ws.roomCode = roomCode;
        });

        const room = {
            code: roomCode,
            players: playersMap,
            type: gameType,
            startTime: Date.now(),
            targetScore: 101, // 101 olan kazanır
            playerCount: playerCount
        };

        rooms.set(roomCode, room);

        const playerIds = players.map(p => p.playerId);
        const gameState = initializeGame(roomCode, playerIds);

        players.forEach(p => {
            // Rakipleri gönder (kendisi hariç)
            const opponents = players.filter(op => op.playerId !== p.playerId).map(op => room.players[op.playerId]);
            sendMessage(p.ws, { type: 'matchFound', roomCode, opponents: opponents, gameType, playerCount });
        });

        // 4 saniye bekleme (Lobi süresi)
        setTimeout(() => {
            // KONTROL: Oyun başlamadan önce herkes hala bağlı mı?
            const allConnected = players.every(p => 
                playerConnections.has(p.playerId) && 
                playerConnections.get(p.playerId).readyState === WebSocket.OPEN
            );

            if (!allConnected) {
                console.log(`❌ Oyun başlatılamadı (${roomCode}), bir oyuncu düştü.`);
                rooms.delete(roomCode);
                // Bağlı olanları tekrar kuyruğun başına ekle
                players.forEach(p => {
                    if (playerConnections.has(p.playerId) && playerConnections.get(p.playerId).readyState === WebSocket.OPEN) {
                        sendMessage(p.ws, { type: 'error', message: 'Rakip bağlantısı koptu, tekrar aranıyor...' });
                        handleFindMatch(p.ws, { playerCount, ...p }); // Tekrar kuyruğa sok
                    }
                });
                return;
            }

            players.forEach(p => {
                sendMessage(p.ws, { type: 'gameStart', gameState: { ...gameState, playerId: p.playerId } });
                sendMessage(p.ws, { type: 'session', playerId: p.playerId, roomCode });
            });
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 4000); // 4 saniye
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) {
    for (const key in matchQueues) {
        const queue = matchQueues[key];
        // PlayerID veya TelegramID ile bul
        const index = queue.findIndex(p => p.playerId === ws.playerId || (ws.telegramId && p.telegramId === ws.telegramId));
        if (index !== -1) {
            queue.splice(index, 1);
            console.log(`❌ ${ws.playerName} aramayı iptal etti (${key} kişilik)`);
            sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
            return;
        }
    }
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode(); // generateRoomCode already returns uppercase
    const playerCount = data.playerCount || 2;
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
        targetScore: 101,
        playerCount: playerCount
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
}

function handleJoinRoom(ws, data) {
    if (!data.roomCode) return sendMessage(ws, { type: 'error', message: 'Oda kodu gerekli' });
    const code = data.roomCode.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı' });
    if (Object.keys(room.players).length >= room.playerCount) return sendMessage(ws, { type: 'error', message: 'Oda dolu' });
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

    // Odaya katılan herkese bilgi ver
    const playerIds = Object.keys(room.players);

    playerIds.forEach(targetId => {
        const socket = playerConnections.get(targetId);
        if (socket) {
            // FIX: Rakipleri playerId üzerinden filtrele (Guest sorunu çözüldü)
            const opponents = playerIds.filter(pid => pid !== targetId).map(pid => room.players[pid]);
            sendMessage(socket, { type: 'matchFound', roomCode: code, opponents: opponents, gameType: 'casual', playerCount: room.playerCount });
        }
    });

    // Eğer oda dolduysa oyunu başlat
    if (playerIds.length === room.playerCount) {
        const gameState = initializeGame(code, playerIds);
        
        setTimeout(() => {
            playerIds.forEach(targetId => {
            const socket = playerConnections.get(targetId);
            if (socket) {
                socket.send(JSON.stringify({ type: 'session', playerId: targetId, roomCode: code }));
                socket.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: targetId } }));
            }
        });
        console.log(`✅ Özel oyun başladı: ${code}`);
    }, 4000);
    }
}

function handlePlayTile(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    const tile = player.hand[data.tileIndex];

    if (!tile) return sendMessage(ws, { type: 'error', message: 'Taş bulunamadı' });

    const position = data.position || 'both';
    const success = playTileOnBoard(tile, gs.board, position);

    if (!success) {
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz (Pozisyon uyuşmuyor)' });
    }

    player.hand.splice(data.tileIndex, 1);
    player.timeouts = 0; // Hamle yapınca timeout sıfırla
    gs.moves = (gs.moves || 0) + 1;
    gs.consecutivePasses = 0; // Hamle yapıldı, pas sayacını sıfırla

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
        // 101 KURALI: Kazanan, diğerlerinin elindeki taşların toplamını alır
        let pointsGained = 0;
        for (const pid in gs.players) {
            if (pid !== winnerId) {
                const handSum = gs.players[pid].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
                pointsGained += handSum;
            }
        }
        
        gs.score[winnerId] += pointsGained;
        console.log(`📈 ${gs.players[winnerId].name} kazandı. +${pointsGained} puan. Toplam: ${gs.score[winnerId]}`);
        // roundLoserId = Object.keys(gs.players).find(id => id !== winnerId); // 4 kişide loser çok, önemi yok
    }

    const winnerName = isDraw ? 'Beraberlik' : (gs.players[winnerId]?.name || 'Bilinmeyen');
    console.log(`🏁 Round bitti. Skorlar: ${JSON.stringify(gs.score)}`);

    broadcastToRoom(roomCode, { type: 'roundEnd', winnerId, score: gs.score });

    // Maç bitiş kontrolü (101 olan kazanır)
    if (!isDraw && gs.score[winnerId] >= (room.targetScore || 101)) {
        console.log(`🏆 Maç bitti! Kazanan: ${winnerName}`);
        setTimeout(() => handleMatchEnd(roomCode, winnerId, gs, 'score'), 4000); 
    } else {
        // Yeni raund başlat (Kaybeden başlar mantığı 4 kişide karışık, sıradaki başlasın veya kazanan)
        // Domino kuralı: Genellikle kazanan başlar veya sıradaki. Biz kazanan başlasın diyelim.
        setTimeout(() => startNewRound(roomCode, winnerId), 5000); 
    }
}

function startNewRound(roomCode, winnerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
 
    // Yeni raund için kartları dağıt
    const { hands, market, startingPlayer: defaultStartingPlayer } = dealCardsAndDetermineStart(playerIds);
 
    // Oyun durumunu sıfırla ama skorları ve raund sayısını koru
    gs.board = [];
    playerIds.forEach(pid => {
        gs.players[pid].hand = hands[pid];
    });
    gs.market = market;
    gs.round++;
    gs.consecutivePasses = 0;
    // Kazanan başlar, yoksa (beraberlik) sistem belirler
    gs.currentPlayer = winnerId && winnerId !== 'DRAW' ? winnerId : defaultStartingPlayer; 
    gs.turnStartTime = Date.now();
    gs.winner = null; // Önceki kazananı temizle
 
    console.log(`🔄 Yeni Raund (${gs.round}) başlıyor. Başlayan: ${gs.players[gs.currentPlayer].name}`);
    Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
}

async function handleMatchEnd(roomCode, winnerId, gameState, reason = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Oyuncuların oda bilgisini temizle (Tekrar eşleşme yapabilmeleri için)
    if (room.players) {
        Object.keys(room.players).forEach(pid => {
            const playerWs = playerConnections.get(pid);
            // if (playerWs) playerWs.roomCode = null; // Rematch için tutuyoruz
        });
    }

    try {
        const playerIds = Object.keys(gameState.players);
        const isDraw = winnerId === 'DRAW';
        const loserId = isDraw ? null : playerIds.find(id => id !== winnerId); // Sadece 1 loser gösterimi için (UI)

        let eloChanges = null;

        // Guest kontrolu - Guest varsa ELO guncellemesi yapma
        const isRankedMatch = room.type === 'ranked';

        if (isRankedMatch) {
            // 4 Kişilik ELO mantığı karmaşık olduğu için şimdilik sadece kazanan + puan, kaybeden - puan
            // Basit ELO: Kazanan +15, Kaybedenler -5
            if (!isDraw) {
                const winnerPlayer = await Player.findOne({ telegramId: room.players[winnerId].telegramId });
                if (winnerPlayer) {
                    winnerPlayer.elo += 15;
                    winnerPlayer.wins += 1;
                    winnerPlayer.level = calculateLevel(winnerPlayer.elo);
                    await winnerPlayer.save();
                }
                
                for (const pid of playerIds) {
                    if (pid !== winnerId) {
                        const loserPlayer = await Player.findOne({ telegramId: room.players[pid].telegramId });
                        if (loserPlayer) {
                            loserPlayer.elo = Math.max(0, loserPlayer.elo - 5);
                            loserPlayer.losses += 1;
                            loserPlayer.level = calculateLevel(loserPlayer.elo);
                            await loserPlayer.save();
                        }
                    }
                }
                eloChanges = { winner: 15, loser: -5 };
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
        // rooms.delete(roomCode); // Rematch için silmiyoruz, handleDisconnect veya Rematch iptali silecek
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
        // rooms.delete(roomCode);
    }
}

function checkAutoPass(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;
    const gs = room.gameState;
    const player = gs.players[playerId];

    // 1. Oynanabilir taş var mı?
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (canPlay) return; 

    // 2. Pazar kontrolü (Pazar doluysa oyuncu çekmeli)
    if (gs.market && gs.market.length > 0) return;

    // 3. Pazar boş ve hamle yok -> 2 saniye sonra otomatik pas
    setTimeout(() => {
        const r = rooms.get(roomCode);
        if (!r || !r.gameState) return;
        if (r.gameState.currentPlayer !== playerId) return;
        
        // Tekrar kontrol (State değişmiş olabilir)
        const p = r.gameState.players[playerId];
        const cp = p.hand.some(tile => canPlayTile(tile, r.gameState.board));
        if (cp) return;

        executeAutoPass(roomCode, playerId);
    }, 2000);
}

function executeAutoPass(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;
    const gs = room.gameState;

    gs.consecutivePasses = (gs.consecutivePasses || 0) + 1;

    if (gs.consecutivePasses >= 2) {
        handleBlockedGame(roomCode, playerId);
    } else {
        broadcastToRoom(roomCode, { type: 'turnPassed', playerName: gs.players[playerId].name });
        broadcastToRoom(roomCode, { type: 'playSound', sound: 'pass' });
        nextTurn(roomCode, playerId);
    }
}

function handleBlockedGame(roomCode, triggeringPlayerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;
    
    console.log(`🔒 Oyun Kapalı (Blocked) - Hesaplama yapılıyor...`);
    
    const opponentId = Object.keys(room.gameState.players).find(id => id !== triggeringPlayerId);
    const playerScore = room.gameState.players[triggeringPlayerId].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
    const opponentHand = room.gameState.players[opponentId].hand;
    const opponentScore = opponentHand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
    
    let winnerIdForCalc = null;
    if (playerScore < opponentScore) winnerIdForCalc = triggeringPlayerId;
    else if (opponentScore < playerScore) winnerIdForCalc = opponentId;
    else winnerIdForCalc = 'DRAW'; 

    broadcastToRoom(roomCode, {
        type: 'calculationLobby',
        players: {
            [triggeringPlayerId]: { hand: room.gameState.players[triggeringPlayerId].hand, name: room.players[triggeringPlayerId].name, photoUrl: room.players[triggeringPlayerId].photoUrl, score: playerScore },
            [opponentId]: { hand: opponentHand, name: room.players[opponentId].name, photoUrl: room.players[opponentId].photoUrl, score: opponentScore }
        },
        winnerId: winnerIdForCalc,
        duration: 7000
    });

    setTimeout(() => {
        processRoundWinner(roomCode, winnerIdForCalc, room.gameState);
    }, 8000);
}

function handlePass(ws) {
    // ws nesnesi zaten oyuncu bilgilerini taşıyor
    if (!ws || !ws.roomCode) return;

    const room = rooms.get(ws.roomCode);
    if (!room || room.gameState.currentPlayer !== ws.playerId) return;

    // Reset timeouts
    room.gameState.players[ws.playerId].timeouts = 0;

    // Pas geçildiği için sayacı artır
    room.gameState.consecutivePasses = (room.gameState.consecutivePasses || 0) + 1;

    // Check if player can actually pass (no valid moves)
    const playerHand = room.gameState.players[ws.playerId].hand;
    const canPlayAnyTile = playerHand.some(tile => 
        canPlayTile(tile, room.gameState.board)
    );

    // If market is empty and no valid moves, end the game
    // OYUN KAPALI KONTROLÜ: Eğer 2 kez üst üste pas geçildiyse (her iki oyuncu da oynayamıyor)
    if (room.gameState.consecutivePasses >= 2) {
        handleBlockedGame(ws.roomCode, ws.playerId);
        return;
    }

    // If there are tiles in market but player has no valid moves, draw a tile
    if (!canPlayAnyTile && room.gameState.market.length > 0) {
        const drawnTile = room.gameState.market.pop();
        room.gameState.players[ws.playerId].hand.push(drawnTile);
        room.gameState.consecutivePasses = 0; // Taş çekildiği için pas sayacı sıfırlanır (bazı kurallarda)
        
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
    gs.consecutivePasses = 0; // Taş çekme işlemi pas sayacını sıfırlar

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
            gs.consecutivePasses = 1; // Pas sayılır
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
        // HATA YERİNE RESET GÖNDER: Sayfa yenilendiğinde oyun yoksa lobiye at
        return sendMessage(ws, { type: 'resetClient', message: 'Oyun bulunamadı' });
    }

    if (!room.players || !room.players[playerId]) {
        return sendMessage(ws, { type: 'resetClient', message: 'Oyun oturumu geçersiz' });
    }

    // Reattach
    ws.playerId = playerId;
    ws.roomCode = roomCode;
    ws.playerName = room.players[playerId].name;
    playerConnections.set(playerId, ws);

    // Eğer oyuncu geri döndüyse ve cleanup timer varsa iptal et
    if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
    }

    console.log(`🔄 Oyuncu geri döndü: ${ws.playerName} (Oda: ${roomCode})`);

    // Send full state to rejoining player
    setTimeout(() => {
        sendGameState(roomCode, playerId);
        broadcastToRoom(roomCode, { type: 'playerReconnected', playerName: ws.playerName }, playerId);
    }, 500);
}

function handleRematch(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    room.rematchVotes = room.rematchVotes || new Set();
    room.rematchVotes.add(ws.playerId);
    
    const playerCount = Object.keys(room.players).length;
    
    broadcastToRoom(ws.roomCode, { 
        type: 'rematchUpdate', 
        votes: room.rematchVotes.size, 
        needed: playerCount 
    });
    
    if (room.rematchVotes.size === playerCount) {
        room.rematchVotes.clear();
        startNewMatch(ws.roomCode);
    }
}

function startNewMatch(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const playerIds = Object.keys(room.players);
    const gameState = initializeGame(roomCode, playerIds);
    
    playerIds.forEach(pid => {
        const ws = playerConnections.get(pid);
        if (ws) {
            sendMessage(ws, { type: 'gameStart', gameState: { ...gameState, playerId: pid } });
        }
    });
}

function handleLeaveGame(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || !ws.playerId) {
        return;
    }

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);

    const leaverId = String(ws.playerId);
    const winnerId = playerIds.find(id => String(id) !== leaverId);

    handleMatchEnd(ws.roomCode, winnerId, gs, 'disconnect');

    // Oyun bitti, bu soketin oda bilgisini temizle ki tekrar eşleşme arayabilsin
    ws.roomCode = null;
    // playerId bağlantı için dursun ama aktif oda ilişkisi kalmasın
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);

    if (ws.playerId) playerConnections.delete(ws.playerId);

    for (const key in matchQueues) {
        const queue = matchQueues[key];
        const qIdx = queue.findIndex(p => p.playerId === ws.playerId);
        if (qIdx !== -1) {
            queue.splice(qIdx, 1);
            console.log(`❌ Kuyruktan çıkarıldı (${key} kişilik)`);
        }
    }

    if (ws.roomCode) {
        const room = rooms.get(ws.roomCode);
        if (room) {
            console.log(`🏠 Odadan ayrıldı (Bağlantı kesildi): ${ws.roomCode}`);
            broadcastToRoom(ws.roomCode, { 
                type: 'playerDisconnected', 
                playerName: ws.playerName,
                playerId: ws.playerId // Frontend kimin düştüğünü bilsin
            });

            // Sadece oyun BAŞLAMAMIŞSA veya oda boşsa odayı sil
            // Oyun devam ediyorsa odayı tut ki geri dönebilsin
            const qSize = Object.keys(room.players).length;
            if (!room.gameState) {
                // LOBBY MODE (Oyun başlamamışsa)
                delete room.players[ws.playerId]; // Sadece çıkan oyuncuyu sil

                if (Object.keys(room.players).length === 0) {
                    rooms.delete(ws.roomCode); // Oda boşaldıysa sil
                } else {
                    // Eğer özel oda sahibi çıktıysa odayı kapat
                    if (room.type === 'private' && room.host === ws.playerId) {
                        const playerIds = Object.keys(room.players);
                        playerIds.forEach(pid => {
                            const socket = playerConnections.get(pid);
                            if (socket) sendMessage(socket, { type: 'resetClient', message: 'Oda sahibi ayrıldı.' });
                        });
                        rooms.delete(ws.roomCode);
                    } else {
                        // Diğer oyunculara güncel listeyi gönder (Lobi güncellemesi)
                        const playerIds = Object.keys(room.players);
                        playerIds.forEach(targetId => {
                            const socket = playerConnections.get(targetId);
                            if (socket) {
                                const opponents = playerIds.filter(pid => pid !== targetId).map(pid => room.players[pid]);
                                sendMessage(socket, { type: 'matchFound', roomCode: ws.roomCode, opponents: opponents, gameType: room.type, playerCount: room.playerCount });
                            }
                        });
                    }
                }
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
                    }, 25000); // İSTEK: 25 saniye bekleme süresi (İnternet kopması/Kapatma için)
                }
            }
        }
    }
}

// --- TIMEOUT KONTROLÜ ---

setInterval(() => {
    rooms.forEach((room, roomCode) => {
        if (!room.gameState || !room.gameState.turnStartTime || room.gameState.winner) return;
        
        // 25 saniye süre (İstek üzerine düşürüldü)
        const TURN_LIMIT = 25000;
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

    // Bağlantı kontrolü: Eğer oyuncu bağlı değilse ve süresi dolduysa oyunu bitir
    if (!playerConnections.has(currentPlayerId)) {
        console.log(`⏰ ${player.name} bağlı değil ve süresi doldu. Oyun bitiriliyor.`);
        const winnerId = Object.keys(gs.players).find(id => id !== currentPlayerId);
        handleMatchEnd(roomCode, winnerId, gs, 'disconnect');
        return;
    }
    
    // Timeout kontrolü
    player.timeouts = (player.timeouts || 0) + 1;
    if (player.timeouts >= 2) {
        console.log(`⏰ ${player.name} 2. kez AFK kaldı. Oyun bitiriliyor.`);
        const winnerId = Object.keys(gs.players).find(id => id !== currentPlayerId);
        gs.winner = winnerId; // Döngüyü durdurmak için
        handleMatchEnd(roomCode, winnerId, gs, 'afk');
        return;
    }

    broadcastToRoom(roomCode, {
        type: 'gameMessage',
        messageKey: 'afkWarning', // Mesaj anahtarı gönder
        params: { name: player.name, timeouts: player.timeouts }, // Parametreler gönder
        duration: 4000
    });

    console.log(`⏰ ${player.name} için süre doldu! Otomatik işlem yapılıyor...`);

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
            gs.consecutivePasses = 0;
            
            // Kazanan kontrolü
            const winner = checkWinner(gs);
            if (winner) {
                processRoundWinner(roomCode, winner, gs);
                return;
            }
            
            // Sıra değiştir
            nextTurn(roomCode, currentPlayerId);
            return;
        }
    }

    // 2. Oynanacak taş yoksa pazar kontrolü
    if (gs.market && gs.market.length > 0) {
        const drawnTile = gs.market.shift(); // Pazardan bir taş çek
        player.hand.push(drawnTile); // Oyuncunun eline ekle
        gs.consecutivePasses = 0;
        console.log(`⏰ (Auto) ${player.name} pazardan taş çekti: [${drawnTile}]`);
        // Çektikten sonra sıra otomatik olarak geçer (hızlı oyun için)
        nextTurn(roomCode, currentPlayerId);
        return;
    }

    // 3. Pazar boşsa pas geç
    console.log(`⏰ (Auto) ${player.name} pas geçti (pazar boş).`);
    gs.consecutivePasses = (gs.consecutivePasses || 0) + 1;
    nextTurn(roomCode, currentPlayerId);
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
