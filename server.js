const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// MongoDB Bağlantısı (Aynen Korundu)
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB bağlantısı başarılı - Domino Game Database'))
.catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

// Mongoose Schemas (Aynen Korundu)
const playerSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    photoUrl: { type: String },
    elo: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    wins: { type: Number, default: 0 },
    losses: { type : Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastPlayed: { type: Date, default: Date.now }
});

const matchSchema = new mongoose.Schema({ /* ... (Aynen Korundu) ... */
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'DominoPlayer' },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'DominoPlayer' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'DominoPlayer' },
    player1Elo: { type: Number },
    player2Elo: { type: Number },
    player1EloChange: { type: Number },
    player2EloChange: { type: Number },
    moves: { type: Number, default: 0 },
    duration: { type: Number },
    isDraw: { type: Boolean, default: false },
    gameType: { type: String, enum: ['ranked', 'private'], default: 'ranked' },
    createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);

app.use(cors());
app.use(express.json());

const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map();
const playerSessions = new Map();

// Room State Schema (Model tanımlaması dışarı alındı, böylece her fonksiyon çağrısında yeniden derlenmez)
const RoomStateSchema = new mongoose.Schema({
    roomCode: { type: String, required: true, unique: true },
    players: [mongoose.Schema.Types.Mixed],
    gameState: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'room_states' });
const RoomState = mongoose.models.RoomState || mongoose.model('RoomState', RoomStateSchema);

// Oda durumunu MongoDB'ye kaydetme ve yükleme (Kullanılan model güncellendi)
async function saveRoomToDatabase(roomCode, roomData) {
    try {
        await RoomState.findOneAndUpdate(
            { roomCode },
            { 
                roomCode,
                players: Object.keys(roomData.players).map(playerId => ({
                    playerId: playerId,
                    ws: '', // WS bağlantısı sunucuya özgüdür
                    playerName: roomData.players[playerId].name,
                    telegramId: roomData.players[playerId].telegramId,
                    level: roomData.players[playerId].level,
                    elo: roomData.players[playerId].elo,
                    photoUrl: roomData.players[playerId].photoUrl,
                    isGuest: roomData.players[playerId].isGuest,
                    hand: roomData.gameState?.players[playerId]?.hand || [], // El durumunu kaydet
                    connected: true
                })),
                gameState: roomData.gameState,
                updatedAt: new Date()
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error('❌ Oda kaydetme hatası:', error);
    }
}

async function loadRoomFromDatabase(roomCode) {
    try {
        const roomData = await RoomState.findOne({ roomCode });
        return roomData;
    } catch (error) {
        console.error('❌ Oda yükleme hatası:', error);
        return null;
    }
}

async function deleteRoomFromDatabase(roomCode) {
    try {
        await RoomState.deleteOne({ roomCode });
    } catch (error) {
        console.error('❌ Oda silme hatası:', error);
    }
}

// ELO Calculation - Win-based system (Aynen Korundu)
function calculateElo(winnerElo, loserElo, winnerLevel) { /* ... (Aynen Korundu) ... */
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13; // 13-20
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10; // 10-15
    }
    
    const loserChange = -Math.floor(winnerChange * 0.7);
    
    return {
        winnerElo: winnerElo + winnerChange,
        loserElo: Math.max(0, loserElo + loserChange),
        winnerChange,
        loserChange
    };
}

function calculateLevel(elo) { /* ... (Aynen Korundu) ... */
    return Math.floor(elo / 100) + 1;
}

// API Endpoints (Aynen Korundu)
app.post('/api/auth/telegram', async (req, res) => { /* ... (Aynen Korundu) ... */ });
app.get('/api/leaderboard', async (req, res) => { /* ... (Aynen Korundu) ... */ });
app.get('/api/player/:telegramId/stats', async (req, res) => { /* ... (Aynen Korundu) ... */ });
app.get('/api/player/:telegramId/matches', async (req, res) => { /* ... (Aynen Korundu) ... */ });
app.get('/', (req, res) => { /* ... (Aynen Korundu) ... */ });
app.get('/health', (req, res) => { /* ... (Aynen Korundu) ... */ });

const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    clientTracking: true
});

