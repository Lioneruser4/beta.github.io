// Dosya Adı: server.js (BOMBALI HAFIZA OYUNU V4 - EŞ ZAMANLI + CHAT + RENDER PORT)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Statik dosyaları (index.html, game.js) sunmak için
app.use(express.static(__dirname));

const io = new Server(server, {
    // CORS ayarları Render için genellikle gereklidir
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'] // WebSocket başarısız olursa Polling'e geçer
});

const rooms = {};

// --- Sabitler ---
const BOARD_SIZE = 20; 
const BOMB_COUNT = 4;   
const DEFAULT_LIVES = 2; 

function selectRandomBombs(boardSize, bombCount) {
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, bombCount).sort((a, b) => a - b);
}

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) { code = Math.random().toString(36).substring(2, 6).toUpperCase(); }
    return code;
}

function initializeRoom(room) {
    room.hostBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.guestBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.hostLives = DEFAULT_LIVES;
    room.guestLives = DEFAULT_LIVES;
    room.board = Array(BOARD_SIZE).fill(false);
    room.cardsLeft = BOARD_SIZE;
    room.gameActive = true;
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = { code, playerCount: 1, hostId: socket.id, hostUsername: username, guestId: null, guestUsername: null };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) { socket.emit('joinFailed', `HATA: ${code} kodlu oda bulunamadı.`); return; }
        if (room.playerCount >= 2) { socket.emit('joinFailed', `HATA: ${code} kodlu oda zaten dolu.`); return; }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        
        initializeRoom(room);
        socket.join(code);
        
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', {
            players, 
            hostBombs: room.hostBombs,
            guestBombs: room.guestBombs,
            boardSize: BOARD_SIZE,
            initialLives: DEFAULT_LIVES
        });
    });

    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive) return;

        const { cardIndex } = data;
        
        const isHostPlayer = socket.id === room.hostId;
        const playerName = isHostPlayer ? room.hostUsername : room.guestUsername;

        if (room.board[cardIndex]) {
             socket.emit('infoMessage', { message: 'Kart zaten açık.', isError: true });
             return; 
        }
        
        room.board[cardIndex] = true;
        room.cardsLeft--;
        
        let moveResult = { cardIndex, hitBomb: false, gameOver: false, winner: null, moverName: playerName };

        const opponentBombs = isHostPlayer ? room.guestBombs : room.hostBombs;
        
        if (opponentBombs.includes(cardIndex)) {
            moveResult.hitBomb = true;
            
            if (isHostPlayer) { room.hostLives--; } else { room.guestLives--; }

            if (room.hostLives <= 0 || room.guestLives <= 0) {
                 room.gameActive = false;
                 moveResult.gameOver = true;
                 moveResult.winner = room.hostLives <= 0 && room.guestLives <= 0 ? 'DRAW' : room.hostLives <= 0 ? 'Guest' : 'Host';
            }
        }
        
        if (room.cardsLeft === 0 && !moveResult.gameOver) {
            room.gameActive = false;
            moveResult.gameOver = true;
            moveResult.winner = room.hostLives === room.guestLives ? 'DRAW' : room.hostLives > room.guestLives ? 'Host' : 'Guest';
        }

        io.to(data.roomCode).emit('gameStateUpdate', { moveResult, hostLives: room.hostLives, guestLives: room.guestLives, cardsLeft: room.cardsLeft });
    });

    // --- SOHBET OLAYI ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.hostId || !room.guestId) return;

        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;

        io.to(data.roomCode).emit('newMessage', {
            sender: senderName,
            text: data.message
        });
    });
    // ----------------------

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.'); }
                
                if (room.hostId === socket.id) { delete rooms[code]; } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1; room.guestId = null; room.guestUsername = null;
                }
            }
        }
    });
});

// Render'ın kullandığı portu otomatik olarak alır, bulamazsa 10000 kullanır
const PORT = process.env.PORT || 10000; 
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
