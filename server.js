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
// Checkers taşları için renkler
const PIECE_COLORS = {
    0: '#FF0000',   // Kırmızı (Host)
    1: '#0000FF'    // Mavi (Guest)
};

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

// Checkers tahtasını başlat
function initializeBoard() {
    const board = Array(8).fill().map(() => Array(8).fill(null));
    
    // Host'un taşları (üstte, kırmızı)
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 === 1) {
                board[row][col] = { player: 1, isKing: false };
            }
        }
    }
    
    // Guest'in taşları (altta, mavi)
    for (let row = 5; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 === 1) {
                board[row][col] = { player: 0, isKing: false };
            }
        }
    }
    
    return board;
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
                stage: 'WAITING', // WAITING, PLAY, GAME_OVER
                turn: 0, // 0 = Host, 1 = Guest
                board: initializeBoard(),
                hostPieces: 12,
                guestPieces: 12,
                lastCapture: null // Son yeme hamlesi
            },
            players: [
                { id: socket.id, username, isHost: true },
                null
            ]
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
        room.players[1] = { id: socket.id, username, isHost: false };
        
        socket.join(code);
        socket.emit('roomJoined', code);
        
        // Oyun başlat
        room.gameState.stage = 'PLAY';
        room.gameState.turn = 0; // Host başlar
        
        // Oyun durumunu gönder
        io.to(code).emit('gameStart', {
            players: room.players,
            roomCode: code,
            gameState: room.gameState
        });
        
        console.log(`${username} odaya katıldı: ${code}`);
    });

    // Geçerli bir hamle mi kontrol et
    function isValidMove(room, fromRow, fromCol, toRow, toCol, isHostTurn) {
        const board = room.gameState.board;
        const piece = board[fromRow][fromCol];
        
        // Boş kareye hamle yapılamaz
        if (!piece) return false;
        
        // Sadece kendi taşını oynat
        if ((isHostTurn && piece.player !== 1) || (!isHostTurn && piece.player !== 0)) {
            return false;
        }
        
        // Hedef kare boş olmalı
        if (board[toRow][toCol] !== null) return false;
        
        // Çapraz gitmeli
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        
        if (rowDiff !== colDiff) return false;
        
        // Normal taşlar sadece ileri gidebilir (kale değilse)
        if (!piece.isKing) {
            if ((piece.player === 1 && toRow < fromRow) || 
                (piece.player === 0 && toRow > fromRow)) {
                return false;
            }
        }
        
        // 1 veya 2 kare gidebilir
        if (rowDiff === 1) {
            return true; // Normal hamle
        } else if (rowDiff === 2) {
            // Taş yeme hamlesi
            const jumpedRow = (fromRow + toRow) / 2;
            const jumpedCol = (fromCol + toCol) / 2;
            const jumpedPiece = board[jumpedRow][jumpedCol];
            
            if (jumpedPiece && jumpedPiece.player !== piece.player) {
                return { captured: { row: jumpedRow, col: jumpedCol } };
            }
        }
        
        return false;
    }
    
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
            const { fromRow, fromCol, toRow, toCol } = data;
            const board = room.gameState.board;
            
            // Geçerli hamle kontrolü
            const moveResult = isValidMove(room, fromRow, fromCol, toRow, toCol, isHostTurn);
            if (!moveResult) {
                socket.emit('error', 'Geçersiz hamle!');
                return;
            }
            
            // Taşı hareket ettir
            const piece = board[fromRow][fromCol];
            board[fromRow][fromCol] = null;
            
            // Kale kontrolü
            if ((piece.player === 1 && toRow === 7) || (piece.player === 0 && toRow === 0)) {
                piece.isKing = true;
            }
            
            board[toRow][toCol] = piece;
            
            // Taş yeme işlemi
            if (moveResult.captured) {
                const { row, col } = moveResult.captured;
                board[row][col] = null;
                
                // Taş sayılarını güncelle
                if (isHostTurn) {
                    room.gameState.guestPieces--;
                } else {
                    room.gameState.hostPieces--;
                }
                
                // Oyun bitiş kontrolü
                if (room.gameState.hostPieces === 0 || room.gameState.guestPieces === 0) {
                    room.gameState.stage = 'GAME_OVER';
                    room.gameState.winner = room.gameState.hostPieces === 0 ? 0 : 1;
                }
            }
            
            // Sırayı değiştir
            room.gameState.turn = isHostTurn ? 1 : 0;
            
            // Güncel oyun durumunu tüm oyunculara gönder
            io.to(code).emit('gameUpdate', {
                board: room.gameState.board,
                turn: room.gameState.turn,
                hostPieces: room.gameState.hostPieces,
                guestPieces: room.gameState.guestPieces,
                gameOver: room.gameState.stage === 'GAME_OVER',
                winner: room.gameState.winner
            });

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
