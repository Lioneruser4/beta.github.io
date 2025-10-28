// Dosya Adı: server.js (BOMBALI HAFIZA OYUNU V5 - KESİN DÜZELTME)
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

// --- Sabitler ---
const BOARD_SIZE = 20; 
const BOMB_COUNT = 4;   
const DEFAULT_LIVES = 2; 
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉'];

// --- Kart İçeriği Hazırlama Fonksiyonu ---
function createShuffledContents(boardSize, hostBombs, guestBombs) {
    const pairs = boardSize / 2; 
    let cardContents = [];

    // 1. Emoji Çiftlerini Ekle (10 çift)
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji);
    }

    // 2. Host ve Guest Bombalarını Belirle (Her oyuncunun bombası RAKİBİNE can kaybettirir)
    // KRİTİK: Bu fonksiyonda, kartın arkasında ne görüneceği değil, mantıksal olarak hangi kartın kime ait bomba olduğu belirlenir.
    // Ancak istemciye göndereceğimiz dizi, kartın arkasında ne olacağını içermeli.
    
    // Bu mantıkta, kart içeriği sadece emojidir. Bomba bilgisi ayrılır.
    // İstemci tarafında görselleştirme karmaşasını azaltmak için, cardContents'i sadece emojilerle yapalım
    
    // Fisher-Yates shuffle (Sadece emojileri karıştır)
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[j], cardContents[i]];
    }

    return cardContents;
}


function selectRandomBombs(boardSize, bombCount) {
    // Sadece bomba indekslerini seçer
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return new Set(indices.slice(0, bombCount));
}


function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) { code = Math.random().toString(36).substring(2, 6).toUpperCase(); }
    return code;
}

// --- Oyun Durumu Başlatıcı ---
function initializeRoom(room) {
    room.hostBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.guestBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.hostLives = DEFAULT_LIVES;
    room.guestLives = DEFAULT_LIVES;
    room.openedCards = new Set(); // Açık kart indeksleri
    
    // Emojileri karıştır ve yerleştir
    const emojiBoard = createShuffledContents(BOARD_SIZE); 
    
    // KRİTİK: Kartın arkasındaki görsel içeriği bir kez belirleyelim.
    room.cardContents = emojiBoard.map((content, index) => {
        // Eğer bir kart HEM Host'un HEM de Guest'in bombasıysa, kural gereği bu oyunun dışındadır.
        // Basitlik adına, sadece bir oyuncunun bombası olarak kalmasını sağlayacağız.

        // Eğer kart, Host'un canını düşürecek (yani Guest'in bombasıysa)
        if (room.guestBombs.has(index)) {
             return '💣'; 
        } 
        // Eğer kart, Guest'in canını düşürecek (yani Host'un bombasıysa)
        else if (room.hostBombs.has(index)) {
             return '💣';
        }
        // Değilse, bu kart bir emojidir (eşleşme kartı)
        return content;
    });

    room.cardsLeft = BOARD_SIZE;
    room.gameActive = true;
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    
    // ... createRoom ve joinRoom olayları aynı kalır ...

    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = { code, playerCount: 1, hostId: socket.id, hostUsername: username, guestId: null, guestUsername: null };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) { socket.emit('joinFailed', `HATA: ${code} kodlu oda bulunamadı.`); return; }
        if (room.playerCount >= 2) { socket.emit('joinFailed', `HATA: ${code} kodlu oda zaten dolu.`); return; }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        
        initializeRoom(room); // Oyunu başlat
        socket.join(code);
        
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', {
            players, 
            cardContents: room.cardContents, // KRİTİK: İstemciye kartların içeriğini gönder
            boardSize: BOARD_SIZE,
            initialLives: DEFAULT_LIVES
        });
    });

    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive) return;

        const { cardIndex } = data;
        
        const isHostPlayer = socket.id === room.hostId;
        const playerName = isHostPlayer ? room.hostUsername : room.guestUsername;

        // 1. Kural Kontrolü: Kart Kontrolü
        if (room.openedCards.has(cardIndex)) {
             socket.emit('infoMessage', { message: 'Kart zaten açık.', isError: true });
             return; 
        }
        
        // 2. Hamleyi İşle
        room.openedCards.add(cardIndex); // Kartı aç
        room.cardsLeft--;
        
        let moveResult = { cardIndex, hitBomb: false, gameOver: false, winner: null, moverName: playerName };

        // Bu oyuncunun canını düşürecek olan, RAKİBİNİN bombalarıdır.
        const opponentBombs = isHostPlayer ? room.guestBombs : room.hostBombs;
        
        // Bombaya bastıysa
        if (opponentBombs.has(cardIndex)) {
            moveResult.hitBomb = true;
            
            if (isHostPlayer) { room.hostLives--; } else { room.guestLives--; }

            // Oyun Bitiş Kontrolü (Can bitti mi?)
            if (room.hostLives <= 0 || room.guestLives <= 0) {
                 room.gameActive = false;
                 moveResult.gameOver = true;
                 moveResult.winner = room.hostLives <= 0 && room.guestLives <= 0 ? 'DRAW' : room.hostLives <= 0 ? 'Guest' : 'Host';
            }
        } else {
             // Emoji Eşleşme Kontrolü
             const openedCardsArray = Array.from(room.openedCards);
             const matchedCardIndices = [];
             
             // NOT: Eş zamanlı oyunda eşleştirme mantığı daha karmaşıktır.
             // Şu an sadece bombaya odaklanıp, eşleşmeyi es geçiyoruz (Can Bitti/Tüm Kartlar Açıldı).
             // Eğer eşleşme zorunluysa, açılan kartları 2'şerli kontrol etmeliyiz.
        }

        // Seviye Tamamlanma Kontrolü (Kart bitti mi?)
        if (room.cardsLeft === 0 && !moveResult.gameOver) {
            room.gameActive = false;
            moveResult.gameOver = true;
            moveResult.winner = room.hostLives === room.guestLives ? 'DRAW' : room.hostLives > room.guestLives ? 'Host' : 'Guest';
        }

        // 3. Tüm client'lara durumu yay
        io.to(data.roomCode).emit('gameStateUpdate', {
            moveResult,
            hostLives: room.hostLives,
            guestLives: room.guestLives,
            cardsLeft: room.cardsLeft,
            openedCardsIndices: Array.from(room.openedCards) // KRİTİK: Açık kartların tam listesini gönder
        });
    });

    // --- SOHBET OLAYI ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.hostId || !room.guestId) return;

        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;

        io.to(data.roomCode).emit('newMessage', {
            sender: senderName,
            text: data.message
        });
    });
    // ----------------------

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.'); }
                
                if (room.hostId === socket.id) { delete rooms[code]; } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1; room.guestId = null; room.guestUsername = null;
                }
            }
        }
    });
});

const PORT = process.env.PORT || 10000; 
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
