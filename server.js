// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] 
});

const rooms = {}; 
const LEVELS = [16, 20, 24]; // Client ile senkronize olmalı

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4 haneli kod
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

io.on('connection', (socket) => {
    
    // 1. Oda Oluşturma
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null,
            guestUsername: null,
            hostBombs: [],
            guestBombs: [],
            level: 1 
        };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    // 2. Odaya Katılma
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
        
        // Oyun Başlatma Sinyali (Her iki oyuncuya da gönderilir)
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true, roomCode: code },
            { id: room.guestId, username: room.guestUsername, isHost: false, roomCode: code }
        ];
        io.to(code).emit('gameStart', players);
    });
    
    // 3. Bomb Seçimi Tamamlandı
    socket.on('bombSelectionComplete', ({ roomCode, bombs }) => {
        const room = rooms[roomCode];
        if (!room || room.playerCount !== 2) return;
        
        const isHostPlayer = socket.id === room.hostId;

        if (isHostPlayer) {
            room.hostBombs = bombs;
        } else {
            room.guestBombs = bombs;
        }
        
        // Seçimi diğer oyuncuya ilet
        socket.to(roomCode).emit('bombSelectionComplete', { isHost: isHostPlayer, bombs });
        
        // Sunucuda da tam listeyi kontrol et
        const hostReady = room.hostBombs.length === 3;
        const guestReady = room.guestBombs.length === 3;
        
        if (hostReady && guestReady) {
            // İki oyuncunun da bombası client'a iletildi. Oyun client tarafında başlayacak.
            console.log(`Oda ${roomCode}: Oyun bomb seçiminden sonra başlatıldı.`);
        }
    });

    // 4. Oyun İçi Veri Alımı (Hamle)
    socket.on('gameData', (data) => {
        const code = data.roomCode;
        if (code) {
            // Hamleyi rakibe ilet
            socket.to(code).emit('gameData', data); 
        }
    });
    
    // 5. Seviye Atlama İsteği (Sadece Host gönderir)
    socket.on('nextLevel', ({ roomCode, newLevel }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || newLevel > LEVELS.length) return; 

        room.level = newLevel;
        room.hostBombs = []; // Bombaları sıfırla
        room.guestBombs = [];
        
        // Tüm client'lara yeni seviyeyi bildir
        io.to(roomCode).emit('nextLevel', { newLevel: room.level });
    });

    // 6. Bağlantı Kesilmesi
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                // Odayı kalıcı olarak sil
                delete rooms[code];
                console.log(`Oda ${code} kapatıldı.`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
