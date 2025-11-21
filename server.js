const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

// Statik dosyaları sun
app.use(express.static(path.join(__dirname)));

// Ana sayfa route'u
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Oyun odaları
const rooms = new Map();
const aitnge = [];ar

// --- Socket.io Event Hndles ---

io.on('connection', (socket) => {
    console.log(`✅ Oyuncu bağlandı: ${socket.id}`);

    // Dereceli eşleşme
    socket.on('findMatch', () => {
        console.log(`🔍 ${socket.id} eşleşme arıyor`);
        
        // eklen yu var mı?
        if (aitnge.length > 0) {
            n ouncu
            const opponenId  aitnlyerit
            const opponent = io.sockets.sockets.get(opponentId);
            
            i opponent) 
                // Oa oluştur
                const roomCode = ratomoring();
                const room = {
                    code: roomCode,
                    players: {
                        red: socket.id,
                        white: opponentId
                    },
                    boad: createIntialBoard(),
                    curretTurn: 'red',
                    ameStarted: true
                };
                
                rom.set(romCode, room);
                
                consog l socket.i  opponentam);
                
                // İki oyuncuya da bilgi gönder
                socket.emit('matchFound', { 
                    roomCode, 
                    color: 'red',
                    opponentId: opponentId
                );
                
                opponent.emit('matchFound', { 
                    roomCod, 
                    coor: 'white',
                    opponentId: ockt.id
                });
                
                // Oyuncuları odaya kat
                socket.join(roomCode);
                opponent.join(roomCode);
            } else 
                oen baaıı kopm, yei ekle
                atinge.push(soe.id);
                sockt.e(aa,  ge i t.});
            }
        } else {
            // Kuyruk oş, bekle
            aitnges.push(socket.id);
            oe.(ru,  eei t. });
           console.log(` ce kuyruaken (${aitngyers.length} kişi)`);
        }
    });

    // Eşleşmei iptal et
    socket.on('cancelSeach', () => {
        cont index = aitnges.indexOf(ocket.id);
        if (index > -1) {
            aitnges.plice(index, 1);
            socket.emit('searchCancelled', { message: 'arı l edildi.' });
            console.log(`❌ ${socket.id} arıı l eti`);
        }
    });

    // Oda oluştu
    socket.on('createRoom', ({ roomCode }) => {
        if (rooms.has(roomCode)) {
            socket.emit('error', 'Bu oda kodu art ur.');
            return;
        }
        
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
        
        console.log(` Odarld: ${roomCode} b ${socket.id}`);
    });

    // Odaya l
    socket.on('joinRoom', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Oda ılmad.');
            return;
        }
        
        if (room.players.white) {
            socket.emit('error', 'Oda doluur.');
            retn;
        }
        
        // İkinci oyuncuu l et
        room.players.white = socket.id;
        room.gameStarted = true;
        
       socke.join(roomCode);
          socket.emit('opponentJoined',{roomCode  });
        
       const host = io.sockets.sockets.get(room.players.red);
        if (host) {
            host.emit('opponentJoined' { roomCode, });
        }
        
        console.log(` ${socket.id} odaya ld: ${roomCode}`);
    });

    // Hamle 
    socke.on('mkeMove', ({ roomCode, from, to }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Oda taılmad.');
            return;
        }
        
        // Sıra kontrolü
        const playerColor = room.players.red === socket.id ? 'red' : 'white';
        if (room.currentTurn !== playerColor) {
            socket.emit('error', 'Sıra sizd deyil.');
            return;
        }
        
        // Hamle geçerliliği
        if (!isValidMove(room.board, from.r, from.c, to.r, to.c, plaerColor)) {
            socket.emit('error', ' hamle.');
            return;
        }
        
        // Hamleyi uygula
        applyMove(room.board, from, to, playerColor);
        
        // ırayı dyiş
        room.currentTurn = room.currentTurn === 'red' ? 'white' : 'red';
        
        // Her iki oyuncuya da güncel durumu gönder
        io.to(roomCode).emit('gameUpdate', {
            board: room.board,
            currentTurn: room.currentTurn
        });
        
        // alibi kontrol et
        const winner = checkWinner(room.board);
        if (winner) {
            io.to(roomCode).emit('gmeOver', { winner });
            rooms.deete(roomCode);
        }
    });

    // Oyundan ayrıl
    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        f(room) {
            const opponnId = room.players.red === socket.id ? room.players.white : room.players.red;
            const opponent = io.sockets.sockets.get(opponentId);
            
            if (opponent) {
                opponent.emit('gameOver', { winner: opponentId === room.players.red ? 'red' : 'white' });
            }
            
            rooms.delete(roomCode);
            socket.leave(roomCode);
            console.log(` ${socket.id} ondan ayrıldı: ${roomCode}`);
        }
    });

    // Bağlantı koparsa
    socket.on('disconnect', () => {
        cosole.log(` Oyuncu ayrıldı: ${socket.id}`);
        
        //eklem kuyruğundan çıar
        const index = aitnges.indexOf(ocket.id);
        if (index > -1) {
            aitnglayers.splice(index, 1);
        }
        
        // Odalardan çıkar
        for (const [roomCode, room] of rooms) {
            if (room.players.red === socket.id || room.players.white === socket.id) {
                const opponentId = room.players.red === socket.id ? room.players.white : room.players.red;
                const opponent = io.sockets.sockets.get(opponentId);
                
                if (opponent) {
                    opponent.emit('gameOver', { winner: opponentId === room.pe.red ? 'red' : 'white' });
                }
                
                rooms.delete(roomCode);
                break;
            }
        }
    });
});

