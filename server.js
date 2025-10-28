// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

// CORS DÜZELTME: Tüm kaynaklardan gelen bağlantılara izin verir
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const rooms = {};

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

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
            hostBombs: null, // Bomba indexleri burada tutulacak
            guestBombs: null, // Bomba indexleri burada tutulacak
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`Oda ${code} oluşturuldu. Host: ${username}`);
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
        
        console.log(`Oda ${code}'a katılım. Guest: ${username}. Oyun Başlatılıyor.`);

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        // İki oyuncuya da oyunun başladığını bildir
        io.to(code).emit('gameStart', players);
    });

    // KRİTİK DÜZELTME: Bomb Seçimini Senkronize Etme
    socket.on('bombSelectionComplete', (data) => {
        const { roomCode, isHost, bombs } = data;
        const room = rooms[roomCode];

        if (room) {
            if (isHost) {
                room.hostBombs = bombs;
            } else {
                room.guestBombs = bombs;
            }
            
            // Bomb seçiminin diğer oyuncuya iletilmesi (UI güncellemesi için)
            // Kendi sinyali kendisine geri gitmeyecektir (socket.to(code))
            socket.to(roomCode).emit('opponentBombSelectionComplete', { 
                isHost: isHost
            });
        
            // Her iki oyuncunun da seçimi tamamlandıysa, oyunu 'PLAY' aşamasına geçirme sinyali gönder
            if (room.hostBombs && room.hostBombs.length === 3 && room.guestBombs && room.guestBombs.length === 3) {
                console.log(`Oda ${roomCode}: Her iki oyuncu da bomba seçti. Oyun Başlıyor (PLAY).`);
                
                io.to(roomCode).emit('allBombsSelected', {
                    hostBombs: room.hostBombs,
                    guestBombs: room.guestBombs
                });
            }
        }
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
            // Bomba listelerini yeni seçim için sıfırla
            room.hostBombs = null;
            room.guestBombs = null;
            
            // Host seviye atlama sinyali gönderdiğinde tüm odaya ilet
            io.to(roomCode).emit('nextLevel', { newLevel });
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