// --- YARDIMCI FONKSİYONLAR ---

function generateRoomCode() { /* ... (Aynen Korundu) ... */
    return Math.random().toString(36).substr(2, 4).toUpperCase();
}

function createDominoSet() { /* ... (Aynen Korundu) ... */
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return shuffleArray(tiles);
}

function shuffleArray(array) { /* ... (Aynen Korundu) ... */
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Başlangıç taşı kuralı: En büyük çifti olan başlar
function initializeGame(roomCode, player1Id, player2Id, gameType = 'ranked') {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14); // Kalan taşlar pazar

    const room = rooms.get(roomCode);
    
    let startingPlayer = player1Id;
    let highestDoubleTile = null;
    let highestDoubleValue = -1;
    let startTileIndex = -1;

    // En yüksek çifti bulma mantığı
    for (const [playerId, hand] of [[player1Id, player1Hand], [player2Id, player2Hand]]) {
        hand.forEach((tile, index) => {
            if (tile[0] === tile[1] && tile[0] > highestDoubleValue) {
                highestDoubleValue = tile[0];
                highestDoubleTile = tile;
                startingPlayer = playerId;
                startTileIndex = index;
            }
        });
    }

    // Başlangıç taşını elden çıkar ve tahtaya koy
    if (highestDoubleTile) {
        if (startingPlayer === player1Id) {
            player1Hand.splice(startTileIndex, 1);
        } else {
            player2Hand.splice(startTileIndex, 1);
        }
    } else {
        // HATA durumunda, 6|6 veya en büyük taş ile başla
        highestDoubleTile = [6, 6];
        startingPlayer = player1Id; // Varsayılan başlangıç
    }
    
    room.gameState = {
        board: highestDoubleTile ? [highestDoubleTile] : [],
        players: {
            [player1Id]: { hand: player1Hand, name: room.players[player1Id].name },
            [player2Id]: { hand: player2Hand, name: room.players[player2Id].name }
        },
        market: market,
        currentPlayer: startingPlayer, // Oyunu başlatan oynar
        turn: 1,
        lastMove: Date.now(),
        gameStarted: true,
        gameType: gameType
    };

    rooms.set(roomCode, room);
    saveRoomToDatabase(roomCode, room);
    console.log(`🎮 Oyun başlatıldı - Başlayan: ${room.players[startingPlayer].name} (${highestDoubleTile || 'yok'})`);
    return room.gameState;
}

// Oyuncunun elinde oynanabilir taş var mı kontrolü
function hasPlayableTiles(hand, board) {
    if (board.length === 0) return hand.length > 0; // İlk hamle ise elindeki her taş oynanabilir
    
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    return hand.some(tile => {
        return tile[0] === leftEnd || tile[1] === leftEnd || 
               tile[0] === rightEnd || tile[1] === rightEnd;
    });
}

// Taşı oynayabilir mi kontrolü
function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Tahtaya taş koyma (yön çevirme mantığı dahil)
function playTileOnBoard(tile, board, position) {
    if (board.length === 0) {
        board.push(tile);
        return true;
    }

    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    let played = false;

    if (position === 'left' || position === 'start') { // 'start' ilk hamlede left olarak işlenecek
        if (tile[1] === leftEnd) {
            board.unshift(tile);
            played = true;
        } else if (tile[0] === leftEnd) {
            board.unshift([tile[1], tile[0]]); // Yön değiştir
            played = true;
        }
    } 
    
    if (!played && position === 'right') {
        if (tile[0] === rightEnd) {
            board.push(tile);
            played = true;
        } else if (tile[1] === rightEnd) {
            board.push([tile[1], tile[0]]); // Yön değiştir
            played = true;
        }
    }

    return played;
}

