const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// --- MongoDB Bağlantısı ve Şemalar ---
// (Bu kısım orijinal kodunuzla aynı kalabilir, sadece useFindAndModify kaldırıldı)
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB bağlantısı başarılı - Domino Game Database'))
.catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

// Mongoose Schemas (Orijinal haliyle korundu)
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
    lastPlayed: { type: Date, default: Date.now },
    isHidden: { type: Boolean, default: false }
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
    gameType: { type: String, enum: ['ranked', 'private', 'casual'], default: 'ranked' },
    createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);

app.use(cors());
app.use(express.json());

// --- Global Durum Yönetimi ---
const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map(); // playerId -> ws
const ADMIN_TELEGRAM_ID = '976640409';

// ELO Calculation (Orijinal mantık korundu)
function calculateElo(winnerElo, loserElo, winnerLevel) {
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

function calculateLevel(elo) {
    return Math.floor(elo / 100) + 1;
}

// Random Room Code Generator
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}


// --- API Endpoints (Orijinal haliyle korundu) ---
// ... (Auth, Leaderboard, Stats, Admin Endpoints)

app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegramId, username, firstName, lastName, photoUrl } = req.body;
        
        if (!telegramId || !username) {
            return res.status(400).json({ error: 'Telegram ID ve kullanıcı adı gerekli' });
        }

        let player = await Player.findOne({ telegramId });
        
        if (!player) {
            player = new Player({ telegramId, username, firstName, lastName, photoUrl });
            await player.save();
            console.log(`🆕 Yeni oyuncu kaydedildi: ${username}`);
        } else {
            // Profil bilgilerini güncelle
            player.username = username;
            player.firstName = firstName;
            player.lastName = lastName;
            player.photoUrl = photoUrl;
            player.lastPlayed = new Date();
            await player.save();
        }
        
        res.json({
            success: true,
            player: {
                id: player._id, telegramId: player.telegramId, username: player.username,
                firstName: player.firstName, lastName: player.lastName, photoUrl: player.photoUrl,
                elo: player.elo, level: player.level, wins: player.wins, losses: player.losses,
                draws: player.draws, totalGames: player.totalGames, winStreak: player.winStreak,
                bestWinStreak: player.bestWinStreak, isAdmin: player.telegramId === ADMIN_TELEGRAM_ID
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});
// ... (Diğer API Endpoints)

app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find({ isHidden: { $ne: true } })
            .sort({ elo: -1 })
            .limit(10)
            .select('telegramId username firstName lastName photoUrl elo level wins losses draws totalGames winStreak');
        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
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

// --- PROFESSIONAL DOMINO 101 GAME LOGIC ---

// Complete domino set (0-0 to 6-6) - Taşlar [val1, val2] formatında
function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return tiles;
}

function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

