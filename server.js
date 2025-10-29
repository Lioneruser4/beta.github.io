// Dosya Adı: server.js (Sıra Kontrollü Güncel Sürüm)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS DÜZELTME: Tüm kaynaklardan gelen bağlantılara izin verir
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] 
});

const rooms = {}; 

// --- SABİTLER VE YARDIMCI FONKSİYONLAR ---
const LEVELS = [12, 16, 20];
const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];
const BOMB_COUNT = 3;

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// Yeni: Oda başlatma fonksiyonu
function initializeRoomGameData(room, levelIndex = 0) {
    const boardSize = LEVELS[levelIndex];
    
    // Oyun durumunu sunucuda sakla
    room.gameData = {
        level: levelIndex + 1,
        board: Array(boardSize).fill(null).map(() => ({ opened: false, content: '?' })),
        turn: 0,   // 0 = Host, 1 = Guest
        hostLives: 2,
        guestLives: 2,
        cardsLeft: boardSize,
        hostBombs: [], 
        guestBombs: [],
        gameStage: 'SELECTION', // 'SELECTION' veya 'PLAY'
        isHandlingMove: false // Hareket işleme kilidi
    };
}


io.on('connection', (socket) => {
    // console.log(`[CONNECT] ${socket.id}`);

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
        initializeRoomGameData(rooms[code]); // İlk seviye verilerini oluştur
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        // Oyunu başlat ve güncel oyun verilerini gönder
        io.to(code).emit('gameStart', { players, initialGameData: room.gameData });
    });

    // YENİ: Bomb Seçimi Olayı
    socket.on('bombSelectionComplete', ({ roomCode, isHost: selectionHost, bombs }) => {
        const room = rooms[roomCode];
        if (!room || room.gameData.gameStage !== 'SELECTION') return;

        if (selectionHost) {
            room.gameData.hostBombs = bombs;
        } else {
            room.gameData.guestBombs = bombs;
        }

        // Seçimler tamamlandı mı?
        if (room.gameData.hostBombs.length === BOMB_COUNT && room.gameData.guestBombs.length === BOMB_COUNT) {
            room.gameData.gameStage = 'PLAY';
            room.gameData.turn = 0; // Host Başlar

            // Tüm oyunculara oyunun başladığını bildir
            io.to(roomCode).emit('selectionComplete', { gameStage: 'PLAY', turn: room.gameData.turn });
        } else {
            // Rakip bombasını seçti bilgisini gönder (Client'taki "bekleniyor..." durumunu güncellemek için)
            socket.to(roomCode).emit('opponentSelectionMade');
        }
    });

    // YENİ VE KRİTİK: Hareket Olayı
    socket.on('gameData', (data) => {
        const roomCode = data.roomCode;
        const room = rooms[roomCode];
        if (!room || room.gameData.gameStage !== 'PLAY' || room.gameData.isHandlingMove || data.type !== 'MOVE') return;

        const { cardIndex } = data;
        const gameData = room.gameData;
        const isHostTurn = gameData.turn === 0;
        
        // Sadece sırası gelen oyuncu hareket edebilir
        if ((isHostTurn && socket.id !== room.hostId) || (!isHostTurn && socket.id !== room.guestId)) {
            // console.log("Sıra hatası!");
            return; 
        }

        if (gameData.board[cardIndex].opened) return; 

        room.gameData.isHandlingMove = true; // Hareketi kilitle
        
        // 1. Kartı aç
        gameData.board[cardIndex].opened = true;
        gameData.cardsLeft--;

        const isHit = isHostTurn ? gameData.guestBombs.includes(cardIndex) : gameData.hostBombs.includes(cardIndex);
        let message = isHit ? 'BOMBA VURDU!' : 'Emoji Açıldı!';

        if (isHit) {
            if (isHostTurn) { gameData.hostLives--; } else { gameData.guestLives--; }
            gameData.board[cardIndex].content = '💣';
        } else {
            // Rastgele bir emoji atama (Server'da olmalı)
            gameData.board[cardIndex].content = EMOTICONS[Math.floor(Math.random() * EMOTICONS.length)];
        }
        
        // 2. Sırayı Değiştir (KRİTİK)
        const nextTurn = gameData.turn === 0 ? 1 : 0;
        gameData.turn = nextTurn; 

        // 3. Oyun Sonu Kontrolü
        let winner = null;
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            gameData.gameStage = 'ENDED';
            if (gameData.hostLives <= 0 && gameData.guestLives <= 0) {
                winner = 'DRAW';
            } else {
                winner = gameData.hostLives <= 0 ? 'Guest' : 'Host';
            }
        } else if (gameData.cardsLeft === 0) {
            // Kartlar biterse, canı fazla olan kazanır
             gameData.gameStage = 'ENDED';
             winner = gameData.hostLives === gameData.guestLives ? 'DRAW' : (gameData.hostLives > gameData.guestLives ? 'Host' : 'Guest');
        }
        
        // 4. Tüm güncel durumu (kart içeriği, canlar, sıra) tüm odaya yayınla
        io.to(roomCode).emit('gameStateUpdate', {
            newBoardState: gameData.board,
            turn: gameData.turn,
            hostLives: gameData.hostLives,
            guestLives: gameData.guestLives,
            cardsLeft: gameData.cardsLeft,
            message: message,
            hitBomb: isHit,
            winner: winner 
        });

        room.gameData.isHandlingMove = false; // Kilidi aç
    });

    // YENİ: Seviye Atlama Sinyali (Sadece Host gönderir)
    socket.on('nextLevel', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || socket.id !== room.hostId) return;

        const newLevelIndex = room.gameData.level; // nextLevel olayını aldıktan sonra level zaten bir artmış olmalı
        if (newLevelIndex < LEVELS.length) {
            initializeRoomGameData(room, newLevelIndex); 
            // Yeni seviye verilerini clientlara gönder
            io.to(roomCode).emit('levelStart', { initialGameData: room.gameData, newLevel: room.gameData.level });
        }
    });

    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                if (room.hostId === socket.id && !room.guestId) {
                    delete rooms[code];
                } else if (room.hostId === socket.id) { // Host ayrılırsa odayı sil
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

app.use(express.static('.')); // İstemci dosyalarını sunmak için

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor.`);
});
