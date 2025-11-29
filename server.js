const { WebSocketServer } = require('ws');
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require("socket.io");

const app = express();
app.use(cors());
const server = http.createServer(app);

// MongoDB Bağlantısı (Bu örnekte kullanılmıyor ama gelecekteki özellikler için kalabilir)
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB bağlantısı başarılı.'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const playerSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, default: 'Oyuncu' },
    firstName: { type: String },
    lastName: { type: String },
    elo: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
});

const matchSchema = new mongoose.Schema({
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    isDraw: { type: Boolean, default: false },
    player1EloChange: { type: Number },
    player2EloChange: { type: Number },
    eloChange: { type: Number },
    createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', playerSchema);
const Match = mongoose.model('Match', matchSchema);

// Oyuncu oluşturma veya bulma fonksiyonu
async function findOrCreatePlayer(playerData) {
    if (!playerData || !playerData.telegramId) return null;
    const { telegramId, username, firstName, lastName } = playerData;

    let player = await Player.findOne({ telegramId });
    if (!player) {
        player = new Player({ telegramId, username, firstName, lastName });
        await player.save();
        console.log(`✨ Yeni oyuncu veritabanına eklendi: ${telegramId}`);
    } else {
        // Kullanıcı adını veya diğer bilgileri güncelle
        let updated = false;
        if (username && player.username !== username) { player.username = username; updated = true; }
        if (firstName && player.firstName !== firstName) { player.firstName = firstName; updated = true; }
        if (lastName && player.lastName !== lastName) { player.lastName = lastName; updated = true; }
        
        if (updated) {
            await player.save();
            console.log(`🔄 Oyuncu bilgisi güncellendi: ${telegramId}`);
        }
    }
    return player;
}

// ELO Hesaplama
function calculateEloChange() {
    return { winnerGain: 15, loserLoss: -10 };
}

// Seviye Hesaplama (Her 100 ELO'da 1 seviye, maks 10)
function calculateLevel(elo) {
    const level = Math.floor(elo / 100) + 1;
    return Math.min(level, 10); // Seviyeyi 10 ile sınırla
}

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Domino Oyun Sunucusu',
        players: wss.clients.size
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/auth/telegram', async (req, res) => {
    try {
        const player = await findOrCreatePlayer(req.body);
        if (player) {
            res.json({ success: true, player });
        } else {
            res.status(400).json({ success: false, message: 'Gerekli bilgi eksik' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Sunucu hatası' });
    }
});

// Skor Tablosu Endpoint'i
app.get('/leaderboard', async (req, res) => {
    try {
        const players = await Player.find({})
            .sort({ elo: -1 })
            .select('username elo level')
            .limit(100); // En iyi 100 oyuncuyu göster

        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası' });
    }
});

const rooms = {};
const matchQueue = [];
const playerConnections = new Map(); // playerId -> ws

// --- YARDIMCI FONKSİYONLAR ---

function generateId() {
    return Math.random().toString(36).substr(2, 9);
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
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function initializeGame(player1, player2) {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14);

    let startingPlayerId = player1.id;
    let highestDouble = -1;

    // En yüksek çifti bulan başlar
    for (const p of [player1, player2]) {
        const hand = p.id === player1.id ? player1Hand : player2Hand;
        for (const tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayerId = p.id;
            }
        }
    }

    return {
        board: [],
        players: {
            [player1.id]: { id: player1.id, name: player1.name, hand: player1Hand },
            [player2.id]: { id: player2.id, name: player2.name, hand: player2Hand }
        },
        market: market,
        currentPlayer: startingPlayerId,
        turn: 1,
        lastMove: null
    };
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile.includes(leftEnd) || tile.includes(rightEnd);
}

function checkWinner(gameState) {
    // Elini bitiren kazanır
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            return { winnerId: playerId, reason: 'Elini bitirdi' };
        }
    }

    // Oyun kilitlendi mi?
    let canAnyonePlay = false;
    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (player.hand.some(tile => canPlayTile(tile, gameState.board))) {
            canAnyonePlay = true;
            break;
        }
    }

    if (!canAnyonePlay && gameState.market.length === 0) {
        // Oyun kilitlendi, en az puana sahip olan kazanır
        let minScore = Infinity;
        let winnerId = null;
        let scores = {};

        for (const playerId in gameState.players) {
            const score = gameState.players[playerId].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
            scores[playerId] = score;
            if (score < minScore) {
                minScore = score;
                winnerId = playerId;
            }
        }

        // Eşitlik durumu
        const winners = Object.keys(scores).filter(id => scores[id] === minScore);
        if (winners.length > 1) {
            return { winnerId: 'DRAW', reason: 'Oyun kilitlendi ve puanlar eşit' };
        }

        return { winnerId, reason: 'Oyun kilitlendi, en düşük puan kazandı' };
    }

    return null; // Oyun devam ediyor
}

