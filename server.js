const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// MongoDB Bağlantısı
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB bağlantısı başarılı - Domino Game Database'))
.catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

// Mongoose Schemas
const playerSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    photoUrl: { type: String },
    elo: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    lastPlayed: { type: Date, default: Date.now }
});

const matchSchema = new mongoose.Schema({
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

// ELO Calculation
function calculateElo(winnerElo, loserElo, winnerLevel) {
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13;
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10;
    }
    
    const loserChange = -Math.floor(winnerChange * 0.7);
    
    return {
        winnerElo: winnerElo + winnerChange,
        loserElo: Math.max(0, loserElo + loserChange),
        winnerChange,
        loserChange
    };
}

function calculateLevel(elo) {
    return Math.floor(elo / 100) + 1;
}

// API Endpoints
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName, photoUrl } = req.body;
        
        if (!telegramId || !username) {
            return res.status(400).json({ error: 'Telegram ID və istifadəçi adı tələb olunur' });
        }

        let player = await Player.findOne({ telegramId });
        
        if (!player) {
            player = new Player({
                telegramId,
                username,
                firstName,
                lastName,
                photoUrl
            });
            await player.save();
            console.log(`🆕 Yeni oyunçu qeyd edildi: ${username} (${telegramId})`);
        } else {
            player.username = username;
            player.firstName = firstName;
            player.lastName = lastName;
            player.photoUrl = photoUrl;
            player.lastPlayed = new Date();
            await player.save();
        }

        playerSessions.set(telegramId, player);
        
        res.json({
            success: true,
            player: {
                id: player._id,
                telegramId: player.telegramId,
                username: player.username,
                firstName: player.firstName,
                lastName: player.lastName,
                photoUrl: player.photoUrl,
                elo: player.elo,
                level: player.level,
                wins: player.wins,
                losses: player.losses,
                draws: player.draws,
                totalGames: player.totalGames,
                winStreak: player.winStreak,
                bestWinStreak: player.bestWinStreak
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Server xətası' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find()
            .sort({ elo: -1 })
            .limit(10)
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames winStreak');
        
        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Server xətası' });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Domino WebSocket Server',
        players: playerConnections.size,
        rooms: rooms.size
    });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    clientTracking: true
});