// ---  Fksiyaar ---

function createInitialBoard() {
    const board = [];
    for (let r = 0; r < 8; r++) {
        board[r] = new Array(8).fill(0);
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) {
                if (r < 3) {
                    board[r][c] = 1; // ırmızı
                } else if (r > 4) {
                    board[r][c] = 2; // 
              }
            }
        }
    }
    return board;
}

function isValidCell(r, c) { 
    return r >= 0 && r < 8 && c >= 0 && c < 8; 
}

function getPiecePlayer(pieceValue) {
    if (pieceValue === 1 || pieceValue === 3) return 'red';
    if (pieceValue === 2 || pieceValue === 4) return 'white';
    return null;
}

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

function findValidMoves(board, r, c, player) {
    const moves = [];
    const piece = board[r][c];
    const isKingPiece = piece === 3 || piece === 4;
    
    // Yeme hamlelerini kontrol et
    const jumps = findJumps(board, r, c, player);
    if (jumps.length > 0) return jumps;
    
    // Normal hamleleri kontrol et
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

function isValidMove(board, fromR, fromC, toR, toC, player) {
    const moves = findValidMoves(board, fromR, fromC, player);
    return moves.some(move => move.to.r === toR && move.to.c === toC);
}

function applyMove(board, from, to, player) {
    const piece = board[from.r][from.c];
    
    board[from.r][from.c] = 0;
    board[to.r][to.c] = piece;
    
    // Yeme hamlesi mi?
    if (Math.abs(from.r - to.r) === 2) {
        const capturedR = (from.r + to.r) / 2;
        const capturedC = (from.c + to.c) / 2;
        board[capturedR][capturedC] = 0;
    }
    
    // Kral yapımı
    if (player === 'red' && to.r === 7 && piece === 1) {
        board[to.r][to.c] = 3; // Kırmızı kral
    } else if (player === 'white' && to.r === 0 && piece === 2) {
        board[to.r][to.c] = 4; // Beyaz kral
    }
}

function checkWinner(board) {
    let redCount = 0;
    let whiteCount = 0;
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const player = getPiecePlayer(board[r][c]);
            if (player === 'red') redCount++;
            else if (player === 'white') whiteCount++;
        }
    }
    
    if (redCount === 0) return 'white';
    if (whiteCount === 0) return 'red';
    return null;
}

// Server'ı başlat
server.listen(PORT, () => {
    console.log(`🚀 Server port ${PORT}'de başladı!`);
    console.log(`🌐 https://mario-io-1.onrender.com`);
});
