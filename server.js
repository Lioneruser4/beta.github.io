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

// --- DÜZELTME: Seviye Hesaplama Mantığı ---
// Seviye 1: 0-149 ELO
// Seviye 2: 150-299 ELO
// Seviye 3: 300-449 ELO ... vb.
function calculateLevel(elo) {
    return Math.floor(elo / 150) + 1; // Her 150 puanda bir seviye atlar, 1'den başlar.
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

// --- YENİ: Admin API Endpoint'leri ---

// Admin yetki kontrolü için middleware
const adminAuth = (req, res, next) => {
    const adminTelegramId = '976640409'; // Sizin Telegram ID'niz
    const requestorId = req.body.telegramId || req.query.telegramId;

    if (requestorId === adminTelegramId) {
        next(); // Yetkili, devam et
    } else {
        res.status(403).json({ error: 'Yetkiniz yok' });
    }
};

app.post('/api/admin/reset-all-stats', adminAuth, async (req, res) => {
    try {
        console.log(`🚨 ADMIN ACTION: ${req.body.telegramId} tüm istatistikleri sıfırlıyor.`);
        await Player.updateMany({}, {
            $set: {
                elo: 0,
                level: 1,
                wins: 0,
                losses: 0,
                draws: 0,
                totalGames: 0,
                winStreak: 0,
                bestWinStreak: 0
            }
        });
        res.json({ success: true, message: 'Tüm oyuncu istatistikleri başarıyla sıfırlandı.' });
    } catch (error) {
        console.error('Admin reset error:', error);
        res.status(500).json({ error: 'İstatistikler sıfırlanırken bir hata oluştu.' });
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
    
    // --- DÜZELTME: En küçük çifti bulan oyuncu başlar ---
    let startingPlayer = null;
    let startingDouble = -1;

    // Öncelik sırası: 1-1, 2-2, ..., 6-6
    for (let i = 1; i <= 6; i++) {
        for (const player of [player1Id, player2Id]) {
            const hand = player === player1Id ? player1Hand : player2Hand;
            if (hand.some(tile => tile[0] === i && tile[1] === i)) {
                startingPlayer = player;
                startingDouble = i;
                break; // Bu çift için oyuncu bulundu, diğer oyuncuya bakma
            }
        }
        if (startingPlayer) break; // En küçük çift bulundu, döngüden çık
    }
    
    // Eğer 1-1'den 6-6'ya kadar çift bulunamazsa, 0-0'ı kontrol et
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
    
    // Eğer hiçbir oyuncuda çift taş yoksa, rastgele bir oyuncu seç
    if (!startingPlayer) {
        startingPlayer = [player1Id, player2Id][Math.floor(Math.random() * 2)];
        startingDouble = -1; // Çift taş olmadığını belirtmek için
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
        startingDouble: startingDouble
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

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break; // İstemci heartbeat'ine yanıt
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'leaveGame': handleLeaveGame(ws); break;
                case 'reconnectToGame': handleReconnect(ws, data); break; // YENİ: Yeniden bağlanma isteği
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

    // --- YENİ: Misafir kullanıcıların dereceli maç aramasını engelle ---
    // İstemci tarafında bu kontrol olsa da, sunucu tarafında da olması güvenliği artırır.
    // 'ranked' bir maç arıyorsa ve misafirse, reddet.
    const gameTypeRequest = data.gameType || 'ranked'; // Varsayılan olarak ranked kabul edelim
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
        // --- YENİ: Sadece aynı türden oyuncuları eşleştir (ranked vs ranked, casual vs casual) ---
        const potentialOpponents = matchQueue.filter(p => p.ws !== ws && p.isGuest === ws.isGuest);
        if (potentialOpponents.length === 0) return sendMessage(ws, { type: 'searchStatus', message: 'Uygun rakip bekleniyor...' });
        let p1 = matchQueue.splice(matchQueue.findIndex(p => p.ws === ws), 1)[0];
        let p2 = matchQueue.splice(matchQueue.findIndex(p => p.ws === potentialOpponents[0].ws), 1)[0];

        // Aynı Telegram hesabının kendi kendisiyle eşleşmesini engelle
        if (!p1.isGuest && !p2.isGuest && p1.telegramId && p2.telegramId && p1.telegramId === p2.telegramId) {
            // İkinci oyuncuyu kuyruğa geri koy ve bu eşleşmeyi iptal et
            matchQueue.unshift(p2);
            // Bu durumda p1 için tekrar rakip beklenir
            console.log('⚠️ Aynı Telegram hesabı kendi kendisiyle eşleşmeye çalıştı, engellendi');
            return;
        }
        const roomCode = generateRoomCode();

        // --- DÜZELTME: Her iki oyuncu da misafir değilse, maç her zaman 'ranked' olmalıdır ---
        const gameType = (p1.isGuest || p2.isGuest) ? 'casual' : 'ranked'; // 'casual' yerine 'friendly' de olabilir
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

        // İYİLEŞTİRME: Oyuncuların eşleşme ekranını görmesi için 3 saniye bekle
        setTimeout(() => {
            const gameStartMsg = { type: 'gameStart', gameState: { ...gameState, playerId: p1.playerId } };
            sendMessage(p1.ws, gameStartMsg);
            
            const gameStartMsg2 = { type: 'gameStart', gameState: { ...gameState, playerId: p2.playerId } };
            sendMessage(p2.ws, gameStartMsg2);
            
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 3000); // 500ms'den 3000ms'ye çıkarıldı
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
    // --- DÜZELTME: Oyuncu bilgilerini doğru şekilde ata ---
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
                isGuest: ws.isGuest
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

    // --- DÜZELTME: Oyuncu bilgilerini doğru şekilde ata ---
    ws.playerId = data.telegramId || `guest_${Date.now()}`;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.roomCode = data.roomCode;
    ws.isGuest = !data.telegramId;
    playerConnections.set(ws.playerId, ws);
    room.players[ws.playerId] = { 
        name: ws.playerName,
        telegramId: data.telegramId,
        isGuest: ws.isGuest
    };

    const hostId = room.host;
    const joinerId = ws.playerId;
    const gameState = initializeGame(data.roomCode, hostId, joinerId);

    setTimeout(() => {
        sendGameState(data.roomCode, hostId, gameState);
        sendGameState(data.roomCode, joinerId, gameState);
        // Herkese oyunun başladığını bildir
        [hostId, joinerId].forEach(pid => {
            const socket = playerConnections.get(pid);
            if(socket) sendMessage(socket, { type: 'gameStart', gameState: {...gameState, playerId: pid} });
        });
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

async function handleGameEnd(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room) return;

    try {
        const playerIds = Object.keys(gameState.players);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;

        // --- YENİ: Oyunun bitiş nedenini belirle ---
        let reason = 'finished'; // Normal bitiş
        if (!isDraw && gameState.players[winnerId].hand.length > 0) {
            // Eğer kazananın elinde hala taş varsa, oyun kilitlenmiştir.
            reason = 'blocked';
        }
        // Oyundan ayrılma durumu 'leave' olarak ayrıca ele alınır.
        // Bu blok sadece normal oyun sonları için.
        const finalScores = reason === 'blocked' ? {
            [player1Id]: gameState.players[player1Id].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0),
            [player2Id]: gameState.players[player2Id].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0)
        } : null;

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
            reason: reason, // 'finished', 'blocked'
            eloChanges: eloChanges ? {
                winner: eloChanges.winnerChange,
                loser: eloChanges.loserChange
            } : null,
            finalScores: finalScores
        });

        // --- DÜZELTME: Oyun bittiğinde her iki oyuncunun da oda bilgisini temizle ---
        // Bu, oyuncuların yeni bir eşleşme ararken "zaten oyundasınız" hatası almasını önler.
        playerIds.forEach(pid => {
            const playerSocket = playerConnections.get(pid);
            if (playerSocket) {
                playerSocket.roomCode = null;
            }
        });
        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: false,
            reason: 'error'
        });

        // Hata durumunda da oyuncuların oda bilgilerini temizle
        if (room) {
            const playerIds = Object.keys(room.players);
            playerIds.forEach(pid => {
                const playerSocket = playerConnections.get(pid);
                if (playerSocket) playerSocket.roomCode = null;
            });
        }
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
    
    const winner = checkWinner(gs);
    if (winner) {
        broadcastToRoom(ws.roomCode, { 
            type: 'gameEnd', 
            winner, 
            winnerName: winner === 'DRAW' ? 'Beraberlik' : gs.players[winner].name 
        });
        rooms.delete(ws.roomCode);
    } else {
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    // --- DÜZELTME: İlk hamlede pazardan taş çekmeyi engelle ---
    // Eğer oyunun ilk hamlesiyse (turn: 1) ve oyuncunun elinde başlaması gereken çift taş varsa,
    // pazardan taş çekmesine izin verme.
    if (gs.turn === 1 && gs.startingDouble > -1) {
        return sendMessage(ws, { type: 'error', message: `Oyuna başlamak için [${gs.startingDouble}|${gs.startingDouble}] taşını oynamalısınız.` });
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
    const roomCode = ws.roomCode;
    const leaverId = ws.playerId;

    if (!roomCode || !leaverId) {
        return;
    }

    const room = rooms.get(roomCode);
    if (!room || !room.gameState) {
        // Oda zaten kapanmış olabilir, oyuncunun durumunu temizle
        if (ws) ws.roomCode = null;
        return;
    }

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);

    // Eğer odada sadece 1 kişi varsa (rakip hiç bağlanmadıysa vs), odayı sadece sil.
    if (playerIds.length !== 2) {
        rooms.delete(roomCode);
        if (ws) ws.roomCode = null;
        return;
    }

    const winnerId = playerIds.find(id => id !== leaverId);

    // handleGameEnd fonksiyonu zaten odadaki herkesin durumunu temizleyip odayı siliyor.
    // Oyundan ayrılma durumunu belirtmek için 'leave' reason'ı ekleyebiliriz.
    handleGameEnd(roomCode, winnerId, gs, 'leave');
}

// YENİ: Yeniden bağlanma mantığı
function handleReconnect(ws, data) {
    const { roomCode, playerId } = data;
    const room = rooms.get(roomCode);

    if (room && room.players[playerId]) {
        const playerInfo = room.players[playerId];

        // Eğer oyuncu için bir "terk etme" zamanlayıcısı varsa, iptal et
        if (playerInfo.disconnectTimer) {
            clearTimeout(playerInfo.disconnectTimer);
            playerInfo.disconnectTimer = null;
            console.log(`✅ Oyuncu ${playerInfo.name} (${playerId}) zamanında yeniden bağlandı: ${roomCode}`);
        }

        // Yeni WebSocket bağlantısını oyuncuyla ilişkilendir
        ws.playerId = playerId;
        ws.roomCode = roomCode;
        ws.playerName = playerInfo.name;
        playerConnections.set(playerId, ws);

        // Oyuncuya güncel oyun durumunu ve yeniden bağlandığına dair onayı gönder
        sendMessage(ws, { type: 'connected', message: 'Oyuna yeniden bağlandınız', isReconnect: true });
        sendGameState(roomCode, playerId);

        // Rakibe, oyuncunun geri döndüğünü bildir
        broadcastToRoom(roomCode, { type: 'opponentReconnected', message: `${playerInfo.name} oyuna geri döndü.` }, playerId);
    } else {
        sendMessage(ws, { type: 'error', message: 'Geçerli bir oyun bulunamadı. Lobiye yönlendiriliyorsunuz.' });
    }
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);
    
    // Kuyruktan çıkar
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }

    // Eğer oyuncu bir odadaysa, hemen silme, bir süre bekle
    if (ws.roomCode && ws.playerId) {
        const room = rooms.get(ws.roomCode);
        if (room && room.players[ws.playerId]) {
            console.log(`⏳ ${ws.playerName} için 60 saniyelik yeniden bağlanma süresi başladı.`);
            broadcastToRoom(ws.roomCode, { type: 'opponentDisconnected', message: 'Rakibin bağlantısı koptu. Yeniden bağlanması bekleniyor...' }, ws.playerId);

            // 60 saniye sonra oyunu bitir
            room.players[ws.playerId].disconnectTimer = setTimeout(() => {
                console.log(`⏰ ${ws.playerName} yeniden bağlanmadı. Oyun sonlandırılıyor.`);
                handleLeaveGame(ws); // Oyundan ayrılmış gibi işlem yap (bu fonksiyon artık her iki oyuncuyu da temizliyor)
            }, 60000); // 60 saniye
        }
    }
    if (ws.playerId) playerConnections.delete(ws.playerId);
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
