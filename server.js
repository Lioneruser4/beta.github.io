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
const scores = {}; // Skor takibi için obje

// Tüm cihazlarda güvenle çalışacak emojiler
const EMOJIS = [
    '😀', // Gülümseyen yüz
    '😊', // Gözleri kapalı gülümseyen yüz
    '😎', // Güneş gözlüklü yüz
    '😍', // Kalp gözlü yüz
    '😜', // Dil çıkaran yüz
    '😇', // Halo melek yüzü
    '😴', // Uyuyan yüz
    '😷', // Maske takan yüz
    '🤖', // Robot
    '👻', // Hayalet
    '👽', // Uzaylı
    '🤡'  // Palyaço
];

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
                hostLives: 3,  // İlk seviyede 3 can
                guestLives: 3, // İlk seviyede 3 can
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
        const bombCount = 5; // İlk seviyede 4 bomba
        
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
        
        // İlk seviyede 3 can
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
        const boardSize = 20; // Tüm seviyelerde 20 kart
        const bombCount = room.gameState.level === 1 ? 4 : 6; // Level 1'de 4, diğerlerinde 6 bomba
        
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
        
        // Can sayılarını ayarla (Level 1'de 3, diğerlerinde 4 can)
        const lives = room.gameState.level === 1 ? 3 : 4;
        room.gameState.hostLives = lives;
        room.gameState.guestLives = lives;
        
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

    // Sohbet mesajı işleme
    socket.on('chatMessage', (data) => {
        try {
            const { roomCode, message, sender } = data;
            const room = rooms[roomCode];
            
            if (!room) {
                console.log(`Oda bulunamadı: ${roomCode}`);
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
