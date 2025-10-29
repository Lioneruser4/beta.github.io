// Dosya Adı: server.js (HATASIZ - HAFIZA OYUNU SUNUCU)
const express = require('express');
const http = require('http'); // require('http') düzeltildi
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Statik dosyaları sun (index.html ve game.js'in bulunduğu klasör)
app.use(express.static('.')); // Kök dizini (server.js'in bulunduğu yer) işaret eder.

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const rooms = {};

// --- Sabitler ---
const BOARD_SIZE = 20; // 5x4 Tahta için 20 kart
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉'];
const MATCH_DELAY = 1500; 

// --- Yardımcı Fonksiyonlar ---
function createShuffledContents(boardSize) {
    const pairs = boardSize / 2;
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length];
        cardContents.push(emoji, emoji);
    }
    // Fisher-Yates Karıştırma Algoritması
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
    room.isHandlingMove = false; // Eş zamanlı hareketleri engellemek için kilit
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    
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
    });

    // ODAYA KATIL
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) { socket.emit('joinFailed', `HATA: ${code} kodlu oda bulunamadı.`); return; }
        if (room.playerCount >= 2) { socket.emit('joinFailed', `HATA: ${code} kodlu oda zaten dolu.`); return; }
        if (room.hostId === socket.id) { socket.emit('joinFailed', `HATA: Zaten bu odanın sahibisiniz.`); return; }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        room.players.push({ id: socket.id, username: username, isHost: false });
        
        initializeRoom(room);
        socket.join(code);

        // Tüm odaya oyunu başlatma sinyali gönder
        io.to(code).emit('gameStart', {
            code,
            players: room.players,
            cardContents: room.cardContents,
            turn: room.turn,
            matchedCards: Array.from(room.matchedCards),
            scoreHost: room.scoreHost,
            scoreGuest: room.scoreGuest
        });
    });

    // KART ÇEVİRME HAREKETİ
    socket.on('MOVE', async (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive || room.isHandlingMove) return;

        const { cardIndex } = data;
        
        // Hata Kontrolleri
        if (socket.id !== room.turn) return; 
        if (room.matchedCards.has(cardIndex) || room.flippedCards.includes(cardIndex) || room.flippedCards.length >= 2) return; 

        room.isHandlingMove = true; // Hareketi kilitle
        room.flippedCards.push(cardIndex);

        // 1. Kart veya 2. Kartın çevrildiği bilgisini hemen gönder
        io.to(data.roomCode).emit('gameStateUpdate', {
            cardIndex: cardIndex,
            flippedCards: room.flippedCards,
            matchedCards: Array.from(room.matchedCards), 
            scoreHost: room.scoreHost,
            scoreGuest: room.scoreGuest
        });

        if (room.flippedCards.length === 2) {
            const [idx1, idx2] = room.flippedCards;
            
            // Eşleşme Kontrolü
            if (room.cardContents[idx1] === room.cardContents[idx2]) {
                
                // Başarılı Eşleşme
                room.matchedCards.add(idx1);
                room.matchedCards.add(idx2);
                
                if (room.turn === room.hostId) { room.scoreHost++; } else { room.scoreGuest++; }
                
                room.flippedCards = []; // Yeni tura hazırla

                // Oyun Bitti mi Kontrolü
                if (room.matchedCards.size === BOARD_SIZE) {
                    room.gameActive = false;
                    const winner = room.scoreHost === room.scoreGuest ? 'DRAW' : room.scoreHost > room.scoreGuest ? 'Host' : 'Guest';
                    io.to(data.roomCode).emit('gameEnd', { winner, scoreHost: room.scoreHost, scoreGuest: room.scoreGuest });
                } else {
                    // Başarılı eşleşmede sıra aynı oyuncuda kalır.
                    io.to(data.roomCode).emit('turnUpdate', { 
                        turn: room.turn, 
                        message: "Eşleşme! Sıra sizde kalıyor.",
                        flippedCards: room.flippedCards, // Boş gönderilir
                        matchedCards: Array.from(room.matchedCards) 
                    });
                }

            } else {
                
                // Eşleşme Başarısız: Kartların kapanması için bekle
                await new Promise(resolve => setTimeout(resolve, MATCH_DELAY));
                
                // Sırayı Değiştir
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                
                // Kartların kapandığı ve sıranın değiştiği bilgisini gönder
                io.to(data.roomCode).emit('turnUpdate', { 
                    turn: room.turn, 
                    message: "Eşleşmedi. Sıra rakibe geçti.",
                    flippedCards: [], // Kartların kapandığını belirtmek için boş gönderilir
                    matchedCards: Array.from(room.matchedCards) 
                });
            }
        }

        room.isHandlingMove = false; // Kilidi kaldır
    });

    // --- SOHBET VE BAĞLANTI KESME OLAYLARI ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;
        if (!senderName) return;

        io.to(data.roomCode).emit('newMessage', { sender: senderName, text: data.message });
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                
                if (room.playerCount === 2) {
                    const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                    if (opponentId) { 
                        io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.'); 
                    }
                }
                
                if (room.hostId === socket.id) { 
                    delete rooms[code];
                    console.log(`Oda ${code} silindi.`);
                } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1; 
                    room.guestId = null; 
                    room.guestUsername = null;
                    room.players = room.players.filter(p => p.id === room.hostId);
                    if (room.gameActive) {
                        room.gameActive = false;
                        // Host'a bekleme ekranına dönmesi için sinyal yolla
                        io.to(room.hostId).emit('roomCreated', code); 
                    }
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    // Sunucunun dinlediği URL'yi konsola yazdır
    const host = process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : `http://localhost:${PORT}`;
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor.`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`🔥 Bağlantı Adresi: ${host}`);
    console.log(`📢 index.html dosyasındaki LIVE_SERVER_URL değişkenini bu adresle EŞLEŞTİRMEYİ UNUTMAYIN.`);
    console.log(`--------------------------------------------------------------------------------`);
});
