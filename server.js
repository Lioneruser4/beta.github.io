/**
 * DOMINO ELITE PRO - SERVER ENGINE
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const MONGO_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
const PORT = process.env.PORT || 3000;

// --- DB Schema ---
mongoose.connect(MONGO_URI).then(() => console.log('MongoDB Connected')).catch(err => console.error(err));

const UserSchema = new mongoose.Schema({
    telegramId: String,
    name: String,
    photo: String,
    elo: { type: Number, default: 0 },
    lastPlayedAt: Date
});
const User = mongoose.model('User', UserSchema);

// --- App Setup ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const mmQueue = []; // Matchmaking
const privateRooms = {}; // Friend rooms
const activeGames = {}; // roomId -> gameState
const playerToRoom = {}; // socketId/userId -> roomId

// --- Game Logic Utils ---
function generatePack() {
    const pack = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            pack.push([i, j]);
        }
    }
    return pack.sort(() => Math.random() - 0.5);
}

// --- Socket Handlers ---
io.on('connection', async (socket) => {
    const { id: userId, name, photo } = socket.handshake.query;
    if (!userId) return;

    console.log(`User connected: ${name} (${userId})`);

    // Sync User Data
    let user = await User.findOne({ telegramId: userId });
    if (!user) {
        user = new User({ telegramId: userId, name, photo, elo: 0 });
        await user.save();
    } else {
        user.name = name;
        user.photo = photo;
        await user.save();
    }

    socket.emit('profile_sync', { elo: user.elo, level: Math.floor(user.elo / 100) + 1 });

    // --- REJOIN LOGIC ---
    socket.on('check_rejoin', () => {
        const roomId = playerToRoom[userId];
        if (roomId && activeGames[roomId]) {
            socket.join(roomId);
            const game = activeGames[roomId];
            socket.emit('game_start', {
                hand: game.hands[userId],
                opponent: game.players.find(p => p.id !== userId),
                board: game.board
            });
            socket.emit('game_update', game);
        }
    });

    // --- MATCHMAKING ---
    socket.on('join_mm', () => {
        if (mmQueue.find(p => p.userId === userId)) return;

        const player = { socketId: socket.id, userId, elo: user.elo, name, photo };
        mmQueue.push(player);
        socket.emit('mm_status', 'searching');

        // Match Logic
        if (mmQueue.length >= 2) {
            const p1 = mmQueue.shift();
            const p2 = mmQueue.shift();

            const roomId = `ranked_${Date.now()}`;
            startGame(roomId, p1, p2, true);
        }
    });

    socket.on('cancel_mm', () => {
        const idx = mmQueue.findIndex(p => p.userId === userId);
        if (idx > -1) mmQueue.splice(idx, 1);
        socket.emit('mm_status', 'idle');
    });

    // --- PRIVATE ROOMS ---
    socket.on('create_private', () => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        privateRooms[code] = { host: { socketId: socket.id, userId, name, photo }, code };
        socket.emit('private_room_created', code);
    });

    socket.on('join_private', (code) => {
        const room = privateRooms[code];
        if (!room) return socket.emit('error_msg', 'Oda bulunamadı.');

        const opponent = { socketId: socket.id, userId, name, photo };
        const roomId = `pri_${code}`;
        startGame(roomId, room.host, opponent, false);
        delete privateRooms[code];
    });

    // --- IN-GAME ACTIONS ---
    socket.on('play_move', (data) => {
        const roomId = playerToRoom[userId];
        const game = activeGames[roomId];
        if (!game || game.currentTurn !== userId) return;

        const stone = data.stone;
        const side = data.side; // 'left', 'right', or 'any'

        // Server-side validation
        let canPlay = false;
        let finalStone = [...stone];

        if (game.board.stones.length === 0) {
            canPlay = true;
        } else {
            if (side === 'left') {
                if (stone[0] === game.board.left) { finalStone = [stone[1], stone[0]]; canPlay = true; }
                else if (stone[1] === game.board.left) { finalStone = [stone[0], stone[1]]; canPlay = true; }
            } else {
                if (stone[0] === game.board.right) { finalStone = [stone[0], stone[1]]; canPlay = true; }
                else if (stone[1] === game.board.right) { finalStone = [stone[1], stone[0]]; canPlay = true; }
            }
        }

        if (canPlay) {
            // Update Board
            if (game.board.stones.length === 0) {
                game.board.left = finalStone[0];
                game.board.right = finalStone[1];
                game.board.stones.push({ v: finalStone, side: 'center' });
            } else if (side === 'left') {
                game.board.left = finalStone[0];
                game.board.stones.unshift({ v: finalStone, side: 'left' });
            } else {
                game.board.right = finalStone[1];
                game.board.stones.push({ v: finalStone, side: 'right' });
            }

            // Remove from hand
            game.hands[userId] = game.hands[userId].filter(s => !(s[0] === stone[0] && s[1] === stone[1]));
            game.stonesPlayed++;

            // Check Win
            if (game.hands[userId].length === 0) {
                endGame(roomId, userId, 'win');
                return;
            }

            // Check Blocked
            if (isGameBlocked(game)) {
                const p1Id = game.players[0].id;
                const p2Id = game.players[1].id;
                const score1 = game.hands[p1Id].reduce((a, b) => a + b[0] + b[1], 0);
                const score2 = game.hands[p2Id].reduce((a, b) => a + b[0] + b[1], 0);
                const winnerId = score1 < score2 ? p1Id : p2Id;
                endGame(roomId, winnerId, 'block');
                return;
            }

            // Next Turn
            game.currentTurn = game.players.find(p => p.id !== userId).id;
            io.to(roomId).emit('game_update', game);
        }
    });

    socket.on('get_leaderboard', async () => {
        const top10 = await User.find({}).sort({ elo: -1 }).limit(10);
        const allUsers = await User.find({}).sort({ elo: -1 });
        const myRank = allUsers.findIndex(u => u.telegramId === userId) + 1;
        socket.emit('profile_sync', { leaderboard: top10, myRank });
    });

    socket.on('disconnect', () => {
        // Find if user was in a game
        const roomId = playerToRoom[userId];
        if (roomId && activeGames[roomId]) {
            const game = activeGames[roomId];
            // Wait for reconnect or declare loss after timeout
            setTimeout(async () => {
                const sockets = await io.in(roomId).fetchSockets();
                if (sockets.length < 2 && activeGames[roomId]) {
                    const opponentId = game.players.find(p => p.id !== userId).id;
                    endGame(roomId, opponentId, 'leave');
                }
            }, 10000); // 10 seconds grace period
        }
    });
});

async function startGame(roomId, p1, p2, isRanked) {
    const pack = generatePack();
    const game = {
        id: roomId,
        isRanked,
        players: [{ id: p1.userId, name: p1.name }, { id: p2.userId, name: p2.name }],
        hands: {
            [p1.userId]: pack.splice(0, 7),
            [p2.userId]: pack.splice(0, 7)
        },
        board: { left: null, right: null, stones: [] },
        currentTurn: p1.userId,
        stonesPlayed: 0
    };

    activeGames[roomId] = game;
    playerToRoom[p1.userId] = roomId;
    playerToRoom[p2.userId] = roomId;

    io.to(p1.socketId).emit('game_start', { hand: game.hands[p1.userId], opponent: p2, board: game.board });
    io.to(p2.socketId).emit('game_start', { hand: game.hands[p2.userId], opponent: p1, board: game.board });

    io.to(p1.socketId).socketsJoin(roomId);
    io.to(p2.socketId).socketsJoin(roomId);

    io.to(roomId).emit('game_update', game);
}

async function endGame(roomId, winnerId, reason) {
    const game = activeGames[roomId];
    if (!game) return;

    const loserId = game.players.find(p => p.id !== winnerId).id;
    let eloChange = 0;

    if (game.isRanked) {
        if (reason === 'leave') {
            const progress = game.stonesPlayed / 14;
            eloChange = progress < 0.5 ? 20 : 10;
        } else {
            eloChange = 12 + Math.floor(Math.random() * 9); // Win range
        }

        const winUser = await User.findOne({ telegramId: winnerId });
        const loseUser = await User.findOne({ telegramId: loserId });

        if (winUser) winUser.elo += eloChange;
        if (loseUser) loseUser.elo = Math.max(0, loseUser.elo - eloChange);

        await winUser?.save();
        await loseUser?.save();
    }

    const winnerName = game.players.find(p => p.id === winnerId).name;
    io.to(roomId).emit('game_over', { winnerId, winnerName, reason, eloChange });

    // Cleanup
    delete playerToRoom[winnerId];
    delete playerToRoom[loserId];
    delete activeGames[roomId];
}

function isGameBlocked(game) {
    const L = game.board.left;
    const R = game.board.right;

    for (const pid of game.players.map(p => p.id)) {
        for (const s of game.hands[pid]) {
            if (s[0] === L || s[1] === L || s[0] === R || s[1] === R) return false;
        }
    }
    return true;
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
