// Sunucu Kodu: Node.js ile çalışır
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.IO Sunucusu
// CORS ayarı: localhost:3000 portu üzerinden gelen tüm bağlantılara izin verir.
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const rooms = {}; // Aktif odaları saklar: { 'A1B2': { hostId: 'socketId1', guestId: null, playerCount: 1, ... } }

// Rastgele 4 haneli oda kodu oluşturucu
function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

io.on('connection', (socket) => {
    console.log(`Yeni bir kullanıcı bağlandı: ${socket.id}`);

    // --- ODA KURMA ---
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null,
            guestUsername: null
        };
        socket.join(code);
        
        // Host'a oda kodunu bildir
        socket.emit('roomCreated', code);
        console.log(`Oda Kuruldu: ${code} (Host: ${username})`);
    });

    // --- ODAYA KATILMA ---
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) {
            socket.emit('roomFull'); // Odayı bulamadık
            return;
        }

        if (room.playerCount >= 2) {
            socket.emit('roomFull'); // Oda dolu
            return;
        }

        // Başarılı Katılım
        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        // Guest'e katılımı bildir
        socket.emit('roomJoined', code);
        console.log(`Odaya Katılım: ${code} (Guest: ${username})`);

        // Her iki oyuncuya da oyunun başladığını ve rollerini bildir
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', players);
        console.log(`Oyun Başladı: ${code}`);
    });

    // --- ODADAN AYRILMA/BAĞLANTI KOPMASI ---
    socket.on('leaveRoom', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room) {
            // Eğer odadan ayrılan kişi Host ise
            if (room.hostId === socket.id) {
                // Diğer oyuncuya (Guest'e) bildir
                if (room.guestId) {
                    io.to(room.guestId).emit('opponentLeft');
                }
                delete rooms[roomCode]; // Odayı tamamen sil
                console.log(`Oda Silindi (Host Ayrıldı): ${roomCode}`);
            } 
            // Eğer odadan ayrılan kişi Guest ise
            else if (room.guestId === socket.id) {
                room.playerCount = 1;
                room.guestId = null;
                room.guestUsername = null;
                // Host'a bildir
                io.to(room.hostId).emit('opponentLeft');
                console.log(`Misafir Ayrıldı: ${roomCode}`);
            }
        }
        socket.leave(roomCode);
    });

    socket.on('disconnect', () => {
        console.log(`Kullanıcı bağlantısı kesildi: ${socket.id}`);
        // Bağlantı kesildiğinde, ayrılma işlemini tüm odalar için kontrol et
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                // disconnect anında leaveRoom olayını simüle et
                // Bu, diğer oyuncuya bildirim gitmesini sağlar.
                socket.emit('leaveRoom', { roomCode: code }); 
            }
        }
    });

    // --- OYUN İÇİ VERİ ALIŞVERİŞİ (Örnek) ---
    socket.on('gameData', (data) => {
        // Gelen veriyi (kart çevirme, puan vb.) odadaki diğer oyuncuya yolla
        const code = data.roomCode;
        if (code) {
            socket.to(code).emit('gameData', data);
        }
    });
});

// Sunucuyu 3000 portunda başlat
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
