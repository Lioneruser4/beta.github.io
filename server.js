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
                stage: 'WAITING', // WAITING, SELECTION, PLAY, ENDED
                turn: 0, // 0 = Host, 1 = Guest
                hostBombs: [],
                guestBombs: [],
                hostLives: 3,  // İlk seviyede 3 bomba
                guestLives: 3, // İlk seviyede 3 bomba
                hostBombsSelected: false,
                guestBombsSelected: false,
                level: 1,
                opened: [], // Açılan kart indeksleri
                boardSize: 20 // Tüm seviyelerde 20 kart
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
        room.gameState.stage = 'SELECTION';
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        // Oda kodunu da ilet ki her iki taraf da hamle gönderirken doğru kodu kullansın
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${username} odaya katıldı: ${code}`);
        
        // Oyun tahtası ayarları
        const boardSize = 20; // Tüm seviyelerde 20 kart
        const bombCount = 3; // İlk seviyede 3 bomba
        
        // Tüm olası kart indekslerini oluştur ve karıştır
        const allIndices = Array.from({ length: boardSize }, (_, i) => i);
        allIndices.sort(() => Math.random() - 0.5);
        
        // Host ve Guest için bombaları ayarla (her oyuncu için ayrı bombalar)
        room.gameState.hostBombs = [];
        room.gameState.guestBombs = [];
        
        // Host için 3 bomba seç
        for (let i = 0; i < bombCount; i++) {
            room.gameState.hostBombs.push(allIndices[i]);
        }
        
        // Guest için farklı 3 bomba seç
        for (let i = bombCount; i < bombCount * 2; i++) {
            room.gameState.guestBombs.push(allIndices[i]);
        }
        
        // Can sayılarını ayarla
        room.gameState.hostLives = bombCount;
        room.gameState.guestLives = bombCount;
        
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
            socket.emit('error', 'Senin sıran değil!');
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
            
            // Eğer bomba patlarsa, canı düşür
            if(isBomb) {
                 if(isHostTurn) {
                     room.gameState.guestLives = Math.max(0, room.gameState.guestLives - 1);
                 } else {
                     room.gameState.hostLives = Math.max(0, room.gameState.hostLives - 1);
                 }
                 console.log(`💣 BOMBA! Canlar Host: ${room.gameState.hostLives}, Guest: ${room.gameState.guestLives}`);
            }

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
            
            console.log(`Hamle yapıldı - Oda: ${code}, Kart: ${idx}, Bomba: ${isBomb}, Emoji: ${emoji}, Yeni sıra: ${room.gameState.turn}`);
        }
    });

    // Seviye tamamlama olayı
    socket.on('levelComplete', ({ roomCode, level: completedLevel, nextLevel }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        console.log(`🏆 Seviye ${completedLevel} tamamlandı! Yeni seviye: ${nextLevel}`);
        
        // Tüm oyunculara seviyenin tamamlandığını bildir
        io.to(roomCode).emit('levelComplete', {
            completedLevel: completedLevel,
            nextLevel: nextLevel
        });
        
        // Yeni seviye konfigürasyonu (Client'taki düzeltmelere göre senkronize ediliyor)
        // Level 1: 16 Kart, 3 Bomba. Level 2+: 20 Kart, 4 Bomba.
        const bombCount = nextLevel === 1 ? 3 : 4; 
        const boardSize = nextLevel === 1 ? 16 : 20; 

        // 1 saniye bekle ve yeni seviyeyi başlat
        setTimeout(() => {
            
            console.log(`🔄 Yeni seviye başlatılıyor: ${nextLevel}, ${bombCount} bomba ile`);
            
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
            room.gameState.level = nextLevel;
            room.gameState.stage = 'PLAY';
            room.gameState.boardSize = boardSize; // Yeni board boyutunu kaydet
            
            console.log(`✅ Yeni seviye başlatıldı: ${nextLevel}, ${bombCount} bomba ile, Kart: ${boardSize}`);
            
            // Her iki oyuncuya da yeni seviyeyi bildir
            io.to(roomCode).emit('newLevel', { 
                level: nextLevel,
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
        }, 1000);
    });

    // NOT: nextLevel olayı yukarıdaki levelComplete olayı ile aynı işi yaptığı için silebilirsiniz, 
    // ancak sunucunuzda kalmasını isterseniz sorun çıkarmaz.
    socket.on('nextLevel', (/* ... */) => { /* ... (Yukarıdaki levelComplete ile aynı) */ });

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