function broadcastToRoom(roomCode, message, excludePlayerId = null) {
    const room = rooms[roomCode];
    if (!room) return;

    for (const playerId in room.players) {
        if (playerId === excludePlayerId) continue;
        const ws = playerConnections.get(playerId);
        if (ws && ws.readyState === 1) { // WebSocket.OPEN
            ws.send(JSON.stringify(message));
        }
    }
}

function sendToPlayer(playerId, message) {
    const ws = playerConnections.get(playerId);
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

function getGameStateForPlayer(gameState, playerId) {
    const publicState = JSON.parse(JSON.stringify(gameState));
    // Rakibin elini gizle, sadece sayısını göster
    for (const pId in publicState.players) {
        if (pId !== playerId) {
            publicState.players[pId].hand = { length: publicState.players[pId].hand.length };
        }
    }
    publicState.playerId = playerId;
    return publicState;
}

// --- WEBSOCKET EVENTLERİ ---

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.id = generateId();
    console.log(`✅ Yeni bir kullanıcı bağlandı: ${ws.id}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(ws, data);
        } catch (error) {
            console.error('Mesaj işlenirken hata:', error);
        }
    });

    ws.on('close', () => {
        console.log(`🔌 Kullanıcı ayrıldı: ${ws.id}`);
        handleDisconnect(ws);
    });
});

function handleClientMessage(ws, data) {
    switch (data.type) {
        case 'findMatch':
            handleFindMatch(ws, data);
            break;
        case 'cancelSearch':
            handleCancelSearch(ws);
            break;
        case 'playTile':
            handlePlayTile(ws, data);
            break;
        case 'drawFromMarket':
            handleDrawFromMarket(ws);
            break;
    }
}

function handleFindMatch(ws, playerData) {
    ws.playerData = { ...playerData, id: ws.id, name: playerData.username };
    playerConnections.set(ws.id, ws);

    const existingInQueue = matchQueue.find(p => p.id === ws.id);
    if (existingInQueue) {
        return sendToPlayer(ws.id, { type: 'error', message: 'Zaten rakip arıyorsunuz.' });
    }

    matchQueue.push(ws);
    console.log(`🔍 ${ws.playerData.name} kuyruğa katıldı. Kuyruk: ${matchQueue.length}`);
    sendToPlayer(ws.id, { type: 'searchStatus', message: 'Rakip aranıyor...' });

    if (matchQueue.length >= 2) {
        const player1Ws = matchQueue.shift();
        const player2Ws = matchQueue.shift();
        const roomCode = generateId();

        const room = {
            code: roomCode,
            players: {
                [player1Ws.id]: player1Ws.playerData,
                [player2Ws.id]: player2Ws.playerData
            },
            gameState: initializeGame(player1Ws.playerData, player2Ws.playerData),
            type: (player1Ws.playerData.isGuest || player2Ws.playerData.isGuest) ? 'casual' : 'ranked'
        };
        rooms[roomCode] = room;

        player1Ws.roomCode = roomCode;
        player2Ws.roomCode = roomCode;

        console.log(`🎉 Eşleşme bulundu: ${player1Ws.playerData.name} vs ${player2Ws.playerData.name}`);

        sendToPlayer(player1Ws.id, { type: 'matchFound', opponent: player2Ws.playerData, gameType: room.type });
        sendToPlayer(player2Ws.id, { type: 'matchFound', opponent: player1Ws.playerData, gameType: room.type });

        setTimeout(() => {
            sendToPlayer(player1Ws.id, { type: 'gameStart', gameState: getGameStateForPlayer(room.gameState, player1Ws.id) });
            sendToPlayer(player2Ws.id, { type: 'gameStart', gameState: getGameStateForPlayer(room.gameState, player2Ws.id) });
        }, 500);
    }
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.id === ws.id);
    if (index > -1) {
        matchQueue.splice(index, 1);
        console.log(`🚫 ${ws.playerData.name} aramayı iptal etti.`);
        sendToPlayer(ws.id, { type: 'searchCancelled' });
    }
}

function handlePlayTile(ws, data) {
    const room = rooms[ws.roomCode];
    if (!room || room.gameState.currentPlayer !== ws.id) return;

    const { tileIndex, position } = data;
    const playerHand = room.gameState.players[ws.id].hand;
    const tile = playerHand[tileIndex];

    if (!tile) return;

    const board = room.gameState.board;
    let played = false;

    if (board.length === 0) {
        board.push(tile);
        played = true;
    } else {
        const leftEnd = board[0][0];
        const rightEnd = board[board.length - 1][1];

        if (position === 'left') {
            if (tile[1] === leftEnd) { board.unshift(tile); played = true; }
            else if (tile[0] === leftEnd) { board.unshift([tile[1], tile[0]]); played = true; }
        } else if (position === 'right') {
            if (tile[0] === rightEnd) { board.push(tile); played = true; }
            else if (tile[1] === rightEnd) { board.push([tile[1], tile[0]]); played = true; }
        }
    }

    if (played) {
        playerHand.splice(tileIndex, 1);
        room.gameState.turn++;
        room.gameState.currentPlayer = Object.keys(room.players).find(id => id !== ws.id);

        const winnerInfo = checkWinner(room.gameState);
        if (winnerInfo) {
            handleGameEnd(ws.roomCode, winnerInfo);
        } else {
            broadcastToRoom(ws.roomCode, { type: 'gameUpdate', gameState: getGameStateForPlayer(room.gameState, null) });
        }
    } else {
        sendToPlayer(ws.id, { type: 'error', message: 'Geçersiz hamle' });
    }
}

function handleDrawFromMarket(ws) {
    const room = rooms[ws.roomCode];
    if (!room || room.gameState.currentPlayer !== ws.id) return;

    const player = room.gameState.players[ws.id];
    const canPlay = player.hand.some(tile => canPlayTile(tile, room.gameState.board));

    if (canPlay) {
        return sendToPlayer(ws.id, { type: 'error', message: 'Oynanabilir taşınız varken pazardan çekemezsiniz.' });
    }

    if (room.gameState.market.length > 0) {
        const drawnTile = room.gameState.market.shift();
        player.hand.push(drawnTile);
        broadcastToRoom(ws.roomCode, { type: 'gameUpdate', gameState: getGameStateForPlayer(room.gameState, null) });
    } else {
        // Pazar boş ve oynayacak taşı yok, pas geçmeli
        room.gameState.turn++;
        room.gameState.currentPlayer = Object.keys(room.players).find(id => id !== ws.id);

        const winnerInfo = checkWinner(room.gameState);
        if (winnerInfo) {
            handleGameEnd(ws.roomCode, winnerInfo);
        } else {
            broadcastToRoom(ws.roomCode, { type: 'gameUpdate', gameState: getGameStateForPlayer(room.gameState, null) });
        }
    }
}

function handleDisconnect(ws) {
    playerConnections.delete(ws.id);
    handleCancelSearch(ws);

    if (ws.roomCode) {
        const room = rooms[ws.roomCode];
        if (room) {
            const winnerId = Object.keys(room.players).find(id => id !== ws.id);
            handleGameEnd(ws.roomCode, { winnerId, reason: 'Rakip oyundan ayrıldı' });
        }
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu ${PORT} portunda çalışıyor.`);
});
async function handleGameEnd(roomCode, { winnerId, reason }) {
    const room = rooms[roomCode];
    if (!room) return;

    const isDraw = winnerId === 'DRAW';
    const winnerName = isDraw ? 'Beraberlik' : room.players[winnerId]?.name;
    console.log(`🏁 Oyun bitti: ${roomCode}. Kazanan: ${winnerName}. Sebep: ${reason}`);

    let eloChangeInfo = null;

    if (room.type === 'ranked' && !isDraw) {
        const loserId = Object.keys(room.players).find(id => id !== winnerId);
        const winnerData = room.players[winnerId];
        const loserData = room.players[loserId];

        const winnerDB = await Player.findOne({ telegramId: winnerData.telegramId });
        const loserDB = await Player.findOne({ telegramId: loserData.telegramId });

        if (winnerDB && loserDB) {
            const { winnerGain, loserLoss } = calculateEloChange();
            
            winnerDB.elo += winnerGain;
            loserDB.elo = Math.max(0, loserDB.elo + loserLoss); // ELO'nun 0'ın altına düşmesini engelle

            winnerDB.level = calculateLevel(winnerDB.elo);
            loserDB.level = calculateLevel(loserDB.elo);

            await winnerDB.save();
            await loserDB.save();

            eloChangeInfo = { winner: { id: winnerId, change: winnerGain }, loser: { id: loserId, change: loserLoss } };
            console.log(`📈 ELO güncellendi: ${winnerData.name} +${winnerGain}, ${loserData.name} ${loserLoss}`);
        }
    }

    broadcastToRoom(roomCode, {
        type: 'gameEnd',
        winnerId,
        winnerName,
        reason,
        isRanked: room.type === 'ranked',
        eloChange: eloChangeInfo
    });

    delete rooms[roomCode];
}
    const piece = room.board[from.r][from.c];
    room.board[to.r][to.c] = piece;
    room.board[from.r][from.c] = 0;

    // Taş yeme mantığı
    if (Math.abs(from.r - to.r) === 2) {
        const capturedR = (from.r + to.r) / 2;
        const capturedC = (from.c + to.c) / 2;
        room.board[capturedR][capturedC] = 0;
    }

    // Dama olma mantığı
    if (playerColor === 'red' && to.r === BOARD_SIZE - 1) room.board[to.r][to.c] = 3; // Kırmızı dama
    if (playerColor === 'white' && to.r === 0) room.board[to.r][to.c] = 4; // Beyaz dama

    // Sırayı değiştir
    room.currentTurn = (playerColor === 'red') ? 'white' : 'red';

    // Oyun bitiş kontrolü
    const winner = checkWinner(room.board, room.currentTurn);
    if (winner) {
        io.to(roomCode).emit('gameOver', { winner });
        delete rooms[roomCode];
    } else {
        io.to(roomCode).emit('gameUpdate', { board: room.board, currentTurn: room.currentTurn });
    }
});

