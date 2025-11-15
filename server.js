// Dosya Adı: server.js - DAMA OYUNU İÇİN GÜNCELLENMİŞ VERSİYON
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

// Dama Tahtasını Başlatma Fonksiyonu (8x8 standart dama)
function initializeBoard() {
    // 0: Boş, 1: Kırmızı Oyuncu, 2: Beyaz Oyuncu
    // 3: Kırmızı Şah, 4: Beyaz Şah
    const board = Array(8).fill(0).map(() => Array(8).fill(0));

    // Kırmızı (Host) altta (oyuncu 1)
    for (let i = 5; i < 8; i++) {
        for (let j = (i % 2 === 0 ? 1 : 0); j < 8; j += 2) {
            board[i][j] = 1;
        }
    }

    // Beyaz (Guest) üstte (oyuncu 2)
    for (let i = 0; i < 3; i++) {
        for (let j = (i % 2 === 0 ? 1 : 0); j < 8; j += 2) {
            board[i][j] = 2;
        }
    }
    return board;
}

io.on('connection', (socket) => {
    console.log(`Yeni bağlantı: ${socket.id}`);
    
    // ODA OLUŞTURMA
    socket.on('createRoom', (userData) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: userData.username,
            guestId: null,
            guestUsername: null,
            gameState: {
                board: initializeBoard(),
                turn: 1, // 1: Kırmızı (Host), 2: Beyaz (Guest)
                stage: 'WAITING',
                hostScore: 0,
                guestScore: 0
            }
        };
        socket.join(code);
        socket.emit('roomCreated', code);
        console.log(`Oda oluşturuldu: ${code} - Host: ${userData.username}`);
    });

    // ODAYA KATILMA
    socket.on('joinRoom', (userData) => {
        const code = userData.roomCode.toUpperCase();
        const room = rooms[code];

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = userData.username;
        room.gameState.stage = 'PLAY';
        socket.join(code);
        
        socket.emit('roomJoined', code); 

        const players = [
            { id: room.hostId, username: room.hostUsername, isHost: true },
            { id: room.guestId, username: room.guestUsername, isHost: false }
        ];
        
        io.to(code).emit('gameStart', { players, roomCode: code });
        console.log(`${userData.username} otağa Qoşuldu : ${code}`);
        
        // Oyunun başlaması için tahta durumunu gönder
        setTimeout(() => {
            io.to(code).emit('gameReady', {
                board: room.gameState.board,
                turn: room.gameState.turn,
                hostName: room.hostUsername,
                guestName: room.guestUsername,
                isHost: socket.id === room.hostId // Bu bilgi gameStart ile gönderiliyor, burası gereksiz olabilir
            });
            console.log(`🚀 gameReady sinyali gönderildi: ${code}`);
        }, 500);
    });
    
    // OYUN HAMLESİ
    socket.on('makeMove', (data) => {
        const { roomCode, fromRow, fromCol, toRow, toCol } = data;
        const room = rooms[roomCode];
        if (!room || room.gameState.stage !== 'PLAY') return;

        const isHost = socket.id === room.hostId;
        const playerTurn = isHost ? 1 : 2; // 1: Kırmızı (Host), 2: Beyaz (Guest)

        if (room.gameState.turn !== playerTurn) {
            socket.emit('error', 'Sənin sıran deyil.');
            return;
        }

        // Basit bir hamle kontrolü (Asıl detaylı kontrol client tarafında yapılacak)
        // Burada sadece hamleyi diğer oyuncuya yayınlıyoruz ve sırayı değiştiriyoruz.
        
        // Hamleyi işleme (Basit doğrulama)
        const piece = room.gameState.board[fromRow][fromCol];
        if (piece !== playerTurn && piece !== playerTurn + 2) { // Kendi taşı değilse
            socket.emit('error', 'Bu sizin daşınız deyil.');
            return;
        }

        // Hamleyi Tahtada Uygula (Şah yapma mantığı dahil)
        const isKing = (piece === 3 || piece === 4);
        const isCapture = Math.abs(fromRow - toRow) === 2; // Basit yakalama kontrolü

        let newBoard = JSON.parse(JSON.stringify(room.gameState.board));
        
        // Taşı yeni konuma taşı
        let newPiece = piece;
        if (playerTurn === 1 && toRow === 0 && !isKing) { // Kırmızı şah
            newPiece = 3; 
        } else if (playerTurn === 2 && toRow === 7 && !isKing) { // Beyaz şah
            newPiece = 4;
        }
        newBoard[toRow][toCol] = newPiece;
        newBoard[fromRow][fromCol] = 0; // Eski konumu boşalt

        if (isCapture) {
            // Yakalanan taşı tahtadan kaldır
            const capturedRow = (fromRow + toRow) / 2;
            const capturedCol = (fromCol + toCol) / 2;
            newBoard[capturedRow][capturedCol] = 0;
            
            // Eğer yakalama varsa ve hala yakalama imkanı varsa sıra değişmez.
            // Bu mantık client'ta çok daha karmaşık olduğu için burada basitleştiriyoruz
        }

        // Oyun Durumunu Güncelle
        room.gameState.board = newBoard;
        room.gameState.turn = room.gameState.turn === 1 ? 2 : 1; // Sırayı değiştir
        
        // Kazanan kontrolü (Çok basit)
        const remainingPiecesHost = newBoard.flat().filter(p => p === 1 || p === 3).length;
        const remainingPiecesGuest = newBoard.flat().filter(p => p === 2 || p === 4).length;
        let winner = null;

        if (remainingPiecesHost === 0) {
            winner = room.guestUsername;
            room.gameState.guestScore += 1;
        } else if (remainingPiecesGuest === 0) {
            winner = room.hostUsername;
            room.gameState.hostScore += 1;
        }

        // Hareketi her iki oyuncuya da gönder
        io.to(roomCode).emit('moveMade', {
            board: room.gameState.board,
            turn: room.gameState.turn, // Yeni sıra
            from: { r: fromRow, c: fromCol },
            to: { r: toRow, c: toCol },
            isCapture: isCapture, // Yakalama olup olmadığı
            winner: winner,
            scores: { host: room.gameState.hostScore, guest: room.gameState.guestScore }
        });
        
        console.log(`Hamle Yapıldı - Oda: ${roomCode}, Oyuncu: ${playerTurn}, Yeni sıra: ${room.gameState.turn}`);
    });
    
    // Oyun Bitiminden Sonra Tahtayı Sıfırlama
    socket.on('resetGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        room.gameState.board = initializeBoard();
        room.gameState.turn = 1; 
        room.gameState.stage = 'PLAY';
        
        io.to(roomCode).emit('gameReady', {
            board: room.gameState.board,
            turn: room.gameState.turn,
            hostName: room.hostUsername,
            guestName: room.guestUsername,
        });
        
        console.log(`🎲 Oyun Sıfırlandı: ${roomCode}`);
    });

    // Sohbet mesajı işleme (Aynı Kalsın)
    socket.on('emojiMessage', ({ roomCode, emoji }) => {
        io.to(roomCode).emit('emojiMessage', { emoji: emoji });
    });

    // Bağlantı kesildiğinde (Aynı Kalsın)
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

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
