// Dosya Adı: server.js
// Render'da yüklü olan kodunuzu bununla güncelleyin.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

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
const users = new Map();
const userSockets = new Map();

// Oyun ayarları
const GAME_SETTINGS = {
    PLAYER_SPEED: 10,
    BULLET_SPEED: 15,
    PLAYER_HEALTH: 100,
    BULLET_DAMAGE: 25,
    GAME_DURATION: 120000 // 2 dakika (milisaniye cinsinden)
};

// Oyun durumları
const GAME_STATES = {
    WAITING: 'waiting',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    FINISHED: 'finished'
};

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// Telegram WebApp doğrulama fonksiyonu
function verifyTelegramData(authData) {
    const botToken = ''; // Bot token'ınızı buraya ekleyin
    const dataCheckString = Object.keys(authData)
        .filter(key => key !== 'hash')
        .sort()
        .map(key => `${key}=${authData[key]}`)
        .join('\n');

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const hash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    return hash === authData.hash;
}

io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    // Kullanıcı bilgilerini ayarla
    // Oyun olaylarını dinle
    socket.on('joinGame', ({ username }) => {
        // Mevcut bir odaya katıl veya yeni oda oluştur
        let room = null;
        let roomCode = '';
        let isHost = false;
        
        // Boş oda ara
        for (const [code, r] of Object.entries(rooms)) {
            if (r.playerCount < 2) {
                room = r;
                roomCode = code;
                break;
            }
        }
        
        if (!room) {
            // Yeni oda oluştur
            roomCode = generateRoomCode();
            isHost = true;
            room = {
                code: roomCode,
                playerCount: 1,
                hostId: socket.id,
                hostUsername: username,
                hostUserId: userSockets.get(socket.id),
                guestId: null,
                guestUsername: null,
                gameState: {
                    status: GAME_STATES.WAITING,
                    countdown: 3,
                    players: {
                        [socket.id]: {
                            id: socket.id,
                            username,
                            x: 0,
                            y: isHost ? 100 : window.innerHeight - 100,
                            health: GAME_SETTINGS.PLAYER_HEALTH,
                            score: 0,
                            isHost: true
                        }
                    },
                    bullets: [],
                    startTime: null,
                    endTime: null
                }
            };
            rooms[roomCode] = room;
        } else {
            // Mevcut odaya katıl
            room.playerCount++;
            room.guestId = socket.id;
            room.guestUsername = username;
            room.guestUserId = userSockets.get(socket.id);
            room.gameState.players[socket.id] = {
                id: socket.id,
                username,
                x: 0,
                y: window.innerHeight - 100,
                health: GAME_SETTINGS.PLAYER_HEALTH,
                score: 0,
                isHost: false
            };
            
            // Oyunu başlat
            room.gameState.status = GAME_STATES.COUNTDOWN;
            room.gameState.startTime = Date.now() + 3000; // 3 saniye geri sayım
            
            // Geri sayım başlat
            const countdownInterval = setInterval(() => {
                room.gameState.countdown--;
                io.to(roomCode).emit('gameUpdate', room.gameState);
                
                if (room.gameState.countdown <= 0) {
                    clearInterval(countdownInterval);
                    room.gameState.status = GAME_STATES.PLAYING;
                    room.gameState.startTime = Date.now();
                    room.gameState.endTime = room.gameState.startTime + GAME_SETTINGS.GAME_DURATION;
                    io.to(roomCode).emit('gameStart', room.gameState);
                }
            }, 1000);
        }
        
        socket.join(roomCode);
        socket.emit('joinedGame', {
            roomCode,
            isHost,
            gameState: room.gameState
        });
        
        // Oyun güncellemelerini dinle
        socket.on('playerMove', (data) => {
            if (room && room.gameState.players[socket.id]) {
                const player = room.gameState.players[socket.id];
                player.x = data.x;
                io.to(roomCode).emit('gameUpdate', room.gameState);
            }
        });
        
        socket.on('playerShoot', (data) => {
            if (room && room.gameState.status === GAME_STATES.PLAYING) {
                const bullet = {
                    id: Date.now(),
                    x: data.x,
                    y: data.y,
                    direction: data.direction,
                    owner: socket.id
                };
                room.gameState.bullets.push(bullet);
                io.to(roomCode).emit('bulletFired', bullet);
            }
        });
        
        socket.on('playerHit', (data) => {
            if (room && room.gameState.status === GAME_STATES.PLAYING) {
                const player = Object.values(room.gameState.players).find(p => p.id === data.playerId);
                if (player) {
                    player.health -= GAME_SETTINGS.BULLET_DAMAGE;
                    
                    // Skoru güncelle
                    const shooter = room.gameState.players[data.shooterId];
                    if (shooter) {
                        shooter.score += 10;
                    }
                    
                    // Oyun bitiş kontrolü
                    if (player.health <= 0) {
                        room.gameState.status = GAME_STATES.FINISHED;
                        room.gameState.winner = shooter.username;
                    }
                    
                    io.to(roomCode).emit('gameUpdate', room.gameState);
                }
            }
        });
    });
    
    // Kullanıcı bağlantısı koptuğunda
    socket.on('disconnect', () => {
        const userId = userSockets.get(socket.id);
        if (userId) {
            users.delete(userId);
            userSockets.delete(socket.id);
            console.log(`Kullanıcı ayrıldı: ${userId}`);
        }
        
        // Eğer bu kullanıcı bir odanın sahibiyse, odayı kaldır
        for (const [code, room] of Object.entries(rooms)) {
            if (room.hostId === socket.id || room.guestId === socket.id) {
                // Diğer oyuncuya bağlantının koptuğunu bildir
                const otherPlayerId = room.hostId === socket.id ? room.guestId : room.hostId;
                if (otherPlayerId) {
                    io.to(otherPlayerId).emit('opponentDisconnected');
                }
                
                // Odayı kaldır
                delete rooms[code];
                console.log(`Oda kaldırıldı: ${code}`);
                break;
            }
        }
    });
    
    // Oyun döngüsü - sürekli çalışacak
    setInterval(() => {
        Object.values(rooms).forEach(room => {
            if (room.gameState.status === GAME_STATES.PLAYING) {
                // Mermileri güncelle
                room.gameState.bullets = room.gameState.bullets.filter(bullet => {
                    // Merminin yeni pozisyonunu hesapla
                    bullet.y += bullet.direction === 'up' ? -GAME_SETTINGS.BULLET_SPEED : GAME_SETTINGS.BULLET_SPEED;
                    
                    // Ekran dışına çıkan mermileri kaldır
                    return bullet.y > 0 && bullet.y < window.innerHeight;
                });
                
                // Oyun süresi kontrolü
                if (Date.now() >= room.gameState.endTime) {
                    room.gameState.status = GAME_STATES.FINISHED;
                    // En yüksek skorlu oyuncuyu belirle
                    const players = Object.values(room.gameState.players);
                    const winner = players.reduce((prev, current) => 
                        (prev.score > current.score) ? prev : current
                    );
                    room.gameState.winner = winner.username;
                }
                
                // Oyun durumunu tüm oyunculara gönder
                io.to(room.code).emit('gameUpdate', room.gameState);
            }
        });
    }, 1000 / 60); // Saniyede 60 kare
        
        socket.emit('roomCreated', { code });
        console.log(`Oda oluşturuldu: ${code} (${username})`);
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];
        if (!room) {
            socket.emit('error', { message: 'Oda bulunamadı!' });

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        room.gameState.stage = 'SELECTION';
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        // Oda kodunu da ilet ki her iki taraf da hamle gönderirken doğru kodu kullansın
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${username} otağa Qoşuldu : ${code}`);
        
        // Oyun tahtası ayarları
        const boardSize = 20; // Tüm seviyelerde 20 kart
        const bombCount = 4; // Level 1'de 4 bomba
        
        // Tüm olası kart indekslerini oluştur ve karıştır
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        allIndices.sort(() => Math.random() - 0.5);
        
        // Host ve Guest için bombaları ayarla (her oyuncu için ayrı bombalar)
        room.gameState.hostBombs = [];
        room.gameState.guestBombs = [];
        
        // Host için bombaları seç
        for (let i = 0; i < bombCount; i++) {
            room.gameState.hostBombs.push(allIndices[i]);
        }
        
        // Guest için farklı bombalar seç
        for (let i = bombCount; i < bombCount * 2; i++) {
            room.gameState.guestBombs.push(allIndices[i]);
        }
        
        // Tüm seviyelerde 3 can
        room.gameState.hostLives = 3;
        room.gameState.guestLives = 3;
        room.gameState.level = 1;
        
        // Skorları başlat
        if (!scores[code]) {
            scores[code] = {
                host: 0,
                guest: 0
            };
        }
        
        // Oyun durumunu ayarla
        room.gameState.stage = 'PLAY';
        room.gameState.turn = 0; // Host başlar
        room.gameState.level = 1;
        room.gameState.opened = [];
        
        console.log(`🎲 Otomatik bombalar yerleştirildi - Host: ${room.gameState.hostBombs}, Guest: ${room.gameState.guestBombs}`);
        
        // Client'a güncel oyun durumunu gönder
        const gameState = {
            hostBombs: room.gameState.hostBombs,
            guestBombs: room.gameState.guestBombs,
            hostLives: room.gameState.hostLives,
            guestLives: room.gameState.guestLives,
            turn: room.gameState.turn,
            level: room.gameState.level
        };
        
        // Client'ın socket dinleyicilerini kurması için kısa bir gecikme
        setTimeout(() => {
            io.to(code).emit('gameReady', gameState);
            console.log(`🚀 gameReady sinyali gönderildi:`, gameState);
        }, 500);
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
            console.log(`Yanlış sıra hareketi engellendi: ${code}`);
            return;
        }

        if (data.type === 'MOVE') {
            const idx = data.cardIndex;
            // Aynı karta ikinci kez tıklamayı engelle
            if (room.gameState.opened.includes(idx)) {
                socket.emit('error', 'Bu kart zaten açıldı.');
                return;
            }

            // Bombayı belirle: Host oynuyorsa Guest'in bombaları tehlikelidir, tersi de aynı
            const isBomb = isHostTurn
                ? room.gameState.guestBombs.includes(idx)
                : room.gameState.hostBombs.includes(idx);

            // Emoji seç (bomba değilse)
            const emoji = isBomb ? '💣' : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

            // Kartı açılmış olarak işaretle
            room.gameState.opened.push(idx);

            // Sırayı değiştir
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            // Hareketi her iki oyuncuya da gönder (emoji ve bomba bilgisi ile)
            io.to(code).emit('gameData', {
                type: 'MOVE',
                cardIndex: idx,
                emoji: emoji,
                isBomb: isBomb,
                roomCode: code
            });
            
            console.log(`Kart Açıldı - Oda: ${code}, Kart: ${idx}, Bomba: ${isBomb}, Emoji: ${emoji}, Yeni sıra: ${room.gameState.turn}`);
        }
    });

    // Sohbet mesajı işleme
    socket.on('chatMessage', (data) => {
        try {
            const { roomCode, message, sender } = data;
            const room = rooms[roomCode];
            
            if (!room) {
                console.log(`Otaq Tapılmadı : ${roomCode}`);
                return;
            }
            
            // Mesajın uzunluğunu kontrol et (maksimum 200 karakter)
            const trimmedMessage = String(message).substring(0, 200).trim();
            if (!trimmedMessage) return;
            
            console.log(`💬 Sohbet mesajı - Oda: ${roomCode}, Gönderen: ${sender}, Mesaj: ${trimmedMessage}`);
            
            // Mesajı oda içindeki tüm oyunculara ilet
            io.to(roomCode).emit('chatMessage', {
                message: trimmedMessage,
                sender: sender,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Sohbet mesajı işlenirken hata:', error);
        }
    });

    // Seviye tamamlama olayı
    socket.on('levelComplete', ({ roomCode, level: completedLevel, nextLevel }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        console.log(`🏆 Seviye ${completedLevel} tamamlandı! Yeni seviye: ${nextLevel}`);
        
        // Mevcut canları al
        const currentHostLives = room.gameState.hostLives;
        const currentGuestLives = room.gameState.guestLives;
        
        // Yeni seviyede canları ayarla
        const isFirstLevel = nextLevel === 1;
        const someoneDied = currentHostLives <= 0 || currentGuestLives <= 0;
        
        // Eğer biri öldüyse veya ilk seviyedeysek canları sıfırla, yoksa aynı tut
        const hostLives = (someoneDied || isFirstLevel) ? (isFirstLevel ? 3 : 4) : currentHostLives;
        const guestLives = (someoneDied || isFirstLevel) ? (isFirstLevel ? 3 : 4) : currentGuestLives;
        
        // Oyun durumunu güncelle
        room.gameState.hostLives = hostLives;
        room.gameState.guestLives = guestLives;

        // İlk seviyede 4, diğerlerinde 6 bomba
        const bombCount = nextLevel === 1 ? 4 : 6;
        const boardSize = 20; // Tüm seviyelerde 20 kart

        // Tüm olası kart indekslerini oluştur ve karıştır
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        allIndices.sort(() => Math.random() - 0.5);

        // Host ve Guest için benzersiz bombalar ayarla
        room.gameState.hostBombs = allIndices.slice(0, bombCount);
        room.gameState.guestBombs = allIndices.slice(bombCount, bombCount * 2);

        // Oyun durumunu sıfırla
        room.gameState.opened = [];
        room.gameState.turn = 0; // Host başlasın
        room.gameState.level = nextLevel;
        room.gameState.stage = 'PLAY';

        console.log(`✅ Yeni seviye başlatıldı: ${nextLevel}, ${bombCount} bomba ile`);
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
            level: nextLevel,
            boardSize: 20,
            hostLives: hostLives,
            guestLives: guestLives,
            scores: scores[roomCode] || { host: 0, guest: 0 },
            hostName: room.hostUsername,
            guestName: room.guestUsername
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
