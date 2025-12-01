// Domino Online Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB bağlantısı başarılı'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// User Schema
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    username: { type: String },
    elo: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    rank: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Game State Management
class GameRoom {
    constructor(id, type = 'ranked') {
        this.id = id;
        this.type = type; // 'ranked' veya 'friend'
        this.players = [];
        this.gameState = null;
        this.createdAt = Date.now();
    }

    get isRanked() {
        return this.type === 'ranked';
    }

    addPlayer(socketId, user) {
        this.players.push({ socketId, user });
        return this.players.length;
    }

    removePlayer(socketId) {
        this.players = this.players.filter(p => p.socketId !== socketId);
    }

    isFull() {
        return this.players.length >= 2;
    }

    getPlayer(socketId) {
        return this.players.find(p => p.socketId === socketId);
    }

    getOpponent(socketId) {
        return this.players.find(p => p.socketId !== socketId);
    }
}

// Global state
const rooms = new Map(); // roomId -> GameRoom
const matchmakingQueue = []; // { socketId, user, timestamp }
const socketUsers = new Map(); // socketId -> userDoc

// Helpers
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function calculateEloChange(winnerElo, loserElo, gameProgress = 'full') {
    // 12-20 arası, Faceit benzeri
    const K = 32;
    const expectedScore = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    let eloChange = Math.round(K * (1 - expectedScore));

    if (gameProgress === 'early') {
        eloChange = 10; // erken terk için tipik 10
    } else if (gameProgress === 'late') {
        eloChange = 20; // oyun ilerlediyse 20
    }

    return Math.min(20, Math.max(12, eloChange));
}

function calculateLevel(elo) {
    return Math.min(10, Math.floor((elo || 0) / 100) + 1);
}

async function updateUserRankings() {
    const users = await User.find().sort({ elo: -1 });
    const bulkOps = [];

    users.forEach((user, index) => {
        const newRank = index + 1;
        if (user.rank !== newRank || user.level !== calculateLevel(user.elo)) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: user._id },
                    update: {
                        $set: {
                            rank: newRank,
                            level: calculateLevel(user.elo)
                        }
                    }
                }
            });
        }
    });

    if (bulkOps.length > 0) {
        await User.bulkWrite(bulkOps);
    }
}

// Domino game logic
class DominoGame {
    constructor() {
        this.tiles = this.generateTiles();
        this.board = [];
        this.hands = new Map(); // socketId -> tile[]
        this.currentPlayer = null;
        this.leftEnd = null;
        this.rightEnd = null;
        this.passCount = 0;
    }

    generateTiles() {
        const tiles = [];
        for (let i = 0; i <= 6; i++) {
            for (let j = i; j <= 6; j++) {
                tiles.push({ left: i, right: j, id: `${i}-${j}` });
            }
        }
        return this.shuffle(tiles);
    }

    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    startGame(players) {
        const tilesPerPlayer = 7;
        players.forEach((p, index) => {
            const start = index * tilesPerPlayer;
            const hand = this.tiles.slice(start, start + tilesPerPlayer);
            this.hands.set(p.socketId, hand);
        });

        this.currentPlayer = this.findStartingPlayer(players);
    }

    findStartingPlayer(players) {
        let highestDouble = -1;
        let starting = players[0].socketId;

        players.forEach(p => {
            const hand = this.hands.get(p.socketId) || [];
            hand.forEach(tile => {
                if (tile.left === tile.right && tile.left > highestDouble) {
                    highestDouble = tile.left;
                    starting = p.socketId;
                }
            });
        });

        return starting;
    }

    canPlayTile(tile, position) {
        if (this.board.length === 0) return true;
        const endValue = position === 'left' ? this.leftEnd : this.rightEnd;
        return tile.left === endValue || tile.right === endValue;
    }

    orientTile(tile, position) {
        if (this.board.length === 0) return tile;
        const endValue = position === 'left' ? this.leftEnd : this.rightEnd;

        if (position === 'left') {
            if (tile.right === endValue) return tile;
            if (tile.left === endValue) return { left: tile.right, right: tile.left, id: tile.id };
        } else {
            if (tile.left === endValue) return tile;
            if (tile.right === endValue) return { left: tile.right, right: tile.left, id: tile.id };
        }
        return tile;
    }

