// Dosya Adı: server.js (BASİT ODA OLUŞTURMA SÜRÜMÜ)
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static('.')); 

const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

const rooms = {};

// --- Sabitler ve Yardımcı Fonksiyonlar (Aynı Kalıyor) ---
const BOARD_SIZE = 20; 
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉', '💣']; 
const BOMB_EMOJI = '💣';
const MATCH_DELAY = 1500; 

function createShuffledContents(boardSize) {
    // İçerik oluşturma mantığı aynı
    const pairs = boardSize / 2;
    let cardContents = [];
    
    for (let i = 0; i < pairs - 1; i++) { 
        const emoji = EMOTICONS[i % (EMOTICONS.length - 1)]; 
        cardContents.push(emoji, emoji);
    }
    cardContents.push(BOMB_EMOJI, BOMB_EMOJI); 

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
    room.isHandlingMove = false; 
    room.hostFailedMatches = 0;
    room.guestFailedMatches = 0;
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
        if (room.hostId === socket.id) { socket.emit('joinFailed', `HATA: Zaten bu odanın sahibisiniz.`); return; }

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

    // KART ÇEVİRME HAREKETİ (Eski kodunuzda olmayan ama gerekli olan temel mantık)
    socket.on('MOVE', async (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive || room.isHandlingMove) return;

        const { cardIndex } = data;
        
        if (socket.id !== room.turn) return; 
        if (room.matchedCards.has(cardIndex) || room.flippedCards.includes(cardIndex) || room.flippedCards.length >= 2) return; 

        if (room.flippedCards.length === 1) { 
            room.isHandlingMove = true; 
        }

        room.flippedCards.push(cardIndex);
        const cardContent = room.cardContents[cardIndex];

        io.to(data.roomCode).emit('gameStateUpdate', {
            flippedCardIndex: cardIndex, 
            flippedCards: room.flippedCards,
            matchedCards: Array.from(room.matchedCards), 
            scoreHost: room.scoreHost,
            scoreGuest: room.scoreGuest,
            cardContent: cardContent 
        });

        if (room.flippedCards.length === 2) {
            const [idx1, idx2] = room.flippedCards;
            const content1 = room.cardContents[idx1];
            const content2 = room.cardContents[idx2];
            let message = '';
            
            // Bu mantık, oyunu çalışır tutmak için hala gereklidir.
            if (content1 === content2) {
                // Eşleşme
                if (room.turn === room.hostId) { room.scoreHost++; } else { room.scoreGuest++; }
                room.matchedCards.add(idx1);
                room.matchedCards.add(idx2);
                room.flippedCards = []; 
                message = "✅ Eşleşme! Sıra sizde kalıyor.";
            } else {
                // Eşleşme yok
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                message = "❌ Eşleşmedi. Sıra rakibe geçti.";
            }

            await new Promise(resolve => setTimeout(resolve, MATCH_DELAY));
            
            // Sıra ve Durum Güncellemesini Gönder
            io.to(data.roomCode).emit('turnUpdate', { 
                turn: room.turn, 
                message: message,
                flippedCards: room.flippedCards, 
                matchedCards: Array.from(room.matchedCards),
                scoreHost: room.scoreHost,
                scoreGuest: room.scoreGuest,
                playSound: (content1 === content2) ? 'MATCH_SOUND' : 'MISMATCH_SOUND'
            });
        }
        room.isHandlingMove = false; 
    });

    // --- BAĞLANTI KESME OLAYLARI (Aynı Kalıyor) ---
    socket.on('disconnect', () => {
        console.log(`[DISCONNECT] Kullanıcı ayrıldı: ${socket.id}`);
        // ... (oda temizleme mantığı) ...
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                if (room.playerCount === 2) {
                    const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                    if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.'); }
                }
                if (room.hostId === socket.id) { 
                    delete rooms[code]; 
                    console.log(`[ROOM] Oda ${code} silindi.`);
                } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1; 
                    room.guestId = null; 
                    room.guestUsername = null;
                    room.players = room.players.filter(p => p.id === room.hostId);
                    if (room.gameActive) {
                        room.gameActive = false;
                        io.to(room.hostId).emit('roomCreated', code); 
                    }
                }
                break;
            }
        }
    });
    
    // Sohbet olayını koruyalım
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;
        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;
        if (!senderName) return;
        io.to(data.roomCode).emit('newMessage', { sender: senderName, text: data.message });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    const host = process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : `http://localhost:${PORT}`;
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor. Yeni Sürüm.`);
    console.log(`🔥 Bağlantı Adresi: ${host}`);
});
