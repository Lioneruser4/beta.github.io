// Dosya Adı: server.js (BOMBALI HAFIZA OYUNU V4 - EŞ ZAMANLI + CHAT + RENDER PORT)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Statik dosyaları (index.html, game.js) sunmak için
app.use(express.static(__dirname));

const io = new Server(server, {
    // CORS ayarları (gerekirse)
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const rooms = {};

// --- Sabitler ---
const BOARD_SIZE = 20; // Sabit 20 kart
const BOMB_COUNT = 4;   // Sabit 4 bomba
const DEFAULT_LIVES = 2; // Sabit 2 can

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
    // Host ve Guest için ayrı bomba setleri oluşturulur
    room.hostBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.guestBombs = selectRandomBombs(BOARD_SIZE, BOMB_COUNT);
    room.hostLives = DEFAULT_LIVES;
    room.guestLives = DEFAULT_LIVES;
    room.board = Array(BOARD_SIZE).fill(false); // Açık/Kapalı durumu
    room.cardsLeft = BOARD_SIZE;
    room.gameActive = true;
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
            boardSize: BOARD_SIZE,
            initialLives: DEFAULT_LIVES
        });
    });

    socket.on('MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.gameActive) return;

        const { cardIndex } = data;
        
        // KRİTİK: Hangi oyuncu hamle yaptı? Host veya Guest.
        const isHostPlayer = socket.id === room.hostId;
        const playerName = isHostPlayer ? room.hostUsername : room.guestUsername;

        // 1. Kural Kontrolü: Kart Kontrolü
        if (room.board[cardIndex]) {
             socket.emit('infoMessage', { message: 'Kart zaten açık.', isError: true });
             return; 
        }
        
        // 2. Hamleyi İşle
        room.board[cardIndex] = true; // Kartı aç
        room.cardsLeft--;
        
        let moveResult = {
            cardIndex,
            hitBomb: false,
            gameOver: false,
            winner: null,
            moverName: playerName // Hamleyi kimin yaptığını client'a bildirir
        };

        // Bu oyuncunun canını düşürecek olan, RAKİBİNİN bombalarıdır.
        const opponentBombs = isHostPlayer ? room.guestBombs : room.hostBombs;
        
        if (opponentBombs.includes(cardIndex)) {
            moveResult.hitBomb = true;
            
            if (isHostPlayer) {
                room.hostLives--;
            } else {
                room.guestLives--;
            }

            // Oyun Bitiş Kontrolü (Can bitti mi?)
            if (room.hostLives <= 0 || room.guestLives <= 0) {
                 room.gameActive = false;
                 moveResult.gameOver = true;
                 
                 // Kimin kazandığını belirle
                 if (room.hostLives <= 0 && room.guestLives <= 0) {
                     moveResult.winner = 'DRAW';
                 } else {
                     // Canı biten rakip değil, hamleyi yapan kişinin canı biterse rakip kazanır.
                     moveResult.winner = room.hostLives <= 0 ? 'Guest' : 'Host';
                 }
            }
        }
        
        // Seviye Tamamlanma Kontrolü (Kart bitti mi?)
        if (room.cardsLeft === 0 && !moveResult.gameOver) {
            room.gameActive = false;
            moveResult.gameOver = true;
            // Tüm kartlar açıldıysa, daha fazla canı olan kazanır.
            if (room.hostLives === room.guestLives) {
                 moveResult.winner = 'DRAW';
            } else {
                 moveResult.winner = room.hostLives > room.guestLives ? 'Host' : 'Guest';
            }
        }

        // 3. Tüm client'lara durumu yay
        io.to(data.roomCode).emit('gameStateUpdate', {
            moveResult,
            hostLives: room.hostLives,
            guestLives: room.guestLives,
            cardsLeft: room.cardsLeft
        });
    });

    // --- SOHBET OLAYI ---
    socket.on('sendMessage', (data) => {
        const room = rooms[data.roomCode];
        if (!room || !room.hostId || !room.guestId) return; // İki oyuncu da bağlı olmalı

        let senderName = "Bilinmeyen";
        if (socket.id === room.hostId) {
            senderName = room.hostUsername;
        } else if (socket.id === room.guestId) {
            senderName = room.guestUsername;
        }

        // Mesajı odadaki herkese geri gönder
        io.to(data.roomCode).emit('newMessage', {
            sender: senderName,
            text: data.message
        });
    });
    // ----------------------

    socket.on('disconnect', () => {
        // Kopan oyuncunun odasını temizle
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

// Render'da kullanılan ÇEVRE DEĞİŞKENİ portunu veya varsayılan 10000 portunu kullan
const PORT = process.env.PORT || 10000; 
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