    playTile(socketId, tileIndex, position) {
        if (socketId !== this.currentPlayer) {
            return { success: false, error: 'Sıra sizde değil' };
        }

        const hand = this.hands.get(socketId);
        if (!hand || tileIndex < 0 || tileIndex >= hand.length) {
            return { success: false, error: 'Geçersiz taş' };
        }

        const tile = hand[tileIndex];
        if (!this.canPlayTile(tile, position)) {
            return { success: false, error: 'Bu taşı buraya oynayamazsın' };
        }

        hand.splice(tileIndex, 1);

        if (this.board.length === 0) {
            this.board.push(tile);
            this.leftEnd = tile.left;
            this.rightEnd = tile.right;
        } else {
            const oriented = this.orientTile(tile, position);
            if (position === 'left') {
                this.board.unshift(oriented);
                this.leftEnd = oriented.left;
            } else {
                this.board.push(oriented);
                this.rightEnd = oriented.right;
            }
        }

        this.passCount = 0;

        if (hand.length === 0) {
            return { success: true, gameOver: true, winner: socketId };
        }

        this.nextPlayer();
        return { success: true };
    }

    passTurn(socketId) {
        if (socketId !== this.currentPlayer) {
            return { success: false, error: 'Sıra sizde değil' };
        }

        this.passCount++;
        if (this.passCount >= 2) {
            const winner = this.calculateWinnerOnBlock();
            return { success: true, gameOver: true, winner };
        }

        this.nextPlayer();
        return { success: true };
    }

    nextPlayer() {
        const players = Array.from(this.hands.keys());
        const idx = players.indexOf(this.currentPlayer);
        this.currentPlayer = players[(idx + 1) % players.length];
    }

    calculateWinnerOnBlock() {
        let best = null;
        let minTiles = Infinity;
        this.hands.forEach((hand, socketId) => {
            if (hand.length < minTiles) {
                minTiles = hand.length;
                best = socketId;
            }
        });
        return best;
    }

    getGameProgress() {
        const totalTiles = 28;
        const played = this.board.length;
        const ratio = played / totalTiles;
        if (ratio < 0.5) return 'early';
        if (ratio < 0.8) return 'mid';
        return 'late';
    }

    getOpponent(socketId) {
        const players = Array.from(this.hands.keys());
        return players.find(p => p !== socketId);
    }

    getGameState(socketId) {
        return {
            board: this.board,
            hand: this.hands.get(socketId) || [],
            opponentTileCount: (this.hands.get(this.getOpponent(socketId)) || []).length,
            currentPlayer: this.currentPlayer,
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd
        };
    }
}

// Socket.io handlers
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Auth
    socket.on('authenticate', async (data) => {
        try {
            let user = await User.findOne({ telegramId: data.telegramId });
            if (!user) {
                user = new User({
                    telegramId: data.telegramId,
                    firstName: data.firstName || 'Oyuncu',
                    username: data.username,
                    elo: 0,
                    wins: 0,
                    losses: 0,
                    level: 1
                });
                await user.save();
            } else {
                user.lastActive = new Date();
                await user.save();
            }

            socketUsers.set(socket.id, user);
            socket.emit('user_authenticated', { user: user.toObject() });
        } catch (err) {
            console.error('Auth hata', err);
            socket.emit('auth_error', { message: 'Doğrulama hatası' });
        }
    });

    // Ranked matchmaking
    socket.on('find_ranked_match', () => {
        const user = socketUsers.get(socket.id);
        if (!user) return;

        if (matchmakingQueue.find(p => p.socketId === socket.id)) return;

        matchmakingQueue.push({ socketId: socket.id, user, timestamp: Date.now() });

        if (matchmakingQueue.length >= 2) {
            const p1 = matchmakingQueue.shift();
            const p2 = matchmakingQueue.shift();

            const roomId = `ranked_${Date.now()}`;
            const room = new GameRoom(roomId, 'ranked');
            room.addPlayer(p1.socketId, p1.user);
            room.addPlayer(p2.socketId, p2.user);
            rooms.set(roomId, room);

            const game = new DominoGame();
            game.startGame(room.players);
            room.gameState = game;

            room.players.forEach(player => {
                const opp = room.getOpponent(player.socketId).user;
                io.to(player.socketId).emit('match_found', {
                    game: game.getGameState(player.socketId),
                    opponent: opp
                });
            });
        }
    });

    socket.on('cancel_search', () => {
        const idx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
        if (idx !== -1) matchmakingQueue.splice(idx, 1);
    });

    // Friend rooms
    socket.on('create_friend_room', () => {
        const user = socketUsers.get(socket.id);
        if (!user) return;

        let code;
        do {
            code = generateRoomCode();
        } while (rooms.has(code));

        const room = new GameRoom(code, 'friend');
        room.addPlayer(socket.id, user);
        rooms.set(code, room);

        socket.emit('room_created', { roomCode: code });
    });

    socket.on('join_room', (data) => {
        const user = socketUsers.get(socket.id);
        if (!user) return;

        const room = rooms.get(data.roomCode);
        if (!room) {
            socket.emit('room_error', { message: 'Oda bulunamadı' });
            return;
        }
        if (room.isFull()) {
            socket.emit('room_error', { message: 'Oda dolu' });
            return;
        }

        room.addPlayer(socket.id, user);

        if (room.isFull()) {
            const game = new DominoGame();
            game.startGame(room.players);
            room.gameState = game;

            room.players.forEach(player => {
                const opp = room.getOpponent(player.socketId).user;
                io.to(player.socketId).emit('room_joined', {
                    game: game.getGameState(player.socketId),
                    opponent: opp
                });
            });
        }
    });

    // Game actions
    socket.on('play_tile', async (data) => {
        const room = findRoomBySocket(socket.id);
        if (!room || !room.gameState) return;

        const game = room.gameState;
        const result = game.playTile(socket.id, data.tileIndex, data.position);
        if (!result.success) {
            socket.emit('game_error', { message: result.error });
            return;
        }

        room.players.forEach(p => {
            io.to(p.socketId).emit('game_update', game.getGameState(p.socketId));
        });

        if (result.gameOver) {
            await handleGameOver(room, result.winner, 'normal');
        }
    });

    socket.on('pass_turn', async () => {
        const room = findRoomBySocket(socket.id);
        if (!room || !room.gameState) return;

        const game = room.gameState;
        const result = game.passTurn(socket.id);
        if (!result.success) {
            socket.emit('game_error', { message: result.error });
            return;
        }

        room.players.forEach(p => {
            io.to(p.socketId).emit('game_update', game.getGameState(p.socketId));
        });

        if (result.gameOver) {
            await handleGameOver(room, result.winner, 'normal');
        }
    });

    socket.on('leave_game', () => {
        handleLeave(socket.id, true);
    });

    socket.on('leave_room', () => {
        handleLeave(socket.id, false);
    });

    // Leaderboard
    socket.on('get_leaderboard', async () => {
        try {
            const top10 = await User.find()
                .sort({ elo: -1 })
                .limit(10)
                .select('firstName username elo wins losses rank');

            const user = socketUsers.get(socket.id);
            let myRank = null;
            if (user) {
                const me = await User.findOne({ telegramId: user.telegramId }).select('rank');
                myRank = me?.rank || 0;
            }

            socket.emit('leaderboard', { top10, myRank });
        } catch (err) {
            console.error('Liderlik tablosu hatası', err);
        }
    });

    socket.on('disconnect', () => {
        console.log('Bağlantı koptu:', socket.id);
        const user = socketUsers.get(socket.id);
        socketUsers.delete(socket.id);
        handleLeave(socket.id, true, true);
    });
});

