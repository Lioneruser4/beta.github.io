// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS Ayarı: GitHub Pages veya Vercel'den gelen bağlantılara izin verir
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const rooms = {}; // Aktif odaları saklar

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

io.on('connection', (socket) => {
    console.log(`[CONNECT] Yeni kullanıcı bağlandı: ${socket.id}`);

    // --- ODA KURMA ---
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
        };
        socket.join(code);
        
        console.log(`[ROOM] Oda Kuruldu: ${code} (Host: ${username})`);
        socket.emit('roomCreated', code);
    });

    // --- ODAYA KATILMA ---
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }

        // Başarılı Katılım
        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        // Her iki oyuncuya da oyunun başladığını ve rollerini bildir
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', players);
        console.log(`[START] Oyun Başladı: ${code}`);
    });

    // --- OYUN İÇİ VERİ AKTARIMI ---
    socket.on('gameData', (data) => {
        const code = data.roomCode;
        if (code) {
            socket.to(code).emit('gameData', data); 
        }
    });

    // --- BAĞLANTI KESİLMESİ / ODADAN AYRILMA ---
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
                } else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                }
            }
        }
    });
});

// Sunucuyu başlatırken, Render'ın atadığı PORT'u kullan
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
