// Dosya Adı: server.js
// Render'da yüklü olan kodunuzu bununla güncelleyin.
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

// Oyun için kullanılacak rastgele emojiler
const EMOJIS = ['😀','😎','🦄','🐱','🍀','🍕','🌟','⚽','🎵','🚀','🎲','🥇'];

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

function initializeGame(level = 1) {
    // Level 1: 4 bombs, subsequent levels: 6 bombs
    const bombCount = level === 1 ? 4 : 6;
    const totalCards = 16;
    const cards = [];
    
    // Add bombs
    for (let i = 0; i < bombCount; i++) {
        cards.push({ type: 'bomb', revealed: false });
    }
    
    // Add safe cards
    for (let i = bombCount; i < totalCards; i++) {
        cards.push({ type: 'safe', revealed: false });
    }
    
    // Shuffle cards
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    
    // Initial lives: 3 for level 1, 4 for subsequent levels
    const initialLives = level === 1 ? 3 : 4;
    
    return {
        cards,
        level,
        bombsLeft: bombCount,
        totalBombs: bombCount,
        gameOver: false,
        winner: null,
        allBombsExploded: false,
        hostLives: initialLives,
        guestLives: initialLives,
        currentPlayer: 'host',
        cardsLeft: totalCards - bombCount // Track remaining safe cards
    };
}

