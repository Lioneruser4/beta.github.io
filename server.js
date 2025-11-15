// Dosya Adı: server.js
// Dama Oyunu Sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Tüm kaynaklardan gelen bağlantılara izin ver
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] 
});

const rooms = {}; // Aktif oda bilgileri
const scores = {}; // Skor takibi için obje

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
                stage: 'WAITING', // WAITING, PLAY, ENDED
                currentTurn: 'white', // white or black
                board: createNewBoard(),
                winner: null,
                lastMove: null
            }
        };
        
        function createNewBoard() {
            const board = Array(8).fill().map(() => Array(8).fill(null));
            
            // Place initial pieces
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    // Only place pieces on black squares
                    if ((row + col) % 2 !== 0) {
                        if (row < 3) {
                            board[row][col] = { type: 'black', isKing: false };
                        } else if (row > 4) {
                            board[row][col] = { type: 'white', isKing: false };
                        }
                    }
                    
                }
            }
            return board;
        }
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
        
        // Oyun tahtasını başlat
        room.gameState.board = createNewBoard();
        room.gameState.currentTurn = 'white'; // Host (beyaz) başlar
        room.gameState.winner = null;
        room.gameState.lastMove = null;
        
        function createNewBoard() {
            const board = Array(8).fill().map(() => Array(8).fill(null));
            
            // Başlangıç taşlarını yerleştir
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    // Sadece siyah karelere taş yerleştir
                    if ((row + col) % 2 !== 0) {
                        if (row < 3) {
                            board[row][col] = { type: 'black', isKing: false };
                        } else if (row > 4) {
                            board[row][col] = { type: 'white', isKing: false };
                        }
                    }
                }
            }
            return board;
        }
        
        // Skorları başlat
        if (!scores[code]) {
            scores[code] = {
                host: 0,
                guest: 0
            };
        }
        
        // Oyun durumunu gönder
        const gameState = {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            winner: room.gameState.winner,
            lastMove: room.gameState.lastMove
        };
        
        // Client'a oyun durumunu gönder
        io.to(code).emit('gameReady', gameState);
        console.log(`🚀 Dama oyunu başladı: ${code}`);
    });

    // Dama hamlesi
    socket.on('makeMove', (data) => {
        const { roomCode, from, to } = data;
        const room = rooms[roomCode];
        if (!room || room.gameState.stage !== 'PLAY' || room.gameState.winner) return;

        // Sıra kontrolü
        const isHost = socket.id === room.hostId;
        const currentPlayerColor = isHost ? 'white' : 'black';
        
        if (room.gameState.currentTurn !== currentPlayerColor) {
            socket.emit('error', 'Sənin sıran deyil');
            return;
        }

        // Hamle geçerli mi kontrol et
        if (!isValidMove(room.gameState.board, from, to, currentPlayerColor)) {
            socket.emit('error', 'Keçərsiz hərəkət');
            return;
        }

        // Hamleyi yap
        const { board, capturedPiece } = makeMove(room.gameState.board, from, to);
        room.gameState.board = board;
        room.gameState.lastMove = { from, to };

        // Kazanan var mı kontrol et
        const winner = checkWinner(board);
        if (winner) {
            room.gameState.winner = winner;
            room.gameState.stage = 'ENDED';
            
            // Skoru güncelle
            if (winner === 'white') {
                scores[roomCode].host++;
            } else {
                scores[roomCode].guest++;
            }
        } else {
            // Sırayı değiştir
            room.gameState.currentTurn = currentPlayerColor === 'white' ? 'black' : 'white';
        }

        // Tüm oyunculara güncel durumu gönder
        io.to(roomCode).emit('gameStateUpdate', {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            winner: room.gameState.winner,
            lastMove: room.gameState.lastMove,
            scores: scores[roomCode]
        });
        
        function isValidMove(board, from, to, playerColor) {
            const { row: fromRow, col: fromCol } = from;
            const { row: toRow, col: toCol } = to;
            
            // Geçerli konumlar mı?
            if (!isValidPosition(fromRow, fromCol) || !isValidPosition(toRow, toCol)) {
                return false;
            }
            
            const piece = board[fromRow][fromCol];
            
            // Taş var mı ve oyuncunun taşı mı?
            if (!piece || piece.type !== playerColor) {
                return false;
            }
            
            // Hedef boş mu?
            if (board[toRow][toCol] !== null) {
                return false;
            }
            
            // Çapraz hareket mi?
            const rowDiff = Math.abs(toRow - fromRow);
            const colDiff = Math.abs(toCol - fromCol);
            
            if (rowDiff !== colDiff) {
                return false;
            }
            
            // Normal taşlar sadece ileri gidebilir (kral değilse)
            if (!piece.isKing) {
                const direction = piece.type === 'white' ? -1 : 1;
                if ((toRow - fromRow) * direction <= 0) {
                    return false;
                }
            }
            
            // 1 kare hareket
            if (rowDiff === 1) {
                return true;
            }
            
            // 2 kare hareket (taş yeme)
            if (rowDiff === 2) {
                const midRow = (fromRow + toRow) / 2;
                const midCol = (fromCol + toCol) / 2;
                const midPiece = board[midRow][midCol];
                
                // Ortadaki taş rakip taşı mı?
                return midPiece && midPiece.type !== playerColor;
            }
            
            return false;
        }
        
        function makeMove(board, from, to) {
            const newBoard = JSON.parse(JSON.stringify(board));
            const { row: fromRow, col: fromCol } = from;
            const { row: toRow, col: toCol } = to;
            
            // Taşı hareket ettir
            const piece = newBoard[fromRow][fromCol];
            newBoard[toRow][toCol] = { ...piece };
            newBoard[fromRow][fromCol] = null;
            
            // Eğer son sıraya ulaştıysa kral yap
            if ((piece.type === 'white' && toRow === 0) || 
                (piece.type === 'black' && toRow === 7)) {
                newBoard[toRow][toCol].isKing = true;
            }
            
            // Eğer taş yeme hamlesiyse, yenilen taşı kaldır
            if (Math.abs(toRow - fromRow) === 2) {
                const midRow = (fromRow + toRow) / 2;
                const midCol = (fromCol + toCol) / 2;
                newBoard[midRow][midCol] = null;
                return { board: newBoard, capturedPiece: true };
            }
            
            return { board: newBoard, capturedPiece: false };
        }
        
        function checkWinner(board) {
            let whitePieces = 0;
            let blackPieces = 0;
            let whiteHasMoves = false;
            let blackHasMoves = false;
            
            // Taş sayılarını ve geçerli hamleleri say
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const piece = board[row][col];
                    if (piece) {
                        if (piece.type === 'white') {
                            whitePieces++;
                            if (!whiteHasMoves) {
                                whiteHasMoves = hasValidMoves(board, row, col);
                            }
                        } else {
                            blackPieces++;
                            if (!blackHasMoves) {
                                blackHasMoves = hasValidMoves(board, row, col);
                            }
                        }
                    }
                }
            }
            
            if (whitePieces === 0 || !whiteHasMoves) return 'black';
            if (blackPieces === 0 || !blackHasMoves) return 'white';
            return null;
        }
        
        function hasValidMoves(board, row, col) {
            const piece = board[row][col];
            if (!piece) return false;
            
            const directions = [];
            
            // Normal taşlar için yönler
            if (piece.isKing || piece.type === 'white') {
                directions.push([-1, -1], [-1, 1]); // Beyaz taşlar yukarı gider
            }
            if (piece.isKing || piece.type === 'black') {
                directions.push([1, -1], [1, 1]); // Siyah taşlar aşağı gider
            }
            
            for (const [dr, dc] of directions) {
                const newRow = row + dr;
                const newCol = col + dc;
                
                // Normal hamle
                if (isValidPosition(newRow, newCol) && !board[newRow][newCol]) {
                    return true;
                }
                
                // Taş yeme hamlesi
                const jumpRow = row + 2 * dr;
                const jumpCol = col + 2 * dc;
                if (isValidPosition(jumpRow, jumpCol) && 
                    !board[jumpRow][jumpCol] && 
                    board[newRow][newCol] && 
                    board[newRow][newCol].type !== piece.type) {
                    return true;
                }
            }
            
            return false;
        }
        
        function isValidPosition(row, col) {
            return row >= 0 && row < 8 && col >= 0 && col < 8;
        }

            });

    // Oyun durumunu sıfırla
    socket.on('resetGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        // Oyun durumunu sıfırla
        room.gameState = {
            stage: 'PLAY',
            currentTurn: 'white',
            board: createNewBoard(),
            winner: null,
            lastMove: null
        };
        
        function createNewBoard() {
            const board = Array(8).fill().map(() => Array(8).fill(null));
            
            // Başlangıç taşlarını yerleştir
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    // Sadece siyah karelere taş yerleştir
                    if ((row + col) % 2 !== 0) {
                        if (row < 3) {
                            board[row][col] = { type: 'black', isKing: false };
                        } else if (row > 4) {
                            board[row][col] = { type: 'white', isKing: false };
                        }
                    }
                }
            }
            return board;
        }
        
        // Tüm oyunculara yeni oyun durumunu gönder
        io.to(roomCode).emit('gameStateUpdate', {
            board: room.gameState.board,
            currentTurn: room.gameState.currentTurn,
            winner: null,
            lastMove: null,
            scores: scores[roomCode] || { host: 0, guest: 0 }
        });
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
            
            // Mesajı oda üyelerine ilet
            io.to(roomCode).emit('chatMessage', {
                sender: sender,
                message: trimmedMessage,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Sohbet mesajı işlenirken hata:', error);
        }
    });
    
    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        console.log(`Bağlantı kesildi: ${socket.id}`);
        
        // Eğer bu kullanıcı bir odada ise, diğer oyuncuyu bilgilendir
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const otherPlayerId = room.hostId === socket.id ? room.guestId : room.hostId;
                if (otherPlayerId) {
                    io.to(otherPlayerId).emit('opponentDisconnected');
                }
                
                // Odayı temizle
                if (room.playerCount <= 1) {
                    delete rooms[code];
                    console.log(`Oda silindi: ${code}`);
                } else {
                    room.playerCount--;
                    if (room.hostId === socket.id) {
                        room.hostId = room.guestId;
                        room.hostUsername = room.guestUsername;
                        room.guestId = null;
                        room.guestUsername = null;
                    } else {
                        room.guestId = null;
                        room.guestUsername = null;
                    }
                }
                break;
            }
        }
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
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
