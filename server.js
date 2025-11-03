// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Statik dosyaları (index.html, game.js vb.) sunmak için
app.use(express.static('.'));

// CORS Ayarı: Render ve diğer hosting platformları için
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] 
});

const rooms = {}; 

// Oyun üçün istifadə ediləcək emojilər
const EMOJIS = ['😀','😎','🦄','🐱','🍀','🍕','🌟','⚽','🎵','🚀','🎲','🥇'];
const BOARD_SIZE = 20; // Bütün səviyyələrdə 20 kart

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// Yeni oyun və ya səviyyə başlatma funksiyası
function initializeLevel(room, level) {
    room.gameState.level = level;
    room.gameState.boardSize = BOARD_SIZE;
    room.gameState.opened = [];
    room.gameState.turn = 0; // Host (Otaq sahibi) başlayır
    room.gameState.stage = 'PLAY';

    // Səviyyəyə görə bomba sayını təyin et
    const bombCount = (level === 1) ? 3 : 4; 
    
    room.gameState.hostLives = bombCount;
    room.gameState.guestLives = bombCount;

    // Kart indekslərini qarışdır
    const allIndices = Array.from({ length: BOARD_SIZE }, (_, i) => i);
    allIndices.sort(() => Math.random() - 0.5);
    
    // Hər oyunçu üçün bombaları təyin et (bir-biri ilə kəsişməyən)
    room.gameState.hostBombs = allIndices.slice(0, bombCount);
    room.gameState.guestBombs = allIndices.slice(bombCount, bombCount * 2);

    console.log(`[Oda: ${room.code}] Seviye ${level} başladı. Bomba Sayı: ${bombCount}.`);

    // Hər iki oyunçuya yeni oyun vəziyyətini göndər
    const gameState = {
        level: room.gameState.level,
        boardSize: room.gameState.boardSize,
        hostBombs: room.gameState.hostBombs,
        guestBombs: room.gameState.guestBombs,
        hostLives: room.gameState.hostLives,
        guestLives: room.gameState.guestLives,
        turn: room.gameState.turn
    };
    
    io.to(room.code).emit('gameReady', gameState);
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
            gameState: {} // Oyun başlayanda dolacaq
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
        socket.join(code);
        
        socket.emit('roomJoined', code); 
        
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${username} odaya katıldı: ${code}`);
        
        // Oyunu Level 1 olaraq başlat
        setTimeout(() => {
            initializeLevel(room, 1);
        }, 500); // Client tərəfinin hazır olması üçün qısa gözləmə
    });

    // Oyun hərəkəti (Kart açma)
    socket.on('gameData', (data) => {
        const code = data.roomCode;
        const room = rooms[code];
        if (!room || room.gameState.stage !== 'PLAY') return;
        
        const isHostTurn = room.gameState.turn === 0;
        const isCorrectPlayer = (isHostTurn && socket.id === room.hostId) || (!isHostTurn && socket.id === room.guestId);

        if (!isCorrectPlayer) {
            socket.emit('error', 'Senin sıran değil!');
            return;
        }

        if (data.type === 'MOVE') {
            const idx = data.cardIndex;
            if (room.gameState.opened.includes(idx)) {
                socket.emit('error', 'Bu kart zaten açıldı.');
                return;
            }

            // Host oynayırsa Guestin bombasını, Guest oynayırsa Hostun bombasını yoxla
            const isBomb = isHostTurn 
                ? room.gameState.guestBombs.includes(idx) 
                : room.gameState.hostBombs.includes(idx);
            
            const emoji = isBomb ? '💣' : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
            room.gameState.opened.push(idx);

            // Növbəni dəyiş
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            io.to(code).emit('gameData', {
                type: 'MOVE',
                cardIndex: idx,
                emoji: emoji,
                isBomb: isBomb,
                turn: room.gameState.turn // Yeni növbəni göndər
            });
        }
    });

    // Client tərəfindən səviyyə tamamlandı siqnalı
    socket.on('levelComplete', ({ roomCode, level }) => {
        const room = rooms[roomCode];
        if (!room) return;

        // Yalnız Host yeni səviyyəni başlada bilər (təkrarlanmanın qarşısını almaq üçün)
        if (socket.id === room.hostId) {
            console.log(`[Oda: ${roomCode}] Seviye ${level} tamamlandı. Yeni seviye hazırlanır...`);
            // Növbəti səviyyəni (L2, L3...) başlat
            initializeLevel(room, level + 1);
        }
    });
    
    // Chat mesajları
    socket.on('chatMessage', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const player = [
            { id: room.hostId, username: room.hostUsername },
            { id: room.guestId, username: room.guestUsername }
        ].find(p => p.id === socket.id);
        
        if (!player) return;
        
        io.to(roomCode).emit('chatMessage', {
            username: player.username,
            message: message
        });
    });

    // Bağlantı kəsildikdə
    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                // Odanı sil
                delete rooms[code];
                console.log(`Oda silindi (Oyunçu ayrıldı): ${code}`);
            }
        }
    });
});

// Port (Render üçün)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