io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    socket.on('createRoom', ({ username }) => {
        const roomCode = generateRoomCode();
        const gameState = initializeGame(1);
        
        // Set initial lives for level 1
        gameState.hostLives = 3;
        gameState.guestLives = 3;
        
        rooms[roomCode] = {
            hostId: socket.id,
            hostUsername: username,
            guestId: null,
            guestUsername: null,
            playerCount: 1,
            gameState
        };
        
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, gameState });
        console.log(`Oda oluşturuldu: ${roomCode} (Host: ${username})`);
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
        room.gameState.currentPlayer = 'host';
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        // Oda kodunu da ilet ki her iki taraf da hamle gönderirken doğru kodu kullansın
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${username} odaya katıldı: ${code}`);
    });

    socket.on('cardClick', async ({ cardIndex, roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.gameState.gameOver) return;
        
        const player = room.hostId === socket.id ? 'host' : 'guest';
        if (room.gameState.currentPlayer !== player) return;
        
        const card = room.gameState.cards[cardIndex];
        if (card.revealed) return;
        
        card.revealed = true;
        let shouldSwitchPlayer = true;
        let levelUp = false;
        
        if (card.type === 'bomb') {
            room.gameState.bombsLeft--;
            
            // Decrease player's lives
            if (player === 'host') {
                room.gameState.hostLives--;
            } else {
                room.gameState.guestLives--;
            }
            
            // Check if player lost all lives
            if (room.gameState.hostLives <= 0 || room.gameState.guestLives <= 0) {
                room.gameState.gameOver = true;
                room.gameState.winner = room.gameState.hostLives <= 0 ? 'guest' : 'host';
                shouldSwitchPlayer = false;
                io.to(roomCode).emit('gameOver', { winner: room.gameState.winner });
                return;
            }
            
            // If all bombs are exploded, prepare for level up
            if (room.gameState.bombsLeft === 0) {
                levelUp = true;
                shouldSwitchPlayer = false;
            }
        } else {
            // Safe card revealed, decrement cards left counter
            room.gameState.cardsLeft--;
            
            // If all safe cards are revealed, prepare for level up
            if (room.gameState.cardsLeft === 0) {
                levelUp = true;
                shouldSwitchPlayer = false;
            }
        }
        
        // Check for level up condition (all bombs exploded or all safe cards revealed)
        if (levelUp) {
            // Wait a moment before starting next level
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Initialize next level
            const nextLevel = room.gameState.level + 1;
            const newGameState = initializeGame(nextLevel);
            
            // Preserve current lives and set initial lives for next level
            newGameState.hostLives = room.gameState.hostLives;
            newGameState.guestLives = room.gameState.guestLives;
            newGameState.currentPlayer = room.gameState.currentPlayer;
            
            // Update room state
            room.gameState = { ...room.gameState, ...newGameState };
            room.gameState.allBombsExploded = false;
            
            // Notify players about level up
            io.to(roomCode).emit('levelUp', { 
                level: nextLevel,
                hostLives: room.gameState.hostLives,
                guestLives: room.gameState.guestLives,
                bombsLeft: room.gameState.bombsLeft,
                totalBombs: room.gameState.totalBombs
            });
            
            // Skip player switch on level up
            shouldSwitchPlayer = false;
        }
        
        // Switch player turn
        if (shouldSwitchPlayer) {
            room.gameState.currentPlayer = room.gameState.currentPlayer === 'host' ? 'guest' : 'host';
            io.to(roomCode).emit('playerSwitch', { currentPlayer: room.gameState.currentPlayer });
        }
        const newLevel = parseInt(requestedLevel) || (currentLevel + 1);
        const bombCount = newLevel === 1 ? 4 : 6; // İlk seviyede 4, sonraki seviyelerde 6 bomba
        const boardSize = 20; // Tüm seviyelerde 20 kart
        
        console.log(`🔄 Yeni seviye başlatılıyor: ${newLevel}, ${bombCount} bomba ile`);
        
        // Tüm olası kart indekslerini oluştur ve karıştır
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        allIndices.sort(() => Math.random() - 0.5);
        
        // Host ve Guest için benzersiz bombalar ayarla
        room.gameState.hostBombs = allIndices.slice(0, bombCount);
        room.gameState.guestBombs = allIndices.slice(bombCount, bombCount * 2);
        
        // Can sayılarını güncelle
        room.gameState.hostLives = bombCount;
        room.gameState.guestLives = bombCount;
        
        // Oyun durumunu sıfırla
        room.gameState.opened = [];
        room.gameState.turn = 0; // Host başlasın
        room.gameState.level = newLevel;
        room.gameState.stage = 'PLAY';
        
        console.log(`✅ Yeni seviye başlatıldı: ${newLevel}, ${bombCount} bomba ile`);
        console.log(`🔵 Host Bombaları: ${room.gameState.hostBombs}`);
        console.log(`🔴 Guest Bombaları: ${room.gameState.guestBombs}`);
        
        // Oyun durumunu logla
        console.log('Oyun Durumu:', {
            level: room.gameState.level,
            hostLives: room.gameState.hostLives,
            guestLives: room.gameState.guestLives,
            turn: room.gameState.turn,
            stage: room.gameState.stage
        });
        
        // Her iki oyuncuya da yeni seviyeyi bildir
        io.to(roomCode).emit('newLevel', { 
            level: newLevel,
            boardSize: boardSize,
            hostLives: bombCount,
            guestLives: bombCount
        });
        
        // Yeni bombaları kısa gecikme ile gönder
        setTimeout(() => {
            io.to(roomCode).emit('gameReady', {
                hostBombs: room.gameState.hostBombs,
                guestBombs: room.gameState.guestBombs,
                hostLives: room.gameState.hostLives,
                guestLives: room.gameState.guestLives,
                turn: room.gameState.turn
            });
            console.log(`🚀 Yeni seviye gameReady gönderildi: ${roomCode}`);
        }, 500);
    });

    // Chat mesajlarını işle
    socket.on('chatMessage', ({ roomCode, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        // Gönderen oyuncuyu bul
        const player = [
            { id: room.hostId, username: room.hostUsername },
            { id: room.guestId, username: room.guestUsername }
        ].find(p => p.id === socket.id);
        if (!player) return;
        
        // Odaya mesajı yayınla
        io.to(roomCode).emit('chatMessage', {
            senderId: socket.id,
            username: player.username,
            message: message,
            timestamp: new Date().toISOString()
        });
    });

    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                // Oda tamamen temizlenir (her iki oyuncu da gittiğinde)
                if (room.hostId === socket.id) {
                    delete rooms[code];
                    console.log(`Oda silindi (Host ayrıldı): ${code}`);
                } else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                    room.gameState.stage = 'WAITING';
                    console.log(`Guest ayrıldı: ${code}`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
