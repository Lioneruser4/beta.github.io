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
    isHidden: { type: Boolean, default: false } // Liderlik tablosu için görünürlük
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

const ADMIN_TELEGRAM_ID = '976640409'; // Admin Telegram ID'si

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
                winStreak: player.winStreak, // Bu alanlar zaten var, tekrar eklemeye gerek yok
                bestWinStreak: player.bestWinStreak,
                isAdmin: player.telegramId === ADMIN_TELEGRAM_ID // Admin kontrolü
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find({ isHidden: { $ne: true } }) // Gizli oyuncuları filtrele
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

// Admin Middleware
async function adminAuth(req, res, next) {
    const adminId = req.headers['x-admin-id'];
    if (adminId === ADMIN_TELEGRAM_ID) {
        next();
    } else {
        res.status(403).json({ error: 'Yetkisiz erişim.' });
    }
}

app.post('/api/admin/reset-elo', adminAuth, async (req, res) => {
    try {
        const updateResult = await Player.updateMany({}, {
            $set: {
                elo: 0, level: 1, wins: 0, losses: 0, draws: 0,
                totalGames: 0, winStreak: 0, bestWinStreak: 0
            }
        });
        await Match.deleteMany({});
        console.log(`✅ ADMIN: Tüm ELO'lar sıfırlandı. Etkilenen: ${updateResult.modifiedCount}`);
        res.json({ success: true, message: `Tüm istatistikler başarıyla sıfırlandı. Etkilenen oyuncu: ${updateResult.modifiedCount}` });
    } catch (error) {
        console.error('❌ Admin ELO sıfırlama hatası:', error);
        res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

app.post('/api/admin/toggle-visibility', adminAuth, async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) {
        return res.status(400).json({ error: 'Hedef oyuncu ID\'si gerekli.' });
    }
    try {
        const player = await Player.findOne({ telegramId });
        if (!player) {
            return res.status(404).json({ error: 'Oyuncu bulunamadı.' });
        }
        player.isHidden = !player.isHidden;
        await player.save();
        console.log(`✅ ADMIN: Oyuncu görünürlüğü değiştirildi - ${player.username}: ${player.isHidden ? 'Gizli' : 'Görünür'}`);
        res.json({ success: true, message: `${player.username} adlı oyuncu artık ${player.isHidden ? 'gizli' : 'görünür'}.` });
    } catch (error) {
        console.error('❌ Admin görünürlük hatası:', error);
        res.status(500).json({ error: 'Sunucu hatası.' });
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

// --- PROFESSIONAL DOMINO 101 GAME LOGIC ---

// Create complete domino set (0-0 to 6-6)
function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return tiles;
}

// Shuffle array
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Initialize professional domino game
function initializeGame(roomCode, player1Id, player2Id) {
    const allTiles = shuffleArray(createDominoSet());
    const player1Hand = allTiles.slice(0, 7); // 7 taş standart
    const player2Hand = allTiles.slice(7, 14); // 7 taş standart
    const market = allTiles.slice(14); // Kalan taşlar pazar

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
    
    // Eğer kimse çift taş yoksa rastgele başlat
    if (highestDouble === -1) {
        startingPlayer = Math.random() < 0.5 ? player1Id : player2Id;
    }

    room.gameState = {
        board: [],
        status: 'playing',
        market: market,
        currentPlayer: startingPlayer,
        players: {
            [player1Id]: { 
                hand: player1Hand, 
                name: room.players[player1Id].name,
                photoUrl: room.players[player1Id].photoUrl,
                elo: room.players[player1Id].elo,
                level: room.players[player1Id].level
            },
            [player2Id]: { 
                hand: player2Hand, 
                name: room.players[player2Id].name,
                photoUrl: room.players[player2Id].photoUrl,
                elo: room.players[player2Id].elo,
                level: room.players[player2Id].level
            }
        },
        turn: 1,
        startingDouble: highestDouble,
        roomCode: roomCode,
        startTime: Date.now()
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Professional Domino 101 başlatıldı - Başlayan: ${startingPlayer === player1Id ? room.players[player1Id].name : room.players[player2Id].name}`);
    return room.gameState;
}

// Check if tile can be played on board
function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Get valid moves for a tile
function getValidMoves(tile, board) {
    if (board.length === 0) return ['start'];
    
    const moves = [];
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

// Play tile on board
function playTile(tile, position, board) {
    const newBoard = [...board];
    
    if (position === 'start' || newBoard.length === 0) {
        newBoard.push(tile);
    } else if (position === 'left') {
        const leftEnd = newBoard[0][0];
        if (tile[1] === leftEnd) {
            newBoard.unshift(tile);
        } else if (tile[0] === leftEnd) {
            newBoard.unshift([tile[1], tile[0]]);
        }
    } else if (position === 'right') {
        const rightEnd = newBoard[newBoard.length - 1][1];
        if (tile[0] === rightEnd) {
            newBoard.push(tile);
        } else if (tile[1] === rightEnd) {
            newBoard.push([tile[1], tile[0]]);
        }
    }
    
    return newBoard;
}

// Check if player has won
function checkWinCondition(hand) {
    return hand.length === 0;
}

// Check if game is blocked (no one can play)
function checkBlockedGame(gameState) {
    const { players, board, market } = gameState;
    
    // Pazarda taş varsa oyun bloke olamaz
    if (market.length > 0) return false;
    
    // Her oyuncunun oynayabileceği taş var mı?
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

// Calculate winner in blocked game
function calculateBlockedWinner(gameState) {
    const { players } = gameState;
    let minPoints = Infinity;
    let winner = null;
    
    for (let playerId in players) {
        const hand = players[playerId].hand;
        const points = hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        if (points < minPoints) {
            minPoints = points;
            winner = playerId;
        }
    }
    
    return winner;
}

function playTileOnBoard(tile, board, position) {
    if (board.length === 0) {
        board.push(tile);
        return true;
    }

    const leftEnd = board[0].value1;
    const rightEnd = board[board.length - 1].value2;
    let played = false;

    if (position === 'left' || position === 'both') {
        if (tile.value2 === leftEnd) {
            board.unshift(tile);
            played = true;
        } else if (tile.value1 === leftEnd) {
            board.unshift({ value1: tile.value2, value2: tile.value1 }); // Yön değiştir
            played = true;
        }
    } 
    
    // Eğer 'both' seçildiyse ve sol tarafa uymadıysa sağa bakmaya devam etmeli
    // Ancak oyuncu spesifik olarak 'left' dediyse ve uymadıysa buraya girmemeli
    if (!played && (position === 'right' || position === 'both')) {
        if (tile.value1 === rightEnd) {
            board.push(tile);
            played = true;
        } else if (tile.value2 === rightEnd) {
            board.push({ value1: tile.value2, value2: tile.value1 }); // Yön değiştir
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

    // Pazar bittiğinde ve kimse oynayamadığında oyun kilitlenir
    if (gameState.bazaar.length === 0) {
        const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
        const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));
        if (!player1CanPlay && !player2CanPlay) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile.value1 + tile.value2, 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile.value1 + tile.value2, 0);
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
            gameState: getSanitizedGameStateForPlayer(roomCode, playerId)
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
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
        bazaarSize: fullGameState.bazaar.length,
        currentPlayer: fullGameState.currentPlayer,
        isMyTurn: fullGameState.currentPlayer === playerId,
        myHand: fullGameState.players[playerId].hand,
        opponentHandSize: opponentId ? fullGameState.players[opponentId].hand.length : 0,
        lastMove: fullGameState.lastMove,
        status: fullGameState.status,
        roomCode: roomCode,
        myPlayerId: playerId
    };

    return sanitizedState;
}

// Oda yönetimi için yardımcı fonksiyonlar
function getPlayerRoom(playerId) {
    for (const [roomCode, room] of rooms.entries()) {
        if (room.players[playerId]) {
            return { roomCode, room };
        }
    }
    return { roomCode: null, room: null };
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    let playerId = null;
    
    // Oyuncunun yeniden bağlanma isteği
    // ...
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'rejoinGame': handleRejoinGame(ws, data); break;
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'pass': handlePass(ws); break; // Pas geçme için eklendi
                case 'leaveGame': handleLeaveGame(ws); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    // sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' }); // Bu mesaj gereksiz kalabalık yapabilir
});

const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// --- PROFESSIONAL DOMINO GAME HANDLERS ---

function handlePlayTile(ws, data) {
    const { tileIndex, position } = data;
    const roomCode = ws.roomCode;
    const playerId = ws.playerId;
    
    if (!roomCode || !rooms.has(roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    }
    
    const room = rooms.get(roomCode);
    const gameState = room.gameState;
    
    if (!gameState || gameState.currentPlayer !== playerId) {
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
    
    // Check win condition
    if (checkWinCondition(playerHand)) {
        gameState.status = 'finished';
        gameState.winner = playerId;
        
        broadcastToRoom(roomCode, {
            type: 'gameEnd',
            winner: playerId,
            winnerName: gameState.players[playerId].name,
            reason: 'no_tiles'
        });
        
        return;
    }
    
    // Check blocked game
    if (checkBlockedGame(gameState)) {
        const blockedWinner = calculateBlockedWinner(gameState);
        gameState.status = 'finished';
        gameState.winner = blockedWinner;
        
        broadcastToRoom(roomCode, {
            type: 'gameEnd',
            winner: blockedWinner,
            winnerName: gameState.players[blockedWinner].name,
            reason: 'blocked'
        });
        
        return;
    }
    
    // Switch turn
    const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
    gameState.currentPlayer = nextPlayer;
    gameState.turn++;
    
    broadcastToRoom(roomCode, {
        type: 'gameUpdate',
        gameState: gameState
    });
}

function handleDrawFromMarket(ws) {
    const roomCode = ws.roomCode;
    const playerId = ws.playerId;
    
    if (!roomCode || !rooms.has(roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    }
    
    const room = rooms.get(roomCode);
    const gameState = room.gameState;
    
    if (!gameState || gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    if (gameState.market.length === 0) {
        return sendMessage(ws, { type: 'error', message: 'Pazarda taş kalmadı' });
    }
    
    // Check if player has playable tiles
    const playerHand = gameState.players[playerId].hand;
    const hasPlayableTile = playerHand.some(tile => canPlayTile(tile, gameState.board));
    
    if (hasPlayableTile) {
        return sendMessage(ws, { type: 'error', message: 'Elinde oynayabileceğin taş var' });
    }
    
    // Draw tile from market
    const drawnTile = gameState.market.shift();
    playerHand.push(drawnTile);
    
    // Check if drawn tile can be played
    if (!canPlayTile(drawnTile, gameState.board)) {
        // Switch turn if still can't play
        const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
        gameState.currentPlayer = nextPlayer;
    }
    
    broadcastToRoom(roomCode, {
        type: 'gameUpdate',
        gameState: gameState
    });
}

function handlePass(ws) {
    const roomCode = ws.roomCode;
    const playerId = ws.playerId;
    
    if (!roomCode || !rooms.has(roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    }
    
    const room = rooms.get(roomCode);
    const gameState = room.gameState;
    
    if (!gameState || gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    // Can only pass if no playable tiles and market is empty
    if (gameState.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: 'Pazarda taş varken pas geçemezsin' });
    }
    
    const playerHand = gameState.players[playerId].hand;
    const hasPlayableTile = playerHand.some(tile => canPlayTile(tile, gameState.board));
    
    if (hasPlayableTile) {
        return sendMessage(ws, { type: 'error', message: 'Oynayabileceğin taş varken pas geçemezsin' });
    }
    
    // Switch turn
    const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
    gameState.currentPlayer = nextPlayer;
    
    // Check if game is blocked after pass
    if (checkBlockedGame(gameState)) {
        const blockedWinner = calculateBlockedWinner(gameState);
        gameState.status = 'finished';
        gameState.winner = blockedWinner;
        
        broadcastToRoom(roomCode, {
            type: 'gameEnd',
            winner: blockedWinner,
            winnerName: gameState.players[blockedWinner].name,
            reason: 'blocked'
        });
        
        return;
    }
    
    broadcastToRoom(roomCode, {
        type: 'gameUpdate',
        gameState: gameState
    });
}

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
            const p1State = getSanitizedGameStateForPlayer(roomCode, p1.playerId);
            const p2State = getSanitizedGameStateForPlayer(roomCode, p2.playerId);

            sendMessage(p1.ws, { type: 'gameStart', gameState: p1State });
            sendMessage(p2.ws, { type: 'gameStart', gameState: p2State });
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
        const hostState = getSanitizedGameStateForPlayer(data.roomCode, hostId);
        const playerState = getSanitizedGameStateForPlayer(data.roomCode, playerId);
        sendMessage(playerConnections.get(hostId), { type: 'gameStart', gameState: hostState });
        sendMessage(playerConnections.get(playerId), { type: 'gameStart', gameState: playerState });
    }, 500);
}

function handlePlayTile(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    const tileIndex = player.hand.findIndex(t => t.value1 === data.tile.value1 && t.value2 === data.tile.value2);
    const tile = player.hand[tileIndex];

    if (!tile) return sendMessage(ws, { type: 'error', message: 'Geçersiz taş' });

    const success = playTileOnBoard(tile, gs.board, data.position);

    if (!success) {
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz (Pozisyon uyuşmuyor)' });
    }

    player.hand.splice(tileIndex, 1);
    gs.turn++;
    gs.lastMove = { player: ws.playerId, tile: tile, position: data.position };
    
    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room || room.gameEnded) return;

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

        // Oyuncuların bağlantılarından oda kodunu temizle
        playerIds.forEach(pid => {
            const playerWs = playerConnections.get(pid);
            if (playerWs) {
                playerWs.roomCode = null;
            }
        });

        room.gameEnded = true;
        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: false
        });

        // Hata durumunda da oyuncuların bağlantılarından oda kodunu temizle
        playerIds.forEach(pid => {
            const playerWs = playerConnections.get(pid);
            if (playerWs) {
                playerWs.roomCode = null;
            }
        });

        room.gameEnded = true;
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
    
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    broadcastToRoom(ws.roomCode, { type: 'info', message: `${ws.playerName} pas geçti.` }, ws.playerId);
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return;

    const player = gs.players[ws.playerId];
    
    // Oyuncunun elinde oynayabileceği taş var mı kontrol et
    const hasPlayableTile = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (hasPlayableTile) {
        return sendMessage(ws, { 
            type: 'error', 
            message: 'Oynanabilir taşınız varken pazardan çekemezsiniz.' 
        });
    }
    
    // Pazarda taş var mı?
    if (gs.bazaar.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        
        const winner = checkWinner(gs); // Her iki oyuncu da çekemiyorsa oyun biter
        if (winner) {
            handleGameEnd(ws.roomCode, winner, gs);
            return;
        }

        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
        return;
    }

    // Pazardan taş çek
    const drawnTile = gs.bazaar.shift();
    player.hand.push(drawnTile);
    
    console.log(`🎲 ${player.name} pazardan taş çekti: [${drawnTile.value1}|${drawnTile.value2}] - Kalan: ${gs.bazaar.length}`);
    
    if (canPlayTile(drawnTile, gs.board)) {
        // Eğer çekilen taş oynanabilir durumdaysa, oyuncuya bildir
        sendMessage(ws, { type: 'info', message: `Pazardan [${drawnTile.value1}|${drawnTile.value2}] çektiniz. Şimdi oynayın.` });
    } else {
        // Çekilen taş oynanamıyor, sıra otomatik olarak geçer.
        console.log(`❌ ${player.name} pazardan çektiği taşı oynayamadı. Sıra geçiyor.`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        broadcastToRoom(ws.roomCode, { type: 'info', message: `${player.name} pazardan çekti ve pas geçti.` }, ws.playerId);
    }
    
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

async function handleLeaveGame(ws) {
    if (!ws.playerId) return;
    console.log(`🚪 ${ws.playerName} oyundan ayrıldı.`);
    
    // Oyuncuyu bağlantılardan ve kuyruktan hemen kaldır
    playerConnections.delete(ws.playerId);
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) matchQueue.splice(qIdx, 1);

    // Eğer bir odadaysa, oyunu sonlandır
    if (ws.roomCode && rooms.has(ws.roomCode)) {
        await handlePlayerDisconnection(ws.roomCode, ws.playerId);
    }
}

async function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerId || 'Bilinmeyen'}`);
    
    if (!ws.playerId) return;

    // Eşleşme kuyruğundan çıkar
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }

    // Oda bilgisini temizle
    if (ws.roomCode && rooms.has(ws.roomCode)) {
        await handlePlayerDisconnection(ws.roomCode, ws.playerId);
    }
    
    // Oyuncu bağlantısını sil
    playerConnections.delete(ws.playerId);
}

async function handlePlayerDisconnection(roomCode, disconnectedPlayerId) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Eğer oyun başlamışsa, kalan oyuncuyu kazanan yap
    if (room.gameState && room.gameState.status === 'playing') {
        const remainingPlayerId = Object.keys(room.gameState.players).find(id => id !== disconnectedPlayerId);
        
        if (remainingPlayerId && playerConnections.has(remainingPlayerId)) {
            console.log(`🏆 ${disconnectedPlayerId} ayrıldı. Kazanan: ${remainingPlayerId}`);
            
            // Oyunu sonlandır ve kazananı bildir
            await handleGameEnd(roomCode, remainingPlayerId, room.gameState);
        } else {
            // Odada kimse kalmadı, odayı sil
            console.log(`🗑️ Oda boşaldı ve siliniyor: ${roomCode}`);
            rooms.delete(roomCode);
        }
    } else {
        // Oyun başlamamışsa, sadece oyuncuyu odadan çıkar
        delete room.players[disconnectedPlayerId];
        if (Object.keys(room.players).length === 0) {
            console.log(`🗑️ Boş lobi odası siliniyor: ${roomCode}`);
            rooms.delete(roomCode);
        }
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
