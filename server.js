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

// Statik dosyalari sun
app.use(express.static(path.join(__dirname)));

// Ana sayfa route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Oyun odalari
const rooms = new Map();
const waitingPlayers = [];

// --- Socket.io Event Handlers ---

io.on('connection', (socket) => {
    console.log('✅ Oyuncu baglandi:', socket.id);

    // Dereceli eslesme
    socket.on('findMatch', () => {
        console.log('🔍 ' + socket.id + ' eslesme ariyor');
        console.log('📊 Mevcut kuyruk: [' + waitingPlayers.join(', ') + '] (' + waitingPlayers.length + ' kisi)');
        
        // Bekleyen oyuncu var mi?
        if (waitingPlayers.length > 0) {
            const opponentId = waitingPlayers.shift();
            console.log('🎯 Rakip ID: ' + opponentId);
            const opponent = io.sockets.sockets.get(opponentId);
            
            console.log('🔌 Rakip var mi: ' + (opponent ? 'evet' : 'yok'));
            
            if (opponent) {
                // Oda olustur
                const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
                const room = {
                    code: roomCode,
                    players: {
                        red: socket.id,
                        white: opponentId
                    },
                    board: createInitialBoard(),
                    currentTurn: 'red',
                    gameStarted: true
                };
                
                rooms.set(roomCode, room);
                
                console.log('🎉 Eslesme basarili:', socket.id, 'vs', opponentId, 'Oda:', roomCode);
                console.log('📤 MatchFound gonderiliyor...');
                
                // Iki oyuncuya da bilgi gonder
                socket.emit('matchFound', { 
                    roomCode, 
                    color: 'red',
                    opponentId: opponentId
                });
                
                opponent.emit('matchFound', { 
                    roomCode, 
                    color: 'white',
                    opponentId: socket.id
                });
                
                // Oyunculari odaya kat
                socket.join(roomCode);
                opponent.join(roomCode);
                
                console.log('✅ Oyuncular odaya katildi, eslesme tamamlandi!');
            } else {
                console.log('⚠️ Rakip baglanti kopmus, kuyruga geri ekleniyor');
                waitingPlayers.push(socket.id);
                socket.emit('searchStatus', { message: 'Raqib axtarilir...' });
            }
        } else {
            waitingPlayers.push(socket.id);
            socket.emit('searchStatus', { message: 'Raqib axtarilir...' });
            console.log('⏳ Kuyruk bos, ' + socket.id + ' eklendi (' + waitingPlayers.length + ' kisi)');
        }
        
        console.log('📈 Son durum: [' + waitingPlayers.join(', ') + '] (' + waitingPlayers.length + ' kisi)');
    });

    // Eslesmeyi iptal et
    socket.on('cancelSearch', () => {
        const index = waitingPlayers.indexOf(socket.id);
        if (index > -1) {
            waitingPlayers.splice(index, 1);
            socket.emit('searchCancelled', { message: 'Axtaris legv edildi.' });
            console.log('❌ ' + socket.id + ' axtarisi legv etti');
        }
    });

    // Oda olustur
    socket.on('createRoom', ({ roomCode }) => {
        if (rooms.has(roomCode)) {
            socket.emit('error', 'Bu oda kodu zaten var.');
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
        
        console.log('🏠 Oda olusturuldu:', roomCode, 'Sahip:', socket.id);
    });

    // Odaya katil
    socket.on('joinRoom', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Oda bulunamadi.');
            return;
        }
        
        if (room.players.white) {
            socket.emit('error', 'Oda dolu.');
            return;
        }
        
        // Ikinci oyuncuyu ekle
        room.players.white = socket.id;
        room.gameStarted = true;
        
        socket.join(roomCode);
        
        // Iki oyuncuya da haber ver
        socket.emit('opponentJoined', { roomCode, color: 'white' });
        
        const host = io.sockets.sockets.get(room.players.red);
        if (host) {
            host.emit('opponentJoined', { roomCode, color: 'red' });
        }
        
        console.log('👥 ' + socket.id + ' odaya katildi:', roomCode);
    });

    // Hamle yap
    socket.on('makeMove', ({ roomCode, from, to }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Oda bulunamadi.');
            return;
        }
        
        // Sira kontrolu
        const playerColor = room.players.red === socket.id ? 'red' : 'white';
        if (room.currentTurn !== playerColor) {
            socket.emit('error', 'Sira sizde degil.');
            return;
        }
        
        // Hamle gecerliligi
        if (!isValidMove(room.board, from.r, from.c, to.r, to.c, playerColor)) {
            socket.emit('error', 'Yanlis hamle.');
            return;
        }
        
        // Hamleyi uygula
        applyMove(room.board, from, to, playerColor);
        
        // Sirayi degistir
        room.currentTurn = room.currentTurn === 'red' ? 'white' : 'red';
        
        // Iki oyuncuya da guncel durumu gonder
        io.to(roomCode).emit('gameUpdate', {
            board: room.board,
            currentTurn: room.currentTurn
        });
        
        // Kazanani kontrol et
        const winner = checkWinner(room.board);
        if (winner) {
            io.to(roomCode).emit('gameOver', { winner });
            rooms.delete(roomCode);
        }
    });

    // Oyundan ayril
    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (room) {
            const opponentId = room.players.red === socket.id ? room.players.white : room.players.red;
            const opponent = io.sockets.sockets.get(opponentId);
            
            if (opponent) {
                opponent.emit('gameOver', { winner: opponentId === room.players.red ? 'red' : 'white' });
            }
            
            rooms.delete(roomCode);
            socket.leave(roomCode);
            console.log('🚪 ' + socket.id + ' oyundan ayrildi:', roomCode);
        }
    });

    // Baglanti koparsa
    socket.on('disconnect', () => {
        console.log('❌ Oyuncu ayrildi:', socket.id);
        
        // Bekleme kuyrugundan cikar
        const index = waitingPlayers.indexOf(socket.id);
        if (index > -1) {
            waitingPlayers.splice(index, 1);
        }
        
        // Odalardan cikar
        for (const [roomCode, room] of rooms) {
            if (room.players.red === socket.id || room.players.white === socket.id) {
                const opponentId = room.players.red === socket.id ? room.players.white : room.players.red;
                const opponent = io.sockets.sockets.get(opponentId);
                
                if (opponent) {
                    opponent.emit('gameOver', { winner: opponentId === room.players.red ? 'red' : 'white' });
                }
                
                rooms.delete(roomCode);
                break;
            }
        }
    });
});

// --- Oyun Fonksiyonlari ---

function createInitialBoard() {
    const board = [];
    for (let r = 0; r < 8; r++) {
        board[r] = new Array(8).fill(0);
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) {
                if (r < 3) {
                    board[r][c] = 1; // Kirmizi
                } else if (r > 4) {
                    board[r][c] = 2; // Ag
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
    
    // Kral yapimi
    if (player === 'red' && to.r === 7 && piece === 1) {
        board[to.r][to.c] = 3; // Kirmizi kral
    } else if (player === 'white' && to.r === 0 && piece === 2) {
        board[to.r][to.c] = 4; // Ag kral
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

// Server'i baslat
server.listen(PORT, () => {
    console.log('🚀 Server port ' + PORT + 'de calisiyor');
    console.log('🌐 https://mario-io-1.onrender.com');
});
