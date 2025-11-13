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
const matchmakingQueue = []; // Eşleştirme kuyruğu

// Odayı oyuncu ID'sine göre bulma fonksiyonu
function getRoomByPlayerId(playerId) {
    for (const code in rooms) {
        const room = rooms[code];
        if (room.hostId === playerId || room.guestId === playerId) {
            return room;
        }
    }
    return null;
}

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
    '🤡', // Palyaço
    '🔥',
    '🌊',
    '🌚',
    '😺',
    '🌼'
];

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

// Eşleştirme kuyruğundan oyuncu eşleştir
function matchPlayers() {
    while (matchmakingQueue.length >= 2) {
        const player1 = matchmakingQueue.shift();
        const player2 = matchmakingQueue.shift();
        
        // Check if players are still connected
        if (!player1.socket.connected || !player2.socket.connected) {
            if (player1.socket.connected) {
                player1.socket.emit('matchmakingStatus', {
                    inQueue: true,
                    message: 'Bağlantı xətası, yenidən axtarılır... / Connection error, searching again...'
                });
                matchmakingQueue.push(player1);
            }
            if (player2.socket.connected) {
                player2.socket.emit('matchmakingStatus', {
                    inQueue: true,
                    message: 'Bağlantı xətası, yenidən axtarılır... / Connection error, searching again...'
                });
                matchmakingQueue.push(player2);
            }
            continue;
        }
        
        // Notify players that a match is found
        player1.socket.emit('matchFound', { opponentName: player2.username });
        player2.socket.emit('matchFound', { opponentName: player1.username });
        
        // Store match info for acceptance
        const matchId = `match_${Date.now()}`;
        
        // Set timeout for match acceptance (10 seconds)
        const timeout = setTimeout(() => {
            // If still in queue (not accepted yet), remove from queue
            if (matchmakingQueue.some(p => p.id === player1.id || p.id === player2.id)) {
                if (player1.socket.connected) {
                    player1.socket.emit('matchmakingStatus', {
                        inQueue: false,
                        message: 'Oyunçu qəbul etmədi / Player did not accept',
                        isError: true
                    });
                }
                if (player2.socket.connected) {
                    player2.socket.emit('matchmakingStatus', {
                        inQueue: false,
                        message: 'Oyunçu qəbul etmədi / Player did not accept',
                        isError: true
                    });
                }
            }
        }, 10000);
        
        // Store accept handlers
        const acceptMatch = (socket, isPlayer1) => {
            if (socket.id !== (isPlayer1 ? player1.id : player2.id)) return;
            
            clearTimeout(timeout);
            
            const otherPlayer = isPlayer1 ? player2 : player1;
            
            // If both players accepted, create room
            if (player1.accepted && player2.accepted) {
                const code = generateRoomCode();
                rooms[code] = {
                    code,
                    playerCount: 2,
                    hostId: player1.id,
                    hostUsername: player1.username,
                    guestId: player2.id,
                    guestUsername: player2.username,
                    gameState: {
                        stage: 'PLAY',
                        turn: 0,
                        hostBombs: [],
                        guestBombs: [],
                        hostLives: 3,
                        guestLives: 3,
                        hostBombsSelected: false,
                        guestBombsSelected: false,
                        level: 1,
                        opened: [],
                        boardSize: 20
                    }
                };
                
                // Add players to room
                player1.socket.join(code);
                player2.socket.join(code);
                
                // Notify players
                player1.socket.emit('matched', { 
                    roomCode: code, 
                    isHost: true, 
                    opponentName: player2.username 
                });
                
                player2.socket.emit('matched', { 
                    roomCode: code, 
                    isHost: false, 
                    opponentName: player1.username 
                });
                
                console.log(`Eşleştirme yapıldı: ${player1.username} ve ${player2.username} oyuna başlıyor (Oda: ${code})`);
            } else {
                // Notify other player that opponent accepted
                if (otherPlayer.socket.connected) {
                    otherPlayer.socket.emit('opponentAccepted');
                }
            }
        };
        
        // Set up accept/decline handlers for both players
        player1.accepted = false;
        player2.accepted = false;
        
        const acceptHandler1 = () => {
            player1.accepted = true;
            acceptMatch(player1.socket, true);
            player1.socket.off('acceptMatch', acceptHandler1);
        };
        
        const acceptHandler2 = () => {
            player2.accepted = true;
            acceptMatch(player2.socket, false);
            player2.socket.off('acceptMatch', acceptHandler2);
        };
        
        const declineHandler1 = () => {
            clearTimeout(timeout);
            if (player2.socket.connected) {
                player2.socket.emit('matchmakingStatus', {
                    inQueue: false,
                    message: 'Oyunçu oyunu rədd etdi / Player declined the match',
                    isError: true
                });
            }
            player1.socket.off('declineMatch', declineHandler1);
            player2.socket.off('declineMatch', declineHandler2);
        };
        
        const declineHandler2 = () => {
            clearTimeout(timeout);
            if (player1.socket.connected) {
                player1.socket.emit('matchmakingStatus', {
                    inQueue: false,
                    message: 'Oyunçu oyunu rədd etdi / Player declined the match',
                    isError: true
                });
            }
            player1.socket.off('declineMatch', declineHandler1);
            player2.socket.off('declineMatch', declineHandler2);
        };
        
        player1.socket.once('acceptMatch', acceptHandler1);
        player2.socket.once('acceptMatch', acceptHandler2);
        player1.socket.once('declineMatch', declineHandler1);
        player2.socket.once('declineMatch', declineHandler2);
    }
}

