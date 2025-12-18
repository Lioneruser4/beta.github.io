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
    elo: { type: Number, default: 100 },
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
const matchQueues = { '2': [], '4': [] };
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

    const loserChange = -winnerChange; // Kaybeden kazanan kadar kaybeder

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
        console.log(`📡 Auth Başarılı: ${username} - ELO: ${player.elo}`);

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
        const players = await Player.find({ elo: { $gte: 0 } })
            .sort({ elo: -1 })
            .limit(50) // Top 50
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

function initializeGame(roomCode, ...playerIds) {
    const tiles = createDominoSet();
    const room = rooms.get(roomCode);
    const playersCount = playerIds.length;

    const players = {};
    let currentIndex = 0;

    playerIds.forEach(pid => {
        players[pid] = {
            hand: tiles.slice(currentIndex * 7, (currentIndex + 1) * 7),
            name: room.players[pid].name
        };
        currentIndex++;
    });

    const market = tiles.slice(playersCount * 7);

    // En yüksek çifti bul (6|6, 5|5, 4|4, ...)
    let startingPlayer = playerIds[0];
    let highestDouble = -1;

    playerIds.forEach(pid => {
        const hand = players[pid].hand;
        for (let tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayer = pid;
            }
        }
    });

    room.gameState = {
        board: [],
        players: players,
        playerOrder: playerIds, // Sıra takibi için
        market: market,
        currentPlayer: startingPlayer,
        turn: 1,
        lastMove: null,
        startingDouble: highestDouble
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı (${playersCount} kişi) - Başlayan: ${room.players[startingPlayer].name} (${highestDouble}|${highestDouble})`);
    return room.gameState;
}

function getNextPlayer(gs) {
    const currentIdx = gs.playerOrder.indexOf(gs.currentPlayer);
    const nextIdx = (currentIdx + 1) % gs.playerOrder.length;
    return gs.playerOrder[nextIdx];
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
    const playerIds = gameState.playerOrder;
    const sums = {};
    playerIds.forEach(pid => {
        sums[pid] = gameState.players[pid].hand.reduce((s, t) => s + t[0] + t[1], 0);
    });

    // 1. Taşını bitiren var mı?
    for (const pid of playerIds) {
        if (gameState.players[pid].hand.length === 0) {
            return { type: 'FINISHED', winnerId: pid, sums };
        }
    }

    // 2. Oyun tıkandı mı? (Kimse oynayamıyor ve pazar boş)
    const marketEmpty = !gameState.market || gameState.market.length === 0;
    if (marketEmpty) {
        let anyoneCanPlay = false;
        for (const pid of playerIds) {
            if (gameState.players[pid].hand.some(tile => canPlayTile(tile, gameState.board))) {
                anyoneCanPlay = true;
                break;
            }
        }

        if (!anyoneCanPlay) {
            // Oyun kilitlendi, elindeki taşların toplamı en az olan kazanır
            let minSum = Infinity;
            let winnerId = playerIds[0];
            let isDraw = false;

            playerIds.forEach(pid => {
                const sum = sums[pid];
                if (sum < minSum) {
                    minSum = sum;
                    winnerId = pid;
                    isDraw = false;
                } else if (sum === minSum) {
                    isDraw = true;
                }
            });

            return {
                type: 'BLOCKED',
                winnerId: isDraw ? 'DRAW' : winnerId,
                sums
            };
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
                case 'startPrivateGame': handleStartGame(ws); break;
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
        const alreadyIn = Object.values(matchQueues).some(q => q.find(p => p.playerId === ws.playerId));
        if (alreadyIn) return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
        if (ws.roomCode) return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız' });
    }

    const playerId = ws.playerId || generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;

    const mode = data.mode === '4' ? '4' : '2';

    // Aynı Telegram hesabının ikinci kez kuyruğa girmesini engelle
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegram = matchQueues[mode].find(p => p.telegramId === ws.telegramId);
        if (sameTelegram) return sendMessage(ws, { type: 'error', message: 'Bu Telegram hesabı zaten eşleşme kuyruğunda' });
    }

    playerConnections.set(playerId, ws);
    matchQueues[mode].push({
        ws, playerId, playerName: ws.playerName, telegramId: ws.telegramId,
        photoUrl: ws.photoUrl, level: ws.level, elo: ws.elo, isGuest: ws.isGuest
    });

    console.log(`✅ ${ws.playerName} (${mode}p) kuyrukta - Toplam: ${matchQueues[mode].length}`);

    const targetSize = parseInt(mode);
    if (matchQueues[mode].length >= targetSize) {
        const participants = [];
        for (let i = 0; i < targetSize; i++) participants.push(matchQueues[mode].shift());

        const roomCode = generateRoomCode();
        const players = {};
        const playerIds = participants.map(p => p.playerId);

        participants.forEach(p => {
            players[p.playerId] = {
                name: p.playerName, telegramId: p.telegramId, photoUrl: p.photoUrl,
                level: p.level, elo: p.elo, isGuest: p.isGuest
            };
            p.ws.roomCode = roomCode;
        });

        const gameType = (targetSize === 2 && !participants.some(p => p.isGuest)) ? 'ranked' : 'casual';
        const room = { code: roomCode, players, type: gameType, startTime: Date.now() };
        rooms.set(roomCode, room);

        const gameState = initializeGame(roomCode, ...playerIds);

        participants.forEach(p => {
            const others = playerIds.filter(id => id !== p.playerId).map(id => players[id]);
            sendMessage(p.ws, { type: 'matchFound', roomCode, opponents: others, gameType });
        });

        setTimeout(() => {
            playerIds.forEach(pid => {
                const pWs = playerConnections.get(pid);
                if (pWs) {
                    pWs.send(JSON.stringify({ type: 'session', playerId: pid, roomCode }));
                    pWs.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: pid } }));
                }
            });
            console.log(`✅ Oyun başladı: ${roomCode} (${targetSize} kişi)`);
        }, 4000);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) {
    Object.values(matchQueues).forEach(q => {
        const idx = q.findIndex(p => p.ws === ws);
        if (idx !== -1) {
            q.splice(idx, 1);
            console.log(`❌ ${ws.playerName} aramayı iptal etti`);
            sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
        }
    });
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode();
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.roomCode = roomCode;

    const capacity = data.capacity === 4 ? 4 : 2;

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
        capacity: capacity, // 2 veya 4
        host: ws.playerId,
        startTime: Date.now()
    });

    sendMessage(ws, { type: 'roomCreated', roomCode, capacity });
}

function handleJoinRoom(ws, data) {
    if (!data.roomCode) return sendMessage(ws, { type: 'error', message: 'Oda kodu gerekli' });
    const code = data.roomCode.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı' });
    if (Object.keys(room.players).length >= (room.capacity || 2)) return sendMessage(ws, { type: 'error', message: 'Oda dolu' });
    if (room.host === ws.playerId) return sendMessage(ws, { type: 'error', message: 'Kendi odanıza bağlanamazsınız' });

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

    room.players[pid] = {
        name: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest
    };

    // Odadakilere yeni oyuncuyu bildir
    const playerList = Object.keys(room.players).map(id => ({ ...room.players[id], id }));
    broadcastToRoom(code, { type: 'roomUpdated', players: playerList, host: room.host });
}

function handleStartGame(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || room.host !== ws.playerId) return;

    const playerIds = Object.keys(room.players);
    const minPlayers = room.capacity === 4 ? 3 : 2;
    if (playerIds.length < minPlayers) {
        return sendMessage(ws, { type: 'error', message: `Yeterli oyuncu yok (En az ${minPlayers} kişi lazım)` });
    }

    const gameState = initializeGame(room.code, ...playerIds);

    playerIds.forEach(targetId => {
        const socket = playerConnections.get(targetId);
        if (socket) {
            socket.send(JSON.stringify({ type: 'session', playerId: targetId, roomCode: room.code }));
            socket.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: targetId } }));
        }
    });
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

    const winResult = checkWinner(gs);
    if (winResult) {
        // Her turlu bıtıste (Fınıshed veya Blocked) puanları goster ve 7sn beklet
        broadcastToRoom(ws.roomCode, {
            type: 'gameBlocked', // Frontend bu ismi 'Hesaplanıyor' olarak kullanıyor
            sums: winResult.sums,
            winnerId: winResult.winnerId
        });

        setTimeout(() => {
            handleGameEnd(ws.roomCode, winResult.winnerId, gs);
        }, 7000);
    } else {
        gs.turn++;
        gs.currentPlayer = getNextPlayer(gs);
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
        const isRankedMatch = room.type === 'ranked' && playerIds.length === 2 && !player1IsGuest && !player2IsGuest;

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

        const winnerChange = eloChanges ? eloChanges.winnerChange : 0;
        const loserChange = eloChanges ? eloChanges.loserChange : 0;

        // Her oyuncunun oda bilgisini temizle ve ELO'sunu anlık güncelle
        playerIds.forEach(pid => {
            const socket = playerConnections.get(pid);
            if (socket) {
                socket.roomCode = null;
                const isThisWinner = pid === winnerId;

                // RANKED ise anlık profil güncellemesi gönder
                if (isRankedMatch) {
                    const pDoc = isThisWinner ? winner : loser;
                    sendMessage(socket, {
                        type: 'profileUpdate',
                        elo: pDoc.elo,
                        level: pDoc.level
                    });
                }
            }
        });

        broadcastToRoom(roomCode, {
            type: 'gameEnd',
            winner: String(winnerId),
            winnerName: isDraw ? 'Beraberlik' : (gameState.players[winnerId]?.name || 'Rakip'),
            isRanked: isRankedMatch,
            eloChanges: eloChanges ? {
                winner: winnerChange,
                loser: loserChange
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
    gs.currentPlayer = getNextPlayer(gs);

    // Pas geçildiğini herkese bildir (Ses efekti için)
    broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: ws.playerName });

    const winResult = checkWinner(gs);
    if (winResult) {
        broadcastToRoom(ws.roomCode, {
            type: 'gameBlocked',
            sums: winResult.sums,
            winnerId: winResult.winnerId
        });
        setTimeout(() => {
            handleGameEnd(ws.roomCode, winResult.winnerId, gs);
        }, 7000);
        return;
    }

    // Sıradaki durumu herkese gönder
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];

    // Elinde oynanacak taş var mı kontrol et
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var, pazardan çekemezsiniz!' });
    }

    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = getNextPlayer(gs);

        broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: player.name });
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
            gs.currentPlayer = getNextPlayer(gs);

            // Pas geçildiğini bildir
            broadcastToRoom(ws.roomCode, { type: 'turnPassed', playerName: player.name });

            // Sıra geçtikten sonra oyun kilitlendi mi kontrol et
            const winResult = checkWinner(gs);
            if (winResult) {
                broadcastToRoom(ws.roomCode, {
                    type: 'gameBlocked',
                    sums: winResult.sums,
                    winnerId: winResult.winnerId
                });
                setTimeout(() => {
                    handleGameEnd(ws.roomCode, winResult.winnerId, gs);
                }, 7000);
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
    const leaverName = room.players[leaverId]?.name || 'Rakip';
    const winnerId = playerIds.find(id => String(id) !== leaverId);

    // Ayrılan kişi için sum'ları hesapla (ayrılan en fazla puana sahip sayılsın ya da elindeki kalsın)
    // Kullanıcı talebi: Puanlar hesaplansın.
    const sums = {};
    playerIds.forEach(pid => {
        sums[pid] = gs.players[pid].hand.reduce((s, t) => s + t[0] + t[1], 0);
    });
    // Ayrılan kişinin puanını cezalı olarak artıralım mı? 
    // Kullanıcı "kiminki azsa o kazansın" dediği için ayrılan otomatik kaybederse daha iyi.
    // Ama puanları gösterelim.
    sums[leaverId] = Math.max(sums[leaverId], 99); // Ayrılana 99 puan cezası

    broadcastToRoom(ws.roomCode, {
        type: 'gameBlocked',
        sums: sums,
        winnerId: winnerId,
        message: `${leaverName} oyundan ayrıldı!`
    });

    setTimeout(() => {
        handleGameEnd(ws.roomCode, winnerId, gs);
    }, 7000);
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);

    if (ws.playerId) playerConnections.delete(ws.playerId);

    Object.values(matchQueues).forEach(q => {
        const qIdx = q.findIndex(p => p.ws === ws);
        if (qIdx !== -1) {
            q.splice(qIdx, 1);
            console.log(`❌ Kuyruktan çıkarıldı`);
        }
    });

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
                // Opsiyonel: 5 dakika sonra odayı temizle (Memory leak önlemek için)
                if (!room.cleanupTimer) {
                    room.cleanupTimer = setTimeout(() => {
                        rooms.delete(ws.roomCode);
                    }, 300000); // 5 dk
                }
            }
        }
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