socket.on('leaveGame', ({ roomCode }) => {
    handleDisconnect(socket, roomCode);
});

socket.on('disconnect', () => {
    console.log(`🔌 Kullanıcı ayrıldı: ${socket.id}`);
    // Kullanıcının olduğu odayı bul ve rakibe haber ver
    for (const roomCode in rooms) {
        if (rooms[roomCode].players[socket.id]) {
            handleDisconnect(socket, roomCode);
            break;
        }
    }
    // Eşleşme kuyruğundan çıkar
    const index = matchQueue.findIndex(s => s.id === socket.id);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`🚫 ${socket.id} bağlantı kesintisiyle kuyruktan çıkarıldı.`);
    }
});

});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dama Sunucusu ${PORT} portunda çalışıyor.`);
});

// --- OYUN MANTIK FONKSİYONLARI ---

function createInitialBoard() {
    const board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        board[r] = new Array(BOARD_SIZE).fill(0);
        for (let c = 0; c < BOARD_SIZE; c++) {
            if ((r + c) % 2 !== 0) { // Sadece siyah kareler
                if (r < 3) {
                    board[r][c] = 1; // Kırmızı oyuncu (piece-black)
                } else if (r > 4) {
                    board[r][c] = 2; // Beyaz oyuncu (piece-white)
                }
            }
        }
    }
    return board;
}

function getPiecePlayer(pieceValue) {
    if (pieceValue === 1 || pieceValue === 3) return 'red';
    if (pieceValue === 2 || pieceValue === 4) return 'white';
    return null;
}

function checkWinner(board, nextTurn) {
    let redPieces = 0;
    let whitePieces = 0;
    let redMoves = 0;
    let whiteMoves = 0;

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece === 0) continue;

            const player = getPiecePlayer(piece);
            if (player === 'red') {
                redPieces++;
                if (findValidMoves(board, r, c, 'red').length > 0) redMoves++;
            } else if (player === 'white') {
                whitePieces++;
                if (findValidMoves(board, r, c, 'white').length > 0) whiteMoves++;
            }
        }
    }

    if (redPieces === 0) return 'white';
    if (whitePieces === 0) return 'red';

    if (nextTurn === 'red' && redMoves === 0) return 'white'; // Kırmızının sırası ama hamlesi yok
    if (nextTurn === 'white' && whiteMoves === 0) return 'red'; // Beyazın sırası ama hamlesi yok

    return null; // Oyun devam ediyor
}

// Bu fonksiyonlar istemcidekiyle aynı olmalı
function findValidMoves(board, r, c, player) {
    const moves = [];
    const piece = board[r][c];
    const isKing = piece === 3 || piece === 4;

    const directions = isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
        (player === 'red' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]);

    // Zıplama hamleleri önceliklidir
    const jumps = findJumps(board, r, c, player);
    if (jumps.length > 0) return jumps;

    for (const [dr, dc] of directions) {
        const newR = r + dr;
        const newC = c + dc;
        if (isValidCell(newR, newC) && board[newR][newC] === 0) {
            moves.push({ from: { r, c }, to: { r: newR, c: newC } });
        }
    }
    return moves;
}

function findJumps(board, r, c, player) {
    const jumps = [];
    const piece = board[r][c];
    const isKing = piece === 3 || piece === 4;
    const opponentPlayer = player === 'red' ? 'white' : 'red';

    const directions = isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
        (player === 'red' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]]);

    for (const [dr, dc] of directions) {
        const capturedR = r + dr;
        const capturedC = c + dc;
        const landR = r + 2 * dr;
        const landC = c + 2 * dc;

        if (isValidCell(landR, landC) && board[landR][landC] === 0) {
            const capturedPiece = board[capturedR] ? board[capturedR][capturedC] : 0;
            if (getPiecePlayer(capturedPiece) === opponentPlayer) {
                jumps.push({ from: { r, c }, to: { r: landR, c: landC }, captured: { r: capturedR, c: capturedC } });
            }
        }
    }
    return jumps;
}

function isValidCell(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function handleDisconnect(socket, roomCode) {
    const room = rooms[roomCode];
    if (room) {
        // Rakibe oyunun bittiğini haber ver
        const opponentColor = room.players[socket.id] === 'red' ? 'white' : 'red';
        io.to(roomCode).emit('gameOver', { winner: opponentColor, reason: 'Rakip oyundan ayrıldı.' });
        console.log(`👋 ${socket.id}, ${roomCode} odasından ayrıldı. Oyun bitti.`);
        delete rooms[roomCode];
    }
}

// MongoDB şemaları ve API endpoint'leri bu dosyanın geri kalanında yer alabilir.
// Bu örnekte sadece oyun mantığına odaklanılmıştır.
const mongoose = require('mongoose');