// --- YARDIMCI FONKSİYONLAR ---
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return shuffleArray(tiles);
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function initializeGame(roomCode, player1Id, player2Id) {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14);

    const room = rooms.get(roomCode);
    
    let startingPlayer = null;
    let startingDouble = -1;

    // Əvvəlcə 6-6 axtar
    for (const player of [player1Id, player2Id]) {
        const hand = player === player1Id ? player1Hand : player2Hand;
        if (hand.some(tile => tile[0] === 6 && tile[1] === 6)) {
            startingPlayer = player;
            startingDouble = 6;
            break;
        }
    }
    
    // Əgər 6-6 yoxdursa, digər cütləri yoxla
    if (!startingPlayer) {
        for (let i = 5; i >= 0; i--) {
            for (const player of [player1Id, player2Id]) {
                const hand = player === player1Id ? player1Hand : player2Hand;
                if (hand.some(tile => tile[0] === i && tile[1] === i)) {
                    startingPlayer = player;
                    startingDouble = i;
                    break;
                }
            }
            if (startingPlayer) break;
        }
    }
    
    // Əgər heç bir cüt yoxdursa, təsadüfi oyunçu seç
    if (!startingPlayer) {
        startingPlayer = [player1Id, player2Id][Math.floor(Math.random() * 2)];
        startingDouble = -1;
    }

    room.gameState = {
        board: [],
        players: {
            [player1Id]: { 
                hand: player1Hand, 
                name: room.players[player1Id].name,
                photoUrl: room.players[player1Id].photoUrl,
                score: 0
            },
            [player2Id]: { 
                hand: player2Hand, 
                name: room.players[player2Id].name,
                photoUrl: room.players[player2Id].photoUrl,
                score: 0
            }
        },
        market: market,
        currentPlayer: startingPlayer,
        turn: 1,
        lastMove: null,
        startingDouble: startingDouble,
        consecutivePasses: 0,
        roomCode: roomCode,
        moves: 0,
        gameStarted: true,
        gameEnded: false
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başladıldı: ${roomCode} - Başlayan: ${startingPlayer === player1Id ? room.players[player1Id].name : room.players[player2Id].name}`);
    return room.gameState;
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

function playTileOnBoard(tile, board, position) {
    const newBoard = [...board];
    
    if (newBoard.length === 0) {
        newBoard.push(tile);
        return { success: true, board: newBoard };
    }

    const leftEnd = newBoard[0][0];
    const rightEnd = newBoard[newBoard.length - 1][1];
    let played = false;
    let rotatedTile = tile;

    if (position === 'left' || position === 'start') {
        if (tile[1] === leftEnd) {
            newBoard.unshift(tile);
            played = true;
        } else if (tile[0] === leftEnd) {
            rotatedTile = [tile[1], tile[0]];
            newBoard.unshift(rotatedTile);
            played = true;
        }
    } 
    
    if (!played && position === 'right') {
        if (tile[0] === rightEnd) {
            newBoard.push(tile);
            played = true;
        } else if (tile[1] === rightEnd) {
            rotatedTile = [tile[1], tile[0]];
            newBoard.push(rotatedTile);
            played = true;
        }
    }

    return { success: played, board: newBoard };
}

function checkWinner(gameState) {
    // Əgər əldə taş qalmayıbsa, qalib
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            return playerId;
        }
    }

    const playerIds = Object.keys(gameState.players);
    const player1Id = playerIds[0];
    const player2Id = playerIds[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    // İki dəfə ardıcıl keçid varsa
    if (gameState.consecutivePasses >= 2) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        if (player1Sum === player2Sum) return 'DRAW';
        return player1Sum < player2Sum ? player1Id : player2Id;
    }

    // Heç kim oynaya bilmir və bazar boşdursa
    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    if (!player1CanPlay && !player2CanPlay && gameState.market.length === 0) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        if (player1Sum === player2Sum) return 'DRAW';
        return player1Sum < player2Sum ? player1Id : player2Id;
    }

    return null;
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const roomPlayers = Object.keys(room.players);
    roomPlayers.forEach(playerId => {
        if (playerId === excludePlayer) return;
        
        const ws = playerConnections.get(playerId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            try { 
                ws.send(JSON.stringify(message)); 
            } catch (e) {
                console.error('Broadcast error:', e);
            }
        }
    });
}

function sendGameState(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const ws = playerConnections.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const gameState = room.gameState;
    const playerSpecificState = {
        board: gameState.board,
        players: gameState.players,
        market: gameState.market,
        currentPlayer: gameState.currentPlayer,
        turn: gameState.turn,
        playerId: playerId,
        roomCode: gameState.roomCode,
        marketCount: gameState.market.length,
        startingDouble: gameState.startingDouble,
        moves: gameState.moves || 0,
        gameStarted: gameState.gameStarted,
        consecutivePasses: gameState.consecutivePasses
    };

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: playerSpecificState
        }));
    } catch (error) { 
        console.error('Game state send error:', error); 
    }
}

function sendMessage(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { 
            ws.send(JSON.stringify(message)); 
        } catch (e) {
            console.error('Send message error:', e);
        }
    }
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📥 Gelen mesaj:', data.type);
            
            switch (data.type) {
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                case 'createRoom': handleCreateRoom(ws, data); break;
                case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws, data); break;
                case 'pass': handlePass(ws, data); break;
                case 'leaveGame': handleLeaveGame(ws); break;
                case 'reconnect': handleReconnect(ws, data); break;
            }
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Serverə qoşuldu', isReconnect: false });
});

const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// --- OYUN MANTIKLARI ---

function handleFindMatch(ws, data) {
    console.log('🔍 Eşleşme aranıyor...', data.username || data.playerName);
    
    // Kullanıcı zaten kuyrukta mı kontrol et
    const existingInQueue = matchQueue.find(p => p.ws === ws);
    if (existingInQueue) {
        return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
    }

    // Kullanıcı zaten bir oyunda mı kontrol et
    if (ws.roomCode && rooms.has(ws.roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız' });
    }

    const playerId = data.telegramId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = playerId;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.telegramId = data.telegramId || null;
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0;
    ws.elo = data.elo || 0;
    ws.isGuest = !data.telegramId;
    
    // Aynı Telegram hesabı kontrolü
    if (!ws.isGuest && ws.telegramId) {
        const sameTelegramInQueue = matchQueue.find(p => p.telegramId === ws.telegramId);
        if (sameTelegramInQueue) {
            return sendMessage(ws, { type: 'error', message: 'Bu Telegram hesabı zaten eşleşme kuyruğunda' });
        }
    }

    playerConnections.set(playerId, ws);
    
    const queueEntry = { 
        ws, 
        playerId, 
        playerName: ws.playerName,
        telegramId: ws.telegramId,
        photoUrl: ws.photoUrl,
        level: ws.level,
        elo: ws.elo,
        isGuest: ws.isGuest,
        timestamp: Date.now()
    };
    
    matchQueue.push(queueEntry);

    console.log(`✅ ${ws.playerName} kuyrukta - Toplam: ${matchQueue.length}`);

    // Eşleşme kontrolü
    if (matchQueue.length >= 2) {
        // Aynı türde oyuncu bul (guest vs non-guest)
        const potentialOpponents = matchQueue.filter(p => 
            p.ws !== ws && 
            p.isGuest === ws.isGuest &&
            !(p.telegramId && ws.telegramId && p.telegramId === ws.telegramId)
        );
        
        if (potentialOpponents.length > 0) {
            const p1 = queueEntry;
            const p2 = potentialOpponents[0];
            
            // Her ikisini de kuyruktan çıkar
            const p1Index = matchQueue.findIndex(p => p.ws === p1.ws);
            const p2Index = matchQueue.findIndex(p => p.ws === p2.ws);
            
            if (p1Index !== -1) matchQueue.splice(p1Index, 1);
            if (p2Index !== -1) matchQueue.splice(p2Index, 1);
            
            const roomCode = generateRoomCode();
            const gameType = (p1.isGuest || p2.isGuest) ? 'casual' : 'ranked';
            console.log(`🎮 Maç oluşturuluyor: ${p1.playerName} vs ${p2.playerName} (${roomCode})`);

            const room = {
                code: roomCode,
                players: { 
                    [p1.playerId]: { 
                        name: p1.playerName,
                        telegramId: p1.telegramId,
                        photoUrl: p1.photoUrl,
                        level: p1.level,
                        elo: p1.elo,
                        isGuest: p1.isGuest,
                        isConnected: true,
                        socket: p1.ws
                    }, 
                    [p2.playerId]: { 
                        name: p2.playerName,
                        telegramId: p2.telegramId,
                        photoUrl: p2.photoUrl,
                        level: p2.level,
                        elo: p2.elo,
                        isGuest: p2.isGuest,
                        isConnected: true,
                        socket: p2.ws
                    } 
                },
                type: gameType,
                startTime: Date.now(),
                gameState: null
            };

            rooms.set(roomCode, room);
            p1.ws.roomCode = roomCode;
            p2.ws.roomCode = roomCode;

            // Eşleşme bulundu mesajı
            sendMessage(p1.ws, { 
                type: 'matchFound', 
                roomCode, 
                opponent: room.players[p2.playerId], 
                gameType: gameType
            });
            
            sendMessage(p2.ws, { 
                type: 'matchFound', 
                roomCode, 
                opponent: room.players[p1.playerId], 
                gameType: gameType
            });

            // 2 saniye sonra oyunu başlat
            setTimeout(() => {
                if (!rooms.has(roomCode)) return;
                
                const gameState = initializeGame(roomCode, p1.playerId, p2.playerId);
                
                console.log(`🚀 Oyun başlatılıyor: ${roomCode}`);
                
                // Oyuncu 1'e gönder
                sendMessage(p1.ws, { 
                    type: 'gameStart', 
                    gameState: { 
                        ...gameState,
                        playerId: p1.playerId,
                        roomCode: roomCode
                    } 
                });
                
                // Oyuncu 2'ye gönder
                sendMessage(p2.ws, { 
                    type: 'gameStart', 
                    gameState: { 
                        ...gameState,
                        playerId: p2.playerId,
                        roomCode: roomCode
                    } 
                });
            }, 2000);
        } else {
            sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
        }
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti`);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode();
    ws.playerId = data.telegramId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.roomCode = roomCode;
    ws.isGuest = !data.telegramId;
    playerConnections.set(ws.playerId, ws);

    rooms.set(roomCode, {
        code: roomCode,
        players: { 
            [ws.playerId]: { 
                name: ws.playerName,
                telegramId: data.telegramId,
                isGuest: ws.isGuest,
                isConnected: true,
                socket: ws
            } 
        },
        type: 'private',
        host: ws.playerId,
        gameState: null
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
    console.log(`🏠 Özel oda oluşturuldu: ${roomCode} - Sahip: ${ws.playerName}`);
}

function handleJoinRoom(ws, data) {
    const roomCode = data.roomCode.toUpperCase();
    const room = rooms.get(roomCode);
    
    if (!room) {
        return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı' });
    }
    
    if (Object.keys(room.players).length >= 2) {
        return sendMessage(ws, { type: 'error', message: 'Oda dolu' });
    }

    if (room.gameState && room.gameState.gameStarted) {
        return sendMessage(ws, { type: 'error', message: 'Oyun zaten başlamış' });
    }

    ws.playerId = data.telegramId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerName = data.playerName || data.username || 'Guest';
    ws.roomCode = roomCode;
    ws.isGuest = !data.telegramId;
    playerConnections.set(ws.playerId, ws);
    
    room.players[ws.playerId] = { 
        name: ws.playerName,
        telegramId: data.telegramId,
        isGuest: ws.isGuest,
        isConnected: true,
        socket: ws
    };

    const hostId = room.host;
    const joinerId = ws.playerId;
    
    console.log(`✅ ${ws.playerName} odaya katıldı: ${roomCode}`);

    // Oyunu başlat
    setTimeout(() => {
        if (!rooms.has(roomCode)) return;
        
        const gameState = initializeGame(roomCode, hostId, joinerId);
        
        // Host'a gönder
        sendMessage(room.players[hostId].socket, { 
            type: 'gameStart', 
            gameState: { 
                ...gameState,
                playerId: hostId,
                roomCode: roomCode
            } 
        });
        
        // Katılan'a gönder
        sendMessage(ws, { 
            type: 'gameStart', 
            gameState: { 
                ...gameState,
                playerId: joinerId,
                roomCode: roomCode
            } 
        });
        
        console.log(`🎮 Özel oyun başlatıldı: ${roomCode}`);
    }, 1000);
}

function handlePlayTile(ws, data) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    }

    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || room.gameState.gameEnded) {
        return sendMessage(ws, { type: 'error', message: 'Oyun sona ermiş' });
    }

    const gs = room.gameState;
    
    // Sıra kontrolü
    if (gs.currentPlayer !== ws.playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }

    const player = gs.players[ws.playerId];
    const tileIndex = data.tileIndex;
    
    if (tileIndex < 0 || tileIndex >= player.hand.length) {
        return sendMessage(ws, { type: 'error', message: 'Geçersiz taş indeksi' });
    }

    const tile = player.hand[tileIndex];

    // İlk hamle kontrolü
    if (gs.board.length === 0 && gs.startingDouble > -1) {
        if (tile[0] !== gs.startingDouble || tile[1] !== gs.startingDouble) {
            return sendMessage(ws, { type: 'error', message: `İlk taş ${gs.startingDouble}-${gs.startingDouble} olmalı!` });
        }
    }

    // Taş oynanabilir mi kontrol et
    if (!canPlayTile(tile, gs.board)) {
        return sendMessage(ws, { type: 'error', message: 'Bu taş oynanamaz!' });
    }

    // Taşı oyna
    const position = data.position || (gs.board.length === 0 ? 'start' : 'right');
    const result = playTileOnBoard(tile, gs.board, position);
    
    if (!result.success) {
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz' });
    }

    // Taşı elden çıkar ve board'u güncelle
    player.hand.splice(tileIndex, 1);
    gs.board = result.board;
    gs.moves = (gs.moves || 0) + 1;
    gs.consecutivePasses = 0;
    gs.lastMove = { player: ws.playerId, tile: tile, position: position };

    console.log(`✅ ${player.name} taş oynadı: [${tile}] - Pozisyon: ${position}`);

    // Kazanan var mı kontrol et
    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs, 'normal');
        return;
    }

    // Sırayı değiştir
    const playerIds = Object.keys(gs.players);
    gs.currentPlayer = playerIds.find(id => id !== ws.playerId);
    gs.turn++;

    // Her iki oyuncuya da güncel durumu gönder
    Object.keys(gs.players).forEach(playerId => {
        sendGameState(ws.roomCode, playerId);
    });
}

