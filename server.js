// Dosya Adı: server.js (SON TEMİZ TASARIM)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const rooms = {};

// Yardımcı fonksiyonlar (Aynı)
function getBombCount(level) {
    if (level === 1) return 2;
    if (level === 2) return 3;
    if (level === 3) return 4;
    return 2;
}

function selectRandomBombs(boardSize, bombCount) {
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, bombCount);
}

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

const LEVELS_SIZE = [12, 16, 20]; 

io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null, 
            guestUsername: null, 
            currentLevel: 1,
            hostBombs: null, 
            guestBombs: null, 
            currentTurn: 0, 
        };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        const level = room.currentLevel;
        const boardSize = LEVELS_SIZE[level - 1];
        const bombCount = getBombCount(level);
        
        room.hostBombs = selectRandomBombs(boardSize, bombCount);
        room.guestBombs = selectRandomBombs(boardSize, bombCount);

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', {
            players, 
            hostBombs: room.hostBombs,
            guestBombs: room.guestBombs,
            level: level,
            initialTurn: room.currentTurn, 
        });
    });

    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        const isHostPlayer = socket.id === room.hostId;
        const expectedTurn = isHostPlayer ? 0 : 1;

        if (room.currentTurn !== expectedTurn) {
             // Sırası olmayan hamle yapamaz
             return; 
        }
        
        // 1. Hareketi her iki istemciye de gönder
        io.to(data.roomCode).emit('playerMove', {
            cardIndex: data.cardIndex,
        });
        
        // 2. Sırayı sunucuda değiştir
        room.currentTurn = room.currentTurn === 0 ? 1 : 0;
        
        // 3. Yeni sıra bilgisini tüm client'lara gönder
        io.to(data.roomCode).emit('turnChange', { newTurn: room.currentTurn });
    });

    socket.on('nextLevel', (data) => {
        const { roomCode, newLevel } = data;
        const room = rooms[roomCode];
        
        if (room) {
            room.currentLevel = newLevel;
            const boardSize = LEVELS_SIZE[newLevel - 1];
            const bombCount = getBombCount(newLevel);
            
            room.hostBombs = selectRandomBombs(boardSize, bombCount);
            room.guestBombs = selectRandomBombs(boardSize, bombCount);
            room.currentTurn = 0; 

            io.to(roomCode).emit('nextLevel', { 
                newLevel,
                hostBombs: room.hostBombs,
                guestBombs: room.guestBombs,
                initialTurn: 0,
            });
        }
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                if (room.hostId === socket.id) {
                    delete rooms[code];
                } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
