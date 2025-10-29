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
        
        // Otomatik bomba seçimi yap (her oyuncu için rastgele 2 bomba)
        const boardSize = 12; // İlk seviye
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        
        // Karıştır
        allIndices.sort(() => Math.random() - 0.5);
        
        // Host için ilk 2, Guest için sonraki 2
        room.gameState.hostBombs = allIndices.slice(0, 2);
        room.gameState.guestBombs = allIndices.slice(2, 4);
        room.gameState.stage = 'PLAY';
        room.gameState.turn = 0;
        
        console.log(`🎲 Otomatik bombalar yerleştirildi - Host: ${room.gameState.hostBombs}, Guest: ${room.gameState.guestBombs}`);
        
        // Oyunu başlat
        io.to(code).emit('gameReady', {
            hostBombs: room.gameState.hostBombs,
            guestBombs: room.gameState.guestBombs
        });
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
            const cardIndex = data.cardIndex;
            
            // Bomba kontrolü - Hamle yapan oyuncuya göre
            const opponentBombs = isHostTurn ? room.gameState.guestBombs : room.gameState.hostBombs;
            const isBomb = opponentBombs.includes(cardIndex);
            
            // Rastgele emoji seç (bomba değilse)
            const emojis = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];
            
            // Sırayı değiştir
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            // Hareketi her iki oyuncuya da gönder (emoji ve bomba bilgisi ile)
            io.to(code).emit('gameData', {
                type: 'MOVE',
                cardIndex: cardIndex,
                emoji: emoji,
                isBomb: isBomb,
                roomCode: code
            });
            
            console.log(`Hamle yapıldı - Oda: ${code}, Kart: ${cardIndex}, Bomba: ${isBomb}, Emoji: ${emoji}, Yeni sıra: ${room.gameState.turn}`);
        }
    });

    // Seviye atlama
    socket.on('nextLevel', ({ roomCode, newLevel }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.hostId) return; // Sadece host seviye atlayabilir

        room.gameState.level = newLevel;
        room.gameState.stage = 'PLAY';
        room.gameState.turn = 0;
        
        // Yeni seviye için board size
        const boardSizes = [12, 16, 20];
        const boardSize = boardSizes[newLevel - 1];
        
        // Otomatik bomba seçimi
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        allIndices.sort(() => Math.random() - 0.5);
        
        room.gameState.hostBombs = allIndices.slice(0, 2);
        room.gameState.guestBombs = allIndices.slice(2, 4);

        console.log(`Yeni seviye: ${newLevel} - Oda: ${roomCode}, Bombalar: Host ${room.gameState.hostBombs}, Guest ${room.gameState.guestBombs}`);

        // Her iki oyuncuya da yeni seviyeyi bildir
        io.to(roomCode).emit('nextLevel', { newLevel });
        
        // Yeni bombaları gönder
        io.to(roomCode).emit('gameReady', {
            hostBombs: room.gameState.hostBombs,
            guestBombs: room.gameState.guestBombs
        });
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
