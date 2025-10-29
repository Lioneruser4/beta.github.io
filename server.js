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

// Oyun için kullanılacak rastgele emojiler
const EMOJIS = ['😀','😎','🦄','🐱','🍀','🍕','🌟','⚽','🎵','🚀','🎲','🥇'];

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
                level: 1,
                opened: [] // Açılan kart indeksleri
            }
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`Oda oluşturuldu: ${code} - Host: ${username}`);
    });

    // Sohbet mesajı
    socket.on('chatMessage', ({ roomCode, text }) => {
        const code = (roomCode || '').toUpperCase();
        const room = rooms[code];
        if (!room || !text || typeof text !== 'string') return;

        // Gönderenin adını belirle
        let name = 'Oyuncu';
        if (socket.id === room.hostId) name = room.hostUsername || 'Host';
        else if (socket.id === room.guestId) name = room.guestUsername || 'Guest';

        const payload = {
            text: text.slice(0, 300), // uzunluğu sınırla
            name,
            ts: Date.now(),
            senderId: socket.id
        };
        io.to(code).emit('chatMessage', payload);
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
        // Oda kodunu da ilet ki her iki taraf da hamle gönderirken doğru kodu kullansın
        io.to(code).emit('gameStart', { players, roomCode: code });
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
        
        // Client'ın socket dinleyicilerini kurması için kısa bir gecikme
        setTimeout(() => {
            io.to(code).emit('gameReady', {
                hostBombs: room.gameState.hostBombs,
                guestBombs: room.gameState.guestBombs
            });
            console.log(`🚀 gameReady sinyali gönderildi: ${code}`);
        }, 500);
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
            const idx = data.cardIndex;
            // Aynı karta ikinci kez tıklamayı engelle
            if (room.gameState.opened.includes(idx)) {
                socket.emit('error', 'Bu kart zaten açıldı.');
                return;
            }

            // Bombayı belirle: Host oynuyorsa Guest'in bombaları tehlikelidir, tersi de aynı
            const isBomb = isHostTurn
                ? room.gameState.guestBombs.includes(idx)
                : room.gameState.hostBombs.includes(idx);

            // Emoji seç (bomba değilse)
            const emoji = isBomb ? '💣' : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

            // Kartı açılmış olarak işaretle
            room.gameState.opened.push(idx);

            // Sırayı değiştir
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            // Hareketi her iki oyuncuya da gönder (emoji ve bomba bilgisi ile)
            io.to(code).emit('gameData', {
                type: 'MOVE',
                cardIndex: idx,
                emoji: emoji,
                isBomb: isBomb,
                roomCode: code
            });
            
            console.log(`Hamle yapıldı - Oda: ${code}, Kart: ${idx}, Bomba: ${isBomb}, Emoji: ${emoji}, Yeni sıra: ${room.gameState.turn}`);
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
        
        // Yeni bombaları kısa gecikme ile gönder
        setTimeout(() => {
            io.to(roomCode).emit('gameReady', {
                hostBombs: room.gameState.hostBombs,
                guestBombs: room.gameState.guestBombs
            });
            console.log(`🚀 Yeni seviye gameReady gönderildi: ${roomCode}`);
        }, 500);
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
