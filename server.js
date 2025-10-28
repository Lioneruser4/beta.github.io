// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Static dosyaların sunulmasını sağlamak için
app.use(express.static(__dirname));

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] 
});

const rooms = {}; 
const LEVELS = [16, 20, 24]; 

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase(); 
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
        console.log(`Oda ${code} oluşturuldu. Host: ${username}`);
    });

    // 2. Odaya Katılma
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }
        if (room.hostId === socket.id) {
            socket.emit('joinFailed', 'Aynı odaya katılamazsınız.');
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        console.log(`Oda ${code}'a katılım. Guest: ${username}`);

        // Oyun Başlatma Sinyali (Her iki oyuncuya da gönderilir)
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true, roomCode: code },
            { id: room.guestId, username: room.guestUsername, isHost: false, roomCode: code }
        ];
        // Oda kodu client tarafından bilindiği için, bu sinyal sadece oyunun başlatılması için gerekli bilgileri taşır.
        io.to(code).emit('gameStart', players);
    });
    
    // 3. Bomb Seçimi Tamamlandı
    socket.on('bombSelectionComplete', ({ roomCode, bombs }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const isHostPlayer = socket.id === room.hostId;

        if (isHostPlayer) {
            room.hostBombs = bombs;
        } else {
            room.guestBombs = bombs;
        }
        
        // Seçimi diğer oyuncuya ilet
        socket.to(roomCode).emit('bombSelectionComplete', { isHost: isHostPlayer, bombs });
        
        const hostReady = room.hostBombs.length === 3;
        const guestReady = room.guestBombs.length === 3;
        
        if (hostReady && guestReady) {
            console.log(`Oda ${roomCode}: İki oyuncu da hazır.`);
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
        room.hostBombs = []; 
        room.guestBombs = [];
        
        // Tüm client'lara yeni seviyeyi bildir
        io.to(roomCode).emit('nextLevel', { newLevel: room.level });
    });
    
    // 6. Odadan Ayrılma (İptal Butonu)
    socket.on('leaveRoom', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id) {
                // Oda sahibi ayrıldıysa tüm odayı sil
                if (room.guestId) {
                    io.to(room.guestId).emit('opponentLeft', 'Oda sahibi ayrıldı. Lobiye dönülüyor.');
                }
                delete rooms[code];
                console.log(`Oda ${code} kapatıldı (Host ayrıldı).`);
                break;
            } else if (room.guestId === socket.id) {
                // Misafir ayrıldıysa odayı tek kişilik hale getir
                room.playerCount = 1;
                room.guestId = null;
                room.guestUsername = null;
                io.to(room.hostId).emit('opponentLeft', 'Rakibiniz odadan ayrıldı. Yeni bir rakip bekleyin.');
                console.log(`Oda ${code}: Guest ayrıldı.`);
                break;
            }
        }
    });

    // 7. Bağlantı Kesilmesi
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id) {
                if (room.guestId) {
                    io.to(room.guestId).emit('opponentLeft', 'Oda sahibi bağlantıyı kesti. Lobiye dönülüyor.');
                }
                delete rooms[code];
                console.log(`Oda ${code} kapatıldı (Host Disconnect).`);
                break;
            } else if (room.guestId === socket.id) {
                room.playerCount = 1;
                room.guestId = null;
                room.guestUsername = null;
                io.to(room.hostId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Yeni bir rakip bekleyin.');
                console.log(`Oda ${code}: Guest Disconnect.`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
