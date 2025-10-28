// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const rooms = {};
const LEVELS = [16, 20, 24]; // Kart sayıları

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// Yeni: Rastgele Bomba Atayan Fonksiyon
function assignRandomBombs(boardSize) {
    const bombCount = 2; // Sabit 2 bomba
    const bombIndexes = [];
    while (bombIndexes.length < bombCount) {
        const randomIndex = Math.floor(Math.random() * boardSize);
        if (!bombIndexes.includes(randomIndex)) {
            bombIndexes.push(randomIndex);
        }
    }
    return bombIndexes;
}

// Yeni: Oyunu Başlatma Fonksiyonu
function startGameInRoom(roomCode, level) {
    const room = rooms[roomCode];
    if (!room) return;

    const boardSize = LEVELS[level - 1];
    
    // Bombaları Rastgele Ata
    const allBombs = assignRandomBombs(boardSize);
    
    // Bombaları iki oyuncu arasında bölüştür
    // Her oyuncu 1 bombayı diğerine atar (Bomba 1 Host'a ait, Bomba 2 Guest'e ait)
    // Bu, kimin hangi bombayı attığını bilmeden oynama hissi verir.
    room.hostBombs = [allBombs[0]]; // Host'un attığı bomba
    room.guestBombs = [allBombs[1]]; // Guest'in attığı bomba
    room.level = level;
    room.turn = 0; // Host başlar

    console.log(`Oda ${roomCode}: Oyun Seviye ${level} ile Başladı. Bombalar: ${allBombs.join(', ')}`);

    const players = [
        { id: room.hostId, username: room.hostUsername, isHost: true, roomCode: roomCode, bombIndexes: room.hostBombs },
        { id: room.guestId, username: room.guestUsername, isHost: false, roomCode: roomCode, bombIndexes: room.guestBombs }
    ];

    io.to(roomCode).emit('gameStart', { players, initialLevel: level, boardSize });
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
            level: 1,
            turn: 0 
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

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        console.log(`Oda ${code}'a katılım. Guest: ${username}. Oyun Başlatılıyor.`);

        // Otomatik Olarak Oyunu Başlat
        startGameInRoom(code, room.level);
    });
    
    // 3. Oyun İçi Hamle
    socket.on('gameMove', (data) => {
        const { roomCode, cardIndex, nextTurn, newHostLives, newGuestLives, cardsLeft } = data;
        const room = rooms[roomCode];
        if (!room) return;

        // Hamleyi rakibe ilet
        socket.to(roomCode).emit('gameMove', { 
            cardIndex, 
            nextTurn, 
            newHostLives, 
            newGuestLives,
            cardsLeft 
        }); 
        
        room.turn = nextTurn;
        
        // Sunucu Tarafında Temel Kazanma Kontrolü (Hata Kontrolü için)
        if (newHostLives <= 0 || newGuestLives <= 0 || cardsLeft === 0) {
            console.log(`Oda ${roomCode} - Oyun Bitti. Host Can: ${newHostLives}, Guest Can: ${newGuestLives}`);
        }
    });
    
    // 4. Seviye Atlama İsteği
    socket.on('nextLevelRequest', ({ roomCode, currentLevel }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return; // Sadece Host seviye atlatabilir.

        const nextLevel = currentLevel + 1;
        if (nextLevel <= LEVELS.length) {
            startGameInRoom(roomCode, nextLevel);
        } else {
            // Oyun bitti, finali ilan et
            io.to(roomCode).emit('finalGameEnd', { message: "Tebrikler! Tüm seviyeler tamamlandı." });
            delete rooms[roomCode];
        }
    });
    
    // 5. Bağlantı Kesilmesi ve Odadan Ayrılma
    socket.on('disconnect', () => {
        // ... (Önceki leaveRoom ve disconnect mantığı aynı kalır)
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id) {
                if (room.guestId) {
                    io.to(room.guestId).emit('opponentLeft', 'Oda sahibi bağlantıyı kesti. Lobiye dönülüyor.');
                }
                delete rooms[code];
                break;
            } else if (room.guestId === socket.id) {
                room.playerCount = 1;
                room.guestId = null;
                room.guestUsername = null;
                io.to(room.hostId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Yeni bir rakip bekleniyor.');
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
