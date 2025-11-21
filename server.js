const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

const PORT = process.env.PORT || 10000;

// Loglama
console.log('🎮 Amerikan Daması Sunucusu Başlatılıyor...');
console.log(`📱 Port: ${PORT}`);
console.log(`🌐 URL: https://mario-io-1.onrender.com (Örnek URL)`);

// Statik dosyaları sun
app.use(express.static(path.join(__dirname)));

// Ana sayfa route'u
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Oyun odaları ve Eşleşme Kuyruğu
const rooms = new Map();
// Kuyruk let olarak tanımlandı, bot eşleşmesinde slice işlemi için kritik.
let matchmakingQueue = []; 

// Eşleşme durumunu tüm kuyruğa bildiren yardımcı fonksiyon
function broadcastMatchmakingStatus() {
    // Sadece matchmaking lobisindeki kullanıcılara gönderilir.
    io.to('matchmaking').emit('searchStatus', {
        status: 'searching',
        queueSize: matchmakingQueue.length,
        inQueue: true
    });
}

// --- Socket.io Event Handlers ---

io.on('connection', (socket) => {
    console.log(`✅ Oyuncu bağlandı: ${socket.id}`);

    // Bağlantı durumu
    socket.emit('connected', { 
        message: 'Sunucuya başarıyla bağlandınız!',
        playerId: socket.id 
    });

    // Dereceli eşleşme isteği
    socket.on('findMatch', () => {
        console.log(`🔍 Oyuncu ${socket.id} dereceli eşleşme arıyor`);
        
        // Zaten kuyrukta ise tekrar ekleme
        if (matchmakingQueue.includes(socket.id)) {
            socket.emit('error', 'Zaten eşleşme arıyorsunuz.');
            return;
        }
        
        // Oyuncuyu matchmaking lobisine al
        socket.join('matchmaking');
        
        // Kuyrukta rəqib var mı?
        if (matchmakingQueue.length > 0) {
            // Kuyruktaki ilk oyuncuyu al
            const opponentId = matchmakingQueue.shift();
            const opponent = io.sockets.sockets.get(opponentId);
            
            // Eğer rəqib hala bağlı ise ve aynı kişi değilse
            if (opponent && opponent.connected && opponent.id !== socket.id) {
                console.log(`🎯 Eşleşme bulundu: ${opponentId} (Kuyruk) vs ${socket.id} (Yeni)`);
                
                const roomCode = generateRoomCode();
                const room = {
                    code: roomCode,
                    players: {
                        red: opponentId, // Kuyruktaki oyuncu kırmızı başlar
                        white: socket.id
                    },
                    board: createInitialBoard(),
                    currentTurn: 'red',
                    gameStarted: true,
                    startTime: Date.now()
                };
                
                rooms.set(roomCode, room);
                
                // İki oyuncudan matchmaking lobisini çıkar
                socket.leave('matchmaking');
                opponent.leave('matchmaking');
                
                // Oyuncuları odaya kat
                socket.join(roomCode);
                opponent.join(roomCode);
                
                // İki oyuncuya da otaq bilgisini gönder
                opponent.emit('matchFound', { 
                    roomCode, 
                    color: 'red',
                    opponentId: socket.id
                });
                
                socket.emit('matchFound', { 
                    roomCode, 
                    color: 'white',
                    opponentId: opponentId
                });

                // İlk tahta durumunu gönder (Gerekli değilse silinebilir, client side'da matchFound'da istenmesi daha iyi)
                io.to(roomCode).emit('gameUpdate', {
                    board: room.board,
                    currentTurn: room.currentTurn,
                    mandatoryCaptures: findAllMandatoryJumps(room.board, room.currentTurn),
                    lastMove: null
                });
                
                console.log(`✅ Eşleşme başarılı: ${opponentId} (Red) vs ${socket.id} (White), Oda: ${roomCode}`);
            } else {
                // Rəqib bağlı deyil, kuyruğa yeni oyuncuyu ekle (Kuyrukta kalmışsa tekrar eklenir)
                if (opponentId && opponent && !opponent.connected) {
                    console.log(`⚠️ Kuyruktaki ${opponentId} bağlantısı kəsilmiş.`);
                }
                matchmakingQueue.push(socket.id);
                console.log(`⏳ Oyuncu eklendi: ${socket.id}`);
            }
        } else {
            // Kuyruk boş, oyuncuyu ekle
            matchmakingQueue.push(socket.id);
            console.log(`⏳ Kuyruk boş, oyuncu eklendi: ${socket.id}`);
        }
        
        broadcastMatchmakingStatus();
        
        // Bot eşleştirme mantığı
        if (matchmakingQueue.includes(socket.id) && matchmakingQueue.length === 1) {
            setTimeout(() => {
                // Timeout süresi dolduğunda hala kuyrukta mı kontrol et
                if (matchmakingQueue.includes(socket.id)) {
                    console.log(`🤖 Bot eşleştiriliyor: ${socket.id}`);
                    
                    const roomCode = generateRoomCode();
                    const room = {
                        code: roomCode,
                        players: {
                            red: socket.id,
                            white: 'bot'
                        },
                        board: createInitialBoard(),
                        currentTurn: 'red',
                        gameStarted: true,
                        startTime: Date.now()
                    };
                    
                    rooms.set(roomCode, room);
                    // Kuyruktan çıkar
                    matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
                    socket.leave('matchmaking');
                    
                    // Botla eşleşme bildirimi (matchFound event'i)
                    socket.emit('matchFound', { 
                        roomCode, 
                        color: 'red', // Bot beyaz oynar
                        opponentId: 'bot'
                    });
                    
                    socket.join(roomCode);
                    console.log(`🤖 Bot eşleşmesi başarılı: ${socket.id} (Red) vs Bot, Oda: ${roomCode}`);
                    
                    // Oyun durumu güncellemesi gönder
                    socket.emit('gameUpdate', {
                        board: room.board,
                        currentTurn: room.currentTurn,
                        mandatoryCaptures: findAllMandatoryJumps(room.board, room.currentTurn),
                        lastMove: null
                    });
                }
            }, 5000);
        }
    });

    // Eşleşmeyi iptal et
    socket.on('cancelSearch', () => {
        const index = matchmakingQueue.indexOf(socket.id);
        if (index > -1) {
            matchmakingQueue.splice(index, 1);
            socket.leave('matchmaking');
            socket.emit('searchCancelled', { message: 'Eşleşme araması iptal edildi.' });
            console.log(`❌ Oyuncu ${socket.id} eşleşme aramasını iptal etti`);
            broadcastMatchmakingStatus(); // Kuyruk durumunu güncelle
        }
    });

    // Oda oluştur
    socket.on('createRoom', ({ roomCode }) => {
        console.log(`Oyuncu ${socket.id} oda oluşturuyor: ${roomCode}`);
        
        if (rooms.has(roomCode)) {
            socket.emit('error', 'Bu oda kodu zaten kullanılıyor.');
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
        
        console.log(`Oda oluşturuldu: ${roomCode} by ${socket.id}`);
    });

    // Odaya katıl
    socket.on('joinRoom', ({ roomCode }) => {
        console.log(`Oyuncu ${socket.id} odaya katılıyor: ${roomCode}`);
        
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Oda bulunamadı.');
            return;
        }
        
        if (room.players.white) {
            socket.emit('error', 'Oda dolu.');
            return;
        }
        
        // İkinci oyuncuyu ekle
        room.players.white = socket.id;
        room.gameStarted = true;
        room.startTime = Date.now();
        
        socket.join(roomCode);
        
        // Her iki oyuncuya da bildirim gönder
        io.to(roomCode).emit('opponentJoined', { 
            roomCode,
            opponentId: room.players.red === socket.id ? room.players.white : room.players.red
        });
        
        // İlk tahta durumunu gönder
        io.to(roomCode).emit('gameUpdate', {
            board: room.board,
            currentTurn: room.currentTurn,
            mandatoryCaptures: findAllMandatoryJumps(room.board, room.currentTurn),
            lastMove: null
        });

        console.log(`Oyuncu ${socket.id} odaya katıldı: ${roomCode}. Oyun başladı.`);
    });

    // Hamle yap
    socket.on('makeMove', ({ roomCode, from, to }) => {
        const room = rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Oda bulunamadı.');
            return;
        }
        
        const playerColor = room.players.red === socket.id ? 'red' : room.players.white === socket.id ? 'white' : null;

        if (!playerColor || room.currentTurn !== playerColor) {
            socket.emit('error', 'Sıra sizde değil veya oyunda değilsiniz.');
            return;
        }
        
        // Hamle geçerlilik ve zorunlu yeme kontrolü... (Orijinal mantık korundu)
        const mandatoryJumps = findAllMandatoryJumps(room.board, playerColor);
        const isJumpMove = Math.abs(from.r - to.r) === 2;
        
        if (mandatoryJumps.length > 0) {
            const isMandatoryMove = mandatoryJumps.some(jump => 
                jump.from.r === from.r && jump.from.c === from.c &&
                jump.jumps.some(dest => dest.to.r === to.r && dest.to.c === to.c)
            );
            if (!isMandatoryMove) {
                socket.emit('error', 'Məcburi yeməni etməlisiniz!');
                socket.emit('mandatoryCapture', { mandatoryJumps });
                return;
            }
        } else if (!isValidMove(room.board, from.r, from.c, to.r, to.c, playerColor)) {
            socket.emit('error', 'Geçersiz hamle.');
            return;
        }
        
        const capturedPiece = applyMove(room.board, from, to, playerColor);
        
        // Devam eden yeme kontrolü
        if (capturedPiece) {
            const additionalJumps = findJumps(room.board, to.r, to.c, playerColor);
            if (additionalJumps.length > 0) {
                // Sıra aynı oyuncuda kalır, devam etmesi gerektiğini bildir
                io.to(roomCode).emit('gameUpdate', {
                    board: room.board,
                    currentTurn: room.currentTurn,
                    mustContinueJump: true,
                    jumpPosition: { r: to.r, c: to.c },
                    lastMove: { from, to, player: playerColor, captured: capturedPiece }
                });
                console.log(`🔄 Devam eden yeme: ${socket.id} (${playerColor})`);
                return;
            }
        }
        
        // Sırayı değiştir
        room.currentTurn = room.currentTurn === 'red' ? 'white' : 'red';
        
        // Yeni sıradaki oyuncu için zorunlu yeme kontrolü
        const nextPlayerMandatoryJumps = findAllMandatoryJumps(room.board, room.currentTurn);
        
        // Her iki oyuncuya da güncel durumu gönder
        io.to(roomCode).emit('gameUpdate', {
            board: room.board,
            currentTurn: room.currentTurn,
            mandatoryCaptures: nextPlayerMandatoryJumps,
            mustContinueJump: false,
            jumpPosition: null,
            lastMove: { from, to, player: playerColor, captured: capturedPiece }
        });
        
        // Oyun bitiş kontrolü
        const winner = checkWinner(room.board);
        if (winner) {
            const winnerId = winner === 'red' ? room.players.red : room.players.white;
            const loserId = winner === 'red' ? room.players.white : room.players.red;
            
            io.to(roomCode).emit('gameOver', { 
                winner, 
                winnerId,
                loserId,
                reason: 'Bütün daşlar yeyildi!',
                gameDuration: Math.floor((Date.now() - room.startTime) / 1000)
            });
            
            setTimeout(() => {
                io.to(roomCode).emit('returnToLobby');
            }, 3000);
            
            rooms.delete(roomCode);
        }

        console.log(`♟️ Hamle yapıldı: ${playerColor} ${from.r},${from.c} -> ${to.r},${to.c} ${capturedPiece ? '(yedi)' : ''}`);
    });

    // Oyundan ayrıl
    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (room) {
            const opponentId = room.players.red === socket.id ? room.players.white : room.players.red;
            const opponent = io.sockets.sockets.get(opponentId);
            
            if (opponent) {
                const winnerColor = opponentId === room.players.red ? 'red' : 'white';
                opponent.emit('gameOver', { winner: winnerColor, reason: 'Rəqib oyunu tərk etdi.' });
                opponent.leave(roomCode);
            }
            
            rooms.delete(roomCode);
            socket.leave(roomCode);
            
            console.log(`Oyuncu ${socket.id} odadan ayrıldı: ${roomCode}`);
        }
    });

    // Bağlantı koparsa
    socket.on('disconnect', () => {
        console.log(`Oyuncu ayrıldı: ${socket.id}`);
        
        // Eşleşme kuyruğundan çıkar
        const index = matchmakingQueue.indexOf(socket.id);
        if (index > -1) {
            matchmakingQueue.splice(index, 1);
            broadcastMatchmakingStatus();
        }
        
        // Odalardan çıkar ve rəqibi bilgilendir
        for (const [roomCode, room] of rooms) {
            if (room.players.red === socket.id || room.players.white === socket.id) {
                const opponentId = room.players.red === socket.id ? room.players.white : room.players.red;
                const opponent = io.sockets.sockets.get(opponentId);
                
                if (opponent && opponentId !== 'bot') {
                    const winnerColor = opponentId === room.players.red ? 'red' : 'white';
                    opponent.emit('gameOver', { winner: winnerColor, reason: 'Rəqib bağlantısı kəsildi.' });
                    opponent.leave(roomCode);
                }
                
                rooms.delete(roomCode);
                break;
            }
        }
    });
});

