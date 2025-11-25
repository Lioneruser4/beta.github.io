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
    isVisible: { type: Boolean, default: true }, // For admin panel visibility control
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

// ELO Calculation - Win-only system (no point loss)
function calculateElo(winnerElo, loserElo, winnerLevel) {
    // Random points between 13-20 for levels 1-5
    // Random points between 10-15 for levels 6+
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13; // 13-20
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10; // 10-15
    }
    
    const loserChange = 0; // Loser doesn't lose points, only winner gains
    
    return {
        winnerElo: winnerElo + winnerChange,
        loserElo: loserElo, // No change for loser
        winnerChange,
        loserChange
    };
}

// Level Calculation - Every 100 points = 1 level
function calculateLevel(elo) {
    // Level 1: 0-99 ELO
    // Level 2: 100-199 ELO  
    // Level 3: 200-299 ELO
    // ...
    // Example: 156 ELO = Level 2, 200 ELO = Level 3
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
        const players = await Player.find({ isVisible: { $ne: false } }) // Only show visible players
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

// ADMIN ENDPOINTS - ONLY FOR TELEGRAM ID 976640409
app.get('/api/admin/players', async (req, res) => {
    const { adminId } = req.query;
    
    // Only allow admin with specific Telegram ID
    if (adminId !== '976640409') {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
    }
    
    try {
        const players = await Player.find()
            .sort({ elo: -1 })
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames isVisible');
        
        res.json({ success: true, players });
    } catch (error) {
        console.error('Admin players error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/admin/player/update', async (req, res) => {
    const { adminId, telegramId, elo, isVisible } = req.body;
    
    // Only allow admin with specific Telegram ID
    if (adminId !== '976640409') {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
    }
    
    try {
        const player = await Player.findOne({ telegramId });
        if (!player) {
            return res.status(404).json({ error: 'Oyuncu bulunamadı' });
        }
        
        // Update ELO and visibility
        if (elo !== undefined) {
            player.elo = parseInt(elo);
            player.level = calculateLevel(player.elo);
        }
        
        if (isVisible !== undefined) {
            player.isVisible = isVisible;
        }
        
        await player.save();
        
        res.json({ success: true, player });
    } catch (error) {
        console.error('Admin update error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/admin/reset-elo', async (req, res) => {
    const { adminId } = req.body;
    
    // Only allow admin with specific Telegram ID
    if (adminId !== '976640409') {
        return res.status(403).json({ error: 'Yetkisiz erişim' });
    }
    
    try {
        // Reset all players' ELO to 0
        await Player.updateMany({}, { elo: 0, level: 1 });
        
        res.json({ success: true, message: 'Tüm ELO puanları sıfırlandı' });
    } catch (error) {
        console.error('Reset ELO error:', error);
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
    
    // Önce en düşük çifti bul (1|1, 2|2, 3|3, ...)
    let startingPlayer = player1Id;
    let lowestDouble = 7; // 7 doesn't exist, so any double will be lower
    let lowestNonDouble = 13; // 13 doesn't exist, so any tile will be lower
    let lowestNonDoubleTile = null;
    
    // Önce player1 elini kontrol et
    for (let tile of player1Hand) {
        if (tile[0] === tile[1] && tile[0] < lowestDouble) {
            lowestDouble = tile[0];
            startingPlayer = player1Id;
        } else if (tile[0] + tile[1] < lowestNonDouble) {
            lowestNonDouble = tile[0] + tile[1];
            lowestNonDoubleTile = tile;
        }
    }
    
    // Sonra player2 elini kontrol et
    for (let tile of player2Hand) {
        if (tile[0] === tile[1] && tile[0] < lowestDouble) {
            lowestDouble = tile[0];
            startingPlayer = player2Id;
        } else if (tile[0] + tile[1] < lowestNonDouble) {
            lowestNonDouble = tile[0] + tile[1];
            lowestNonDoubleTile = tile;
        }
    }
    
    // Eğer hiç çift yoksa, en düşük toplamı olan oyuncu başlasın
    if (lowestDouble === 7 && lowestNonDoubleTile) {
        // Hangi oyuncuda bu taş var?
        for (let tile of player1Hand) {
            if (tile[0] === lowestNonDoubleTile[0] && tile[1] === lowestNonDoubleTile[1]) {
                startingPlayer = player1Id;
                break;
            }
        }
        for (let tile of player2Hand) {
            if (tile[0] === lowestNonDoubleTile[0] && tile[1] === lowestNonDoubleTile[1]) {
                startingPlayer = player2Id;
                break;
            }
        }
        console.log(`🎲 En düşük taş: [${lowestNonDoubleTile}] - ${room.players[startingPlayer].name} başlıyor`);
    } else if (lowestDouble < 7) {
        console.log(`🎲 Başlangıç çifti: ${lowestDouble}|${lowestDouble} - ${room.players[startingPlayer].name} başlıyor`);
    } else {
        // Eğer hiç uygun taş yoksa, player1 başlasın
        startingPlayer = player1Id;
        console.log(`🎲 Uygun taş bulunamadı, ${room.players[player1Id].name} başlıyor`);
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
        startingDouble: lowestDouble < 7 ? lowestDouble : -1,
        // AFK tracking
        playerLastAction: {
            [player1Id]: Date.now(),
            [player2Id]: Date.now()
        },
        afkWarnings: {
            [player1Id]: 0,
            [player2Id]: 0
        }
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı - Başlayan: ${room.players[startingPlayer].name}`);
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
    const player1Id = Object.keys(gameState.players)[0];
    const player2Id = Object.keys(gameState.players)[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    // WIN CONDITION 1: Player has no tiles left (finished all tiles)
    if (player1Hand.length === 0) {
        console.log(`🏆 ${gameState.players[player1Id].name} won by finishing all tiles!`);
        return player1Id;
    }
    if (player2Hand.length === 0) {
        console.log(`🏆 ${gameState.players[player2Id].name} won by finishing all tiles!`);
        return player2Id;
    }
    
    // WIN CONDITION 2: Both players blocked (no valid moves)
    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    // Only check blocked condition if BOTH players can't play AND market is empty
    const marketEmpty = !gameState.market || gameState.market.length === 0;
    
    if (!player1CanPlay && !player2CanPlay && marketEmpty) {
        // Calculate points in each player's hand
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        console.log(`🔒 Game blocked! Player1: ${player1Sum} points, Player2: ${player2Sum} points`);
        
        // Draw if equal points
        if (player1Sum === player2Sum) {
            console.log(`🤝 Draw - Both players have ${player1Sum} points`);
            return 'DRAW';
        }
        
        // Winner is player with FEWER points
        const winnerId = player1Sum < player2Sum ? player1Id : player2Id;
        console.log(`🏆 ${gameState.players[winnerId].name} wins with fewer points!`);
        return winnerId;
    }

    // Game continues
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
    if (!room || !room.gameState) {
        console.error('❌ Server: sendGameState - No room or gameState', { roomCode, playerId });
        return;
    }

    const ws = playerConnections.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('❌ Server: sendGameState - WebSocket not open', { playerId, readyState: ws?.readyState });
        return;
    }

    try {
        const gameStateToSend = { ...room.gameState, playerId: playerId };
        console.log('📤 Server: Sending gameState to player', {
            playerId,
            boardLength: gameStateToSend.board.length,
            currentPlayer: gameStateToSend.currentPlayer
        });
        
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: gameStateToSend
        }));
    } catch (error) { 
        console.error('❌ Server: Error sending gameState:', error);
    }
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
                case 'rejoinRoom': handleRejoinRoom(ws, data); break;
                case 'playerDisconnected': handlePlayerDisconnected(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' });
});

// AFK kontrolü için interval
const afkCheckInterval = setInterval(() => {
    const now = Date.now();
    const afkTimeout = 20000; // 20 saniye
    const maxAfkWarnings = 2; // 2 kez afk kalırsa kaybeder
    
    rooms.forEach((room, roomCode) => {
        if (!room.gameState) return;
        
        const gs = room.gameState;
        const currentPlayerId = gs.currentPlayer;
        
        // Sadece oyun devam ediyorsa kontrol et
        if (gs.playerLastAction && gs.afkWarnings) {
            const lastAction = gs.playerLastAction[currentPlayerId];
            const timeSinceLastAction = now - lastAction;
            
            if (timeSinceLastAction > afkTimeout) {
                const warnings = gs.afkWarnings[currentPlayerId] || 0;
                
                if (warnings >= maxAfkWarnings) {
                    // Oyuncu 2 kez afk kaldı, oyunu kaybeder
                    console.log(`💀 ${room.players[currentPlayerId].name} 2 kez AFK kaldı, oyunu kaybetti!`);
                    const winnerId = Object.keys(gs.players).find(id => id !== currentPlayerId);
                    handleGameEnd(roomCode, winnerId, gs);
                } else {
                    // İlk AFK uyarısı - otomatik hamle yap
                    console.log(`⏰ ${room.players[currentPlayerId].name} AFK - Otomatik hamle yapılıyor`);
                    
                    // Otomatik hamle yap
                    makeAutoMove(roomCode, currentPlayerId);
                    
                    // Uyarı sayısını artır
                    gs.afkWarnings[currentPlayerId] = warnings + 1;
                    gs.playerLastAction[currentPlayerId] = now; // Yeni eylem zamanını güncelle
                }
            }
        }
    });
}, 5000); // 5 saniyede bir kontrol et

wss.on('close', () => {
    clearInterval(afkCheckInterval);
    clearInterval(pingInterval);
});

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
        const p1 = matchQueue.shift();
        const p2 = matchQueue.shift();
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

function handleRejoinRoom(ws, data) {
    const room = rooms.get(data.roomCode);
    if (!room) {
        return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı' });
    }

    // Find the player in the room
    let playerId = null;
    for (const [id, player] of Object.entries(room.players)) {
        if (player.telegramId === data.telegramId || player.name === data.playerName) {
            playerId = id;
            break;
        }
    }

    if (!playerId) {
        return sendMessage(ws, { type: 'error', message: 'Oyuncu bulunamadı' });
    }

    // Update the websocket connection
    ws.playerId = playerId;
    ws.playerName = data.playerName;
    ws.roomCode = data.roomCode;
    playerConnections.set(playerId, ws);

    // Send current game state
    if (room.gameState) {
        sendGameState(data.roomCode, playerId);
        sendMessage(ws, { type: 'gameStart', gameState: { ...room.gameState, playerId } });
    }
}

function handlePlayerDisconnected(ws, data) {
    // This is just for client-side notification, server-side cleanup is done in handleDisconnect
    console.log(`📤 Player disconnected notification: ${ws.playerName || 'Unknown'}`);
}

function makeAutoMove(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;
    
    const gs = room.gameState;
    const player = gs.players[playerId];
    
    // Önce elindeki taşlardan oynanabilir olanı bul
    for (let i = 0; i < player.hand.length; i++) {
        const tile = player.hand[i];
        
        if (gs.board.length === 0) {
            // Tahta boşsa her taşı oynayabilir
            player.hand.splice(i, 1);
            gs.board.push(tile);
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== playerId);
            
            // Eylem zamanını güncelle
            if (gs.playerLastAction) {
                gs.playerLastAction[gs.currentPlayer] = Date.now();
            }
            
            Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
            console.log(`🤖 ${room.players[playerId].name} otomatik olarak [${tile}] taşıyla oynadı`);
            return;
        } else {
            // Tahta doluysa uygun yeri bul
            const leftEnd = gs.board[0][0];
            const rightEnd = gs.board[gs.board.length - 1][1];
            
            if (tile[0] === leftEnd || tile[1] === leftEnd) {
                // Sola oynayabilir
                player.hand.splice(i, 1);
                if (tile[1] === leftEnd) {
                    gs.board.unshift(tile);
                } else {
                    gs.board.unshift([tile[1], tile[0]]); // Yön değiştir
                }
                gs.turn++;
                gs.currentPlayer = Object.keys(gs.players).find(id => id !== playerId);
                
                // Eylem zamanını güncelle
                if (gs.playerLastAction) {
                    gs.playerLastAction[gs.currentPlayer] = Date.now();
                }
                
                Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
                console.log(`🤖 ${room.players[playerId].name} otomatik olarak [${tile}] taşıyla sola oynadı`);
                return;
            } else if (tile[0] === rightEnd || tile[1] === rightEnd) {
                // Sağa oynayabilir
                player.hand.splice(i, 1);
                if (tile[0] === rightEnd) {
                    gs.board.push(tile);
                } else {
                    gs.board.push([tile[1], tile[0]]); // Yön değiştir
                }
                gs.turn++;
                gs.currentPlayer = Object.keys(gs.players).find(id => id !== playerId);
                
                // Eylem zamanını güncelle
                if (gs.playerLastAction) {
                    gs.playerLastAction[gs.currentPlayer] = Date.now();
                }
                
                Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
                console.log(`🤖 ${room.players[playerId].name} otomatik olarak [${tile}] taşıyla sağa oynadı`);
                return;
            }
        }
    }
    
    // Eğer elinde oynanabilir taş yoksa, pazardan çek
    if (gs.market && gs.market.length > 0) {
        const drawnTile = gs.market.shift();
        player.hand.push(drawnTile);
        
        // Eylem zamanını güncelle
        if (gs.playerLastAction) {
            gs.playerLastAction[playerId] = Date.now();
        }
        
        Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
        console.log(`🤖 ${room.players[playerId].name} otomatik olarak pazardan [${drawnTile}] taşı çekti`);
        return;
    }
    
    // Pazarda taş yoksa ve oynanabilir taş yoksa, pas geç
    console.log(`🤖 ${room.players[playerId].name} otomatik olarak pas geçti`);
    gs.turn++;
    gs.currentPlayer = Object.keys(gs.players).find(id => id !== playerId);
    
    // Eylem zamanını güncelle
    if (gs.playerLastAction) {
        gs.playerLastAction[gs.currentPlayer] = Date.now();
    }
    
    Object.keys(gs.players).forEach(pid => sendGameState(roomCode, pid));
}

function handlePlayTile(ws, data) {
    console.log('🎯 Server: handlePlayTile called', {
        playerId: ws.playerId,
        roomCode: ws.roomCode,
        data: data
    });
    
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) {
        console.error('❌ Server: No room or gameState found');
        return;
    }

    const gs = room.gameState;
    console.log('📊 Server: Current gameState', {
        currentPlayer: gs.currentPlayer,
        boardLength: gs.board.length,
        playerHand: gs.players[ws.playerId]?.hand?.length
    });
    
    if (gs.currentPlayer !== ws.playerId) {
        console.error('❌ Server: Not player turn');
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }

    const player = gs.players[ws.playerId];
    const tile = player.hand[data.tileIndex];

    if (!tile) {
        console.error('❌ Server: Tile not found at index', data.tileIndex);
        return;
    }

    console.log('🎮 Server: Playing tile', tile, 'to position', data.position);

    const boardCopy = JSON.parse(JSON.stringify(gs.board));
    const success = playTileOnBoard(tile, gs.board, data.position);

    if (!success) {
        console.error('❌ Server: Invalid move');
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz (Pozisyon uyuşmuyor)' });
    }

    player.hand.splice(data.tileIndex, 1);
    gs.moves = (gs.moves || 0) + 1;
    
    // Track last played position for client scrolling
    gs.lastPlayedPosition = data.position;
    gs.lastPlayedTile = tile;
    
    console.log('✅ Server: Move successful, new board length:', gs.board.length);
    
    // AFK timer'ı sıfırla
    if (gs.playerLastAction) {
        gs.playerLastAction[ws.playerId] = Date.now();
    }
    
    const winner = checkWinner(gs);
    if (winner) {
        console.log('🏆 Server: Winner found', winner);
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        
        console.log('🔄 Server: Next turn', {
            newCurrentPlayer: gs.currentPlayer,
            turn: gs.turn
        });
        
        // Yeni oyuncunun AFK timer'ını da sıfırla
        if (gs.playerLastAction) {
            gs.playerLastAction[gs.currentPlayer] = Date.now();
        }
        
        console.log('📤 Server: Sending gameState to all players');
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

    const player = gs.players[ws.playerId];
    
    // Önce elinde oynanabilir taş var mı kontrol et
    const hasPlayable = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (hasPlayable) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var, pazardan çekemezsiniz!' });
    }
    
    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        
        // Yeni oyuncunun AFK timer'ını sıfırla
        if (gs.playerLastAction) {
            gs.playerLastAction[gs.currentPlayer] = Date.now();
        }
        
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
        return;
    }

    // Pazardan taş çek
    const drawnTile = gs.market.shift();
    player.hand.push(drawnTile);
    
    // AFK timer'ı sıfırla
    if (gs.playerLastAction) {
        gs.playerLastAction[ws.playerId] = Date.now();
    }
    
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
            
            // Yeni oyuncunun AFK timer'ını sıfırla
            if (gs.playerLastAction) {
                gs.playerLastAction[gs.currentPlayer] = Date.now();
            }
        }
    }
    
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);
    
    // Remove from matchmaking queue
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }
    
    if (ws.roomCode) {
        const room = rooms.get(ws.roomCode);
        
        if (room && room.gameState) {
            // Oyun devam ediyorsa ve bu oyuncu oyundayken ayrıldıysa
            const remainingPlayerId = Object.keys(room.gameState.players).find(id => id !== ws.playerId);
            
            if (remainingPlayerId) {
                // Kalan oyuncuyu otomatik olarak kazanan yap
                console.log(`🏆 ${room.players[remainingPlayerId].name} otomatik kazandı (rakip ayrıldı)`);
                
                // ELO hesaplaması ve oyun sonu işlemleri
                handleGameEnd(ws.roomCode, remainingPlayerId, room.gameState);
                
                return; // Oyun zaten bitti, room silinecek
            }
            
            // Eğer kalan oyuncu yoksa sadece notification gönder
            broadcastToRoom(ws.roomCode, { 
                type: 'playerDisconnected',
                message: 'Rakip oyundan ayrıldı',
                reason: 'disconnect'
            }, ws.playerId);
        }
        
        // Clean up room after short delay to allow message delivery
        setTimeout(() => {
            rooms.delete(ws.roomCode);
            console.log(`🗑️ Oda silindi: ${ws.roomCode}`);
        }, 1000);
    }
    
    // Clean up player connections
    if (ws.playerId) {
        playerConnections.delete(ws.playerId);
        playerSessions.delete(ws.playerId);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
