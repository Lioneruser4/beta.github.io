// Dosya Adı: server.js
// Gerekli Paketler: npm install express socket.io

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.IO Sunucusu başlatılıyor.
// Not: index.html dosyasını bir web sunucusu (live server vb.) üzerinden açıyorsanız
// CORS ayarını kendi adresinize göre düzenlemeniz gerekebilir.
const io = new Server(server, {
    cors: {
        // index.html dosyasının açıldığı adres (Tarayıcı dosya yolunu kabul etmez, genellikle http://127.0.0.1:port veya http://localhost:port olmalıdır)
        origin: "*", // Geliştirme aşamasında her yerden gelen bağlantıyı kabul et (DİKKAT: Üretimde bu güvensizdir)
        methods: ["GET", "POST"]
    }
});

const rooms = {}; // Aktif odaları saklar: { 'ABCD': { hostId: 'socketId1', hostUsername: 'userA', guestId: null, ... } }

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
        
        console.log(`Oda Kuruldu: ${code} (Host: ${username})`);
        // Host'a oda kodunu bildir
        socket.emit('roomCreated', code);
    });

    // --- ODAYA KATILMA ---
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) {
            console.log(`Katılma Başarısız: Oda bulunamadı ${code}`);
            socket.emit('roomFull'); // Oda bulunamadı
            return;
        }

        if (room.playerCount >= 2) {
             console.log(`Katılma Başarısız: Oda dolu ${code}`);
            socket.emit('roomFull'); // Oda dolu
            return;
        }

        // Başarılı Katılım
        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        console.log(`Odaya Katılım: ${code} (Guest: ${username})`);
        socket.emit('roomJoined', code); // Guest'e katılımı bildir

        // Her iki oyuncuya da oyunun başladığını ve rollerini bildir
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', players);
        console.log(`Oyun Başladı: ${code}`);
    });

    // --- ODADAN AYRILMA/BAĞLANTI KOPMASI/İPTAL ---
    socket.on('leaveRoom', ({ roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];
        if (room) {
            // Eğer ayrılan kişi Host ise
            if (room.hostId === socket.id) {
                if (room.guestId) {
                    io.to(room.guestId).emit('opponentLeft');
                }
                delete rooms[code]; // Odayı tamamen sil
                console.log(`Oda Silindi (Host Ayrıldı): ${code}`);
            } 
            // Eğer ayrılan kişi Guest ise
            else if (room.guestId === socket.id) {
                room.playerCount = 1;
                room.guestId = null;
                room.guestUsername = null;
                io.to(room.hostId).emit('opponentLeft');
                console.log(`Misafir Ayrıldı: ${code}`);
            }
        }
        socket.leave(code);
    });

    // --- OYUN İÇİ VERİ AKTARIMI ---
    socket.on('gameData', (data) => {
        // Gelen veriyi (kart çevirme, skor vb.) odadaki diğer oyuncuya yolla
        const code = data.roomCode;
        if (code) {
            // Veriyi gönderen hariç odadaki herkese yolla
            socket.to(code).emit('gameData', data); 
        }
    });

    // --- BAĞLANTI KESİLMESİ ---
    socket.on('disconnect', () => {
        console.log(`Kullanıcı bağlantısı kesildi: ${socket.id}`);
        // Bağlantı kesildiğinde, bu kullanıcının hangi odada olduğunu bul ve odayı temizle
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                // Diğer oyuncuya bildirim gönderilmesi için 'leaveRoom' olayını tetikle
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft');
                }
                
                // Odayı temizle
                if (room.hostId === socket.id) {
                    delete rooms[code];
                    console.log(`Oda Silindi (Host Disconnect): ${code}`);
                } else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                    console.log(`Misafir Ayrıldı (Guest Disconnect): ${code}`);
                }
            }
        }
    });
});

// Sunucuyu 3000 portunda başlat
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
