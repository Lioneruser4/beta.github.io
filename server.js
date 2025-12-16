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
    status: { type: String, enum: ['ongoing', 'completed', 'abandoned'], default: 'ongoing' },
    gameState: { type: Object },
    moves: { type: Number, default: 0 },
    duration: { type: Number },
    isDraw: { type: Boolean, default: false },
    gameType: { type: String, enum: ['ranked', 'private', 'casual'], default: 'ranked' },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);

app.use(cors());
app.use(express.json());

const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map();
const playerRooms = new Map(); // playerId -> roomCode
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
    // Oyun taşlarının toplam sayısını kontrol et
    let totalTiles = 0;
    for (const playerId in gameState.players) {
        totalTiles += gameState.players[playerId].hand.length;
    }
    
    // Eğer hiç taş kalmadıysa oyun biter
    if (totalTiles === 0) {
        return 'DRAW';
    }

    // Her oyuncunun elindeki taşları kontrol et
    const player1Id = Object.keys(gameState.players)[0];
    const player2Id = Object.keys(gameState.players)[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    // Eğer bir oyuncunun eli boşsa ve piyasada taş kalmadıysa o kazanır
    if (player1Hand.length === 0 && gameState.market.length === 0) {
        return player1Id;
    }
    
    if (player2Hand.length === 0 && gameState.market.length === 0) {
        return player2Id;
    }

    // Her iki oyuncunun da oynayabileceği hamlesi var mı kontrol et
    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    // Eğer hiçbir oyuncu hamle yapamıyorsa
    if (!player1CanPlay && !player2CanPlay) {
        // Puan hesapla
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        // Eşitlik durumunda beraberlik
        if (player1Sum === player2Sum) return 'DRAW';
        // Düşük puan kazanır
        return player1Sum < player2Sum ? player1Id : player2Id;
    }

    // Oyun devam ediyor
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
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'leaveGame': handleLeaveGame(ws); break;
                case 'reconnectGame': handleReconnect(ws, data); break;
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

async function handleFindMatch(ws, data) {
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
    // Ayrıca zaten bir odada olan oyuncunun kuyruğa girmesini engelle
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegramInQueue = matchQueue.find(p => p.telegramId === ws.telegramId);
        if (sameTelegramInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Bu Telegram hesabı zaten eşleşme kuyruğunda' });
        }
    }

    const existingRoom = playerRooms.get(playerId);
    if (existingRoom && rooms.has(existingRoom)) {
        return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız.' });
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
        const isRankedMatch = gameType === 'ranked';

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
        playerRooms.set(p1.playerId, roomCode);
        playerRooms.set(p2.playerId, roomCode);

        const gameState = initializeGame(roomCode, p1.playerId, p2.playerId);

        // Oyunu veritabanına kaydet
        try {
            const player1Doc = isRankedMatch ? await Player.findOne({ telegramId: p1.telegramId }) : null;
            const player2Doc = isRankedMatch ? await Player.findOne({ telegramId: p2.telegramId }) : null;

            const newMatch = new Match({
                player1: player1Doc ? player1Doc._id : null,
                player2: player2Doc ? player2Doc._id : null,
                gameType: gameType,
                status: 'ongoing',
                gameState: gameState,
                player1Elo: p1.elo,
                player2Elo: p2.elo,
            });
            await newMatch.save();
            room.matchId = newMatch._id; // Oda bilgisine maç ID'sini ekle
            console.log(`💾 Maç veritabanına kaydedildi: ${newMatch._id}`);
        } catch (dbError) {
            console.error("❌ Maçı veritabanına kaydederken hata oluştu:", dbError);
            // Hata durumunda oyuncuları bilgilendir ve odayı temizle
        }

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
    playerRooms.set(playerId, roomCode);

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
    playerRooms.set(playerId, roomCode);

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

async function handlePlayTile(ws, data) {
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

    // Oyun durumunu veritabanında güncelle
    if (room.matchId) {
        await Match.findByIdAndUpdate(room.matchId, { $set: { gameState: gs, 'moves': gs.moves } });
    }
    
    const winner = checkWinner(gs);
    if (winner) {
        await handleGameEnd(ws.roomCode, winner, gs);
    } else {
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId); // Sıradaki oyuncu
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const matchId = room.matchId;

    // Oyunun zaten bitip bitmediğini kontrol et, çift bitirmeyi önle
    if (room.isFinished) {
        return;
    }

    try {
        const playerIds = Object.keys(gameState.players);
        if (playerIds.length < 2) return; // Eğer yeterli oyuncu yoksa çık

        const player1Id = playerIds[0];
        const player2Id = playerIds[1];
        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;
        
        // Guest kontrolu - Guest varsa ELO guncellemesi yapma
        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
        const isRankedMatch = room.type === 'ranked' && !player1IsGuest && !player2IsGuest;

        if (isRankedMatch && matchId) {
            // Her iki oyuncu da Telegram ile girdi - ELO guncelle
            const player1 = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const player2 = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (!player1 || !player2) {
                console.error('❌ Oyuncular MongoDB\'de bulunamadı');
                throw new Error("Oyuncular DB'de bulunamadı.");
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

                // Veritabanındaki maçı güncelle
                await Match.findByIdAndUpdate(matchId, {
                    status: 'completed',
                    winner: winner._id,
                    player1Elo: winnerId === player1Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player2Elo: winnerId === player2Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player1EloChange: winnerId === player1Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    player2EloChange: winnerId === player2Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    duration: Math.floor((Date.now() - room.startTime) / 1000),
                    isDraw: false,
                    completedAt: new Date()
                });
                
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

                await Match.findByIdAndUpdate(matchId, {
                    status: 'completed',
                    player1Elo: player1.elo,
                    player2Elo: player2.elo,
                    player1EloChange: 0,
                    player2EloChange: 0,
                    duration: Math.floor((Date.now() - room.startTime) / 1000),
                    isDraw: true,
                    completedAt: new Date()
                });
            }
        } else {
            // Casual (Guest) maç - ELO guncellenmez
            console.log(`🎮 CASUAL Maç bitti: ${isDraw ? 'Beraberlik' : gameState.players[winnerId].name + ' kazandı'}`);
            // Casual maçı da tamamlandı olarak işaretle
            if (matchId) {
                await Match.findByIdAndUpdate(matchId, { status: 'completed', completedAt: new Date() });
            }
        }

        // Oyun sonu verilerini hazırla (kalan taşlar ve puanlar)
        const player1 = gameState.players[player1Id];
        const player2 = gameState.players[player2Id];
        const finalScores = {
            [player1Id]: {
                remainingTiles: player1.hand,
                score: player1.hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0)
            },
            [player2Id]: {
                remainingTiles: player2.hand,
                score: player2.hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0)
            }
        };

        // Kazanan ve kaybeden oyuncu ID'lerini belirle
        const winnerPlayerId = isDraw ? null : winnerId;
        const loserPlayerId = isDraw ? null : playerIds.find(id => id !== winnerId);

        // Her oyuncuya özel oyun sonu mesajı gönder
        playerIds.forEach(pid => {
            const ws = playerConnections.get(pid);
            if (ws) {
                const isWinner = pid === winnerPlayerId;
                let eloChangeForPlayer = 0;
                if (isRankedMatch && eloChanges) {
                    eloChangeForPlayer = isWinner ? eloChanges.winnerChange : eloChanges.loserChange;
                }

                sendMessage(ws, {
                    type: 'gameEnd',
                    winner: winnerId,
                    winnerName: isDraw ? 'Beraberlik' : gameState.players[winnerId].name,
                    isRanked: isRankedMatch,
                    isWinner: isWinner,
                    eloChange: eloChangeForPlayer,
                    scores: finalScores
                });
            }
        });

        room.isFinished = true; // Odanın bittiğini işaretle
        
        // Oyuncuları odadan ve hafızadan temizle
        broadcastToRoom(roomCode, { 
            type: 'cleanup' // İstemcilere temizlik yapmalarını söyle
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
    if (room && room.players) {
        Object.keys(room.players).forEach(pid => playerRooms.delete(pid));
        rooms.delete(roomCode);
        console.log(`🧹 Oda temizlendi: ${roomCode}`);
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
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];

    // KURAL: İlk elden pazardan taş çekilemez.
    if (gs.board.length === 0) {
        return sendMessage(ws, { type: 'error', message: 'İlk hamle yapılmadan pazardan taş çekemezsiniz.' });
    }

    // KURAL: Elinde oynanabilir taş varsa pazardan çekemez.
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir bir taş varken pazardan çekemezsiniz.' });
    }

    
    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        
        if (room.matchId) {
            await Match.findByIdAndUpdate(room.matchId, { $set: { gameState: gs } });
        }

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
    
    if (room.matchId) {
        await Match.findByIdAndUpdate(room.matchId, { $set: { gameState: gs } });
    }

    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

async function handleLeaveGame(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || !ws.playerId) {
        return;
    }

    const gs = room.gameState;
    const leaverId = ws.playerId;
    const playerIds = Object.keys(gs.players);
    const winnerId = playerIds.find(id => id !== leaverId);

    console.log(`🚪 ${ws.playerName} oyundan ayrıldı. Kazanan: ${winnerId}`);

    if (winnerId) {
        // Oyunu 'abandoned' olarak işaretle
        if (room.matchId) {
            const winnerDoc = await Player.findOne({ 'telegramId': room.players[winnerId].telegramId });
            await Match.findByIdAndUpdate(room.matchId, { status: 'abandoned', winner: winnerDoc ? winnerDoc._id : null, completedAt: new Date() });
        }
        // handleGameEnd'i çağırarak ELO hesaplamalarını ve bildirimleri yap
        await handleGameEnd(ws.roomCode, winnerId, gs);
    } else {
        // Rakip zaten yoksa odayı temizle
        cleanupRoom(ws.roomCode);
    }

    ws.roomCode = null;
    playerRooms.delete(leaverId);
}

async function handleReconnect(ws, data) {
    const { telegramId, playerId: oldPlayerId, roomCode: oldRoomCode } = data;
    if (!telegramId) {
        sendMessage(ws, { type: 'error', message: 'Yeniden bağlanmak için Telegram ID gerekli.' });
        return;
    }

    console.log(`🔄 Yeniden bağlanma isteği: ${data.username} (${telegramId})`);
    
    const playerDoc = await Player.findOne({ telegramId });
    if (!playerDoc) return;

    const ongoingMatch = await Match.findOne({ 
        status: 'ongoing',
        $or: [{ player1: playerDoc._id }, { player2: playerDoc._id }]
    });

    if (ongoingMatch) {
        console.log(`✅ Devam eden maç bulundu: ${ongoingMatch._id}`);
        const gs = ongoingMatch.gameState;
        const playerIds = Object.keys(gs.players);
        
        // Oyuncunun eski playerId'sini bul
        const roomForMatch = [...rooms.values()].find(r => r.matchId && r.matchId.equals(ongoingMatch._id));
        if (!roomForMatch) {
            console.log('Oda hafızada bulunamadı, yeniden oluşturuluyor.');
            // Eğer sunucu yeniden başladıysa ve oda hafızada yoksa, yeniden oluştur.
            // Bu kısım daha karmaşık bir state yönetimi gerektirir. Şimdilik var olan oda üzerinden gidelim.
            return;
        }

        const reconnectingPlayerEntry = Object.entries(roomForMatch.players).find(([pid, pdata]) => pdata.telegramId === telegramId);
        if (!reconnectingPlayerEntry) return;

        const newPlayerId = reconnectingPlayerEntry[0];
        const roomCode = roomForMatch.code;

        // Yeni bağlantıyı eski kimlikle eşleştir
        ws.playerId = newPlayerId;
        ws.roomCode = roomCode;
        ws.playerName = gs.players[newPlayerId].name;
        
        // EKSİK BİLGİLERİ EKLE: Oyuncunun ELO, level gibi bilgilerini de ws objesine yeniden ata.
        const reconnectingPlayerData = roomForMatch.players[newPlayerId];
        ws.telegramId = reconnectingPlayerData.telegramId;
        ws.photoUrl = reconnectingPlayerData.photoUrl;
        ws.level = reconnectingPlayerData.level;
        ws.elo = reconnectingPlayerData.elo;
        ws.isGuest = reconnectingPlayerData.isGuest;

        playerConnections.set(newPlayerId, ws);
        playerRooms.set(newPlayerId, roomCode);

        // Rakip bilgilerini bul
        const opponentId = playerIds.find(id => id !== newPlayerId);
        const opponentData = roomForMatch.players[opponentId];

        // Oyuncuya oyunun geri yüklendiğini bildir
        sendMessage(ws, {
            type: 'gameRestored',
            gameState: { ...gs, playerId: newPlayerId },
            opponent: opponentData
        });

        // Rakibe de haber ver
        const opponentWs = playerConnections.get(opponentId);
        if (opponentWs) {
            sendMessage(opponentWs, { type: 'info', message: 'Rakibin oyuna geri döndü!' });
        }

        console.log(`♻️ ${ws.playerName} oyuna geri döndü: ${roomCode}`);
    } else {
        console.log(`🤷‍♂️ ${data.username} için devam eden maç bulunamadı.`);
    }
}

async function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);
    
    const playerId = ws.playerId;
    const roomCode = playerRooms.get(playerId);

    if (playerId) {
        playerConnections.delete(playerId); // Bağlantıyı sil

        if (roomCode) {
            const room = rooms.get(roomCode);
            if (room && room.gameState && !room.isFinished) {
                console.log(`🏠 Oyuncu oyundan ayrıldı: ${ws.roomCode}`);
                const gameState = room.gameState;
                const playerIds = Object.keys(gameState.players);
                const otherPlayerId = playerIds.find(id => id !== ws.playerId);
                
                if (otherPlayerId) {
                    // Diğer oyuncuya bağlı mı kontrol et
                    const otherPlayerWs = playerConnections.get(otherPlayerId);
                    if (otherPlayerWs && otherPlayerWs.readyState === WebSocket.OPEN) {
                        console.log(`⏳ ${ws.playerName} için 30 saniye bekleniyor...`);
                        sendMessage(otherPlayerWs, { type: 'info', message: 'Rakibin bağlantısı koptu. Geri dönmesi için 30 saniye bekleniyor...' });
                        
                        // 30 saniye bekle, eğer oyuncu geri dönmezse oyunu bitir.
                        room.disconnectTimer = setTimeout(async () => {
                            console.log(`⏰ ${ws.playerName} geri dönmedi. Oyun bitiriliyor.`);
                            if (room.matchId) {
                                const winnerDoc = await Player.findOne({ 'telegramId': room.players[otherPlayerId].telegramId });
                                await Match.findByIdAndUpdate(room.matchId, { status: 'abandoned', winner: winnerDoc ? winnerDoc._id : null, completedAt: new Date() });
                            }
                            await handleGameEnd(roomCode, otherPlayerId, gameState);
                        }, 30000); // 30 saniye

                    } else {
                        // Her iki oyuncu da ayrıldı, maçı 'abandoned' yap ve odayı temizle
                        if (room.matchId) {
                            await Match.findByIdAndUpdate(room.matchId, { status: 'abandoned', completedAt: new Date() });
                        }
                        cleanupRoom(roomCode);
                    }
                }
            }
        }
    }
    
    // Kuyruktan çıkar
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
