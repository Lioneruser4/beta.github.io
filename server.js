// Dosya Adı: server.js
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

// Level'a göre bomba sayısını belirleyen fonksiyon
function getBombCount(level) {
    if (level === 1) return 2;
    if (level === 2) return 3;
    if (level === 3) return 4;
    return 2;
}

// Rastgele bomba indexleri seçen fonksiyon
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

const LEVELS_SIZE = [12, 16, 20]; // Board boyutları

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
        
        // OTOMATİK BOMBA SEÇİMİ
        room.hostBombs = selectRandomBombs(boardSize, bombCount);
        room.guestBombs = selectRandomBombs(boardSize, bombCount);

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        // Oyun Başlangıcı Sinyali (Bomba verileri ile birlikte)
        io.to(code).emit('gameStart', {
            players, 
            hostBombs: room.hostBombs,
            guestBombs: room.guestBombs,
            level: level
        });
    });

    socket.on('gameData', (data) => {
        const code = data.roomCode;
        if (code) {
            // Hareketi sadece rakibe ilet
            socket.to(code).emit('gameData', data);
        }
    });

    socket.on('nextLevel', (data) => {
        const { roomCode, newLevel } = data;
        const room = rooms[roomCode];
        
        if (room) {
            room.currentLevel = newLevel;

            // Yeni Seviye için OTOMATİK bomba seçimi
            const boardSize = LEVELS_SIZE[newLevel - 1];
            const bombCount = getBombCount(newLevel);
            
            room.hostBombs = selectRandomBombs(boardSize, bombCount);
            room.guestBombs = selectRandomBombs(boardSize, bombCount);
            
            // Tüm odaya yeni seviye ve bomba bilgilerini ilet
            io.to(roomCode).emit('nextLevel', { 
                newLevel,
                hostBombs: room.hostBombs,
                guestBombs: room.guestBombs
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