io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    // Eşleştirme kuyruğuna katılma
    socket.on('joinMatchmaking', ({ username }) => {
        console.log(`Eşleştirme isteği: ${username} (${socket.id})`);
        
        // Eğer zaten kuyruktaysa çık
        const existingIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (existingIndex !== -1) {
            console.log(`Zaten eşleşme kuyruğunda: ${username}`);
            return;
        }
        
        // Kullanıcıyı kuyruğa ekle
        const player = {
            id: socket.id,
            username,
            socket: socket,
            accepted: false
        };
        
        matchmakingQueue.push(player);
        console.log(`Eşleşme kuyruğuna eklendi: ${username}. Kuyruk uzunluğu: ${matchmakingQueue.length}`);
        
        // Kullanıcıya kuyruk bilgisini gönder
        socket.emit('matchmakingStatus', {
            inQueue: true,
            queuePosition: matchmakingQueue.length,
            message: 'Oyunçu axtarılır... / Searching for opponent...'
        });
        
        // Eşleştirme kontrolü yap
        matchPlayers();
    });
    
    // Eşleştirmeyi iptal et
    socket.on('cancelMatchmaking', () => {
        const index = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const player = matchmakingQueue.splice(index, 1)[0];
            console.log(`Eşleşme iptal edildi: ${player.username}`);
            socket.emit('matchmakingStatus', {
                inQueue: false,
                message: 'Eşleşme iptal edildi. / Matchmaking cancelled.'
            });
        }
    });
    
    // Bağlantı kesildiğinde kuyruktan çıkar
    socket.on('disconnect', () => {
        const index = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const player = matchmakingQueue.splice(index, 1)[0];
            console.log(`Bağlantı kesildi, eşleşme kuyruğundan çıkarıldı: ${player.username}`);
        }
    });
    
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

    // Eşleştirme isteği
    socket.on('joinMatchmaking', ({ username }) => {
        console.log(`Eşleştirme isteği: ${username} (${socket.id})`);
        
        // Eğer zaten eşleşme kuyruğundaysa çık
        const alreadyInQueue = matchmakingQueue.some(p => p.id === socket.id);
        if (alreadyInQueue) {
            console.log(`Zaten eşleşme kuyruğunda: ${username}`);
            return;
        }
        
        // Kullanıcıyı eşleşme kuyruğuna ekle
        matchmakingQueue.push({
            id: socket.id,
            username,
            socket: socket
        });
        
        console.log(`Eşleşme kuyruğuna eklendi: ${username}. Kuyruk uzunluğu: ${matchmakingQueue.length}`);
        
        // Eşleşme durumunu kullanıcıya bildir
        socket.emit('matchmakingStatus', {
            inQueue: true,
            queuePosition: matchmakingQueue.length,
            message: 'Eşleşme aranıyor...'
        });
        
        // Eşleşme kontrolü yap
        matchPlayers();
    });
    
    // Eşleşmeyi iptal et
    socket.on('cancelMatchmaking', () => {
        const index = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const player = matchmakingQueue.splice(index, 1)[0];
            console.log(`Eşleşme iptal edildi: ${player.username}`);
            socket.emit('matchmakingStatus', {
                inQueue: false,
                message: 'Eşleşme iptal edildi.'
            });
        }
    });
    
    // Bağlantı kesildiğinde eşleşme kuyruğundan çıkar
    socket.on('disconnect', () => {
        const index = matchmakingQueue.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const player = matchmakingQueue.splice(index, 1)[0];
            console.log(`Bağlantı kesildi, eşleşme kuyruğundan çıkarıldı: ${player.username}`);
        }
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

    // Emoji mesajlarını işle
    socket.on('emojiMessage', (data) => {
        try {
            console.log('Emoji mesajı alındı:', data);
            const room = getRoomByPlayerId(socket.id);
            
            if (room) {
                console.log(`Oda bulundu: ${room.code}, Tüm oyunculara emoji gönderiliyor...`);
                // Odaya emoji mesajını tüm oyunculara yayınla (gönderen de dahil)
                io.to(room.code).emit('emojiMessage', data);
                console.log(`Emoji gönderildi: ${data.emoji} (Oda: ${room.code})`);
                
                // Debug için oyuncu bilgilerini yazdır
                console.log('Oda bilgileri:', {
                    hostId: room.hostId,
                    guestId: room.guestId,
                    hostUsername: room.hostUsername,
                    guestUsername: room.guestUsername
                });
            } else {
                console.log('Oda bulunamadı veya oyuncu bir odada değil');
            }
        } catch (error) {
            console.error('Emoji mesajı işlenirken hata:', error);
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