function handleDrawFromMarket(ws, data) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    }

    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || room.gameState.gameEnded) {
        return sendMessage(ws, { type: 'error', message: 'Oyun sona ermiş' });
    }

    const gs = room.gameState;
    
    // Sıra kontrolü
    if (gs.currentPlayer !== ws.playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }

    const player = gs.players[ws.playerId];
    
    // Bazar boş mu kontrol et
    if (!gs.market || gs.market.length === 0) {
        // Bazar boşsa ve oynayabilecek taş yoksa pas geç
        const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
        
        if (!canPlay) {
            gs.consecutivePasses++;
            gs.turn++;
            
            // Kazanan var mı kontrol et
            const winner = checkWinner(gs);
            if (winner) {
                handleGameEnd(ws.roomCode, winner, gs, 'normal');
                return;
            }
            
            // Sırayı değiştir
            const playerIds = Object.keys(gs.players);
            gs.currentPlayer = playerIds.find(id => id !== ws.playerId);
            
            // Her iki oyuncuya da güncel durumu gönder
            Object.keys(gs.players).forEach(playerId => {
                sendGameState(ws.roomCode, playerId);
            });
        } else {
            sendMessage(ws, { type: 'error', message: 'Oynayabileceğiniz taş var! Önce oynayın.' });
        }
        return;
    }

    // Bazardan taş çek
    const drawnTile = gs.market.shift();
    player.hand.push(drawnTile);
    gs.consecutivePasses = 0;
    
    console.log(`🎲 ${player.name} bazardan taş çekti: [${drawnTile}]`);

    // Çekilen taş oynanabilir mi kontrol et
    const canPlayDrawn = canPlayTile(drawnTile, gs.board);
    
    if (!canPlayDrawn) {
        // Elindeki diğer taşlardan oynayabileceği var mı kontrol et
        const hasPlayableInHand = player.hand.some(tile => canPlayTile(tile, gs.board));
        
        if (!hasPlayableInHand && gs.market.length > 0) {
            // Oynayacak taşı yok, tekrar çekebilir
            sendMessage(ws, { type: 'info', message: 'Çektiğiniz taş oynanamıyor. Başka bir taş çekebilirsiniz.' });
        } else if (!hasPlayableInHand && gs.market.length === 0) {
            // Oynayacak taşı yok ve bazar boş, pas geç
            gs.consecutivePasses++;
            gs.turn++;
            
            // Kazanan var mı kontrol et
            const winner = checkWinner(gs);
            if (winner) {
                handleGameEnd(ws.roomCode, winner, gs, 'normal');
                return;
            }
            
            // Sırayı değiştir
            const playerIds = Object.keys(gs.players);
            gs.currentPlayer = playerIds.find(id => id !== ws.playerId);
        }
    }
    
    // Her iki oyuncuya da güncel durumu gönder
    Object.keys(gs.players).forEach(playerId => {
        sendGameState(ws.roomCode, playerId);
    });
}

