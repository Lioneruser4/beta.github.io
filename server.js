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

// Level'a göre bomba sayısını belirleyen yardımcı fonksiyon
const getBombCount = (level) => level === 1 ? 3 : 4;
// Level'a göre kart sayısını belirleyen yardımcı fonksiyon
const getBoardSize = (level) => level === 1 ? 16 : 20;

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

/**
 * Yeni seviye için bomba yerleşimi ve oda durumunu sıfırlayan/güncelleyen yardımcı fonksiyon.
 * @param {object} room - Güncellenecek oda nesnesi.
 * @param {number} newLevel - Geçilecek yeni seviye.
 */
function initializeNextLevel(room, newLevel) {
    const bombCount = getBombCount(newLevel); 
    const boardSize = getBoardSize(newLevel);
    
    console.log(`🔄 Yeni seviye başlatılıyor: ${newLevel}, ${bombCount} bomba, ${boardSize} kart ile`);
    
    // Tüm olası kart indekslerini oluştur ve karıştır
    const allIndices = Array.from({ length: boardSize }, (_, i) => i);
    allIndices.sort(() => Math.random() - 0.5);
    
    // Host ve Guest için benzersiz bombalar ayarla
    // Host: İlk 'bombCount' kadar
    room.gameState.hostBombs = allIndices.slice(0, bombCount);
    // Guest: Sonraki 'bombCount' kadar
    // Bombaların çakışmaması için 2 * bombCount kullanıyoruz. 
    // Örn: Level 2 için 4 bomba. Host 0-3 alır. Guest 4-7 alır. Toplam 8 kart bombalanır. (20 kartın 12'si emoji olur)
    room.isHostBombPlacement = room.gameState.hostBombs; 
    room.isGuestBombPlacement = allIndices.slice(bombCount, bombCount * 2);

    // Kodu daha temiz hale getirelim ve room.gameState içindeki değişkenleri güncelleyelim
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
    room.gameState.boardSize = boardSize; // Yeni boardSize'ı kaydet
    
    console.log(`✅ Yeni seviye başlatıldı: ${newLevel}, Host Bombaları: ${room.gameState.hostBombs}, Guest Bombaları: ${room.gameState.guestBombs}`);
}


io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    // *** ODA KURMA KISMI ***
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
                hostLives: getBombCount(1), 
                guestLives: getBombCount(1), 
                level: 1,
                opened: [], 
                boardSize: getBoardSize(1)
            }
        };
        socket.join(code);
        // Bu kısım istemciye oda kodunu başarıyla kurduğunu bildirir.
        socket.emit('roomCreated', code); 
        console.log(`Oda oluşturuldu: ${code} - Host: ${username}`);
    });

    // *** ODAYA KATILMA KISMI ***
    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];
        const initialLevel = 1;
        
        if (!room || room.playerCount >= 2) {
            // Eğer bu bildirim gelmiyorsa, sunucuya bağlanılamamış demektir.
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.'); 
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        
        socket.join(code);
        
        // Bu kısım istemciye odaya başarıyla katıldığını bildirir.
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${username} odaya katıldı: ${code}`);
        
        // --- OYUN BAŞLANGICI VE BOMBA YERLEŞİMİ (LEVEL 1) ---
        initializeNextLevel(room, initialLevel);

        const gameState = {
            hostBombs: room.gameState.hostBombs,
            guestBombs: room.gameState.guestBombs,
            hostLives: room.gameState.hostLives,
            guestLives: room.gameState.guestLives,
            turn: room.gameState.turn,
            level: room.gameState.level,
            boardSize: room.gameState.boardSize
        };
        
        setTimeout(() => {
            // İstemcinin oyunu başlatması için gerekli kritik sinyal.
            io.to(code).emit('gameReady', gameState); 
            console.log(`🚀 gameReady sinyali gönderildi (Level ${initialLevel}):`, gameState);
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
            
            // Can kaybetme mantığı
            if (isBomb) {
                if (isHostTurn) {
                    room.gameState.hostLives = Math.max(0, room.gameState.hostLives - 1);
                } else {
                    room.gameState.guestLives = Math.max(0, room.gameState.guestLives - 1);
                }
            }

            // Emoji seç (bomba değilse)
            const emoji = isBomb ? '💣' : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

            // Kartı açılmış olarak işaretle
            room.gameState.opened.push(idx);

            // Sırayı değiştir
            room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
            
            // Hareketi her iki oyuncuya da gönder
            io.to(code).emit('gameData', {
                type: 'MOVE',
                cardIndex: idx,
                emoji: emoji,
                isBomb: isBomb,
                hostLives: room.gameState.hostLives, // Güncel canları gönder
                guestLives: room.gameState.guestLives, // Güncel canları gönder
                turn: room.gameState.turn
            });
            
            console.log(`Hamle yapıldı - Oda: ${code}, Kart: ${idx}, Bomba: ${isBomb}, Yeni sıra: ${room.gameState.turn}`);
        }
    });

    // Seviye tamamlama olayı (Tüm kartlar açılınca veya bir oyuncu ölünce istemciden gelir)
    socket.on('levelComplete', ({ roomCode, nextLevel }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const currentLevel = room.gameState.level;
        const newLevel = parseInt(nextLevel) || (currentLevel + 1);

        console.log(`🏆 Seviye ${currentLevel} tamamlandı. Yeni seviye: ${newLevel}`);

        // Sunucunun yeni seviye hazırlığını yap
        initializeNextLevel(room, newLevel);
        
        // Her iki oyuncuya da yeni seviyeyi bildir
        io.to(roomCode).emit('newLevel', { 
            level: room.gameState.level,
            boardSize: room.gameState.boardSize,
            hostLives: room.gameState.hostLives,
            guestLives: room.gameState.guestLives
        });
        
        // Yeni bombaları kısa gecikme ile gönder (gameReady)
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
