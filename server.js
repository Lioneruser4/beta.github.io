// Dosya Adı: server.js
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
const scores = {}; 

// Tüm cihazlarda güvenle çalışacak emojiler
const EMOJIS = [
    '😀', '😊', '😎', '😍', '😜', '😇', '😴', '😷', '🤖', '👻', '👽', '🤡',
    '🔥', '🌊', '🌚', '😺', '🌼', '⭐', '⚡', '👑'
];

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// **YARDIMCI FONKSİYON: Yeni Seviye/Oyun Hazırlığı**
function setupGameBoard(room, level = 1, isInitialSetup = false) {
    const code = room.code;
    const boardSize = 20; 
    // Level 1: 4 bomba, Diğer: 6 bomba
    const bombCount = level === 1 ? 4 : 6; 
    
    let hostLives = room.gameState.hostLives;
    let guestLives = room.gameState.guestLives;

    if (isInitialSetup || hostLives <= 0 || guestLives <= 0) {
        // İlk kurulumda veya biri öldüyse canları seviyeye göre sıfırla
        const initialLives = level === 1 ? 3 : 4;
        hostLives = initialLives;
        guestLives = initialLives;
    }

    const allIndices = Array.from({ length: boardSize }, (_, i) => i);
    allIndices.sort(() => Math.random() - 0.5);

    // Host ve Guest için benzersiz bombalar
    room.gameState.hostBombs = allIndices.slice(0, bombCount);
    room.gameState.guestBombs = allIndices.slice(bombCount, bombCount * 2);

    room.gameState.hostLives = hostLives;
    room.gameState.guestLives = guestLives;
    room.gameState.opened = [];
    room.gameState.turn = 0; // Host başlar
    room.gameState.level = level;
    room.gameState.stage = 'PLAY';

    if (!scores[code]) {
        scores[code] = { host: 0, guest: 0 };
    }

    console.log(`✅ ${code} Otağı - Level ${level} Kuruldu.`);

    const gameState = {
        hostBombs: room.gameState.hostBombs,
        guestBombs: room.gameState.guestBombs,
        hostLives: room.gameState.hostLives,
        guestLives: room.gameState.guestLives,
        turn: room.gameState.turn,
        level: room.gameState.level,
        scores: scores[code]
    };

    // Client'a güncel oyun durumunu gönder
    setTimeout(() => {
        io.to(code).emit('gameReady', gameState);
        console.log(`🚀 ${code} Otağına gameReady sinyali gönderildi.`);
    }, 500);

    return gameState;
}


io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    socket.on('createRoom', ({ username }) => {
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
                hostBombs: [],
                guestBombs: [],
                hostLives: 3,
                guestLives: 3,
                level: 1,
                opened: [],
                boardSize: 20
            }
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`Oda oluşturuldu: ${code} - Host: ${username}`);
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
        room.gameState.stage = 'PLAY'; 
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${username} otağa qoşuldu : ${code}`);
        
        // Oyun ayarlarını yap ve başlat
        setupGameBoard(room, 1, true); 
    });

    // Oyun hamlesi
    socket.on('gameData', (data) => {
        const code = data.roomCode;
        const room = rooms[code];
        if (!room || room.gameState.stage !== 'PLAY') return;

        // Sıra kontrolü
        const isHostTurn = room.gameState.turn === 0;
        const isCorrectPlayer = (isHostTurn && socket.id === room.hostId) || 
                                (!isHostTurn && socket.id === room.guestId);
        
        if (!isCorrectPlayer) {
            socket.emit('error', 'Sənin sıran deyil');
            return;
        }

        if (data.type === 'MOVE') {
            const idx = data.cardIndex;
            if (room.gameState.opened.includes(idx)) {
                socket.emit('error', 'Bu kart zaten açıldı.');
                return;
            }

            const activePlayerRole = isHostTurn ? 'Host' : 'Guest';
            const targetPlayerRole = isHostTurn ? 'Guest' : 'Host';
            const targetBombs = isHostTurn ? room.gameState.guestBombs : room.gameState.hostBombs;

            const isBomb = targetBombs.includes(idx);
            
            room.gameState.opened.push(idx);
            
            let gameResult = null; 

            if (isBomb) {
                // Vuran oyuncu (activePlayer) rakibinin canını (targetPlayer) düşürür.
                const targetLivesKey = isHostTurn ? 'guestLives' : 'hostLives'; 
                room.gameState[targetLivesKey]--;
                
                if (room.gameState[targetLivesKey] <= 0) {
                    // Oyun BİTTİ
                    room.gameState.stage = 'ENDED';
                    const winnerRole = targetPlayerRole === 'Host' ? 'Guest' : 'Host';
                    scores[code][winnerRole.toLowerCase()]++; 
                    
                    gameResult = {
                        type: 'END',
                        winner: winnerRole.toLowerCase(),
                        hostScore: scores[code].host,
                        guestScore: scores[code].guest,
                        reason: `${targetPlayerRole === 'Host' ? room.hostUsername : room.guestUsername} canı tükendi.`,
                    };
                }
            }
            
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            const emoji = isBomb ? '💣' : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
            
            const moveData = {
                type: 'MOVE',
                cardIndex: idx,
                emoji: emoji,
                isBomb: isBomb,
                newHostLives: room.gameState.hostLives,
                newGuestLives: room.gameState.guestLives,
                newTurn: room.gameState.turn,
                roomCode: code,
            };

            io.to(code).emit('gameData', moveData);
            
            if (gameResult) {
                io.to(code).emit('gameData', gameResult);
            }
        }
    });

    // Seviye tamamlama olayı (Tekrar oynama veya yeni level)
    socket.on('levelComplete', ({ roomCode, nextLevel }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        setupGameBoard(room, nextLevel, false); 
        
        const gameState = {
            level: room.gameState.level,
            hostLives: room.gameState.hostLives,
            guestLives: room.gameState.guestLives,
            turn: room.gameState.turn,
            scores: scores[roomCode] || { host: 0, guest: 0 },
            hostName: room.hostUsername,
            guestName: room.guestUsername
        };
        
        io.to(roomCode).emit('newLevel', gameState);
    });
    
    // Sohbet mesajı işleme
    socket.on('chatMessage', (data) => {
        try {
            const { roomCode, message } = data;
            const room = rooms[roomCode];
            
            if (!room) return;
            
            const player = [
                { id: room.hostId, username: room.hostUsername },
                { id: room.guestId, username: room.guestUsername }
            ].find(p => p.id === socket.id);
            if (!player) return;

            const trimmedMessage = String(message).substring(0, 200).trim();
            if (!trimmedMessage) return;
            
            io.to(roomCode).emit('chatMessage', {
                senderId: socket.id,
                username: player.username,
                message: trimmedMessage,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Sohbet mesajı işlenirken hata:', error);
        }
    });

    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const isHost = room.hostId === socket.id;
                const opponentId = isHost ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                if (isHost && !room.guestId) {
                    delete rooms[code];
                    delete scores[code];
                } else if (isHost) {
                     // Host gider, Guest yeni Host olur
                    room.hostId = room.guestId;
                    room.hostUsername = room.guestUsername;
                    room.guestId = null;
                    room.guestUsername = null;
                    room.playerCount = 1;
                    room.gameState.stage = 'WAITING';
                    
                    io.to(room.hostId).emit('hostChanged', 'Yeni Host sizsiniz. Yeni oyuncu bekleniyor.');
                } else if (!isHost) {
                    // Guest gider
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                    room.gameState.stage = 'WAITING';
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
