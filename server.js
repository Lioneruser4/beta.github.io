// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Cors ayarlarını kendi alan adınızla güncelleyin
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const LEVELS = [12, 16, 20]; // Seviye kart sayıları
const BOMB_COUNT = 3; // Her oyuncu için 3 bomba

// --- OYUN DURUMU YÖNETİMİ ---
const rooms = {}; 

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms[code]);
    return code;
}

/**
 * Belirtilen kart boyutu için rastgele BOMB_COUNT adet Host ve Guest bombası seçer.
 */
function generateRandomBombs(boardSize) {
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    
    // Rastgele karıştır
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // İlk 2*BOMB_COUNT kartı Host ve Guest arasında paylaştır
    const uniqueBombs = indices.slice(0, 2 * BOMB_COUNT);
    
    const hostBombs = uniqueBombs.slice(0, BOMB_COUNT);
    const guestBombs = uniqueBombs.slice(BOMB_COUNT, 2 * BOMB_COUNT);

    return { hostBombs, guestBombs };
}

// --- SOCKET.IO BAĞLANTI İŞLEYİCİSİ ---
io.on('connection', (socket) => {
    console.log('Yeni bir kullanıcı bağlandı:', socket.id);

    // 1. Oda Oluşturma
    socket.on('createRoom', ({ username }) => {
        const roomCode = generateRoomCode();
        
        rooms[roomCode] = {
            code: roomCode,
            players: [{ id: socket.id, username, isHost: true }],
            turn: 0, // 0: Host, 1: Guest
            level: 1, 
            maxLevel: LEVELS.length,
            gameData: null 
        };
        
        socket.join(roomCode);
        console.log(`Oda oluşturuldu: ${roomCode} (Host: ${username})`);
        socket.emit('roomCreated', roomCode);
    });

    // 2. Odaya Katılma
    socket.on('joinRoom', ({ username, roomCode }) => {
        const room = rooms[roomCode];
        
        if (!room) {
            return socket.emit('joinFailed', 'Oda bulunamadı.');
        }
        if (room.players.length >= 2) {
            return socket.emit('joinFailed', 'Oda zaten dolu.');
        }
        
        socket.join(roomCode);
        room.players.push({ id: socket.id, username, isHost: false });
        console.log(`Oyuncu odaya katıldı: ${roomCode} (Guest: ${username})`);

        // Oyunun Başlatılması
        const host = room.players.find(p => p.isHost);
        const guest = room.players.find(p => !p.isHost);
        
        // 1. Her iki oyuncuya da oyunun başladığını bildir.
        io.to(roomCode).emit('gameStart', [host, guest]);

        // 2. Sunucu rastgele bombaları seçer.
        const boardSize = LEVELS[room.level - 1]; 
        const { hostBombs, guestBombs } = generateRandomBombs(boardSize);
        
        // 3. Her iki oyuncuya da rastgele seçilen bombaları ve başlatma sinyalini gönder.
        io.to(roomCode).emit('startGameWithBombs', { 
            hostBombs, 
            guestBombs, 
            level: room.level 
        });

        // Oda verilerini sunucuda kaydet
        room.gameData = {
            hostBombs,
            guestBombs,
            boardSize,
            cardsLeft: boardSize
        };
    });

    // 3. Oyun İçi Veri Alımı (Hamle)
    socket.on('gameData', (data) => {
        const { roomCode, type, cardIndex } = data;
        const room = rooms[roomCode];
        if (!room || type !== 'MOVE') return;

        // Hamleyi yapanın sırası olup olmadığını kontrol et (Basit Güvenlik)
        const playerIsHost = room.players.find(p => p.id === socket.id)?.isHost;
        const isMyTurn = (playerIsHost && room.turn === 0) || (!playerIsHost && room.turn === 1);

        if (!isMyTurn) {
             console.log(`Hata: ${socket.id} sıra kendisinde değilken hamle yapmaya çalıştı.`);
             return; // Sıra başkasındaysa hamleyi yoksay
        }

        // Sunucu tarafından turu güncelle
        room.turn = room.turn === 0 ? 1 : 0; 
        
        // Hamleyi ve yeni tur bilgisini tüm oyunculara ilet.
        // Bu olay, game.js'te applyMove'u tetikler.
        io.to(roomCode).emit('moveApplied', {
            cardIndex: cardIndex,
            nextTurn: room.turn 
        });
    });
    
    // 4. Seviye Atlama İsteği (Sadece Host gönderir)
    socket.on('nextLevel', ({ roomCode, newLevel }) => {
        const room = rooms[roomCode];
        if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return; 

        if (newLevel <= room.maxLevel) {
            room.level = newLevel;
            room.turn = 0; // Her yeni seviyede Host başlar
            const boardSize = LEVELS[newLevel - 1];
            
            // Yeni seviye için rastgele bombaları seç
            const { hostBombs, guestBombs } = generateRandomBombs(boardSize);
            
            // Yeni bomb ve seviye verilerini kaydet
            room.gameData = {
                hostBombs,
                guestBombs,
                boardSize,
                cardsLeft: boardSize
            };
            
            // Her iki oyuncuya da seviye atlama sinyalini yeni bombalarla gönder.
            io.to(roomCode).emit('nextLevel', { 
                newLevel: room.level,
                hostBombs,
                guestBombs
            });
        }
    });

    // 5. Bağlantı Kesilmesi
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            if (playerIndex !== -1) {
                const disconnectedPlayer = room.players[playerIndex];
                
                // Odanın tüm üyelerine oyuncunun ayrıldığını bildir
                socket.to(code).emit('opponentLeft', `${disconnectedPlayer.username} oyundan ayrıldı.`);
                
                // Odayı sil
                delete rooms[code];
                console.log(`Oda ${code} kapatıldı. Oyuncu: ${disconnectedPlayer.username} ayrıldı.`);
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
