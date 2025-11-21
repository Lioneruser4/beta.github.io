const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Matchmaking kuyrugu
let matchmakingQueue = [];
const rooms = new Map();

// Oyun tahtasını oluştur
function createInitialBoard() {
    const board = [];
    for (let r = 0; r < 8; r++) {
        board[r] = new Array(8).fill(0);
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) {
                if (r < 3) board[r][c] = 1; // Kırmızı taşlar
                else if (r > 4) board[r][c] = 2; // Beyaz taşlar
            }
        }
    }
    return board;
}

// Oda kodu oluştur (4 haneli sayı)
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Taşın sahibini belirle
function getPiecePlayer(pieceValue) {
    if (pieceValue === 1 || pieceValue === 3) return 'red';
    if (pieceValue === 2 || pieceValue === 4) return 'white';
    return null;
}

// Zıplama hamlelerini bul
function findJumps(board, r, c, player) {
    const piece = board[r][c];
    const isKingPiece = piece === 3 || piece === 4;
    const jumps = [];
    const directions = isKingPiece ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
        player === 'red' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];

    for (const [dr, dc] of directions) {
        const capturedR = r + dr;
        const capturedC = c + dc;
        const landR = r + 2 * dr;
        const landC = c + 2 * dc;

        if (isValidCell(landR, landC) && board[landR][landC] === 0) {
            const capturedPieceValue = board[capturedR][capturedC];
            const capturedPlayer = getPiecePlayer(capturedPieceValue);

            if (capturedPlayer && capturedPlayer !== player) {
                jumps.push({ from: { r, c }, to: { r: landR, c: landC }, captured: { r: capturedR, c: capturedC } });
            }
        }
    }
    return jumps;
}

// Geçerli hamleleri bul
function findValidMoves(board, r, c, player) {
    const moves = [];
    const piece = board[r][c];
    const isKingPiece = piece === 3 || piece === 4;
    
    // Önce zorunlu zıplamaları kontrol et
    const jumps = findJumps(board, r, c, player);
    if (jumps.length > 0) return jumps;
    
    // Normal hamleler
    const directions = isKingPiece ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
        player === 'red' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];

    for (const [dr, dc] of directions) {
        const newR = r + dr;
        const newC = c + dc;

        if (isValidCell(newR, newC) && board[newR][newC] === 0) {
            moves.push({ from: { r, c }, to: { r: newR, c: newC } });
        }
    }
    return moves;
}

// Hücre geçerli mi?
function isValidCell(r, c) { 
    return r >= 0 && r < 8 && c >= 0 && c < 8; 
}

// Hamle geçerli mi?
function isValidMove(board, fromR, fromC, toR, toC, player) {
    const moves = findValidMoves(board, fromR, fromC, player);
    return moves.some(move => move.to.r === toR && move.to.c === toC);
}

// Oyun bitti mi?
function checkWinner(board, currentPlayer) {
    const otherPlayer = currentPlayer === 'red' ? 'white' : 'red';
    let hasPieces = false;
    let hasValidMoves = false;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            const piecePlayer = getPiecePlayer(piece);
            
            if (piecePlayer === otherPlayer) {
                hasPieces = true;
                if (findValidMoves(board, r, c, otherPlayer).length > 0) {
                    hasValidMoves = true;
                    break;
                }
            }
        }
        if (hasValidMoves) break;
    }

    if (!hasPieces || !hasValidMoves) {
        return currentPlayer; // Mevcut oyuncu kazandı
    }
    return null;
}

