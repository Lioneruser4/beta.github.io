// Dosya Adı: server.js (EN ESKİ TEMEL SÜRÜM)
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Statik dosyaları sun
app.use(express.static('.')); 

// CORS ayarları ile minimal Socket.IO kurulumu
const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const rooms = {};

// --- Sabitler ve Yardımcı Fonksiyonlar ---
const BOARD_SIZE = 20; 
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉', '💣']; 
const BOMB_EMOJI = '💣'; // Eski koddaki bomba olmayabilir, oyunu başlatmak için kalsın.

function createShuffledContents(boardSize) {
    // Sadece oyunu başlatmak için gerekli kart dizisi
    const pairs = boardSize / 2;
    let cardContents = [];
    for (let i = 0; i < pairs; i++) { 
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji);
    }
    // Karıştırma
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[j], cardContents[i]];
    }
    return cardContents;
}

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) { code = Math.random().toString(36).substring(2, 6).toUpperCase(); }
    return code;
}

function initializeRoom(room) {
    room.cardContents = createShuffledContents(BOARD_SIZE);
    room.matchedCards = new Set();
    room.flippedCards = []; 
    room.turn = room.hostId; 
    room.gameActive = true;
    room.scoreHost = 0;
    room.scoreGuest = 0;
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    console.log(`[CONNECT] Yeni kullanıcı bağlandı: ${socket.id}`);
    
    // ODA OLUŞTUR
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = { 
            code, 
            playerCount: 1, 
            hostId: socket.id, 
            hostUsername: username, 
            guestId: null, 
            guestUsername: null,
            players: [{ id: socket.id, username: username, isHost: true }]
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`[ROOM] ${username} tarafından ${code} odası oluşturuldu.`);
    });

    // ODAYA KATIL
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) { socket.emit('joinFailed', `HATA: ${code} kodlu oda bulunamadı.`); return; }
        if (room.playerCount >= 2) { socket.emit('joinFailed', `HATA: ${code} kodlu oda zaten dolu.`); return; }
        
        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        room.players.push({ id: socket.id, username: username, isHost: false });
        
        initializeRoom(room);
        socket.join(code);

        io.to(code).emit('gameStart', {
            code,
            players: room.players,
            cardContents: room.cardContents,
            turn: room.turn,
            matchedCards: Array.from(room.matchedCards),
            scoreHost: room.scoreHost,
            scoreGuest: room.scoreGuest
        });
        console.log(`[ROOM] ${username}, ${code} odasına katıldı. Oyun başladı.`);
    });

    // KART ÇEVİRME HAREKETİ (Çok Basit Eşleşme Mantığı)
    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive || socket.id !== room.turn) return;

        // ... (hareket mantığı) ... Bu kısım game.js'deki kodun çalışması için bir miktar eşleşme mantığı gerektirir. 
        // Ancak bu kodun öncelikli amacı BAĞLANTIYI KURMAK olduğu için, bu kısmı test etmeden geçebiliriz.
    });


    // --- BAĞLANTI KESME OLAYLARI ---
    socket.on('disconnect', () => {
        // ... (Basit oda temizleme mantığı) ...
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    const host = process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : `http://localhost:${PORT}`;
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor. ESKİ TEMEL SÜRÜM.`);
    console.log(`🔥 Bağlantı Adresi: ${host}`);
});
