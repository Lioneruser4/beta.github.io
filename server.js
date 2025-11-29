const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require("socket.io");

const app = express();
app.use(cors());
const server = http.createServer(app);

// MongoDB Bağlantısı
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB bağlantısı başarılı.'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const io = new Server(server, {
    cors: {
        origin: "*", // Geliştirme için tüm kaynaklara izin ver, canlıda kısıtla
        methods: ["GET", "POST"]
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Dama Socket.IO Sunucusu',
        players: io.engine.clientsCount
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const rooms = {};
const matchQueue = [];
const BOARD_SIZE = 8;

// --- YARDIMCI FONKSİYONLAR ---

function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return shuffleArray(tiles);
}

// --- WEBSOCKET EVENTLERİ ---

io.on('connection', (socket) => {
    console.log(`✅ Yeni bir kullanıcı bağlandı: ${socket.id}`);

// --- OYUN MANTIKLARI ---

function handleFindMatch(ws, data) {
    if (ws.playerId && playerConnections.has(ws.playerId)) {
        const existingInQueue = matchQueue.find(p => p.playerId === ws.playerId);
        if (existingInQueue) {
            return socket.emit('error', 'Zaten bir rakip arıyorsunuz.');
        }
        if (ws.roomCode) {
            return socket.emit('error', 'Zaten bir odadasınız.');
        }
    }

    matchQueue.push(socket);
    console.log(`🔍 ${socket.id} dereceli eşleşme kuyruğuna katıldı. Kuyruktaki kişi sayısı: ${matchQueue.length}`);
    socket.emit('searchStatus', { message: 'Rakip aranıyor...' });

    if (matchQueue.length >= 2) {
        const player1 = matchQueue.shift();
        const player2 = matchQueue.shift();
        const roomCode = `r_${Math.random().toString(36).substr(2, 5)}`;

        console.log(`🎉 Eşleşme bulundu! ${player1.id} ve ${player2.id}, ${roomCode} odasında eşleşti.`);

        player1.join(roomCode);
        player2.join(roomCode);

        rooms[roomCode] = {
            players: {
                [player1.id]: 'red',
                [player2.id]: 'white'
            },
            board: createInitialBoard(),
            currentTurn: 'red'
        };

        player1.emit('matchFound', { roomCode, color: 'red' });
        player2.emit('matchFound', { roomCode, color: 'white' });
    }
});

socket.on('cancelSearch', () => {
    const index = matchQueue.findIndex(s => s.id === socket.id);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`🚫 ${socket.id} aramayı iptal etti. Kuyrukta kalan: ${matchQueue.length}`);
        socket.emit('searchCancelled', { message: 'Arama iptal edildi.' });
    }
});

socket.on('createRoom', ({ roomCode }) => {
    if (rooms[roomCode]) {
        return socket.emit('error', 'Bu oda kodu zaten kullanılıyor.');
    }
    socket.join(roomCode);
    rooms[roomCode] = {
        players: { [socket.id]: 'red' },
        board: null, // Oyun rakip katılınca başlayacak
        currentTurn: 'red'
    };
    console.log(`🏠 ${socket.id} tarafından ${roomCode} odası oluşturuldu.`);
    socket.emit('roomCreated', { roomCode });
});

socket.on('joinRoom', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
        return socket.emit('error', 'Oda bulunamadı.');
    }
    if (Object.keys(room.players).length >= 2) {
        return socket.emit('error', 'Oda dolu.');
    }

    socket.join(roomCode);
    room.players[socket.id] = 'white';
    room.board = createInitialBoard(); // Oyun şimdi başlıyor

    console.log(`🚪 ${socket.id}, ${roomCode} odasına katıldı. Oyun başlıyor.`);
    io.to(roomCode).emit('opponentJoined');
    io.to(roomCode).emit('gameUpdate', { board: room.board, currentTurn: room.currentTurn });
});

socket.on('makeMove', ({ roomCode, from, to }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Oyun odası bulunamadı.');

    const playerColor = room.players[socket.id];
    if (room.currentTurn !== playerColor) {
        return socket.emit('error', 'Sıra sizde değil.');
    }

    // Burada hamlenin geçerliliği sunucu tarafında da kontrol edilmeli.
    // Şimdilik istemciye güveniyoruz ama canlı bir ortamda bu büyük bir güvenlik açığıdır.
    // Basit bir hamle mantığı:
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