function handlePass(ws, data) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
    }

    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || room.gameState.gameEnded) {
        return sendMessage(ws, { type: 'error', message: 'Oyun sona ermiş' });
    }

    const gs = room.gameState;
    
    // Sıra kontrolü
    if (gs.currentPlayer !== ws.playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }

    const player = gs.players[ws.playerId];
    
    // Oynayabilecek taş var mı kontrol et
    const canPlay = player.hand.some(tile => canPlayTile(tile, gs.board));
    
    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Oynayabileceğiniz taş var! Pas geçemezsiniz.' });
    }
    
    // Bazardan çekme şansı var mı kontrol et
    if (gs.market && gs.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: 'Önce pazardan taş çekmelisiniz!' });
    }

    // Pas geç
    gs.consecutivePasses++;
    gs.turn++;
    
    // Kazanan var mı kontrol et
    const winner = checkWinner(gs);
    if (winner) {
        handleGameEnd(ws.roomCode, winner, gs, 'normal');
        return;
    }
    
    // Sırayı değiştir
    const playerIds = Object.keys(gs.players);
    gs.currentPlayer = playerIds.find(id => id !== ws.playerId);
    
    // Her iki oyuncuya da güncel durumu gönder
    Object.keys(gs.players).forEach(playerId => {
        sendGameState(ws.roomCode, playerId);
    });
}