// Socket.io bağlantıları
io.on('connection', (socket) => {
    console.log(`✅ Yeni bağlantı: ${socket.id}`);

    // Eşleşme arama
    socket.on('findMatch', () => {
        console.log(`🔍 ${socket.id} eşleşme arıyor`);
        
        // Kullanıcıyı kuyruğa ekle
        if (!matchmakingQueue.includes(socket.id)) {
            matchmakingQueue.push(socket.id);
            console.log(`📊 Kuyruk: ${matchmakingQueue.join(', ')}`);
        }

        // Eğer kuyrukta en az iki kişi varsa eşleştir
        if (matchmakingQueue.length >= 2) {
            const player1 = matchmakingQueue.shift();
            const player2 = matchmakingQueue.shift();
            
            const roomCode = generateRoomCode();
            const room = {
                code: roomCode,
                players: {
                    red: player1,
                    white: player2
                },
                board: createInitialBoard(),
                currentTurn: 'red',
                gameStarted: true,
                startTime: Date.now()
            };
            
            rooms.set(roomCode, room);
            
            // Oyunculara oda bilgilerini gönder
            io.to(player1).emit('matchFound', { 
                roomCode, 
                color: 'red',
                opponentId: player2
            });
            
            io.to(player2).emit('matchFound', { 
                roomCode, 
                color: 'white',
                opponentId: player1
            });
            
            console.log(`🎉 Eşleşme: ${player1} (kırmızı) vs ${player2} (beyaz) - Oda: ${roomCode}`);
        } else {
            // Kuyruk durumunu güncelle
            socket.emit('searchStatus', { 
                status: 'searching', 
                message: `Eşleşme aranıyor... (${matchmakingQueue.length}/2)`,
                queueSize: matchmakingQueue.length
            });
        }
    });

    // Arama iptali
    socket.on('cancelSearch', () => {
        console.log(`❌ ${socket.id} aramayı iptal etti`);
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        socket.emit('searchCancelled', { message: 'Arama iptal edildi.' });
    });

    // Oda oluşturma (arkadaşla oyna)
    socket.on('createRoom', ({ roomCode }) => {
        if (!roomCode) roomCode = generateRoomCode();
        
        const room = {
            code: roomCode,
            players: {
                red: socket.id,
                white: null
            },
            board: createInitialBoard(),
            currentTurn: 'red',
            gameStarted: false
        };
        
        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode });
        console.log(`🏠 Oda oluşturuldu: ${roomCode} - Ev Sahibi: ${socket.id}`);
    });

    // Odaya katılma
    socket.on('joinRoom', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('error', 'Oda bulunamadı!');
            return;
        }
        
        if (room.players.white) {
            socket.emit('error', 'Oda dolu!');
            return;
        }
        
        room.players.white = socket.id;
        room.gameStarted = true;
        socket.join(roomCode);
        
        // Her iki oyuncuya da oyunun başladığını bildir
        io.to(room.players.red).emit('opponentJoined', { 
            roomCode,
            opponentId: socket.id
        });
        
        socket.emit('opponentJoined', { 
            roomCode,
            opponentId: room.players.red
        });
        
        console.log(`👥 Odaya katılım: ${roomCode} - Oyuncu: ${socket.id}`);
    });

    // Hamle yapma
    socket.on('makeMove', ({ roomCode, from, to }) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        const { board, currentTurn } = room;
        const player = room.players.red === socket.id ? 'red' : 
                      room.players.white === socket.id ? 'white' : null;
        
        if (!player || player !== currentTurn) return;
        
        // Hamleyi uygula
        const piece = board[from.r][from.c];
        board[to.r][to.c] = piece;
        board[from.r][from.c] = 0;
        
        // Eğer taş son sıraya ulaştıysa kral yap
        if ((player === 'red' && to.r === 7) || (player === 'white' && to.r === 0)) {
            board[to.r][to.c] = player === 'red' ? 3 : 4; // 3: Kırmızı kral, 4: Beyaz kral
        }
        
        // Sırayı değiştir
        room.currentTurn = currentTurn === 'red' ? 'white' : 'red';
        
        // Kazanan var mı kontrol et
        const winner = checkWinner(board, currentTurn);
        if (winner) {
            io.to(roomCode).emit('gameOver', { winner });
            rooms.delete(roomCode);
            return;
        }
        
        // Oyun durumunu güncelle
        io.to(roomCode).emit('gameUpdate', {
            board,
            currentTurn: room.currentTurn
        });
    });

    // Oyundan ayrılma
    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        const player = room.players.red === socket.id ? 'red' : 
                      room.players.white === socket.id ? 'white' : null;
        
        if (player) {
            // Diğer oyuncuya oyunun bittiğini bildir
            const otherPlayerId = room.players[player === 'red' ? 'white' : 'red'];
            if (otherPlayerId) {
                io.to(otherPlayerId).emit('gameOver', { 
                    winner: player === 'red' ? 'white' : 'red',
                    reason: 'Rakip oyundan ayrıldı.'
                });
            }
            
            // Odayı temizle
            rooms.delete(roomCode);
            console.log(`🚪 ${socket.id} oyundan ayrıldı - Oda: ${roomCode}`);
        }
    });

    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        console.log(`❌ Bağlantı kesildi: ${socket.id}`);
        
        // Eğer kuyruktaysa çıkar
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        
        // Eğer bir odadaysa çıkar
        for (const [code, room] of rooms.entries()) {
            if (room.players.red === socket.id || room.players.white === socket.id) {
                socket.leave(code);
                const otherPlayerId = room.players.red === socket.id ? room.players.white : room.players.red;
                if (otherPlayerId) {
                    io.to(otherPlayerId).emit('gameOver', { 
                        winner: room.players.red === socket.id ? 'white' : 'red',
                        reason: 'Rakip bağlantısı koptu.'
                    });
                }
                rooms.delete(code);
                console.log(`🚪 ${socket.id} oyundan ayrıldı (bağlantı koptu) - Oda: ${code}`);
                break;
            }
        }
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
    console.log(`🌍 http://localhost:${PORT}`);
});
