// Dosya Adı: server.js (BOMBALI HAFIZA OYUNU V9 - STABİL BAĞLANTI + SONSUZ SEVİYE)
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

// --- Yardımcı Fonksiyonlar (Aynı Kalır) ---
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

function selectRandomBombs(boardSize, bombCount) {
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

// --- Oyun Durumu Başlatıcı (Yeni Seviye için de kullanılır) ---
function initializeRoom(room) {
    room.hostBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.guestBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    // Canlar korunur, sadece ilk başlangıçta ayarlanır
    if (typeof room.hostLives === 'undefined') room.hostLives = DEFAULT_LIVES;
    if (typeof room.guestLives === 'undefined') room.guestLives = DEFAULT_LIVES;
    
    room.openedCards = new Set();
    
    const emojiBoard = createShuffledContents(BOARD_SIZE); 
    
    room.cardContents = emojiBoard.map((content, index) => {
        if (room.guestBombs.has(index) || room.hostBombs.has(index)) {
             return '💣'; 
        } 
        return content;
    });

    room.cardsLeft = BOARD_SIZE;
    room.gameActive = true;
    
    return {
        cardContents: room.cardContents,
        hostLives: room.hostLives,
        guestLives: room.guestLives
    };
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    
    console.log(`Yeni bağlantı: ${socket.id}`);

    // --- ODA OLUŞTURMA ---
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        // Oda objesini resetliyoruz
        rooms[code] = { 
            code, 
            playerCount: 1, 
            hostId: socket.id, 
            hostUsername: username, 
            guestId: null, 
            guestUsername: null,
            hostLives: DEFAULT_LIVES, // Canları burada ilk kez tanımla
            guestLives: DEFAULT_LIVES
        };
        socket.join(code);
        console.log(`Oda oluşturuldu: ${code} - Host: ${username}`);
        socket.emit('roomCreated', code);
    });

    // --- ODAYA KATILMA (Eski stabil mantık) ---
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) { 
            socket.emit('joinFailed', `HATA: ${code} kodlu oda bulunamadı.`); 
            return; 
        }
        
        if (room.playerCount >= 2) { 
            socket.emit('joinFailed', `HATA: ${code} kodlu oda zaten dolu.`); 
            return; 
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        
        const initialData = initializeRoom(room); // Oyunu başlat
        socket.join(code);
        
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        console.log(`Odaya başarıyla katıldı ve oyun başlatılıyor: ${code}`);

        // Odaya bağlı tüm client'lara oyunu başlat sinyalini gönder
        io.to(code).emit('gameStart', {
            code: code,
            players, 
            cardContents: initialData.cardContents, 
            boardSize: BOARD_SIZE,
            initialLives: DEFAULT_LIVES // client için initialLives hala lazım
        });
    });

    // --- HAREKET (MOVE) MANTIĞI (Level Up ile aynı kalır) ---
    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive) return;

        const { cardIndex } = data;
        
        const isHostPlayer = socket.id === room.hostId;
        const playerName = isHostPlayer ? room.hostUsername : room.guestUsername;

        if (room.openedCards.has(cardIndex)) {
             socket.emit('infoMessage', { message: 'Kart zaten açık.', isError: true });
             return; 
        }
        
        room.openedCards.add(cardIndex);
        room.cardsLeft--;
        
        let moveResult = { cardIndex, hitBomb: false, gameOver: false, winner: null, moverName: playerName };

        const opponentBombs = isHostPlayer ? room.guestBombs : room.hostBombs;
        
        if (opponentBombs.has(cardIndex)) {
            moveResult.hitBomb = true;
            
            if (isHostPlayer) { room.hostLives--; } else { room.guestLives--; }

            if (room.hostLives <= 0 || room.guestLives <= 0) {
                 room.gameActive = false;
                 moveResult.gameOver = true;
                 moveResult.winner = room.hostLives <= 0 && room.guestLives <= 0 ? 'DRAW' : room.hostLives <= 0 ? 'Guest' : 'Host';
            }
        } 
        
        // SEVİYE TAMAMLANMA KONTROLÜ (Level Up)
        if (room.cardsLeft === 0 && !moveResult.gameOver) {
            
            const newLevelData = initializeRoom(room);
            
            io.to(data.roomCode).emit('levelUp', {
                hostLives: room.hostLives,
                guestLives: room.guestLives,
                cardContents: newLevelData.cardContents,
                cardCount: BOARD_SIZE,
                message: "Tebrikler! Yeni seviyeye geçiliyor. Canlar korundu!"
            });
            return; 
        }

        io.to(data.roomCode).emit('gameStateUpdate', {
            moveResult,
            hostLives: room.hostLives,
            guestLives: room.guestLives,
            cardsLeft: room.cardsLeft,
            openedCardsIndices: Array.from(room.openedCards) 
        });
    });

    // --- SOHBET VE BAĞLANTI KESME OLAYLARI (Aynı Kalır) ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.hostId || !room.guestId) return;

        let senderName = (socket.id === room.hostId) ? room.hostUsername : room.guestUsername;

        io.to(data.roomCode).emit('newMessage', {
            sender: senderName,
            text: data.message
        });
    });

    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (room.hostId === socket.id) { 
                    if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Oda sahibi (Host) ayrıldı. Lobiye dönülüyor.'); }
                    delete rooms[code]; 
                } 
                else if (room.guestId === socket.id) {
                    if (opponentId) { io.to(opponentId).emit('opponentLeft', 'Rakibiniz ayrıldı. Yeni oyuncu beklenebilir.'); }
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