async function handleGameEnd(roomCode, winnerId, gameState, reason = 'normal') {
    const room = rooms.get(roomCode);
    if (!room) return;

    try {
        room.gameState.gameEnded = true;
        const playerIds = Object.keys(gameState.players);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;
        let winnerName = '';
        let loserName = '';

        if (!isDraw) {
            winnerName = gameState.players[winnerId].name;
            const loserId = playerIds.find(id => id !== winnerId);
            loserName = gameState.players[loserId].name;
        }

        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
        const isRankedMatch = room.type === 'ranked' && !player1IsGuest && !player2IsGuest;

        if (isRankedMatch && !isDraw) {
            const player1 = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const player2 = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (player1 && player2) {
                const winner = winnerId === player1Id ? player1 : player2;
                const loser = winnerId === player1Id ? player2 : player1;

                eloChanges = calculateElo(winner.elo, loser.elo, winner.level);

                winner.elo = eloChanges.winnerElo;
                winner.level = calculateLevel(winner.elo);
                winner.wins += 1;
                winner.winStreak += 1;
                winner.bestWinStreak = Math.max(winner.bestWinStreak, winner.winStreak);
                winner.totalGames += 1;
                winner.lastPlayed = new Date();

                loser.elo = eloChanges.loserElo;
                loser.level = calculateLevel(loser.elo);
                loser.losses += 1;
                loser.winStreak = 0;
                loser.totalGames += 1;
                loser.lastPlayed = new Date();

                await winner.save();
                await loser.save();
            }
        } else if (isDraw && isRankedMatch) {
            const player1 = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const player2 = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (player1 && player2) {
                player1.draws += 1;
                player1.totalGames += 1;
                player1.winStreak = 0;
                player1.lastPlayed = new Date();

                player2.draws += 1;
                player2.totalGames += 1;
                player2.winStreak = 0;
                player2.lastPlayed = new Date();

                await player1.save();
                await player2.save();
            }
        }

        // Her oyuncuya kendi sonucunu gönder
        playerIds.forEach(playerId => {
            const ws = playerConnections.get(playerId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                const isWinner = playerId === winnerId;
                const isLoser = !isDraw && playerId !== winnerId;
                
                let message = '';
                if (reason === 'leave') {
                    if (isWinner) {
                        message = 'Rəqib oyundan ayrıldı. QAZANDINIZ!';
                    } else {
                        message = 'Siz oyundan ayrıldınız. UDUZDUNUZ!';
                    }
                } else if (isDraw) {
                    message = 'Oyun bərabərə bitdi!';
                } else if (isWinner) {
                    message = 'Təbriklər! QAZANDINIZ!';
                } else {
                    message = 'UDUZDUNUZ!';
                }

                sendMessage(ws, { 
                    type: 'gameEnd', 
                    winner: winnerId, 
                    winnerName: isDraw ? 'Bərabərə' : winnerName,
                    loserName: isDraw ? '' : loserName,
                    isRanked: isRankedMatch,
                    eloChanges: eloChanges ? {
                        winner: eloChanges.winnerChange,
                        loser: eloChanges.loserChange
                    } : null,
                    reason: reason,
                    message: message,
                    isDraw: isDraw,
                    isWinner: isWinner,
                    isLoser: isLoser
                });
            }
        });

        console.log(`🏁 Oyun sonlandırıldı: ${roomCode} - Qalib: ${isDraw ? 'Bərabərə' : winnerName} - Səbəb: ${reason}`);

        // 5 saniye sonra odayı temizle
        setTimeout(() => {
            cleanupRoom(roomCode);
        }, 5000);

    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Bərabərə' : gameState.players[winnerId].name,
            isRanked: false,
            reason: 'error',
            message: 'Oyun xəta ilə sonlandı'
        });
        setTimeout(() => {
            cleanupRoom(roomCode);
        }, 5000);
    }
}

function cleanupRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const playerIds = Object.keys(room.players);
    playerIds.forEach(pid => {
        const playerSocket = playerConnections.get(pid);
        if (playerSocket) {
            playerSocket.roomCode = null;
        }
    });
    
    rooms.delete(roomCode);
    console.log(`🧹 Oda təmizləndi: ${roomCode}`);
}

function handleLeaveGame(ws) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) {
        return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState || room.gameState.gameEnded) {
        cleanupRoom(ws.roomCode);
        return;
    }

    const gs = room.gameState;
    const playerIds = Object.keys(gs.players);
    
    if (playerIds.length !== 2) {
        cleanupRoom(ws.roomCode);
        return;
    }

    const leaverId = ws.playerId;
    const winnerId = playerIds.find(id => id !== leaverId);

    console.log(`🚪 ${room.players[leaverId].name} oyundan ayrıldı: ${ws.roomCode}`);
    handleGameEnd(ws.roomCode, winnerId, gs, 'leave');
}

function handleReconnect(ws, data) {
    const { roomCode, playerId } = data;
    const room = rooms.get(roomCode);

    if (!room) {
        return sendMessage(ws, { 
            type: 'error', 
            message: 'Oda tapılmadı.' 
        });
    }

    const player = room.players[playerId];
    if (!player) {
        return sendMessage(ws, { 
            type: 'error', 
            message: 'Bu oyunda qeydiyyatdan keçməmisiniz.' 
        });
    }

    player.isConnected = true;
    player.socket = ws;
    ws.playerId = playerId;
    ws.roomCode = roomCode;
    ws.playerName = player.name;
    ws.isGuest = player.isGuest;
    playerConnections.set(playerId, ws);

    if (room.gameState && !room.gameState.gameEnded) {
        sendMessage(ws, { 
            type: 'reconnectSuccess',
            gameState: { 
                ...room.gameState,
                playerId: playerId,
                roomCode: roomCode
            } 
        });
        
        console.log(`🔄 ${player.name} yenidən qoşuldu: ${roomCode}`);
    } else {
        sendMessage(ws, { 
            type: 'error', 
            message: 'Oyun bitmişdir.' 
        });
    }
}

function handleDisconnect(ws) {
    if (ws.roomCode && ws.playerId) {
        const room = rooms.get(ws.roomCode);
        if (room && room.players[ws.playerId]) {
            room.players[ws.playerId].isConnected = false;
            
            // Kuyruktan çıkar
            const queueIndex = matchQueue.findIndex(p => p.ws === ws);
            if (queueIndex !== -1) {
                matchQueue.splice(queueIndex, 1);
            }
            
            // Eğer oyun devam ediyorsa ve bağlantı kesilmişse
            if (room.gameState && !room.gameState.gameEnded) {
                setTimeout(() => {
                    if (room.players[ws.playerId] && !room.players[ws.playerId].isConnected) {
                        const playerIds = Object.keys(room.players);
                        const winnerId = playerIds.find(id => id !== ws.playerId);
                        if (winnerId) {
                            console.log(`⏰ ${room.players[ws.playerId].name} bağlantısı kəsildi, oyun sonlandırılır...`);
                            handleGameEnd(ws.roomCode, winnerId, room.gameState, 'disconnect');
                        }
                    }
                }, 30000); // 30 saniye bekle
            }
        }
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Server çalışır: Port ${PORT}`);
});