// Kazananı Kontrol Et
function checkWinner(gameState) {
    const playerIds = Object.keys(gameState.players);
    const player1Id = playerIds[0];
    const player2Id = playerIds[1];

    // 1. ELİ BİTİREN KURALI
    if (gameState.players[player1Id].hand.length === 0) return player1Id;
    if (gameState.players[player2Id].hand.length === 0) return player2Id;

    // 2. KİLİTLENME (STUCK) KURALI
    const player1CanPlay = hasPlayableTiles(gameState.players[player1Id].hand, gameState.board);
    const player2CanPlay = hasPlayableTiles(gameState.players[player2Id].hand, gameState.board);
    
    // Pazar boş ve kimse oynayamıyor
    if (gameState.market.length === 0 && !player1CanPlay && !player2CanPlay) {
        const player1Sum = gameState.players[player1Id].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = gameState.players[player2Id].hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        // Az puanlı olan kazanır
        if (player1Sum < player2Sum) return player1Id;
        if (player2Sum < player1Sum) return player2Id;
        
        return 'DRAW'; // Beraberlik
    }

    return null;
}

function broadcastToRoom(roomCode, message, excludePlayer = null) { /* ... (Aynen Korundu) ... */
    const room = rooms.get(roomCode);
    if (!room) return;

    for (const playerId in room.players) {
        if (playerId === excludePlayer) continue;
        const ws = playerConnections.get(playerId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify(message)); } catch (e) {}
        }
    }
}

function sendGameState(roomCode, playerId) { /* ... (Aynen Korundu) ... */
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const ws = playerConnections.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Oyuncunun kendi elini içeren güncel durumu gönder
    const myHand = room.gameState.players[playerId].hand;
    const opponentId = Object.keys(room.gameState.players).find(id => id !== playerId);
    const opponentHandLength = room.gameState.players[opponentId]?.hand.length || 0;

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: { 
                ...room.gameState, 
                playerId: playerId,
                players: {
                    [playerId]: { hand: myHand, name: room.gameState.players[playerId].name }, // Kendi elini gör
                    [opponentId]: { hand: Array(opponentHandLength).fill(0).map(() => [0, 0]), name: room.gameState.players[opponentId]?.name } // Rakibin elini gizle
                }
            }
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) { /* ... (Aynen Korundu) ... */
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {}
    }
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'pass': handlePass(ws); break; // Yeni eklendi
                case 'leaveGame': handleLeaveGame(ws); break; // Yeni eklendi
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' });
});