function initializeGame(roomCode, player1Id, player2Id) {
    const allTiles = shuffleArray(createDominoSet());
    const player1Hand = allTiles.slice(0, 7);
    const player2Hand = allTiles.slice(7, 14);
    const market = allTiles.slice(14);

    const room = rooms.get(roomCode);
    
    // Başlangıç oyuncusu bulma (En yüksek çift taş)
    let startingPlayer = player1Id;
    let highestDouble = -1;
    
    for (let playerId of [player1Id, player2Id]) {
        const hand = playerId === player1Id ? player1Hand : player2Hand;
        for (let tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayer = playerId;
            }
        }
    }
    
    if (highestDouble === -1) {
        startingPlayer = Math.random() < 0.5 ? player1Id : player2Id;
    }

    room.gameState = {
        board: [],
        status: 'playing',
        market: market,
        currentPlayer: startingPlayer,
        players: {
            [player1Id]: { 
                hand: player1Hand, 
                name: room.players[player1Id].name,
                photoUrl: room.players[player1Id].photoUrl,
                elo: room.players[player1Id].elo,
                level: room.players[player1Id].level
            },
            [player2Id]: { 
                hand: player2Hand, 
                name: room.players[player2Id].name,
                photoUrl: room.players[player2Id].photoUrl,
                elo: room.players[player2Id].elo,
                level: room.players[player2Id].level
            }
        },
        turn: 1,
        startingDouble: highestDouble,
        roomCode: roomCode,
        startTime: Date.now(),
        lastMove: null // Yeni eklendi
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Domino oyunu başlatıldı - Başlayan: ${room.players[startingPlayer].name}`);
    return room.gameState;
}

// Bir taşın tahtaya oynanabilirliğini kontrol et
function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Bir taş için geçerli hamleleri bul
function getValidMoves(tile, board) {
    if (board.length === 0) return ['start'];
    
    const moves = [];
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

// Taşı tahtaya oynama (Düzeltilmiş)
function playTile(tile, position, board) {
    let newBoard = [...board];
    let tileToPlay = [...tile]; // Taşın kopyası
    
    if (position === 'start' || newBoard.length === 0) {
        // İlk taş
        newBoard.push(tileToPlay);
        return newBoard;
    } else if (position === 'left') {
        const leftEnd = newBoard[0][0];
        if (tileToPlay[1] === leftEnd) {
            newBoard.unshift(tileToPlay); // Uçlar uyuşuyor
        } else if (tileToPlay[0] === leftEnd) {
            newBoard.unshift([tileToPlay[1], tileToPlay[0]]); // Taşı çevir
        } else {
            return null; // Geçersiz hamle
        }
    } else if (position === 'right') {
        const rightEnd = newBoard[newBoard.length - 1][1];
        if (tileToPlay[0] === rightEnd) {
            newBoard.push(tileToPlay); // Uçlar uyuşuyor
        } else if (tileToPlay[1] === rightEnd) {
            newBoard.push([tileToPlay[1], tileToPlay[0]]); // Taşı çevir
        } else {
            return null; // Geçersiz hamle
        }
    } else {
        return null; // Geçersiz pozisyon
    }
    
    return newBoard;
}

function checkWinCondition(hand) {
    return hand.length === 0;
}

// Oyunun kilitlenip kilitlenmediğini kontrol et (Pazar bitti ve kimse oynayamıyor)
function checkBlockedGame(gameState) {
    const { players, board, market } = gameState;
    
    if (market.length > 0) return false;
    
    for (let playerId in players) {
        const hand = players[playerId].hand;
        const canPlay = hand.some(tile => canPlayTile(tile, board));
        if (canPlay) return false;
    }
    
    return true;
}

// Kilitlenmiş oyunda kazananı hesapla (En az puana sahip olan)
function calculateBlockedWinner(gameState) {
    const { players } = gameState;
    let minPoints = Infinity;
    let winner = null;
    let draw = [];
    
    for (let playerId in players) {
        const hand = players[playerId].hand;
        const points = hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        if (points < minPoints) {
            minPoints = points;
            winner = playerId;
            draw = [playerId];
        } else if (points === minPoints) {
            draw.push(playerId);
        }
    }
    
    return draw.length === 2 ? 'DRAW' : winner; // Beraberlik durumunda 'DRAW' dön
}

// --- İletişim Yardımcı Fonksiyonları ---

function sendMessage(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {
             console.error('Mesaj gönderme hatası:', e.message);
        }
    }
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
    const room = rooms.get(roomCode);
    if (!room || !room.players) return;

    for (const playerId in room.players) {
        if (playerId === excludePlayer) continue;
        const ws = playerConnections.get(playerId);
        sendMessage(ws, message);
    }
}

// Oyuncuya özel oyun durumunu gönderir (Rakibin elini gizler)
function getSanitizedGameStateForPlayer(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return null;

    const fullGameState = room.gameState;
    const opponentId = Object.keys(fullGameState.players).find(id => id !== playerId);
    const myPlayer = fullGameState.players[playerId];
    const opponent = opponentId ? fullGameState.players[opponentId] : {};

    const sanitizedState = {
        board: fullGameState.board,
        market: fullGameState.market, // Pazarda kalan taşlar
        currentPlayer: fullGameState.currentPlayer,
        isMyTurn: fullGameState.currentPlayer === playerId,
        roomCode: roomCode,
        status: fullGameState.status,
        turn: fullGameState.turn,
        
        // Oyuncuya özel bilgiler
        myPlayerId: playerId,
        
        players: {
            [playerId]: { 
                hand: myPlayer.hand, 
                name: myPlayer.name,
                photoUrl: myPlayer.photoUrl,
                elo: myPlayer.elo,
                level: myPlayer.level
            }
        },
        // Rakip bilgisi (Sadece elindeki taş sayısı)
        ...(opponentId && {
            [opponentId]: { 
                hand: new Array(opponent.hand.length).fill([-1, -1]), // Taşları gizle, sadece sayıyı client'a göster
                name: opponent.name,
                photoUrl: opponent.photoUrl,
                elo: opponent.elo,
                level: opponent.level
            }
        })
    };

    return sanitizedState;
}

function sendGameStateUpdate(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    Object.keys(room.players).forEach(pid => {
        const sanitizedState = getSanitizedGameStateForPlayer(roomCode, pid);
        sendMessage(playerConnections.get(pid), {
            type: 'gameUpdate',
            gameState: sanitizedState
        });
    });
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                // case 'rejoinGame': handleRejoinGame(ws, data); break;
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                // case 'createRoom': handleCreateRoom(ws, data); break;
                // case 'joinRoom': handleJoinRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'pass': handlePass(ws); break;
                case 'leaveGame': handleLeaveGame(ws); break; // Oyundan çıkış
                case 'initialAuth': handleInitialAuth(ws, data); break; // Yeni eklendi
            }
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
            sendMessage(ws, { type: 'error', message: 'Sunucu hatası.' });
        }
    });

    ws.on('close', () => handleDisconnect(ws));
});

function handleInitialAuth(ws, data) {
    // Client'tan gelen Telegram ID'yi ws objesine atar
    const playerId = data.telegramId || data.username || generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.username || 'Guest';
    ws.telegramId = data.telegramId;
    ws.photoUrl = data.photoUrl;
    ws.level = data.level;
    ws.elo = data.elo;
    ws.isGuest = !data.telegramId;
    
    playerConnections.set(playerId, ws);
    console.log(`👤 Oyuncu bağlandı ve doğrulandı: ${ws.playerName} (${playerId})`);
}

// ... (Ping Interval ve wss.on('close') orijinal haliyle kalabilir)

// --- PROFESSIONAL DOMINO GAME HANDLERS ---

function handleFindMatch(ws, data) {
    if (!ws.playerId) {
        return sendMessage(ws, { type: 'error', message: 'Önce kimlik doğrulaması yapın' });
    }
    
    if (ws.roomCode) {
        return sendMessage(ws, { type: 'error', message: 'Zaten bir oyundasınız' });
    }
    
    const existingInQueue = matchQueue.find(p => p.playerId === ws.playerId);
    if (existingInQueue) {
        return sendMessage(ws, { type: 'error', message: 'Zaten kuyrukta bekliyorsunuz' });
    }

    // Gelen verideki ELO/Level bilgileri ile kuyruğa ekle
    matchQueue.push({ 
        ws, 
        playerId: ws.playerId, 
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
                [p1.playerId]: { name: p1.playerName, telegramId: p1.telegramId, photoUrl: p1.photoUrl, level: p1.level, elo: p1.elo, isGuest: p1.isGuest }, 
                [p2.playerId]: { name: p2.playerName, telegramId: p2.telegramId, photoUrl: p2.photoUrl, level: p2.level, elo: p2.elo, isGuest: p2.isGuest } 
            },
            type: gameType,
            startTime: Date.now()
        };

        rooms.set(roomCode, room);
        p1.ws.roomCode = roomCode;
        p2.ws.roomCode = roomCode;

        initializeGame(roomCode, p1.playerId, p2.playerId);

        // gameStart mesajı her iki oyuncuya da gönderilir
        const p1State = getSanitizedGameStateForPlayer(roomCode, p1.playerId);
        const p2State = getSanitizedGameStateForPlayer(roomCode, p2.playerId);

        sendMessage(p1.ws, { type: 'gameStart', gameState: p1State });
        sendMessage(p2.ws, { type: 'gameStart', gameState: p2State });
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) {
    if (!ws.playerId) return;

    const index = matchQueue.findIndex(p => p.playerId === ws.playerId);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti - Kalan: ${matchQueue.length}`);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function handlePlayTile(ws, data) {
    const roomCode = ws.roomCode;
    const playerId = ws.playerId;
    
    if (!roomCode || !rooms.has(roomCode) || !playerId) {
        return sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı veya yetkilendirilmedi' });
    }
    
    const room = rooms.get(roomCode);
    const gameState = room.gameState;
    
    if (!gameState || gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    const { tileIndex, position } = data;
    const playerHand = gameState.players[playerId].hand;
    
    if (tileIndex < 0 || tileIndex >= playerHand.length) {
        return sendMessage(ws, { type: 'error', message: 'Geçersiz taş indeksi' });
    }
    
    const tile = playerHand[tileIndex];
    const validMoves = getValidMoves(tile, gameState.board);
    
    if (!validMoves.includes(position)) {
        return sendMessage(ws, { type: 'error', message: 'Bu taşı buraya oynayamazsın' });
    }
    
    // Play the tile
    const newBoard = playTile(tile, position, gameState.board);
    if (!newBoard) {
        return sendMessage(ws, { type: 'error', message: 'Tahta ucu ile uyuşmuyor' });
    }
    
    playerHand.splice(tileIndex, 1);
    gameState.board = newBoard;
    gameState.lastMove = { player: playerId, tile: tile, position: position };
    gameState.moves = (gameState.moves || 0) + 1; // Hamle sayısını takip et
    
    // Kazanma Kontrolü (El bitti)
    if (checkWinCondition(playerHand)) {
        gameState.status = 'finished';
        handleGameEnd(roomCode, playerId, gameState);
        return;
    }
    
    // Sırayı Değiştir
    const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
    gameState.currentPlayer = nextPlayer;
    gameState.turn++;
    
    // Kilitlenme Kontrolü (Sıra değişimi sonrası)
    if (checkBlockedGame(gameState)) {
        gameState.status = 'finished';
        const blockedWinner = calculateBlockedWinner(gameState);
        handleGameEnd(roomCode, blockedWinner, gameState);
        return;
    }

    sendGameStateUpdate(roomCode);
}

function handleDrawFromMarket(ws) {
    const roomCode = ws.roomCode;
    const playerId = ws.playerId;
    
    if (!roomCode || !rooms.has(roomCode) || !playerId) return;
    
    const room = rooms.get(roomCode);
    const gameState = room.gameState;
    
    if (!gameState || gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    const playerHand = gameState.players[playerId].hand;
    const hasPlayableTile = playerHand.some(tile => canPlayTile(tile, gameState.board));
    
    // KURAL: Oynanabilir taş varken pazardan çekilemez.
    if (hasPlayableTile) {
        return sendMessage(ws, { type: 'error', message: 'Elinde oynayabileceğin taş var' });
    }
    
    if (gameState.market.length === 0) {
        return sendMessage(ws, { type: 'error', message: 'Pazarda taş kalmadı. Pas geçmelisin.' });
    }
    
    // Pazardan taş çek
    const drawnTile = gameState.market.shift();
    playerHand.push(drawnTile);
    
    // Çekilen taş ile oynanıp oynanamayacağını kontrol et. Oynanamıyorsa sıra geçer.
    if (!canPlayTile(drawnTile, gameState.board)) {
        console.log(`❌ ${ws.playerName} çektiği taşı oynayamadı. Sıra geçiyor.`);
        gameState.currentPlayer = Object.keys(gameState.players).find(id => id !== playerId);
        gameState.turn++;
        
        // Sıra değişiminden sonra oyun kilitlendi mi kontrol et
        if (checkBlockedGame(gameState)) {
            gameState.status = 'finished';
            const blockedWinner = calculateBlockedWinner(gameState);
            handleGameEnd(roomCode, blockedWinner, gameState);
            return;
        }
    } else {
        // Oynanabilir taş çekti, sıra onda kalır.
        sendMessage(ws, { type: 'info', message: `Pazardan [${drawnTile[0]}|${drawnTile[1]}] çektiniz. Şimdi oynayın.` });
    }
    
    sendGameStateUpdate(roomCode);
}

function handlePass(ws) {
    const roomCode = ws.roomCode;
    const playerId = ws.playerId;
    
    if (!roomCode || !rooms.has(roomCode) || !playerId) return;
    
    const room = rooms.get(roomCode);
    const gameState = room.gameState;
    
    if (!gameState || gameState.currentPlayer !== playerId) {
        return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });
    }
    
    // KURAL 1: Pazarda taş varsa pas geçilemez (Çekmek zorunlu).
    if (gameState.market.length > 0) {
        return sendMessage(ws, { type: 'error', message: 'Pazarda taş varken pas geçemezsin' });
    }
    
    const playerHand = gameState.players[playerId].hand;
    const hasPlayableTile = playerHand.some(tile => canPlayTile(tile, gameState.board));
    
    // KURAL 2: Oynanabilir taş varken pas geçilemez.
    if (hasPlayableTile) {
        return sendMessage(ws, { type: 'error', message: 'Oynayabileceğin taş varken pas geçemezsin' });
    }
    
    // Pas Geç
    const nextPlayer = Object.keys(gameState.players).find(id => id !== playerId);
    gameState.currentPlayer = nextPlayer;
    gameState.turn++;
    
    broadcastToRoom(roomCode, { type: 'info', message: `${ws.playerName} pas geçti.` }, ws.playerId);
    
    // Kilitlenme Kontrolü (Pas geçişi sonrası)
    if (checkBlockedGame(gameState)) {
        gameState.status = 'finished';
        const blockedWinner = calculateBlockedWinner(gameState);
        handleGameEnd(roomCode, blockedWinner, gameState);
        return;
    }
    
    sendGameStateUpdate(roomCode);
}

