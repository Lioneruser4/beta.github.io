// Dosya Adı: server.js (Render URL'ye ve Port 10000'e uygun)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS DÜZELTME: Render'dan gelen bağlantılara izin verir
const io = new Server(server, {
    cors: {
        // Render URL'si kendi origin'i olabilir, bu yüzden hepsine izin vermek en güvenlisi
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
        gameStage: 'SELECTION', // 'SELECTION', 'PLAY', 'ENDED'
        isHandlingMove: false // Hareket işleme kilidi
    };
}


io.on('connection', (socket) => {
    // Oda Oluşturma
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

    // Odaya Katılma
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

    // Bomb Seçimi Olayı
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

    // KRİTİK: Hareket Olayı (Sıra Kontrolü Burada Yapılır)
    socket.on('gameData', (data) => {
        const roomCode = data.roomCode;
        const room = rooms[roomCode];
        if (!room || room.gameData.gameStage !== 'PLAY' || room.gameData.isHandlingMove || data.type !== 'MOVE') return;

        const { cardIndex } = data;
        const gameData = room.gameData;
        const isHostTurn = gameData.turn === 0;
        
        // Sıra Kontrolü
        if ((isHostTurn && socket.id !== room.hostId) || (!isHostTurn && socket.id !== room.guestId)) {
            return; 
        }

        if (gameData.board[cardIndex].opened) return; 

        room.gameData.isHandlingMove = true; // Hareketi kilitle
        
        // Kartı Açma ve Can Kontrolü
        gameData.board[cardIndex].opened = true;
        gameData.cardsLeft--;

        const isHit = isHostTurn ? gameData.guestBombs.includes(cardIndex) : gameData.hostBombs.includes(cardIndex);
        let message = isHit ? 'BOMBA VURDU!' : 'Emoji Açıldı!';

        if (isHit) {
            if (isHostTurn) { gameData.hostLives--; } else { gameData.guestLives--; }
            gameData.board[cardIndex].content = '💣';
        } else {
            gameData.board[cardIndex].content = EMOTICONS[Math.floor(Math.random() * EMOTICONS.length)];
        }
        
        // Sırayı Değiştir
        const nextTurn = gameData.turn === 0 ? 1 : 0;
        gameData.turn = nextTurn; 

        // Oyun Sonu Kontrolü
        let winner = null;
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0 || gameData.cardsLeft === 0) {
            gameData.gameStage = 'ENDED';
            if (gameData.hostLives <= 0 && gameData.guestLives <= 0) {
                winner = 'DRAW';
            } else if (gameData.hostLives <= 0) {
                winner = 'Guest';
            } else if (gameData.guestLives <= 0) {
                winner = 'Host';
            } else if (gameData.cardsLeft === 0) {
                winner = gameData.hostLives === gameData.guestLives ? 'DRAW' : (gameData.hostLives > gameData.guestLives ? 'Host' : 'Guest');
            }
        }
        
        // Tüm güncel durumu tüm odaya yayınla
        io.to(roomCode).emit('gameStateUpdate', {
            newBoardState: gameData.board,
            turn: gameData.turn,
            hostLives: gameData.hostLives,
            guestLives: gameData.guestLives, // Düzeltildi
            cardsLeft: gameData.cardsLeft,
            message: message,
            hitBomb: isHit,
            winner: winner 
        });

        room.gameData.isHandlingMove = false; // Kilidi aç
    });

    // Seviye Atlama Sinyali (Sadece Host gönderir)
    socket.on('nextLevel', ({ roomCode }) => {
        const room = rooms[roomCode];
        // Host ve seviye limitini aşmamışsa
        if (!room || socket.id !== room.hostId || room.gameData.level >= LEVELS.length) return; 

        const newLevelIndex = room.gameData.level; 
        initializeRoomGameData(room, newLevelIndex); 
        
        io.to(roomCode).emit('levelStart', { initialGameData: room.gameData, newLevel: room.gameData.level });
    });

    // Bağlantı Kesilmesi
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                // Odayı Temizle/Yenile
                if (room.hostId === socket.id) {
                    delete rooms[code]; // Host ayrılırsa odayı tamamen sil
                } else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                    // Host'a bilgi gönderilebilir: "Rakip ayrıldı, yeni oyuncu bekleniyor"
                }
            }
        }
    });
});

app.use(express.static('.')); // İstemci dosyalarını sunmak için

// Render Portu Olarak Ayarlandı
const PORT = process.env.PORT || 10000; 
server.listen(PORT, () => {
    console.log(`🚀 Sunucu port ${PORT} üzerinde çalışıyor.`);
});