const pingInterval = setInterval(() => { /* ... (Aynen Korundu) ... */
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// --- OYUN MANTIKLARI ---

function handleFindMatch(ws, data) { /* ... (Aynen Korundu) ... */
    if (ws.playerId && playerConnections.has(ws.playerId)) {
        const existingInQueue = matchQueue.find(p => p.playerId === ws.playerId);
        if (existingInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
        }
        if (ws.roomCode) {
            return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız' });
        }
    }

    const playerId = ws.playerId || generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;
    
    playerConnections.set(playerId, ws);
    matchQueue.push({ 
        ws, 
        playerId, 
        playerName: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest
    });

    const playerType = ws.isGuest ? 'GUEST' : `LVL ${ws.level}, ELO ${ws.elo}`;
    console.log(`✅ ${ws.playerName} (${playerType}) kuyrukta - Toplam: ${matchQueue.length}`);

    if (matchQueue.length >= 2) {
        const p1 = matchQueue.shift();
        const p2 = matchQueue.shift();
        const roomCode = generateRoomCode();
        
        const gameType = (p1.isGuest || p2.isGuest) ? 'casual' : 'ranked';
        console.log(`🎮 Maç oluşturuluyor (${gameType.toUpperCase()}): ${p1.playerName} vs ${p2.playerName}`);

        const room = {
            code: roomCode,
            players: { 
                [p1.playerId]: { 
                    name: p1.playerName,
                    telegramId: p1.telegramId,
                    photoUrl: p1.photoUrl,
                    level: p1.level,
                    elo: p1.elo,
                    isGuest: p1.isGuest
                }, 
                [p2.playerId]: { 
                    name: p2.playerName,
                    telegramId: p2.telegramId,
                    photoUrl: p2.photoUrl,
                    level: p2.level,
                    elo: p2.elo,
                    isGuest: p2.isGuest
                } 
            },
            type: gameType,
            startTime: Date.now()
        };

        rooms.set(roomCode, room);
        
        p1.ws.roomCode = roomCode;
        p2.ws.roomCode = roomCode;

        const gameState = initializeGame(roomCode, p1.playerId, p2.playerId, gameType);

        sendMessage(p1.ws, { type: 'matchFound', roomCode, opponent: room.players[p2.playerId], gameType });
        sendMessage(p2.ws, { type: 'matchFound', roomCode, opponent: room.players[p1.playerId], gameType });

        // GameStart ve ilk durum bilgisi gönder
        setTimeout(() => {
            sendGameState(roomCode, p1.playerId);
            sendGameState(roomCode, p2.playerId);
            
            p1.ws.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: p1.playerId } }));
            p2.ws.send(JSON.stringify({ type: 'gameStart', gameState: { ...gameState, playerId: p2.playerId } }));
            
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 500);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) { /* ... (Aynen Korundu) ... */
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti - Kalan: ${matchQueue.length}`);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function handleCreateRoom(ws, data) { /* ... (Aynen Korundu) ... */
    const roomCode = generateRoomCode();
    const playerId = generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName;
    ws.roomCode = roomCode;
    ws.telegramId = data.telegramId;
    ws.isGuest = data.isGuest;
    ws.level = data.level;
    ws.elo = data.elo;
    ws.photoUrl = data.photoUrl;
    playerConnections.set(playerId, ws);

    rooms.set(roomCode, {
        code: roomCode,
        players: { 
            [playerId]: { 
                name: data.playerName, 
                telegramId: data.telegramId, 
                level: data.level, 
                elo: data.elo,
                photoUrl: data.photoUrl,
                isGuest: data.isGuest 
            } 
        },
        type: 'private',
        host: playerId
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
}

function handleJoinRoom(ws, data) { /* ... (Aynen Korundu) ... */
    const roomCode = data.roomCode;
    loadRoomFromDatabase(roomCode).then(async (savedRoom) => {
        let room = rooms.get(roomCode);
        
        if (savedRoom && !room) {
            console.log(`🔄 Oda ${roomCode} veritabanından geri yükleniyor...`);
            
            room = {
                host: savedRoom.players.find(p => p.connected)?.playerId || savedRoom.players[0]?.playerId || 'host',
                players: {},
                gameState: savedRoom.gameState || { board: [], currentPlayer: null, market: [], gameStarted: false },
                type: savedRoom.gameState?.gameType || 'private',
                startTime: Date.now()
            };
            
            savedRoom.players.forEach(player => {
                room.players[player.playerId] = {
                    name: player.playerName,
                    telegramId: player.telegramId,
                    level: player.level,
                    elo: player.elo,
                    photoUrl: player.photoUrl,
                    isGuest: player.isGuest,
                    hand: player.hand || []
                };
                
                // Geri yüklenen oyuncunun elini gameState'e geri yükle
                if (room.gameState.players) {
                     room.gameState.players[player.playerId] = {
                        hand: player.hand || [],
                        name: player.playerName
                     };
                }
            });
            
            rooms.set(roomCode, room);
        }
        
        room = rooms.get(roomCode);
        const currentPlayers = room ? Object.keys(room.players).length : 0;
        
        if (!room || currentPlayers >= 2) {
            return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı veya dolu' });
        }

        const playerId = generateRoomCode();
        ws.playerId = playerId;
        ws.playerName = data.playerName;
        ws.roomCode = roomCode;
        ws.telegramId = data.telegramId;
        ws.isGuest = data.isGuest;
        ws.level = data.level;
        ws.elo = data.elo;
        ws.photoUrl = data.photoUrl;
        playerConnections.set(playerId, ws);
        
        room.players[playerId] = { 
            name: data.playerName,
            telegramId: data.telegramId,
            level: data.level,
            elo: data.elo,
            photoUrl: data.photoUrl,
            isGuest: data.isGuest,
            hand: []
        };
        
        // Yeni oyuncunun hand'i ilk anda boş olur, initializeGame doldurur
        const hostId = room.host;
        
        if (room.gameState && room.gameState.gameStarted) {
            // Oyun zaten başlamış, sadece durumu gönder
            setTimeout(() => {
                sendGameState(roomCode, hostId);
                sendGameState(roomCode, playerId);
                
                ws.send(JSON.stringify({ 
                    type: 'gameStart', 
                    gameState: {...room.gameState, playerId: playerId} 
                }));
            }, 500);
        } else {
            // Yeni oyun başlat
            const gameState = initializeGame(roomCode, hostId, playerId, room.type);
            
            setTimeout(() => {
                sendGameState(roomCode, hostId);
                sendGameState(roomCode, playerId);
                
                [hostId, playerId].forEach(pid => {
                    const socket = playerConnections.get(pid);
                    if(socket) socket.send(JSON.stringify({ type: 'gameStart', gameState: {...gameState, playerId: pid} }));
                });
            }, 500);
        }
    });
}

function handlePlayTile(ws, data) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    const tile = player.hand[data.tileIndex];
    const position = data.position;

    if (!tile) return;
    
    // Gelen hamle geçerli mi?
    const tileCanPlay = canPlayTile(tile, gs.board);
    if (!tileCanPlay) {
        return sendMessage(ws, { type: 'error', message: 'Bu taş tahtaya uymuyor' });
    }

    const success = playTileOnBoard(tile, gs.board, position);

    if (!success) {
        return sendMessage(ws, { type: 'error', message: 'Bu pozisyona oynayamazsınız' });
    }

    player.hand.splice(data.tileIndex, 1);
    gs.moves = (gs.moves || 0) + 1;
    gs.lastMove = new Date();
    
    // El bitince kontrol et
    const winner = checkWinner(gs);
    
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        // Sıra diğer oyuncuya geçer
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
    
    saveRoomToDatabase(ws.roomCode, room);
}

// Yeni: Oyuncu pas geçtiğinde çalışır
function handlePass(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const playerHand = gs.players[ws.playerId].hand;
    const canPlay = hasPlayableTiles(playerHand, gs.board);
    
    // Pazarda taş yok ve elinde oynanabilir taş yoksa pas geçebilir
    if (canPlay || gs.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var veya pazardan çekmelisiniz!' });
    }
    
    // Pas geçme durumunu kaydet (kilitlenme kontrolü için)
    gs.players[ws.playerId].passed = (gs.players[ws.playerId].passed || 0) + 1;
    
    const opponentId = Object.keys(gs.players).find(id => id !== ws.playerId);
    const opponentPassed = gs.players[opponentId].passed || 0;

    if (opponentPassed >= 1 && gs.players[ws.playerId].passed >= 1) {
        // Her iki oyuncu da pas geçti ve pazar boşsa -> KİLİTLENME!
        console.log(`🔒 Oyun kilitlendi: ${ws.roomCode}`);
        const winner = checkWinner(gs); // Puanlamaya göre kazananı bul
        handleGameEnd(ws.roomCode, winner, gs);
    } else {
        // Normal sıra geçişi
        gs.turn++;
        gs.currentPlayer = opponentId;
        gs.players[opponentId].passed = 0; // Sıra ona geçtiği için pas sayısını sıfırla
        sendMessage(ws, { type: 'info', message: 'Pas geçildi, sıra rakipte.' });
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

// Yeni: Oyuncu pazardan taş çekmek istediğinde
function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    
    if (hasPlayableTiles(player.hand, gs.board)) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş varken çekemezsiniz!' });
    }
    
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, çekilemez. Otomatik pas mantığını handlePass'e devret.
        return handlePass(ws);
    }

    let drawnTile = null;
    let played = false;
    
    // Oynanabilir taş bulana kadar çekme döngüsü
    while (!played && gs.market.length > 0) {
        drawnTile = gs.market.shift();
        player.hand.push(drawnTile);
        
        if (canPlayTile(drawnTile, gs.board)) {
            // Oynanabilir taş bulundu, oyuncu şimdi oynayabilir. Sıra geçmez.
            sendMessage(ws, { type: 'info', message: `🎲 Oynanabilir taş çekildi: [${drawnTile}]` });
            played = true; // Döngüyü kır
        } else {
            // Oynanabilir taş bulunamadı, döngü devam eder.
            sendMessage(ws, { type: 'info', message: `🎲 Taş çekildi: [${drawnTile}]. Tekrar çekiliyor...` });
        }
    }
    
    saveRoomToDatabase(ws.roomCode, room);
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));

    if (!played && gs.market.length === 0) {
        // Pazar bitti ve hala oynanabilir taş yok, sıra pas geçer.
        console.log(`❌ ${player.name} oynanabilir taş bulamadı - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerId, gameState) { /* ... (Aynen Korundu ve Düzeltildi) ... */
    const room = rooms.get(roomCode);
    if (!room) return;

    try {
        const playerIds = Object.keys(gameState.players);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;

        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
        const isRankedMatch = room.type === 'ranked' && !player1IsGuest && !player2IsGuest;

        if (isRankedMatch) {
            const player1 = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const player2 = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (!player1 || !player2) {
                console.error('❌ Oyuncular MongoDB\'de bulunamadı');
            } else if (!isDraw) {
                const winnerDB = winnerId === player1Id ? player1 : player2;
                const loserDB = winnerId === player1Id ? player2 : player1;

                eloChanges = calculateElo(winnerDB.elo, loserDB.elo, winnerDB.level);

                winnerDB.elo = eloChanges.winnerElo;
                winnerDB.level = calculateLevel(winnerDB.elo);
                winnerDB.wins += 1;
                winnerDB.winStreak += 1;
                winnerDB.bestWinStreak = Math.max(winnerDB.bestWinStreak, winnerDB.winStreak);
                winnerDB.totalGames += 1;
                winnerDB.lastPlayed = new Date();

                loserDB.elo = eloChanges.loserElo;
                loserDB.level = calculateLevel(loserDB.elo);
                loserDB.losses += 1;
                loserDB.winStreak = 0;
                loserDB.totalGames += 1;
                loserDB.lastPlayed = new Date();

                await winnerDB.save();
                await loserDB.save();

                const match = new Match({
                    player1: player1._id,
                    player2: player2._id,
                    winner: winnerDB._id,
                    player1Elo: winnerId === player1Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player2Elo: winnerId === player2Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player1EloChange: winnerId === player1Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    player2EloChange: winnerId === player2Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    moves: gameState.moves || 0,
                    duration: Math.floor((Date.now() - (room.startTime || Date.now())) / 1000),
                    gameType: 'ranked',
                    isDraw: false
                });
                await match.save();

                console.log(`🏆 RANKED Maç bitti: ${winnerDB.username} kazandı! ELO: ${eloChanges.winnerChange > 0 ? '+' : ''}${eloChanges.winnerChange}`);
            } else {
                // Beraberlik durumu
                player1.draws += 1; player1.totalGames += 1; player1.winStreak = 0; player1.lastPlayed = new Date();
                player2.draws += 1; player2.totalGames += 1; player2.winStreak = 0; player2.lastPlayed = new Date();

                await player1.save();
                await player2.save();
                
                const match = new Match({
                    player1: player1._id, player2: player2._id, isDraw: true, gameType: 'ranked',
                    moves: gameState.moves || 0,
                    duration: Math.floor((Date.now() - (room.startTime || Date.now())) / 1000),
                });
                await match.save();
            }
        }

        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: isDraw ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: isRankedMatch,
            eloChanges: eloChanges ? {
                winner: eloChanges.winnerChange,
                loser: eloChanges.loserChange
            } : null
        });
        deleteRoomFromDatabase(roomCode);
        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            isRanked: false
        });
        deleteRoomFromDatabase(roomCode);
        rooms.delete(roomCode);
    }
}

