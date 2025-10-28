// Dosya Adı: server.js (STABİL BAŞLANGIÇ - SIRALI OYNAMA)
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
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉'];
const MATCH_DELAY = 1500; // Eşleşme kontrolü bekleme süresi

// --- Yardımcı Fonksiyonlar ---
function createShuffledContents(boardSize) {
    const pairs = boardSize / 2;
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length];
        cardContents.push(emoji, emoji);
    }
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
    room.flippedCards = []; // Açılan 2 kartın indeksi
    room.turn = room.hostId; // İlk sıranın Host'ta olduğunu varsayalım
    room.gameActive = true;
    room.scoreHost = 0;
    room.scoreGuest = 0;
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    
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
        
        initializeRoom(room);
        socket.join(code);

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', {
            players, 
            cardContents: room.cardContents, 
            boardSize: BOARD_SIZE,
            turn: room.turn 
        });
    });

    socket.on('MOVE', async (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive) return;

        const { cardIndex } = data;
        
        if (socket.id !== room.turn) {
            socket.emit('infoMessage', { message: 'Sıra sizde değil!', isError: true });
            return;
        }

        if (room.matchedCards.has(cardIndex) || room.flippedCards.length >= 2) {
             socket.emit('infoMessage', { message: 'Geçersiz hareket.', isError: true });
             return; 
        }

        room.flippedCards.push(cardIndex);

        // Durumu tüm oyunculara gönder
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
                    return;
                }
                
                // Başarılı eşleşmede sıra aynı oyuncuda kalır.
                io.to(data.roomCode).emit('turnUpdate', { turn: room.turn, message: "Eşleşme! Sıra sizde kalıyor." });

            } else {
                
                // Eşleşme Başarısız: Kartların kapanması için bekle
                await new Promise(resolve => setTimeout(resolve, MATCH_DELAY));
                
                room.flippedCards = []; // Kartları kapat

                // Sırayı Değiştir
                room.turn = (room.turn === room.hostId) ? room.guestId : room.hostId;
                
                // Kartların kapandığı ve sıranın değiştiği bilgisini gönder
                io.to(data.roomCode).emit('turnUpdate', { 
                    turn: room.turn, 
                    message: "Eşleşmedi. Sıra rakibe geçti." 
                });
            }
        }
    });

    // --- SOHBET VE BAĞLANTI KESME OLAYLARI ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.hostId || !room.guestId) return;

        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;

        io.to(data.roomCode).emit('newMessage', { sender: senderName, text: data.message });
    });

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
