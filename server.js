// Dosya Adı: server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Cors ayarlarını kendi alan adınızla güncelleyin (örneğin: 'http://localhost:3000')
const io = new Server(server, {
    cors: {
        origin: "*", // Tüm alanlardan erişime izin verir (Geliştirme için uygundur)
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// --- OYUN DURUMU YÖNETİMİ ---
// Global oda nesnesi
const rooms = {}; 

/**
 * Rastgele 6 haneli oda kodu üretir.
 * @returns {string} Oda kodu
 */
function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms[code]);
    return code;
}

/**
 * Belirtilen kart boyutu için rastgele 3 Host ve 3 Guest bombası seçer (toplam 6 benzersiz kart).
 * @param {number} boardSize - Toplam kart sayısı (12, 16, 20)
 * @returns {{hostBombs: number[], guestBombs: number[]}}
 */
function generateRandomBombs(boardSize) {
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    
    // Rastgele karıştır
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // İlk 6 kartı Host ve Guest arasında paylaştır
    const uniqueBombs = indices.slice(0, 6);
    
    const hostBombs = uniqueBombs.slice(0, 3);
    const guestBombs = uniqueBombs.slice(3, 6);

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
            maxLevel: 3,
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

        // 2. Host (Sunucu), rastgele bombaları seçer.
        const boardSize = [12, 16, 20][0]; // Seviye 1: 12 kart
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
        if (!room) return;

        // Hamleyi rakibe ilet
        socket.to(roomCode).emit('gameData', {
            type,
            cardIndex
        });
        
        // Sunucu tarafından turu güncelle (güvenlik için)
        room.turn = room.turn === 0 ? 1 : 0; 
    });
    
    // 4. Seviye Atlama İsteği (Sadece Host gönderir)
    socket.on('nextLevel', ({ roomCode, newLevel }) => {
        const room = rooms[roomCode];
        if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return; // Sadece Host ilerletebilir

        if (newLevel <= room.maxLevel) {
            room.level = newLevel;
            const boardSize = [12, 16, 20][newLevel - 1];
            
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
