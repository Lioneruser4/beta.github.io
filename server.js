/**
 * DOMINO ELITE PRO - SERVER (v4.4)
 * Türkçe Kural Seti - Global Domino Mantığı - ELO Sıfırlama
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const MONGO_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
const PORT = process.env.PORT || 3000;

// Veritabanı Bağlantısı
mongoose.connect(MONGO_URI).then(() => console.log('MongoDB Bağlandı')).catch(e => console.log('DB Hatası:', e));

const UserSchema = new mongoose.Schema({
    telegramId: String,
    name: { type: String, default: 'Oyuncu' },
    photo: String,
    elo: { type: Number, default: 0 },
    resetDone: { type: Boolean, default: false } // ELO Sıfırlama kontrolü
});
const User = mongoose.model('User', UserSchema);

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const mmQueue = [];
const activeGames = {};
const playerToRoom = {};
const privateRooms = {};

io.on('connection', async (socket) => {
    const { id: userId, name, photo } = socket.handshake.query;
    if (!userId) return;

    // Kullanıcı Kaydı ve ELO Sıfırlama Mantığı
    let user = await User.findOne({ telegramId: userId });
    if (!user) {
        user = new User({ telegramId: userId, name, photo, elo: 0, resetDone: true });
        await user.save();
    } else {
        // Kullanıcı isteği üzerine tüm ELO'ları sıfırla (Bir kerelik)
        if (!user.resetDone) {
            user.elo = 0;
            user.resetDone = true;
            await user.save();
        }
        user.name = name || user.name;
        user.photo = photo || user.photo;
        await user.save();
    }

    socket.emit('profile_sync', { name: user.name, photo: user.photo, elo: user.elo });

    socket.on('check_rejoin', () => {
        const rid = playerToRoom[userId];
        if (rid && activeGames[rid]) {
            socket.join(rid);
            const g = activeGames[rid];
            socket.emit('game_start', { hand: g.hands[userId], opponent: g.players.find(p => p.id !== userId), board: g.board });
            socket.emit('game_update', g);
        }
    });

    socket.on('join_mm', () => {
        if (mmQueue.find(p => p.id === userId)) return;
        mmQueue.push({ socketId: socket.id, id: userId, name: user.name, photo: user.photo, elo: user.elo });
        socket.emit('mm_status', 'searching');
        if (mmQueue.length >= 2) {
            const p1 = mmQueue.shift();
            const p2 = mmQueue.shift();
            startMatch(`match_${Date.now()}`, p1, p2, true);
        }
    });

    socket.on('cancel_mm', () => {
        const idx = mmQueue.findIndex(p => p.id === userId);
        if (idx > -1) mmQueue.splice(idx, 1);
        socket.emit('mm_status', 'idle');
    });

    socket.on('create_private', () => {
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        privateRooms[code] = { host: { socketId: socket.id, id: userId, name: user.name, photo: user.photo } };
        socket.emit('private_room_created', code);
    });

    socket.on('join_private', (code) => {
        const room = privateRooms[code];
        if (!room) return socket.emit('error_msg', 'Oda Bulunamadı');
        startMatch(`pri_${code}`, room.host, { socketId: socket.id, id: userId, name: user.name, photo: user.photo }, false);
        delete privateRooms[code];
    });

    // --- OYUN HAMLELERİ VE KURALLAR ---
    socket.on('play_move', async (data) => {
        const rid = playerToRoom[userId];
        const g = activeGames[rid];
        if (!g || g.currentTurn !== userId) return;

        const { stone, side } = data;
        let valid = false;
        let finalStone = [...stone];

        // Tahtaya taş koyma mantığı
        if (g.board.stones.length === 0) {
            valid = true;
            g.board.left = finalStone[0];
            g.board.right = finalStone[1];
            g.board.stones.push({ v: finalStone });
        } else {
            if (side === 'left') {
                if (stone[0] === g.board.left) { finalStone = [stone[1], stone[0]]; valid = true; }
                else if (stone[1] === g.board.left) { finalStone = [stone[0], stone[1]]; valid = true; }
                if (valid) { g.board.stones.unshift({ v: finalStone }); g.board.left = finalStone[0]; }
            } else if (side === 'right') {
                if (stone[0] === g.board.right) { finalStone = [stone[0], stone[1]]; valid = true; }
                else if (stone[1] === g.board.right) { finalStone = [stone[1], stone[0]]; valid = true; }
                if (valid) { g.board.stones.push({ v: finalStone }); g.board.right = finalStone[1]; }
            }
        }

        if (valid) {
            g.hands[userId] = g.hands[userId].filter(s => !(s[0] === stone[0] && s[1] === stone[1]));
            g.history.push({ u: userId, s: stone });

            // Kazanma kontrolü
            if (g.hands[userId].length === 0) {
                endMatch(rid, userId, 'win');
                return;
            }

            // Oyunun kilitlenmesi (Global kural)
            if (isGameBlocked(g)) {
                calculateBlockWinner(rid);
                return;
            }

            g.currentTurn = g.players.find(p => p.id !== userId).id;
            io.to(rid).emit('game_update', g);
        }
    });

    socket.on('quit_game', () => {
        const rid = playerToRoom[userId];
        if (rid && activeGames[rid]) {
            const oppId = activeGames[rid].players.find(p => p.id !== userId).id;
            endMatch(rid, oppId, 'quit');
        }
    });

    socket.on('get_leaderboard', async () => {
        const top10 = await User.find({}).sort({ elo: -1 }).limit(10);
        const all = await User.find({}).sort({ elo: -1 });
        const rank = all.findIndex(u => u.telegramId === userId) + 1;
        socket.emit('profile_sync', { leaderboard: top10, myRank: rank });
    });

    socket.on('disconnect', () => {
        const rid = playerToRoom[userId];
        if (rid && activeGames[rid]) {
            const g = activeGames[rid];
            setTimeout(() => {
                const currentRid = playerToRoom[userId];
                if (!currentRid || !activeGames[rid]) return;
                const sockets = io.sockets.adapter.rooms.get(rid);
                if (!sockets || sockets.size < 2) {
                    const opp = g.players.find(p => p.id !== userId).id;
                    endMatch(rid, opp, 'leave');
                }
            }, 10000);
        }
    });
});

function startMatch(rid, p1, p2, isRanked) {
    const pack = [];
    for (let i = 0; i <= 6; i++) for (let j = i; j <= 6; j++) pack.push([i, j]);
    pack.sort(() => Math.random() - 0.5);

    const game = {
        id: rid, isRanked,
        players: [{ id: p1.id, name: p1.name }, { id: p2.id, name: p2.name }],
        hands: { [p1.id]: pack.splice(0, 7), [p2.id]: pack.splice(0, 7) },
        boneyard: pack, // Pazar
        board: { stones: [], left: null, right: null },
        currentTurn: p1.id, history: []
    };

    activeGames[rid] = game;
    playerToRoom[p1.id] = rid;
    playerToRoom[p2.id] = rid;

    io.to(p1.socketId).emit('game_start', { hand: game.hands[p1.id], opponent: p2 });
    io.to(p2.socketId).emit('game_start', { hand: game.hands[p2.id], opponent: p1 });

    io.to(p1.socketId).socketsJoin(rid);
    io.to(p2.socketId).socketsJoin(rid);
    io.to(rid).emit('game_update', game);
}

function isGameBlocked(g) {
    const L = g.board.left;
    const R = g.board.right;
    for (const pid in g.hands) {
        for (const s of g.hands[pid]) {
            if (s[0] === L || s[1] === L || s[0] === R || s[1] === R) return false;
        }
    }
    return g.boneyard.length === 0;
}

function calculateBlockWinner(rid) {
    const g = activeGames[rid];
    const scores = {};
    for (const pid in g.hands) {
        scores[pid] = g.hands[pid].reduce((a, b) => a + b[0] + b[1], 0);
    }
    const ids = Object.keys(scores);
    const winId = scores[ids[0]] < scores[ids[1]] ? ids[0] : ids[1];
    endMatch(rid, winId, 'block');
}

async function endMatch(rid, winId, reason) {
    const g = activeGames[rid];
    if (!g) return;

    const loseId = g.players.find(p => p.id !== winId).id;
    let change = 0;

    if (g.isRanked) {
        if (reason === 'quit' || reason === 'leave') change = 20;
        else change = 15 + Math.floor(Math.random() * 6);

        await User.updateOne({ telegramId: winId }, { $inc: { elo: change } });
        await User.updateOne({ telegramId: loseId }, { $inc: { elo: -change } });

        // ELO'nun 0'ın altına düşmemesi ve 1000'i (Level 10) geçmemesi için kısıt (opsiyonel)
        const updatedLose = await User.findOne({ telegramId: loseId });
        if (updatedLose.elo < 0) await User.updateOne({ telegramId: loseId }, { elo: 0 });
        const updatedWin = await User.findOne({ telegramId: winId });
        if (updatedWin.elo > 1000) await User.updateOne({ telegramId: winId }, { elo: 1000 });
    }

    io.to(rid).emit('game_over', {
        winnerId: winId,
        winnerName: g.players.find(p => p.id === winId).name,
        eloChange: change,
        reason: reason
    });

    delete activeGames[rid];
    delete playerToRoom[winId];
    delete playerToRoom[loseId];
}

server.listen(PORT, () => console.log('WARSET AKTIF'));
