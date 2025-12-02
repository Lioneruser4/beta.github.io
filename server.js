const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

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
const playerSessions = new Map(); // telegramId -> player data

// ELO Calculation - Win-based system
function calculateElo(winnerElo, loserElo, winnerLevel) {
    // Random points between 13-20 for levels 1-5
    // Random points between 10-15 for levels 6+
    let winnerChange;
    if (winnerLevel <= 5) {
        winnerChange = Math.floor(Math.random() * 8) + 13; // 13-20
    } else {
        winnerChange = Math.floor(Math.random() * 6) + 10; // 10-15
    }
    
    const loserChange = -Math.floor(winnerChange * 0.7); // Loser loses 70% of winner's gain
    
    return {
        winnerElo: winnerElo + winnerChange,
        loserElo: Math.max(0, loserElo + loserChange),
        winnerChange,
        loserChange
    };
}

// Level Calculation - Every 100 points = 1 level
function calculateLevel(elo) {
    return Math.floor(elo / 100) + 1; // Start at level 1 (0 ELO)
}

// API Endpoints
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName, photoUrl } = req.body;
        
        if (!telegramId || !username) {
            return res.status(400).json({ error: 'Telegram ID ve kullanıcı adı gerekli' });
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
            console.log(`🆕 Yeni oyuncu kaydedildi: ${username} (${telegramId})`);
        } else {
            // Profil bilgilerini güncelle
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
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find()
            .sort({ elo: -1 })
            .limit(10) // Top 10
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames winStreak');
        
        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/player/:telegramId/stats', async (req, res) => {
    try {
        const player = await Player.findOne({ telegramId: req.params.telegramId });
        if (!player) {
            return res.status(404).json({ error: 'Oyuncu bulunamadı' });
        }
        
        const recentMatches = await Match.find({
            $or: [{ player1: player._id }, { player2: player._id }]
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('player1 player2 winner');
        
        res.json({ success: true, player, recentMatches });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/player/:telegramId/matches', async (req, res) => {
    try {
        const player = await Player.findOne({ telegramId: req.params.telegramId });
        if (!player) {
            return res.status(404).json({ error: 'Oyuncu bulunamadı' });
        }
        
        const matches = await Match.find({
            $or: [{ player1: player._id }, { player2: player._id }]
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('player1 player2 winner');
        
        res.json({ success: true, matches });
    } catch (error) {
        console.error('Matches error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
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

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    clientTracking: true
});

// --- YARDIMCI FONKSİYONLAR ---

function generateRoomCode() {
    return Math.random().toString(36).substr(2, 4).toUpperCase();
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
    const market = tiles.slice(14); // Kalan taşlar pazar

    const room = rooms.get(roomCode);
    
    // En yüksek çifti bul (6|6, 5|5, 4|4, ...)
    let startingPlayer = player1Id;
    let highestDouble = -1;
    
    for (let player of [player1Id, player2Id]) {
        const hand = player === player1Id ? player1Hand : player2Hand;
        for (let tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayer = player;
            }
        }
    }
    
    room.gameState = {
        board: [],
        players: {
            [player1Id]: { hand: player1Hand, name: room.players[player1Id].name },
            [player2Id]: { hand: player2Hand, name: room.players[player2Id].name }
        },
        market: market,
        currentPlayer: startingPlayer,
        turn: 1,
        lastMove: null,
        startingDouble: highestDouble
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı - Başlayan: ${startingPlayer === player1Id ? room.players[player1Id].name : room.players[player2Id].name} (${highestDouble}|${highestDouble})`);
    return room.gameState;
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Bu fonksiyonu TRUE/FALSE dönecek şekilde güncelledim
function playTileOnBoard(tile, board, position) {
    if (board.length === 0) {
        board.push(tile);
        return true;
    }

    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    let played = false;

    if (position === 'left' || position === 'both') {
        if (tile[1] === leftEnd) {
            board.unshift(tile);
            played = true;
        } else if (tile[0] === leftEnd) {
            board.unshift([tile[1], tile[0]]); // Yön değiştir
            played = true;
        }
    } 
    
    // Eğer 'both' seçildiyse ve sol tarafa uymadıysa sağa bakmaya devam etmeli
    // Ancak oyuncu spesifik olarak 'left' dediyse ve uymadıysa buraya girmemeli
    if (!played && (position === 'right' || position === 'both')) {
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

function checkWinner(gameState) {
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            return playerId;
        }
    }

    const player1Id = Object.keys(gameState.players)[0];
    const player2Id = Object.keys(gameState.players)[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    if (!player1CanPlay && !player2CanPlay) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        // Eşitlik durumunda beraberlik mantığı eklenebilir, şimdilik az puanlı kazanır
        if (player1Sum === player2Sum) return 'DRAW'; 
        return player1Sum < player2Sum ? player1Id : player2Id;
    }

    return null;
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
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

function sendGameState(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    const ws = playerConnections.get(playerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
        ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: { ...room.gameState, playerId: playerId }
        }));
    } catch (error) { console.error(error); }
}

function sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {}
    }
}

// --- WEBSOCKET EVENTLERİ ---

// Store active connections
const activeConnections = new Map();

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    const connectionId = uuidv4();
    let playerId = null;
    let roomCode = null;

    // Handle reconnection
    ws.on('reconnect', async (data) => {
        try {
            const { playerId: reconnectingPlayerId, roomCode: reconnectingRoomCode, sessionId } = data;
            if (!reconnectingPlayerId || !reconnectingRoomCode || !sessionId) {
                return sendMessage(ws, { type: 'error', message: 'Geçersiz yeniden bağlantı isteği' });
            }

            playerId = reconnectingPlayerId;
            roomCode = reconnectingRoomCode;
            const room = rooms.get(roomCode);

            if (!room) {
                return sendMessage(ws, {
                    type: 'reconnectFailed',
                    message: 'Oyun bulunamadı'
                });
            }

            const player = room.players.find(p => p.telegramId === playerId && p.sessionId === sessionId);
            if (!player) {
                return sendMessage(ws, {
                    type: 'reconnectFailed',
                    message: 'Oturum bulunamadı'
                });
            }

            // Update player's WebSocket connection
            player.ws = ws;
            playerConnections.set(ws, { playerId, roomCode });

            // Send current game state
            sendMessage(ws, {
                type: 'gameState',
                ...room,
                isReconnect: true
            });

            // Notify other player
            const otherPlayer = room.players.find(p => p.telegramId !== playerId);
            if (otherPlayer && otherPlayer.ws) {
                sendMessage(otherPlayer.ws, {
                    type: 'playerReconnected',
                    playerId
                });
            }

        } catch (error) {
            console.error('Yeniden bağlantı hatası:', error);
            sendMessage(ws, {
                type: 'reconnectFailed',
                message: 'Yeniden bağlanırken hata oluştu'
            });
        }
    });
    ws.on('pong', () => {
        ws.isAlive = true;
        // Update last ping time
        if (playerId && roomCode) {
            const room = rooms.get(roomCode);
            if (room) {
                const player = room.players.find(p => p.telegramId === playerId);
                if (player) {
                    player.lastPing = Date.now();
                }
            }
        }
    });

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
                case 'leaveGame': handleLeaveGame(ws); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' });
});

// ...

async function handleFindMatch(ws, data) {
    try {
        const { telegramId, isGuest = false } = data;
        
        // Önce oyuncunun önceki bağlantılarını temizle
        for (const [code, room] of rooms.entries()) {
            const existingPlayer = room.players.find(p => p.telegramId === telegramId);
            if (existingPlayer) {
                // Eğer bu bağlantı zaten bu odadaysa, sadece bağlantıyı güncelle
                existingPlayer.ws = ws;
                playerConnections.set(ws, { playerId: telegramId, roomCode: code });
                return sendGameState(ws, code);
            }
        }
        
        // Eğer oyuncu bir odada değilse devam et // Add to queue with session ID for reconnection
        const player = {
            ws,
            telegramId,
            isGuest: isGuest || false,
            elo: 0, // Default ELO for guests
            sessionId: uuidv4(), // Unique session ID for reconnection
            lastPing: Date.now(),
            username: isGuest ? `Guest_${Math.floor(Math.random() * 10000)}` : '',
            playerData: data.playerData || {}
        };

        // If player is not a guest, get their ELO from database
        if (!isGuest) {
            const dbPlayer = await Player.findOne({ telegramId });
            if (dbPlayer) {
                player.elo = dbPlayer.elo || 0;
                player.username = dbPlayer.username;
            }
        }

        // Find a match with similar ELO (±200) and same account type (guest/telegram)
        const matchIndex = matchQueue.findIndex(p => {
            // Don't match with self
            if (p.telegramId === player.telegramId) return false;
            
            // For ranked games, only match Telegram users with other Telegram users
            if (data.gameType === 'ranked') {
                return !p.isGuest && !player.isGuest && 
                       Math.abs((p.elo || 0) - (player.elo || 0)) <= 200;
            }
            
            // For friendly games, match any user with any other user
            return true;
        });

        if (matchIndex !== -1) {
            // Found a match!
            const opponent = matchQueue[matchIndex];
            matchQueue.splice(matchIndex, 1);

            const roomCode = generateRoomCode();
            initializeGame(roomCode, player, opponent);
            
            // Notify both players
            sendMessage(ws, { 
                type: 'matchFound', 
                roomCode,
                color: 'red',
                opponent: {
                    username: opponent.username,
                    elo: opponent.elo
                }
            });
            
            sendMessage(opponent.ws, { 
                type: 'matchFound', 
                roomCode,
                color: 'white',
                opponent: {
                    username: player.username,
                    elo: player.elo
                }
            });
        } else {
            // No match found, add to queue
            matchQueue.push(player);
            sendMessage(ws, { 
                type: 'searchStatus', 
                message: 'Eşleşme aranıyor...' 
            });
        }
    } catch (error) {
        console.error('Eşleşme hatası:', error);
        sendMessage(ws, { 
            type: 'error', 
            message: 'Eşleşme sırasında bir hata oluştu.' 
        });
    }
};

function handleDisconnect(ws) {
    console.log('❌ İstifadəçi ayrıldı');
    
    // Eğer oyuncu sıradaydı, kuyruktan çıkar
    const queueIndex = matchQueue.findIndex(p => p.ws === ws);
    if (queueIndex !== -1) {
        matchQueue.splice(queueIndex, 1);
    }
    
    // Eğer oyuncu bir odadaysa, oyundan çıkar
    for (const [roomCode, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.ws === ws);
        if (playerIndex !== -1) {
            // Oyuncunun bağlantısını kaldır ama oyun durumunu koru
            room.players[playerIndex].ws = null;
            
            // Diğer oyuncuya bildir
            const otherPlayer = room.players[1 - playerIndex];
            if (otherPlayer && otherPlayer.ws) {
                sendMessage(otherPlayer.ws, {
                    type: 'opponentDisconnected',
                    message: 'Rakibiniz bağlantısını kesti. Lobiye yönlendiriliyorsunuz...'
                });
                
                // Oyunu bitir ve oyuncuyu lobiye gönder
                setTimeout(() => {
                    if (otherPlayer.ws) { // Hala bağlı mı kontrol et
                        sendMessage(otherPlayer.ws, {
                            type: 'gameOver',
                            winner: otherPlayer.telegramId,
                            reason: 'leave',
                            eloChange: 0
                        });
                    }
                }, 3000);
            }
            
            // Odayı temizle
            rooms.delete(roomCode);
            break;
        }
    }
    
    // Bağlantıyı temizle
    playerConnections.delete(ws);
}

function handleLeaveGame(ws) {
    const connection = playerConnections.get(ws);
    if (!connection) return;

    const { playerId, roomCode } = connection;
    const room = rooms.get(roomCode);
    
    // Eğer oyuncu bir odadaysa
    if (room) {
        // Oyuncuyu odadan çıkar
        const playerIndex = room.players.findIndex(p => p.ws === ws);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
        }

        // Eğer oda boşsa sil
        if (room.players.length === 0) {
            rooms.delete(roomCode);
        } else {
            // Diğer oyuncuya haber ver
            const otherPlayer = room.players[0];
            if (otherPlayer && otherPlayer.ws) {
                sendMessage(otherPlayer.ws, {
                    type: 'opponentLeft',
                    message: 'Rakibiniz oyundan ayrıldı',
                    roomCleared: true  // Oda temizlendi bilgisi
                });
                
                // Diğer oyuncunun bağlantısını temizle
                playerConnections.delete(otherPlayer.ws);
            }
            // Odayı temizle
            rooms.delete(roomCode);
        }
    }

    // Bağlantıyı temizle
    playerConnections.delete(ws);
    
    // Eşleşme kuyruğundan da çıkar
    const queueIndex = matchQueue.findIndex(p => p.ws === ws);
    if (queueIndex !== -1) {
        matchQueue.splice(queueIndex, 1);
    }
    
    console.log(`Oyuncu çıktı: ${playerId}, Oda: ${roomCode}`);
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
