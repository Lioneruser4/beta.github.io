// Dosya Adı: server.js (EMOJİ BOMBA OYUNU SUNUCU)
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static('.')); 

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
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
    
    // Normal Eşleşen Kartlar
    for (let i = 0; i < pairs - 1; i++) { // 9 Çift (18 Kart)
        const emoji = EMOTICONS[i % (EMOTICONS.length - 1)]; 
        cardContents.push(emoji, emoji);
    }
    
    // 2 adet BOMBA Kartı Ekle
    cardContents.push(BOMB_EMOJI, BOMB_EMOJI); 

    // Karıştır
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
        
        // Sıra kontrolü
        if (socket.id !== room.turn) return; 
        if (room.matchedCards.has(cardIndex) || room.flippedCards.includes(cardIndex) || room.flippedCards.length >= 2) return; 

        if (room.flippedCards.length === 1) { 
            room.isHandlingMove = true; 
        }

        room.flippedCards.push(cardIndex);
        const cardContent = room.cardContents[cardIndex];

        // 1. ADIM: Kart açma bilgisini anında tüm odaya gönder (Senkronizasyon Düzeltmesi)
        io.to(data.roomCode).emit('gameStateUpdate', {
            flippedCardIndex: cardIndex, 
            flippedCards: room.flippedCards,
            matchedCards: Array.from(room.matchedCards), 
            scoreHost: room.scoreHost,
            scoreGuest: room.scoreGuest,
            cardContent: cardContent 
        });


        // 2. ADIM: Bomba veya Eşleşme Kontrolü
        if (room.flippedCards.length === 2) {
            const [idx1, idx2] = room.flippedCards;
            const content1 = room.cardContents[idx1];
            const content2 = room.cardContents[idx2];
            let message = '';
            let turnChange = true;
            let playSound = null; 

            // Bomba Kontrolü
            if (content1 === BOMB_EMOJI || content2 === BOMB_EMOJI) {
                
                message = "💣 BOMBA! Rakibe bir eşleşme hakkı kazandırdınız!";
                playSound = 'BOMB_SOUND'; 
                
                room.flippedCards = []; 
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                turnChange = true;

            } else if (content1 === content2) {
                
                // Başarılı Eşleşme
                message = "✅ Eşleşme! Sıra sizde kalıyor.";
                playSound = 'MATCH_SOUND';

                room.matchedCards.add(idx1);
                room.matchedCards.add(idx2);
                
                if (room.turn === room.hostId) { room.scoreHost++; } else { room.scoreGuest++; }
                
                room.flippedCards = []; 
                turnChange = false; 

            } else {
                
                // Eşleşme Başarısız
                message = "❌ Eşleşmedi. Sıra rakibe geçti.";
                playSound = 'MISMATCH_SOUND';
                
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                turnChange = true;
            }

            
            // Kartların Kapanması için bekleme
            await new Promise(resolve => setTimeout(resolve, MATCH_DELAY));
            
            // Oyun Bitti mi Kontrolü
            if (room.matchedCards.size === (BOARD_SIZE - 2) && room.gameActive) { 
                room.gameActive = false;
                const winner = room.scoreHost === room.scoreGuest ? 'DRAW' : room.scoreHost > room.scoreGuest ? 'Host' : 'Guest';
                io.to(data.roomCode).emit('gameEnd', { winner, scoreHost: room.scoreHost, scoreGuest: room.scoreGuest });
            }


            // Sıra ve Durum Güncellemesini Gönder
            io.to(data.roomCode).emit('turnUpdate', { 
                turn: room.turn, 
                message: message,
                flippedCards: room.flippedCards, 
                matchedCards: Array.from(room.matchedCards),
                scoreHost: room.scoreHost,
                scoreGuest: room.scoreGuest,
                playSound: playSound,
                turnChange: turnChange,
                isBomb: (content1 === BOMB_EMOJI || content2 === BOMB_EMOJI) ? true : false,
                bombIndexes: (content1 === BOMB_EMOJI && content2 === BOMB_EMOJI) ? [idx1, idx2] : 
                             (content1 === BOMB_EMOJI) ? [idx1] : 
                             (content2 === BOMB_EMOJI) ? [idx2] : [] 
            });

        } else {
            room.isHandlingMove = false;
        }

        room.isHandlingMove = false; 
    });

    // --- SOHBET VE BAĞLANTI KESME OLAYLARI (Aynı) ---
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
                    if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.'); }
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
    const host = process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL : `http://localhost:${PORT}`;
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor.`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`🔥 Bağlantı Adresi: ${host}`);
    console.log(`📢 index.html dosyasındaki LIVE_SERVER_URL değişkenini bu adresle EŞLEŞTİRMEYİ UNUTMAYIN.`);
    console.log(`--------------------------------------------------------------------------------`);
});