function findRoomBySocket(socketId) {
    for (const [, room] of rooms) {
        if (room.players.some(p => p.socketId === socketId)) {
            return room;
        }
    }
    return null;
}

async function handleGameOver(room, winnerSocketId, reason) {
    const game = room.gameState;
    const winner = room.getPlayer(winnerSocketId);
    const loser = room.getOpponent(winnerSocketId);
    if (!winner || !loser) return;

    if (room.isRanked) {
        const progress = game.getGameProgress();
        const eloChange = calculateEloChange(winner.user.elo, loser.user.elo, progress);

        await User.updateOne(
            { telegramId: winner.user.telegramId },
            {
                $inc: { elo: eloChange, wins: 1 },
                $set: { level: calculateLevel(winner.user.elo + eloChange), lastActive: new Date() }
            }
        );

        await User.updateOne(
            { telegramId: loser.user.telegramId },
            {
                $inc: { elo: -eloChange, losses: 1 },
                $set: { level: calculateLevel(loser.user.elo - eloChange), lastActive: new Date() }
            }
        );

        await updateUserRankings();

        io.to(winner.socketId).emit('game_over', {
            winner: winner.socketId,
            eloChange: eloChange,
            opponent: loser.user
        });
        io.to(loser.socketId).emit('game_over', {
            winner: winner.socketId,
            eloChange: -eloChange,
            opponent: winner.user
        });
    } else {
        // arkadaş modu: elo yok
        io.to(winner.socketId).emit('game_over', {
            winner: winner.socketId,
            eloChange: 0,
            opponent: loser.user
        });
        io.to(loser.socketId).emit('game_over', {
            winner: winner.socketId,
            eloChange: 0,
            opponent: winner.user
        });
    }

    setTimeout(() => {
        rooms.delete(room.id);
    }, 5000);
}

function handleLeave(socketId, maybeRankedPenalty = false, onDisconnect = false) {
    // matchmaking kuyruğundan çıkar
    const idx = matchmakingQueue.findIndex(p => p.socketId === socketId);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);

    const room = findRoomBySocket(socketId);
    if (!room) return;

    const opponent = room.getOpponent(socketId);
    if (opponent) {
        io.to(opponent.socketId).emit('opponent_disconnected');
    }

    rooms.delete(room.id);
}

// Periodik rank güncelleme
setInterval(updateUserRankings, 60 * 1000);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});