// Yeni: Oyuncu oyundan kendi isteğiyle ayrıldığında (ELO cezası uygula)
function handleLeaveGame(ws) {
    if (!ws.roomCode) return;
    
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;
    
    const gs = room.gameState;
    const leaverId = ws.playerId;
    const winnerId = Object.keys(gs.players).find(id => id !== leaverId);
    
    handleDisconnectLogic(ws, true); // ELO kaybı ile bitir
    
    // Kalan oyuncuya bildir
    const winnerWs = playerConnections.get(winnerId);
    if (winnerWs) {
        sendMessage(winnerWs, {
            type: 'gameEnd',
            winner: winnerId,
            winnerName: room.players[winnerId].name,
            isRanked: room.type === 'ranked',
            eloChanges: { winner: 15, loser: -15 } // Varsayılan ELO değişimi
        });
    }
    
    deleteRoomFromDatabase(ws.roomCode);
    rooms.delete(ws.roomCode);
}

// Disconnect/Leave durumlarında ELO güncelleme mantığı
async function handleDisconnectLogic(ws, isLeaver = false) {
    if (!ws.roomCode) return;
    
    const room = rooms.get(ws.roomCode);
    if (!room || !room.players || Object.keys(room.players).length < 2) return;

    const remainingPlayerId = Object.keys(room.players).find(playerId => playerId !== ws.playerId);
    if (!remainingPlayerId) return;
    
    const remainingPlayer = room.players[remainingPlayerId];
    const leaverPlayer = room.players[ws.playerId];
    
    const isRankedMatch = room.type === 'ranked' && !remainingPlayer.isGuest && !leaverPlayer.isGuest;
    
    let eloChange = 0;

    if (isRankedMatch) {
        const winnerDB = await Player.findOne({ telegramId: remainingPlayer.telegramId });
        const loserDB = await Player.findOne({ telegramId: leaverPlayer.telegramId });
        
        if (winnerDB && loserDB) {
            // Leaver (loser) için sabit ELO kaybı, winner için kazanç
            eloChange = Math.floor(Math.random() * 6) + 15; // 15-20 arası
            const loserChange = isLeaver ? -eloChange : -10; // Kendi çıkan daha çok kaybetsin

            winnerDB.elo += eloChange;
            winnerDB.level = calculateLevel(winnerDB.elo);
            winnerDB.wins += 1;
            winnerDB.winStreak += 1;
            winnerDB.bestWinStreak = Math.max(winnerDB.bestWinStreak, winnerDB.winStreak);
            winnerDB.totalGames += 1;
            winnerDB.lastPlayed = new Date();

            loserDB.elo = Math.max(0, loserDB.elo + loserChange);
            loserDB.level = calculateLevel(loserDB.elo);
            loserDB.losses += 1;
            loserDB.winStreak = 0;
            loserDB.totalGames += 1;
            loserDB.lastPlayed = new Date();
            
            await winnerDB.save();
            await loserDB.save();
            
            const match = new Match({
                player1: winnerDB._id,
                player2: loserDB._id,
                winner: winnerDB._id,
                player1Elo: winnerDB.elo,
                player2Elo: loserDB.elo,
                player1EloChange: eloChange,
                player2EloChange: loserChange,
                gameType: 'ranked',
            });
            await match.save();
        }
    }
    
    const remainingWs = playerConnections.get(remainingPlayerId);
    if (remainingWs) {
        remainingWs.send(JSON.stringify({
            type: 'opponentLeft',
            eloChange: isRankedMatch ? eloChange : 0,
            winner: remainingPlayerId,
            opponentName: leaverPlayer.name
        }));
    }
}


function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);
    
    if (ws.playerId) playerConnections.delete(ws.playerId);
    
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }

    if (ws.roomCode && rooms.has(ws.roomCode)) {
        // Oyun bitmeden bağlantı koptuysa ELO güncellemesi yap
        handleDisconnectLogic(ws);
        
        broadcastToRoom(ws.roomCode, { type: 'playerDisconnected' });
        deleteRoomFromDatabase(ws.roomCode);
        rooms.delete(ws.roomCode);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