// --- Yardımcı Fonksiyonlar (Oyun Mantığı) ---

function generateRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function createInitialBoard() {
    const board = [];
    for (let r = 0; r < 8; r++) {
        board[r] = new Array(8).fill(0);
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) {
                if (r < 3) {
                    board[r][c] = 1; // Kırmızı (Red)
                } else if (r > 4) {
                    board[r][c] = 2; // Beyaz (White)
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
    let capturedPiece = null;
    
    board[from.r][from.c] = 0;
    board[to.r][to.c] = piece;
    
    // Yeme hamlesi mi?
    if (Math.abs(from.r - to.r) === 2) {
        const capturedR = (from.r + to.r) / 2;
        const capturedC = (from.c + to.c) / 2;
        capturedPiece = board[capturedR][capturedC];
        board[capturedR][capturedC] = 0;
    }
    
    // Kral yapımı kontrolü
    if (player === 'red' && to.r === 7 && piece === 1) {
        board[to.r][to.c] = 3; // Kırmızı kral (Red King)
    } else if (player === 'white' && to.r === 0 && piece === 2) {
        board[to.r][to.c] = 4; // Beyaz kral (White King)
    }
    
    return capturedPiece;
}

function findAllMandatoryJumps(board, player) {
    const allJumps = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piecePlayer = getPiecePlayer(board[r][c]);
            if (piecePlayer === player) {
                const jumps = findJumps(board, r, c, player);
                if (jumps.length > 0) {
                    allJumps.push({ from: { r, c }, jumps });
                }
            }
        }
    }
    return allJumps;
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
    console.log(`🚀 Server port ${PORT}'de başarıyla başlatıldı!`);
    console.log(`🎮 Oyun hazır!`);
});

// Hata yakalama
process.on('uncaughtException', (error) => {
    console.error('❌ Sunucu hatası:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise hatası:', reason);
});
