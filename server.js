// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Statik dosyaları sunmak için
app.use(express.static('.'));

// --- KRİTİK GÜNCELLEME: CORS Ayarları ---
// Render gibi barındırma ortamlarında bağlantı sorunlarını çözmek için
const io = new Server(server, {
    cors: {
        origin: "*", // Tüm kaynaklardan gelen bağlantılara izin verir
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // Ağ sorunlarını gidermek için
});

const rooms = {}; 
const EMOJIS = ['😀', '😎', '🦄', '🐱', '🍀', '🍕', '🌟', '⚽', '🎵', '🚀', '🎲', '🥇'];

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

function initializeGame(room, gameType) {
    room.gameState.currentGame = gameType;
    room.gameState.turn = 0; 
    room.gameState.opened = [];
    room.gameState.level = 1;
    room.gameState.stage = 'PLAY';
    
    if (gameType === 'MEMORY') {
        const boardSize = 20; 
        const bombCount = 3; 
        
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        allIndices.sort(() => Math.random() - 0.5);
        
        room.gameState.hostBombs = allIndices.slice(0, bombCount);
        room.gameState.guestBombs = allIndices.slice(bombCount, bombCount * 2);
        
        room.gameState.hostLives = bombCount;
        room.gameState.guestLives = bombCount;
        room.gameState.boardSize = boardSize;
        
        console.log(`🎲 MEMORY Oyunu Hazır - Host Bomba: ${room.gameState.hostBombs}, Guest Bomba: ${room.gameState.guestBombs}`);
        
    } else if (gameType === 'PONG') {
        room.gameState.hostScore = 0;
        room.gameState.guestScore = 0;
        console.log(`🏓 PONG Oyunu Hazır`);
    }
}

io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    // createRoom, joinRoom, gameData, levelComplete, pongMove, pongBallUpdate, pongScore, chatMessage ve disconnect olayları burada olduğu gibi kalır.

    socket.on('createRoom', ({ username, gameType }) => { 
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null,
            guestUsername: null,
            gameState: {
                stage: 'WAITING', 
                turn: 0,
                currentGame: gameType, 
                hostBombs: [], guestBombs: [], hostLives: 3, guestLives: 3, level: 1, opened: [], boardSize: 20, 
                hostScore: 0, guestScore: 0
            }
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`Oda oluşturuldu: ${code} - Host: ${username}, Oyun: ${gameType}`);
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
        
        initializeGame(room, room.gameState.currentGame);

        io.to(code).emit('gameStart', { 
            players, 
            roomCode: code,
            gameType: room.gameState.currentGame 
        });
        
        const gameState = room.gameState;

        setTimeout(() => {
            if (room.gameState.currentGame === 'MEMORY') {
                 io.to(code).emit('gameReady', {
                    hostBombs: gameState.hostBombs,
                    guestBombs: gameState.guestBombs,
                    hostLives: gameState.hostLives,
                    guestLives: gameState.guestLives,
                    turn: gameState.turn,
                    level: gameState.level
                });
            }
            if (room.gameState.currentGame === 'PONG') {
                 io.to(code).emit('pongReady', { 
                    hostScore: gameState.hostScore,
                    guestScore: gameState.guestScore 
                });
            }
        }, 500);
    });

    // --- MEMORY OYUN MANTIKLARI (Kaldığı Gibi) ---
    socket.on('gameData', (data) => {
        const code = data.roomCode;
        const room = rooms[code];
        if (!room || room.gameState.currentGame !== 'MEMORY' || room.gameState.stage !== 'PLAY') return;
        
        const isHostTurn = room.gameState.turn === 0;
        const isCorrectPlayer = (isHostTurn && socket.id === room.hostId) || (!isHostTurn && socket.id === room.guestId);

        if (!isCorrectPlayer) {
            socket.emit('error', 'Senin sıran değil!');
            return;
        }

        if (data.type === 'MOVE') {
            const idx = data.cardIndex;
            if (room.gameState.opened.includes(idx)) {
                socket.emit('error', 'Bu kart zaten açıldı.');
                return;
            }

            const isBomb = isHostTurn ? room.gameState.guestBombs.includes(idx) : room.gameState.hostBombs.includes(idx);
            const emoji = isBomb ? '💣' : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
            room.gameState.opened.push(idx);
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            io.to(code).emit('gameData', {
                type: 'MOVE',
                cardIndex: idx,
                emoji: emoji,
                isBomb: isBomb,
                roomCode: code
            });
        }
    });

    socket.on('levelComplete', ({ roomCode, nextLevel }) => {
        const room = rooms[roomCode];
        if (!room || room.gameState.currentGame !== 'MEMORY') return;
        
        setTimeout(() => {
            const bombCount = nextLevel === 1 ? 3 : 4; 
            const boardSize = 20; 
            
            const allIndices = Array.from({ length: boardSize }, (_, i) => i);
            allIndices.sort(() => Math.random() - 0.5);
            
            room.gameState.hostBombs = allIndices.slice(0, bombCount);
            room.gameState.guestBombs = allIndices.slice(bombCount, bombCount * 2);
            
            room.gameState.hostLives = bombCount;
            room.gameState.guestLives = bombCount;
            
            room.gameState.opened = [];
            room.gameState.turn = 0; 
            room.gameState.level = nextLevel;
            room.gameState.stage = 'PLAY';
            
            io.to(roomCode).emit('newLevel', { 
                level: nextLevel,
                boardSize: boardSize,
                hostLives: bombCount,
                guestLives: bombCount
            });
            
            setTimeout(() => {
                io.to(roomCode).emit('gameReady', {
                    hostBombs: room.gameState.hostBombs,
                    guestBombs: room.gameState.guestBombs,
                    hostLives: room.gameState.hostLives,
                    guestLives: room.gameState.guestLives,
                    turn: room.gameState.turn
                });
            }, 500);
        }, 1000);
    });

    // --- PONG OYUN MANTIKLARI (Kaldığı Gibi) ---
    socket.on('pongMove', ({ roomCode, y, isHost: movedByHost }) => {
        const room = rooms[roomCode];
        if (!room || room.gameState.currentGame !== 'PONG' || room.gameState.stage !== 'PLAY') return;
        socket.to(roomCode).emit('pongMove', { y, isHost: movedByHost });
    });

    socket.on('pongBallUpdate', (data) => {
        const room = rooms[data.roomCode];
        if (!room || room.gameState.currentGame !== 'PONG' || room.hostId !== socket.id || room.gameState.stage !== 'PLAY') return;
        socket.to(data.roomCode).emit('pongBallUpdate', data);
    });

    socket.on('pongScore', ({ roomCode, score, scorerIsHost }) => {
        const room = rooms[roomCode];
        if (!room || room.gameState.currentGame !== 'PONG' || room.gameState.stage !== 'PLAY') return;

        if (scorerIsHost) {
            room.gameState.hostScore = score;
        } else {
            room.gameState.guestScore = score;
        }
        socket.to(roomCode).emit('pongScore', { score, scorerIsHost });
    });
    
    // --- CHAT (Kaldığı Gibi) ---
    socket.on('chatMessage', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = [
            { id: room.hostId, username: room.hostUsername },
            { id: room.guestId, username: room.guestUsername }
        ].find(p => p.id === socket.id);
        if (!player) return;
        io.to(roomCode).emit('chatMessage', {
            senderId: socket.id,
            username: player.username,
            message: message,
            timestamp: new Date().toISOString()
        });
    });

    // --- BAĞLANTI KESİLDİĞİNDE (Kaldığı Gibi) ---
    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                if (room.hostId === socket.id && room.guestId) {
                    delete rooms[code]; 
                    console.log(`Oda silindi (Host ayrıldı): ${code}`);
                } else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                    room.gameState.stage = 'WAITING';
                    console.log(`Guest ayrıldı: ${code}`);
                } else if (room.hostId === socket.id && !room.guestId) {
                    delete rooms[code];
                    console.log(`Oda silindi (Tek host ayrıldı): ${code}`);
                }
            }
        }
    });
});

// Port tanımı
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
