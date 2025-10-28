// Dosya Adı: server.js (BOMBALI HAFIZA OYUNU V3 - GÜNCELLENMİŞ MİMARİ)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const rooms = {};

// --- Sabitler ve Yardımcı Fonksiyonlar ---
const LEVELS_SIZE = [12, 16, 20]; // Kart sayısı
const BOMB_COUNTS = [2, 3, 4];   // Bomba sayısı
const DEFAULT_LIVES = 2;

function getBombCount(level) {
    return BOMB_COUNTS[level - 1] || 2;
}

function selectRandomBombs(boardSize, bombCount) {
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, bombCount).sort((a, b) => a - b);
}

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// --- Oyun Durumu Başlatıcı ---
function initializeRoom(room) {
    const level = room.currentLevel;
    const boardSize = LEVELS_SIZE[level - 1];
    
    room.hostBombs = selectRandomBombs(boardSize, getBombCount(level));
    room.guestBombs = selectRandomBombs(boardSize, getBombCount(level));
    room.currentTurn = 0; // Host başlar
    room.hostLives = DEFAULT_LIVES;
    room.guestLives = DEFAULT_LIVES;
    room.board = Array(boardSize).fill(false); // Açık/Kapalı durumu
    room.cardsLeft = boardSize;
}


// --- SOCKET.IO Olay Yönetimi ---
io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null, 
            guestUsername: null, 
            currentLevel: 1,
        };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

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

        // --- Başarılı Bağlantı ---
        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        
        // Oyunu Başlat
        initializeRoom(room);
        socket.join(code);
        
        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];

        io.to(code).emit('gameStart', {
            players, 
            hostBombs: room.hostBombs,
            guestBombs: room.guestBombs,
            level: room.currentLevel,
            initialTurn: room.currentTurn, 
            boardSize: LEVELS_SIZE[room.currentLevel - 1],
            initialLives: DEFAULT_LIVES
        });
    });

    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        const { cardIndex } = data;
        
        const isHostPlayer = socket.id === room.hostId;
        const expectedTurn = isHostPlayer ? 0 : 1;

        // 1. Kural Kontrolü: Sıra ve Kart Kontrolü
        if (room.currentTurn !== expectedTurn) {
             socket.emit('infoMessage', { message: 'Geçersiz hamle! Sıranız değil.', isError: true });
             return; 
        }
        if (room.board[cardIndex]) {
             socket.emit('infoMessage', { message: 'Geçersiz hamle! Kart zaten açık.', isError: true });
             return; 
        }
        
        // 2. Hamleyi İşle
        room.board[cardIndex] = true; // Kartı aç
        room.cardsLeft--;
        
        let moveResult = {
            cardIndex,
            hitBomb: false,
            gameOver: false,
            winner: null
        };

        // Bu oyuncunun rakibinin bombaları kontrol edilir
        const opponentBombs = isHostPlayer ? room.guestBombs : room.hostBombs;
        
        if (opponentBombs.includes(cardIndex)) {
            moveResult.hitBomb = true;
            
            if (isHostPlayer) {
                room.hostLives--;
            } else {
                room.guestLives--;
            }

            // Oyun Bitiş Kontrolü
            if (room.hostLives <= 0 || room.guestLives <= 0) {
                 moveResult.gameOver = true;
                 if (room.hostLives <= 0 && room.guestLives <= 0) {
                     moveResult.winner = 'DRAW';
                 } else {
                     // Canı biten rakip (Host ise Guest kazanır, Guest ise Host kazanır)
                     moveResult.winner = room.hostLives <= 0 ? 'Guest' : 'Host';
                 }
            }
        }
        
        // Seviye Tamamlanma Kontrolü
        if (room.cardsLeft === 0 && !moveResult.gameOver) {
            moveResult.gameOver = true;
            moveResult.winner = 'LEVEL_COMPLETE';
        }

        // 3. Sırayı Değiştir (Oyun bitmediyse)
        if (!moveResult.gameOver) {
            // Bomba yoksa sıra rakibe geçer, Bomba varsa sıra aynı oyuncuda kalır (Opsiyonel kural)
            if (!moveResult.hitBomb) {
                room.currentTurn = room.currentTurn === 0 ? 1 : 0;
            }
        }

        // 4. Tüm client'lara durumu yay
        io.to(data.roomCode).emit('gameStateUpdate', {
            moveResult,
            newTurn: room.currentTurn,
            hostLives: room.hostLives,
            guestLives: room.guestLives,
            cardsLeft: room.cardsLeft
        });
    });

    socket.on('nextLevelReady', (data) => {
        const room = rooms[data.roomCode];
        if (!room || room.hostId !== socket.id) return; // Sadece Host ilerletebilir

        room.currentLevel++;
        if (room.currentLevel > LEVELS_SIZE.length) {
            // Son seviye tamamlandı
            return;
        }

        initializeRoom(room); // Yeni seviye verilerini hazırla

        io.to(data.roomCode).emit('nextLevel', { 
            newLevel: room.currentLevel,
            hostBombs: room.hostBombs,
            guestBombs: room.guestBombs,
            boardSize: LEVELS_SIZE[room.currentLevel - 1],
            initialTurn: 0,
            initialLives: DEFAULT_LIVES
        });
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room && (room.hostId === socket.id || room.guestId === socket.id)) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                if (room.hostId === socket.id) {
                    delete rooms[code];
                } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