async function handleGameEnd(roomCode, winnerId, gameState) {
    const room = rooms.get(roomCode);
    if (!room || room.gameEnded) return;

    room.gameEnded = true; // Tekrar çalışmasını engelle
    
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
            const p1Doc = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const p2Doc = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (!p1Doc || !p2Doc) {
                console.error('❌ Oyuncular MongoDB\'de bulunamadı - ELO güncellenemedi.');
            } else if (!isDraw) {
                const winnerDoc = winnerId === player1Id ? p1Doc : p2Doc;
                const loserDoc = winnerId === player1Id ? p2Doc : p1Doc;

                eloChanges = calculateElo(winnerDoc.elo, loserDoc.elo, winnerDoc.level);

                winnerDoc.elo = eloChanges.winnerElo;
                winnerDoc.level = calculateLevel(winnerDoc.elo);
                winnerDoc.wins += 1;
                winnerDoc.winStreak += 1;
                winnerDoc.bestWinStreak = Math.max(winnerDoc.bestWinStreak, winnerDoc.winStreak);
                winnerDoc.totalGames += 1;
                loserDoc.elo = eloChanges.loserElo;
                loserDoc.level = calculateLevel(loserDoc.elo);
                loserDoc.losses += 1;
                loserDoc.winStreak = 0;
                loserDoc.totalGames += 1;

                await winnerDoc.save();
                await loserDoc.save();

                await Match.create({
                    player1: p1Doc._id, player2: p2Doc._id, winner: winnerDoc._id,
                    player1EloChange: winnerId === player1Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    player2EloChange: winnerId === player2Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    moves: gameState.moves, duration: Math.floor((Date.now() - room.startTime) / 1000),
                    gameType: 'ranked', isDraw: false
                });
                console.log(`🏆 RANKED Maç bitti: ${winnerDoc.username} kazandı!`);
            } else { // Beraberlik
                p1Doc.draws += 1; p1Doc.totalGames += 1; p1Doc.winStreak = 0;
                p2Doc.draws += 1; p2Doc.totalGames += 1; p2Doc.winStreak = 0;
                await p1Doc.save(); await p2Doc.save();
                await Match.create({
                    player1: p1Doc._id, player2: p2Doc._id, moves: gameState.moves,
                    duration: Math.floor((Date.now() - room.startTime) / 1000), gameType: 'ranked', isDraw: true
                });
                console.log(`🤝 RANKED Maç bitti: Beraberlik.`);
            }
        } else {
            console.log(`🎮 CASUAL Maç bitti.`);
        }

        // Client'a son durum ve sonucu gönder
        const finalMessage = { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: isDraw ? 'Beraberlik' : gameState.players[winnerId].name,
            reason: winnerId === 'DRAW' ? 'blocked' : (room.gameState.status === 'finished' && room.gameState.winner === winnerId ? 'no_tiles' : 'disconnection'), // Sebep düzeltildi
            isRanked: isRankedMatch,
            eloChanges: eloChanges ? {
                myChange: 0 // Placeholder, client'ın kendi tarafındaki değişimi hesaplaması daha kolay
            } : null
        };

        // Her oyuncuya kendi ELO değişimini gönder
        playerIds.forEach(pid => {
            const playerWs = playerConnections.get(pid);
            if (playerWs && isRankedMatch && eloChanges) {
                const isWinner = pid === winnerId;
                const change = isWinner ? eloChanges.winnerChange : eloChanges.loserChange;
                
                finalMessage.eloChanges = { myChange: change };
                sendMessage(playerWs, finalMessage);
            } else {
                sendMessage(playerWs, finalMessage);
            }
            if (playerWs) playerWs.roomCode = null; // Oda kodunu temizle
        });

        rooms.delete(roomCode);
    } catch (error) {
        console.error('❌ Game end error (critical):', error);
        rooms.delete(roomCode);
    }
}

