// Dosya Adı: server.js
// Render'da yüklü olan kodunuzu bununla güncelleyin.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

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
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null,
            guestUsername: null,
            gameState: {
                stage: 'WAITING', // WAITING, SELECTION, PLAY, ENDED
                turn: 0, // 0 = Host, 1 = Guest
                hostBombs: [],
                guestBombs: [],
                hostBombsSelected: false,
                guestBombsSelected: false,
                level: 1
            }
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`Oda oluşturuldu: ${code} - Host: ${username}`);
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
        room.gameState.stage = 'SELECTION';
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        io.to(code).emit('gameStart', players);
        console.log(`${username} odaya katıldı: ${code}`);
    });

    // Bomba seçimi tamamlandı
    socket.on('bombSelectionComplete', ({ roomCode, isHost, bombs }) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (isHost) {
            room.gameState.hostBombs = bombs;
            room.gameState.hostBombsSelected = true;
            console.log(`Host bombaları seçti (${bombs.length} adet): ${roomCode}`, bombs);
        } else {
            room.gameState.guestBombs = bombs;
            room.gameState.guestBombsSelected = true;
            console.log(`Guest bombaları seçti (${bombs.length} adet): ${roomCode}`, bombs);
        }

        // Her iki oyuncu da seçtiyse oyunu başlat
        if (room.gameState.hostBombsSelected && room.gameState.guestBombsSelected) {
            console.log(`✅ Her iki bomba seti hazır! Host: ${room.gameState.hostBombs.length}, Guest: ${room.gameState.guestBombs.length}`);
            room.gameState.stage = 'PLAY';
            room.gameState.turn = 0; // Host başlar
            
            // Her iki oyuncuya da OYUN BAŞLASIN sinyali gönder
            io.to(roomCode).emit('bothBombsSelected', { 
                hostBombs: room.gameState.hostBombs,
                guestBombs: room.gameState.guestBombs
            });
            
            console.log(`Her iki oyuncu da bomba seçti. Oyun başlıyor: ${roomCode}`);
        } else {
            // Sadece seçen oyuncuya bildir
            io.to(roomCode).emit('bombSelectionComplete', { isHost, bombs });
        }
    });

    // Oyun hamlesi
    socket.on('gameData', (data) => {
        const code = data.roomCode;
        const room = rooms[code];
        if (!room || room.gameState.stage !== 'PLAY') return;

        // Sıra kontrolü
        const isHostTurn = room.gameState.turn === 0;
        const isCorrectPlayer = (isHostTurn && socket.id === room.hostId) || 
                               (!isHostTurn && socket.id === room.guestId);

        if (!isCorrectPlayer) {
            socket.emit('error', 'Senin sıran değil!');
            console.log(`Yanlış sıra hareketi engellendi: ${code}`);
            return;
        }

        if (data.type === 'MOVE') {
            // Sırayı değiştir
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            // Hareketi her iki oyuncuya da gönder
            io.to(code).emit('gameData', data);
            console.log(`Hamle yapıldı - Oda: ${code}, Kart: ${data.cardIndex}, Yeni sıra: ${room.gameState.turn}`);
        }
    });

    // Seviye atlama
    socket.on('nextLevel', ({ roomCode, newLevel }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.hostId) return; // Sadece host seviye atlayabilir

        room.gameState.level = newLevel;
        room.gameState.stage = 'SELECTION';
        room.gameState.turn = 0;
        room.gameState.hostBombs = [];
        room.gameState.guestBombs = [];
        room.gameState.hostBombsSelected = false;
        room.gameState.guestBombsSelected = false;

        // Her iki oyuncuya da yeni seviyeyi bildir
        io.to(roomCode).emit('nextLevel', { newLevel });
        console.log(`Yeni seviye: ${newLevel} - Oda: ${roomCode}`);
    });

    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                // Oda tamamen temizlenir (her iki oyuncu da gittiğinde)
                if (room.hostId === socket.id) {
                    delete rooms[code];
                    console.log(`Oda silindi (Host ayrıldı): ${code}`);
                } else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                    room.gameState.stage = 'WAITING';
                    console.log(`Guest ayrıldı: ${code}`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
