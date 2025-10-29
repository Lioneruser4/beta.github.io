// Dosya Adı: server.js (PROFESYONEL EMOJİ BOMB SUNUCU)
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static('.')); 

// Profesyonel CORS ve Transport Ayarları
const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // En yaygın iki metodu zorlar
});

const rooms = {};

// --- Sabitler ---
const BOARD_SIZE = 20; 
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉', '💣']; 
const BOMB_EMOJI = '💣';
const MATCH_DELAY = 1500; 

// --- Yardımcı Fonksiyonlar ---
function createShuffledContents(boardSize) {
    const pairs = boardSize / 2;
    let cardContents = [];
    
    // 10 çift kart (9 normal, 1 bomba çifti)
    for (let i = 0; i < pairs - 1; i++) { 
        const emoji = EMOTICONS[i % (EMOTICONS.length - 1)]; 
        cardContents.push(emoji, emoji);
    }
    cardContents.push(BOMB_EMOJI, BOMB_EMOJI); 

    // Fisher-Yates Karıştırma
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
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    console.log(`[CONNECT] Kullanıcı bağlandı: ${socket.id}`);
    
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
    });

    // KART ÇEVİRME HAREKETİ
    socket.on('MOVE', async (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive || room.isHandlingMove || socket.id !== room.turn) return;

        const { cardIndex } = data;
        
        if (room.matchedCards.has(cardIndex) || room.flippedCards.includes(cardIndex) || room.flippedCards.length >= 2) return; 

        if (room.flippedCards.length === 1) { 
            room.isHandlingMove = true; 
        }

        room.flippedCards.push(cardIndex);
        const cardContent = room.cardContents[cardIndex];

        // Anında kart açma bilgisini gönder (Senkronizasyon)
        io.to(data.roomCode).emit('gameStateUpdate', {
            flippedCardIndex: cardIndex, 
            flippedCards: room.flippedCards,
            cardContent: cardContent 
        });


        // İkinci kart açıldığında kontrol et
        if (room.flippedCards.length === 2) {
            const [idx1, idx2] = room.flippedCards;
            const content1 = room.cardContents[idx1];
            const content2 = room.cardContents[idx2];
            let message = '';
            let turnChange = true;
            let playSound = null; 

            if (content1 === BOMB_EMOJI || content2 === BOMB_EMOJI) {
                
                message = "💣 BOMBA! Sıra rakibe geçti.";
                playSound = 'BOMB_SOUND'; 
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                turnChange = true;

            } else if (content1 === content2) {
                
                message = "✅ Eşleşme! Sıra sizde kalıyor.";
                playSound = 'MATCH_SOUND';

                room.matchedCards.add(idx1);
                room.matchedCards.add(idx2);
                
                if (room.turn === room.hostId) { room.scoreHost++; } else { room.scoreGuest++; }
                turnChange = false; 

            } else {
                
                message = "❌ Eşleşmedi. Sıra rakibe geçti.";
                playSound = 'MISMATCH_SOUND';
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                turnChange = true;
            }

            
            // Animasyon süresi kadar bekle
            await new Promise(resolve => setTimeout(resolve, MATCH_DELAY));
            room.flippedCards = []; // Kartları kapat

            
            // Oyun Bitti mi Kontrolü
            if (room.matchedCards.size === BOARD_SIZE && room.gameActive) { 
                room.gameActive = false;
                const winner = room.scoreHost === room.scoreGuest ? 'DRAW' : room.scoreHost > room.scoreGuest ? room.hostUsername : room.guestUsername;
                io.to(data.roomCode).emit('gameEnd', { winner, scoreHost: room.scoreHost, scoreGuest: room.scoreGuest });
            }


            // Sıra ve Durum Güncellemesini Gönder
            io.to(data.roomCode).emit('turnUpdate', { 
                turn: room.turn, 
                message: message,
                matchedCards: Array.from(room.matchedCards),
                scoreHost: room.scoreHost,
                scoreGuest: room.scoreGuest,
                playSound: playSound,
                turnChange: turnChange,
                isBomb: (content1 === BOMB_EMOJI || content2 === BOMB_EMOJI),
                // Bomba açıldıysa, kartların kapanması için indeksi gönderiyoruz.
                flippedIndexesToClose: turnChange ? [idx1, idx2] : [] 
            });
        }
        room.isHandlingMove = false; 
    });

    // --- SOHBET VE BAĞLANTI KESME OLAYLARI ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;
        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;
        io.to(data.roomCode).emit('newMessage', { sender: senderName, text: data.message });
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                // Rakibe haber ver
                if (room.playerCount === 2) {
                    const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                    if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.'); }
                }
                // Odayı temizle
                if (room.hostId === socket.id) { 
                    delete rooms[code]; 
                } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1; 
                    room.guestId = null; 
                    room.guestUsername = null;
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    const host = process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : `http://localhost:${PORT}`;
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor.`);
    console.log(`🔥 İSTEMCİ ADRESİNİZ: ${host}`);
});