async function handleLeaveGame(ws) {
    if (!ws.playerId) return;
    
    // Oyuncuyu bağlantılardan ve kuyruktan hemen kaldır (Kuyrukta olabilir)
    playerConnections.delete(ws.playerId);
    const qIdx = matchQueue.findIndex(p => p.playerId === ws.playerId);
    if (qIdx !== -1) matchQueue.splice(qIdx, 1);

    // Eğer bir odadaysa, oyunu sonlandır (Bu fonksiyonu bekletmeliyiz)
    if (ws.roomCode && rooms.has(ws.roomCode)) {
        await handlePlayerDisconnection(ws.roomCode, ws.playerId);
    }
    ws.roomCode = null;
    ws.terminate();
}

async function handleDisconnect(ws) {
    if (!ws.playerId) return;

    // Kuyruktan çıkar
    const qIdx = matchQueue.findIndex(p => p.playerId === ws.playerId);
    if (qIdx !== -1) matchQueue.splice(qIdx, 1);

    // Oda bilgisini temizle ve oyunu sonlandır
    if (ws.roomCode && rooms.has(ws.roomCode)) {
        // Asıl işi yapan fonksiyona devret
        await handlePlayerDisconnection(ws.roomCode, ws.playerId);
    }
    
    playerConnections.delete(ws.playerId);
}

async function handlePlayerDisconnection(roomCode, disconnectedPlayerId) {
    const room = rooms.get(roomCode);
    if (!room || room.gameEnded) return;

    if (room.gameState && room.gameState.status === 'playing') {
        const remainingPlayerId = Object.keys(room.gameState.players).find(id => id !== disconnectedPlayerId);
        
        if (remainingPlayerId) {
            console.log(`🏆 Oyuncu ayrıldı. Kazanan: ${room.players[remainingPlayerId].name}`);
            // Kalan oyuncuyu kazanan yap
            await handleGameEnd(roomCode, remainingPlayerId, room.gameState);
        } else {
            console.log(`🗑️ Oda boşaldı ve siliniyor: ${roomCode}`);
            rooms.delete(roomCode);
        }
    } else {
        // Oyun başlamamışsa (Lobi/Arama anında), oyuncuyu odadan çıkar
        delete room.players[disconnectedPlayerId];
        if (Object.keys(room.players).length === 0) {
            rooms.delete(roomCode);
        }
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
