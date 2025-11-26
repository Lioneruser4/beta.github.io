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
const playerSessions = new Map(); // telegramId -> player data

// Oda durumunu MongoDB'ye kaydetme ve yükleme
async function saveRoomToDatabase(roomCode, roomData) {
    try {
        const RoomState = mongoose.model('RoomState', new mongoose.Schema({
            roomCode: { type: String, required: true, unique: true },
            players: [{
                playerId: String,
                ws: String, // WebSocket ID placeholder
                playerName: String,
                telegramId: String,
                level: Number,
                elo: Number,
                photoUrl: String,
                isGuest: Boolean,
                hand: [[Number]], // Domino tiles
                connected: Boolean
            }],
            gameState: {
                board: [[Number]],
                currentPlayer: String,
                market: [[Number]],
                gameStarted: Boolean,
                gameType: String,
                createdAt: Date,
                lastMove: Date
            },
            createdAt: { type: Date, default: Date.now },
            updatedAt: { type: Date, default: Date.now }
        }, { collection: 'room_states' }));
        
        await RoomState.findOneAndUpdate(
            { roomCode },
            { 
                roomCode,
                players: roomData.players.map(p => ({
                    playerId: p.playerId,
                    ws: '',
                    playerName: p.playerName,
                    telegramId: p.telegramId,
                    level: p.level,
                    elo: p.elo,
                    photoUrl: p.photoUrl,
                    isGuest: p.isGuest,
                    hand: p.hand || [],
                    connected: true
                })),
                gameState: roomData.gameState,
                updatedAt: new Date()
            },
            { upsert: true, new: true }
        );
        
        console.log(`💾 Oda ${roomCode} veritabanına kaydedildi`);
    } catch (error) {
        console.error('❌ Oda kaydetme hatası:', error);
    }
}

async function loadRoomFromDatabase(roomCode) {
    try {
        const RoomState = mongoose.model('RoomState', new mongoose.Schema({
            roomCode: String,
            players: [mongoose.Schema.Types.Mixed],
            gameState: mongoose.Schema.Types.Mixed,
            createdAt: Date,
            updatedAt: Date
        }), { collection: 'room_states' });
        
        const roomData = await RoomState.findOne({ roomCode });
        if (roomData) {
            console.log(`📂 Oda ${roomCode} veritabanından yüklendi`);
            return roomData;
        }
        return null;
    } catch (error) {
        console.error('❌ Oda yükleme hatası:', error);
        return null;
    }
}

async function deleteRoomFromDatabase(roomCode) {
    try {
        const RoomState = mongoose.model('RoomState', new mongoose.Schema({}, { collection: 'room_states' }));
        await RoomState.deleteOne({ roomCode });
        console.log(`🗑️ Oda ${roomCode} veritabanından silindi`);
    } catch (error) {
        console.error('❌ Oda silme hatası:', error);
    }
}

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

app.get('/api/reset-all-elo', async (req, res) => {
    try {
        // Tüm oyuncuların ELO puanlarını sıfırla
        await Player.updateMany(
            {}, 
            { 
                elo: 0, 
                level: 1,
                wins: 0,
                losses: 0,
                draws: 0,
                totalGames: 0,
                winStreak: 0,
                bestWinStreak: 0
            }
        );
        
        // Tüm maçları sil
        await Match.deleteMany({});
        
        console.log('🔄 Tüm ELO puanları ve istatistikler sıfırlandı!');
        res.json({ success: true, message: 'Tüm ELO puanları sıfırlandı' });
    } catch (error) {
        console.error('ELO sıfırlama hatası:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// ELO sıfırlama komutu
app.get('/api/reset-elo-simple', async (req, res) => {
    try {
        console.log('🔄 ELO sıfırlama başlatılıyor...');
        
        // Tüm oyuncuların ELO puanlarını sıfırla
        const result = await Player.updateMany(
            {}, 
            { 
                $set: {
                    elo: 0, 
                    level: 1,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    totalGames: 0,
                    winStreak: 0,
                    bestWinStreak: 0
                }
            }
        );
        
        // Tüm maçları sil
        await Match.deleteMany({});
        
        console.log(`✅ ${result.modifiedCount} oyuncunun ELO puanları sıfırlandı!`);
        res.json({ success: true, message: `${result.modifiedCount} oyuncunun ELO puanları sıfırlandı` });
    } catch (error) {
        console.error('ELO sıfırlama hatası:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin Paneli - Sadece Admin ID: 976640409
app.get('/admin', (req, res) => {
    const adminId = '976640409';
    
    // Admin ID kontrolü
    if (req.query.id !== adminId) {
        return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Access Denied</title>
                <style>
                    body { font-family: Arial; padding: 50px; background: #1a1a2e; color: white; text-align: center; }
                    .error-box { background: #e94560; padding: 30px; border-radius: 10px; max-width: 400px; margin: 0 auto; }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <h1>🚫 Access Denied</h1>
                    <p>Bu sayfaya erişim izniniz yok!</p>
                    <p>Admin ID gerekli.</p>
                </div>
            </body>
            </html>
        `);
    }
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Domino Admin Panel</title>
            <style>
                body { font-family: Arial; padding: 20px; background: #1a1a2e; color: white; }
                .container { max-width: 800px; margin: 0 auto; }
                .card { background: #16213e; padding: 20px; margin: 10px 0; border-radius: 10px; }
                .btn { background: #0f3460; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 5px; }
                .btn:hover { background: #533483; }
                .danger { background: #e94560; }
                .danger:hover { background: #c23652; }
                input { padding: 10px; margin: 5px; border-radius: 5px; border: none; width: 200px; }
                .admin-info { background: #0f3460; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: center; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="admin-info">
                    <h2>🔐 Admin Paneli</h2>
                    <p>Admin ID: ${adminId}</p>
                </div>
                <h1>🎮 Domino Admin Panel</h1>
                <div class="card">
                    <h2>⚙️ ELO Yönetimi</h2>
                    <button class="btn danger" onclick="resetElo()">🔄 Tüm ELO Puanlarını Sıfırla</button>
                    <button class="btn" onclick="resetStats()">📊 İstatistikleri Sıfırla</button>
                </div>
                <div class="card">
                    <h2>👥 Kullanıcı Yönetimi</h2>
                    <input type="text" id="telegramId" placeholder="Telegram ID">
                    <button class="btn danger" onclick="deleteUser()">🗑️ Kullanıcıyı Sil</button>
                    <button class="btn" onclick="resetUserElo()">🔄 Kullanıcı ELO Sıfırla</button>
                </div>
                <div class="card">
                    <h2>📊 Sistem Durumu</h2>
                    <button class="btn" onclick="checkStatus()">🔍 Durum Kontrol</button>
                    <div id="status"></div>
                </div>
            </div>
            <script>
                async function resetElo() {
                    if (confirm('Tüm ELO puanlarını sıfırlamak istediğinizden emin misiniz?')) {
                        const response = await fetch('/admin/reset-all-elo');
                        const result = await response.json();
                        alert(result.message);
                    }
                }
                async function resetStats() {
                    if (confirm('Tüm istatistikleri sıfırlamak istediğinizden emin misiniz?')) {
                        const response = await fetch('/admin/reset-all-stats');
                        const result = await response.json();
                        alert(result.message);
                    }
                }
                async function deleteUser() {
                    const telegramId = document.getElementById('telegramId').value;
                    if (!telegramId) { alert('Telegram ID girin'); return; }
                    if (confirm(telegramId + ' ID'li kullanıcıyı silmek istediğinizden emin misiniz?')) {
                        const response = await fetch('/admin/delete-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ telegramId })
                        });
                        const result = await response.json();
                        alert(result.message);
                    }
                }
                async function resetUserElo() {
                    const telegramId = document.getElementById('telegramId').value;
                    if (!telegramId) { alert('Telegram ID girin'); return; }
                    if (confirm(telegramId + ' ID'li kullanıcının ELO puanını sıfırlamak istediğinizden emin misiniz?')) {
                        const response = await fetch('/admin/reset-user-elo', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ telegramId })
                        });
                        const result = await response.json();
                        alert(result.message);
                    }
                }
                async function checkStatus() {
                    const response = await fetch('/admin/status');
                    const result = await response.json();
                    document.getElementById('status').innerHTML = 
                        '<p>👥 Bağlı Oyuncu: ' + result.players + '</p>' +
                        '<p>🏠 Aktif Oda: ' + result.rooms + '</p>' +
                        '<p>🔍 Arama Kuyruğu: ' + result.queue + '</p>';
                }
            </script>
        </body>
        </html>
    `;
    res.send(htmlContent);
});

// Admin API'leri
app.post('/admin/reset-all-elo', async (req, res) => {
    try {
        const result = await Player.updateMany({}, { $set: { elo: 0, level: 1 } });
        console.log(`🔄 Admin: ${result.modifiedCount} oyuncunun ELO puanları sıfırlandı`);
        res.json({ success: true, message: `${result.modifiedCount} oyuncunun ELO puanları sıfırlandı` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Hata: ' + error.message });
    }
});

app.post('/admin/reset-all-stats', async (req, res) => {
    try {
        await Player.updateMany({}, { 
            $set: { elo: 0, level: 1, wins: 0, losses: 0, draws: 0, totalGames: 0, winStreak: 0, bestWinStreak: 0 }
        });
        await Match.deleteMany({});
        res.json({ success: true, message: 'Tüm istatistikler sıfırlandı' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Hata: ' + error.message });
    }
});

app.post('/admin/delete-user', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const result = await Player.deleteOne({ telegramId });
        await Match.deleteMany({ $or: [{ player1: result._id }, { player2: result._id }] });
        res.json({ success: true, message: `Kullanıcı ${telegramId} silindi` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Hata: ' + error.message });
    }
});

app.post('/admin/reset-user-elo', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const result = await Player.updateOne({ telegramId }, { $set: { elo: 0, level: 1 } });
        res.json({ success: true, message: `Kullanıcı ${telegramId} ELO puanı sıfırlandı` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Hata: ' + error.message });
    }
});

app.get('/admin/status', (req, res) => {
    res.json({
        players: playerConnections.size,
        rooms: rooms.size,
        queue: matchQueue.length
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
    saveRoomToDatabase(roomCode, room);
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
    // 1. Bir oyuncunun eli boş mu kontrol et
    for (const playerId in gameState.players) {
        if (gameState.players[playerId].hand.length === 0) {
            console.log(`🏆 ${playerId} kazandı - eli boş!`);
            return { winner: playerId, reason: 'empty_hand' };
        }
    }

    const playerIds = Object.keys(gameState.players);
    if (playerIds.length < 2) return null;
    
    const player1Id = playerIds[0];
    const player2Id = playerIds[1];
    const player1Hand = gameState.players[player1Id].hand;
    const player2Hand = gameState.players[player2Id].hand;

    // 2. Pazarda taş var mı ve herkes oynayabiliyor mu kontrol et
    const marketEmpty = !gameState.market || gameState.market.length === 0;
    const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
    const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

    // Pazar boşsa VE kimse oynayamıyorsa oyun bitmeli
    if (marketEmpty && (!player1CanPlay || !player2CanPlay)) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        console.log(`🔒 Oyun kapandı - Pazar boş, oynanabilir taş yok`);
        console.log(`📊 Puanlar: ${player1Id}: ${player1Sum}, ${player2Id}: ${player2Sum}`);
        
        if (player1Sum === player2Sum) {
            return { winner: 'DRAW', reason: 'points_equal', player1Sum, player2Sum };
        }
        const winner = player1Sum < player2Sum ? player1Id : player2Id;
        return { winner, reason: 'points', player1Sum, player2Sum };
    }

    // Pazar dolu ama kimse oynayamıyorsa (normal oyun durumu)
    if (!player1CanPlay && !player2CanPlay) {
        const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        
        console.log(`🔒 Oyun kapandı - İki oyuncu da oynayamaz`);
        console.log(`📊 Puanlar: ${player1Id}: ${player1Sum}, ${player2Id}: ${player2Sum}`);
        
        if (player1Sum === player2Sum) {
            return { winner: 'DRAW', reason: 'points_equal', player1Sum, player2Sum };
        }
        const winner = player1Sum < player2Sum ? player1Id : player2Id;
        return { winner, reason: 'points', player1Sum, player2Sum };
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
                case 'reconnectToRoom': handleReconnectToRoom(ws, data); break;
                case 'playTile': handlePlayTile(ws, data); break;
                case 'drawFromMarket': handleDrawFromMarket(ws); break;
                case 'forceDisconnect': handleForceDisconnect(ws, data); break;
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' });
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
    ws.telegramId = data.telegramId || null; // null ise guest
    ws.photoUrl = data.photoUrl || null;
    ws.level = data.level || 0; // 0 = guest
    ws.elo = data.elo || 0; // 0 = guest
    ws.isGuest = !data.telegramId; // Telegram yoksa guest
    
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
        saveRoomToDatabase(roomCode, room);
        p1.ws.roomCode = roomCode;
        p2.ws.roomCode = roomCode;

        const gameState = initializeGame(roomCode, p1.playerId, p2.playerId);

        sendMessage(p1.ws, { type: 'matchFound', roomCode, opponent: room.players[p2.playerId], gameType });
        sendMessage(p2.ws, { type: 'matchFound', roomCode, opponent: room.players[p1.playerId], gameType });

        // CRITICAL FIX: Send gameStart immediately to both players
        setTimeout(() => {
            const gameStartMsg = { type: 'gameStart', gameState: { ...gameState, playerId: p1.playerId } };
            sendMessage(p1.ws, gameStartMsg);
            
            const gameStartMsg2 = { type: 'gameStart', gameState: { ...gameState, playerId: p2.playerId } };
            sendMessage(p2.ws, gameStartMsg2);
            
            console.log(`✅ Oyun başladı: ${roomCode}`);
        }, 500);
    } else {
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        console.log(`❌ ${ws.playerName} aramayı iptal etti - Kalan: ${matchQueue.length}`);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function handleReconnectToRoom(ws, data) {
    const { roomCode, playerName } = data;
    
    if (!roomCode) {
        return sendMessage(ws, { type: 'error', message: 'Oda kodu gerekli' });
    }

    // Önce veritabanından oda durumunu kontrol et
    loadRoomFromDatabase(roomCode).then(async (savedRoom) => {
        let room = rooms.get(roomCode);
        
        if (savedRoom && !room) {
            // Sunucu restart olmuş, odayı veritabanından geri yükle
            console.log(`🔄 Oda ${roomCode} veritabanından geri yükleniyor (reconnect)...`);
            
            room = {
                host: savedRoom.players[0]?.playerId || 'host',
                players: {},
                gameState: savedRoom.gameState || { board: [], currentPlayer: null, market: [], gameStarted: false },
                type: savedRoom.gameState?.gameType || 'private'
            };
            
            // Oyuncuları geri ekle (WebSocket bağlantıları olmadan)
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
            });
            
            rooms.set(roomCode, room);
            saveRoomToDatabase(roomCode, room);
        }
        
        room = rooms.get(roomCode);
        if (!room) {
            return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı' });
        }

        // Yeni playerId oluştur
        const playerId = generateRoomCode();
        ws.playerId = playerId;
        ws.playerName = playerName || 'Player';
        ws.roomCode = roomCode;
        playerConnections.set(playerId, ws);
        
        // Eğer bu oyuncu odada daha önce varsa, onu güncelle
        let existingPlayer = null;
        for (const existingId in room.players) {
            if (room.players[existingId].name === ws.playerName) {
                existingPlayer = room.players[existingId];
                // Eski oyuncuyu sil ve yenisini ekle
                delete room.players[existingId];
                break;
            }
        }
        
        // Oyuncuyu odaya ekle
        room.players[playerId] = { 
            name: ws.playerName,
            telegramId: existingPlayer?.telegramId || null,
            level: existingPlayer?.level || 0,
            elo: existingPlayer?.elo || 0,
            photoUrl: existingPlayer?.photoUrl || null,
            isGuest: existingPlayer?.isGuest || true,
            hand: existingPlayer?.hand || []
        };

        console.log(`🔄 ${ws.playerName} odaya geri bağlandı: ${roomCode}`);
        
        // Oyun durumunu gönder
        if (room.gameState && room.gameState.gameStarted) {
            // Oyuncunun IDsini gameState'e ekle
            const gameStateWithPlayer = { ...room.gameState, playerId };
            
            setTimeout(() => {
                sendMessage(ws, { 
                    type: 'reconnectedToRoom', 
                    gameState: gameStateWithPlayer,
                    playerId: playerId
                });
                
                // Diğer oyunculara bildir
                Object.keys(room.players).forEach(pid => {
                    if (pid !== playerId) {
                        const otherWs = playerConnections.get(pid);
                        if (otherWs) {
                            sendGameState(roomCode, pid);
                        }
                    }
                });
            }, 500);
        } else {
            sendMessage(ws, { type: 'error', message: 'Oyun bulunamadı' });
        }
    });
}

function handleCreateRoom(ws, data) {
    const roomCode = generateRoomCode();
    const playerId = generateRoomCode();
    ws.playerId = playerId;
    ws.playerName = data.playerName;
    ws.roomCode = roomCode;
    playerConnections.set(playerId, ws);

    rooms.set(roomCode, {
        code: roomCode,
        players: { [playerId]: { name: data.playerName } },
        type: 'private',
        host: playerId
    });

    sendMessage(ws, { type: 'roomCreated', roomCode });
}

function handleJoinRoom(ws, data) {
    // Önce veritabanından oda durumunu kontrol et
    loadRoomFromDatabase(data.roomCode).then(async (savedRoom) => {
        let room = rooms.get(data.roomCode);
        
        if (savedRoom && !room) {
            // Sunucu restart olmuş, odayı veritabanından geri yükle
            console.log(`🔄 Oda ${data.roomCode} veritabanından geri yükleniyor...`);
            
            room = {
                host: savedRoom.players[0]?.playerId || 'host',
                players: {},
                gameState: savedRoom.gameState || { board: [], currentPlayer: null, market: [], gameStarted: false },
                type: savedRoom.gameState?.gameType || 'private'
            };
            
            // Oyuncuları geri ekle (WebSocket bağlantıları olmadan)
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
            });
            
            rooms.set(data.roomCode, room);
            saveRoomToDatabase(data.roomCode, room);
        }
        
        room = rooms.get(data.roomCode);
        if (!room || Object.keys(room.players).length >= 2) {
            return sendMessage(ws, { type: 'error', message: 'Oda bulunamadı veya dolu' });
        }

        const playerId = generateRoomCode();
        ws.playerId = playerId;
        ws.playerName = data.playerName;
        ws.roomCode = data.roomCode;
        playerConnections.set(playerId, ws);
        
        room.players[playerId] = { 
            name: data.playerName || data.firstName || 'Player',
            firstName: data.firstName || data.playerName || 'Player',
            telegramId: data.telegramId,
            level: data.level || 0, 
            elo: data.elo || 0,
            photoUrl: data.photoUrl,
            isGuest: !data.telegramId,
            hand: []
        };

        const hostId = room.host;
        
        // Eğer oyun zaten başlamışsa, oyun durumunu gönder
        if (room.gameState && room.gameState.gameStarted) {
            // Yeni gelen oyuncuya mevcut oyun durumunu gönder
            setTimeout(() => {
                sendGameState(data.roomCode, hostId);
                sendGameState(data.roomCode, playerId);
                
                ws.send(JSON.stringify({ 
                    type: 'gameStart', 
                    gameState: {...room.gameState, playerId: playerId} 
                }));
            }, 500);
        } else {
            // Yeni oyun başlat
            const gameState = initializeGame(data.roomCode, hostId, playerId);
            
            setTimeout(() => {
                sendGameState(data.roomCode, hostId);
                sendGameState(data.roomCode, playerId);
                // Herkese oyunun başladığını bildir
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

    if (!tile) return;

    const boardCopy = JSON.parse(JSON.stringify(gs.board));
    const success = playTileOnBoard(tile, gs.board, data.position);

    if (!success) {
        return sendMessage(ws, { type: 'error', message: 'Bu hamle geçersiz (Pozisyon uyuşmuyor)' });
    }

    player.hand.splice(data.tileIndex, 1);
    gs.moves = (gs.moves || 0) + 1;
    gs.lastMove = new Date();
    
    // Oda durumunu veritabanına kaydet
    if (room) {
        saveRoomToDatabase(ws.roomCode, room);
    }
    
    const winner = checkWinner(gs);
    if (winner) {
        // Oyun sonu bildirimini tüm oyunculara gönder
        broadcastToRoom(ws.roomCode, { 
            type: 'gameEnding', 
            reason: winner.reason,
            message: winner.reason === 'empty_hand' ? 'Oyun bitti - Bir oyuncunun eli boş!' :
                     winner.reason === 'points' ? 'Oyun kapandı - Taşlar hesaplanıyor...' :
                     winner.reason === 'points_equal' ? 'Oyun kapandı - Beraberlik! Taşlar hesaplanıyor...' :
                     'Oyun bitti!',
            player1Sum: winner.player1Sum,
            player2Sum: winner.player2Sum
        });
        
        // 3 saniye bekle ve oyunu bitir
        setTimeout(() => {
            handleGameEnd(ws.roomCode, winner, gs);
        }, 3000);
    } else {
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

async function handleGameEnd(roomCode, winnerResult, gameState) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const winnerId = winnerResult.winner;
    const reason = winnerResult.reason;
    
    try {
        const playerIds = Object.keys(gameState.players);
        const player1Id = playerIds[0];
        const player2Id = playerIds[1];

        const isDraw = winnerId === 'DRAW';
        let eloChanges = null;

        // Guest kontrolu - Guest varsa ELO guncellemesi yapma
        const player1IsGuest = room.players[player1Id].isGuest;
        const player2IsGuest = room.players[player2Id].isGuest;
        const isRankedMatch = room.type === 'ranked' && !player1IsGuest && !player2IsGuest;

        if (isRankedMatch) {
            // Her iki oyuncu da Telegram ile girdi - ELO guncelle
            const player1 = await Player.findOne({ telegramId: room.players[player1Id].telegramId });
            const player2 = await Player.findOne({ telegramId: room.players[player2Id].telegramId });

            if (!player1 || !player2) {
                console.error('❌ Oyuncular MongoDB\'de bulunamadı');
                broadcastToRoom(roomCode, { 
                    type: 'gameEnd', 
                    winner: winnerId, 
                    winnerName: isDraw ? 'Beraberlik' : gameState.players[winnerId].name,
                    reason: reason,
                    isRanked: false,
                    startTime: room.startTime
                });
                deleteRoomFromDatabase(roomCode);
                rooms.delete(roomCode);
                return;
            }

            if (!isDraw) {
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

                const match = new Match({
                    player1: player1._id,
                    player2: player2._id,
                    winner: winner._id,
                    player1Elo: winnerId === player1Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player2Elo: winnerId === player2Id ? eloChanges.winnerElo : eloChanges.loserElo,
                    player1EloChange: winnerId === player1Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    player2EloChange: winnerId === player2Id ? eloChanges.winnerChange : eloChanges.loserChange,
                    moves: gameState.moves || 0,
                    duration: Math.floor((Date.now() - room.startTime) / 1000),
                    gameType: 'ranked',
                    isDraw: false
                });
                await match.save();

                console.log(`🏆 RANKED Maç bitti: ${winner.firstName || winner.username} kazandı! ELO: ${eloChanges.winnerChange > 0 ? '+' : ''}${eloChanges.winnerChange}`);
            } else {
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

                const match = new Match({
                    player1: player1._id,
                    player2: player2._id,
                    player1Elo: player1.elo,
                    player2Elo: player2.elo,
                    player1EloChange: 0,
                    player2EloChange: 0,
                    moves: gameState.moves || 0,
                    duration: Math.floor((Date.now() - room.startTime) / 1000),
                    gameType: 'ranked',
                    isDraw: true
                });
                await match.save();
            }
        } else {
            // Casual (Guest) maç - ELO guncellenmez
            console.log(`🎮 CASUAL Maç bitti: ${isDraw ? 'Beraberlik' : gameState.players[winnerId].name}`);
        }

        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: isDraw ? 'Beraberlik' : (gameState.players[winnerId].firstName || gameState.players[winnerId].name),
            reason: reason,
            player1Sum: winnerResult.player1Sum,
            player2Sum: winnerResult.player2Sum,
            isRanked: isRankedMatch,
            eloChanges: eloChanges ? {
                winner: eloChanges.winnerChange,
                loser: eloChanges.loserChange
            } : null,
            startTime: room.startTime,
            players: {
                [player1Id]: {
                    name: room.players[player1Id].firstName || room.players[player1Id].name,
                    photoUrl: room.players[player1Id].photoUrl
                },
                [player2Id]: {
                    name: room.players[player2Id].firstName || room.players[player2Id].name,
                    photoUrl: room.players[player2Id].photoUrl
                }
            }
        });
        
        // Odayı hemen silme, 3 saniye bekle
        setTimeout(() => {
            deleteRoomFromDatabase(roomCode);
            rooms.delete(roomCode);
        }, 3000);
    } catch (error) {
        console.error('❌ Game end error:', error);
        broadcastToRoom(roomCode, { 
            type: 'gameEnd', 
            winner: winnerId, 
            winnerName: winnerId === 'DRAW' ? 'Beraberlik' : gameState.players[winnerId].name,
            reason: reason,
            isRanked: false,
            startTime: room?.startTime
        });
        setTimeout(() => {
            rooms.delete(roomCode);
        }, 3000);
    }
}

function handleForceDisconnect(ws, data) {
    const { roomCode, playerName } = data;
    
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Oyuncuyu bul ve çıkar
    for (const playerId in room.players) {
        if (room.players[playerId].name === playerName || room.players[playerId].firstName === playerName) {
            const remainingPlayerId = Object.keys(room.players).find(id => id !== playerId);
            
            if (remainingPlayerId) {
                const remainingPlayer = room.players[remainingPlayerId];
                const remainingWs = playerConnections.get(remainingPlayerId);
                
                if (remainingWs) {
                    // Level'e göre ELO belirle
                    const playerLevel = remainingPlayer.level || 1;
                    let eloChange;
                    
                    if (playerLevel <= 5) {
                        eloChange = Math.floor(Math.random() * 6) + 15; // 15-20 arası
                    } else {
                        eloChange = Math.floor(Math.random() * 6) + 10; // 10-15 arası
                    }
                    
                    // Anında oyun bitirme lobisi gönder
                    remainingWs.send(JSON.stringify({
                        type: 'gameEnd',
                        winner: remainingPlayerId,
                        winnerName: remainingPlayer.firstName || remainingPlayer.name,
                        reason: 'opponent_left',
                        isRanked: !remainingPlayer.isGuest,
                        eloChanges: {
                            winner: eloChange,
                            loser: 0
                        },
                        startTime: room.startTime,
                        players: {
                            [remainingPlayerId]: {
                                name: remainingPlayer.firstName || remainingPlayer.name,
                                photoUrl: remainingPlayer.photoUrl
                            },
                            [playerId]: {
                                name: playerName,
                                photoUrl: null
                            }
                        }
                    }));
                    
                    console.log(`🏆 ${remainingPlayer.name} rakip ayrıldığı için kazandı! +${eloChange} ELO`);
                }
            }
            
            // Odayı sil
            deleteRoomFromDatabase(roomCode);
            rooms.delete(roomCode);
            break;
        }
    }
}

function handlePass(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return;

    const playerHand = gs.players[ws.playerId].hand;
    const canPlay = playerHand.some(tile => canPlayTile(tile, gs.board));

    if (canPlay) {
        return sendMessage(ws, { type: 'error', message: 'Elinizde oynanabilir taş var, pas geçemezsiniz!' });
    }

    gs.turn++;
    gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
    
    const winner = checkWinner(gs);
    if (winner) {
        broadcastToRoom(ws.roomCode, { 
            type: 'gameEnd', 
            winner, 
            winnerName: winner === 'DRAW' ? 'Beraberlik' : gs.players[winner].name 
        });
        deleteRoomFromDatabase(ws.roomCode);
        rooms.delete(ws.roomCode);
    } else {
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
    }
}

function handleDrawFromMarket(ws) {
    const room = rooms.get(ws.roomCode);
    if (!room || !room.gameState) return;

    const gs = room.gameState;
    if (gs.currentPlayer !== ws.playerId) return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil' });

    const player = gs.players[ws.playerId];
    
    // Pazarda taş var mı?
    if (!gs.market || gs.market.length === 0) {
        // Pazar boş, otomatik sıra geç
        console.log(`🎲 ${player.name} pazardan çekemedi (boş) - Sıra geçiyor`);
        gs.turn++;
        gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
        return;
    }

    // Pazardan taş çek
    const drawnTile = gs.market.shift();
    player.hand.push(drawnTile);
    
    console.log(`🎲 ${player.name} pazardan taş çekti: [${drawnTile}] - Kalan: ${gs.market.length}`);
    
    // Çekilen taş oynanabilir mi kontrol et
    const canPlayDrawn = canPlayTile(drawnTile, gs.board);
    
    if (!canPlayDrawn) {
        // Oynanamıyor, tekrar çekmeli mi yoksa sıra geçmeli mi?
        // Domino kurallarına göre: Oynanabilir taş bulana kadar çeker
        const hasPlayable = player.hand.some(tile => canPlayTile(tile, gs.board));
        
        if (!hasPlayable && gs.market.length > 0) {
            // Hala oynanabilir taş yok ve pazar doluysa, oyuncu tekrar çekebilir
            sendMessage(ws, { type: 'info', message: 'Taş oynanamıyor, tekrar çekin veya bekleyin' });
        } else if (!hasPlayable && gs.market.length === 0) {
            // Pazar bitti ve hala oynanabilir taş yok - sıra geç
            console.log(`❌ ${player.name} oynanabilir taş bulamadı - Sıra geçiyor`);
            gs.turn++;
            gs.currentPlayer = Object.keys(gs.players).find(id => id !== ws.playerId);
        }
    }
    
    Object.keys(gs.players).forEach(pid => sendGameState(ws.roomCode, pid));
}

function handleDisconnect(ws) {
    console.log(`🔌 Oyuncu ayrıldı: ${ws.playerName || 'Bilinmeyen'}`);
    
    if (ws.playerId) playerConnections.delete(ws.playerId);
    
    const qIdx = matchQueue.findIndex(p => p.ws === ws);
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı - Kalan: ${matchQueue.length}`);
    }

    if (ws.roomCode) {
        console.log(`🏠 Odadan ayrıldı: ${ws.roomCode}`);
        
        // Oyuncu odadan ayrıldığında diğer oyuncuya kazanç ver
        const room = rooms.get(ws.roomCode);
        if (room && room.players) {
            // players object formatında çalış
            const remainingPlayerId = Object.keys(room.players).find(playerId => playerId !== ws.playerId);
            if (remainingPlayerId) {
                const remainingPlayer = room.players[remainingPlayerId];
                const remainingWs = playerConnections.get(remainingPlayerId);
                
                if (remainingWs && remainingWs.readyState === WebSocket.OPEN) {
                    // Level'e göre ELO belirle
                    const playerLevel = remainingPlayer.level || 1;
                    let eloChange;
                    
                    if (playerLevel <= 5) {
                        eloChange = Math.floor(Math.random() * 6) + 15; // 15-20 arası
                    } else {
                        eloChange = Math.floor(Math.random() * 6) + 10; // 10-15 arası
                    }
                    
                    // Anında oyun bitirme lobisi gönder
                    remainingWs.send(JSON.stringify({
                        type: 'gameEnd',
                        winner: remainingPlayerId,
                        winnerName: remainingPlayer.firstName || remainingPlayer.name,
                        reason: 'opponent_left',
                        isRanked: !remainingPlayer.isGuest,
                        eloChanges: {
                            winner: eloChange,
                            loser: 0
                        },
                        startTime: room.startTime,
                        players: {
                            [remainingPlayerId]: {
                                name: remainingPlayer.firstName || remainingPlayer.name,
                                photoUrl: remainingPlayer.photoUrl
                            },
                            [ws.playerId]: {
                                name: ws.firstName || ws.playerName,
                                photoUrl: ws.photoUrl
                            }
                        }
                    }));
                    
                    console.log(`🏆 ${remainingPlayer.name} rakip ayrıldığı için kazandı! +${eloChange} ELO`);
                    
                    // ELO puanını veritabanında güncelle
                    if (!remainingPlayer.isGuest) {
                        Player.findOne({ telegramId: remainingPlayer.telegramId }).then(player => {
                            if (player) {
                                player.elo += eloChange;
                                player.level = calculateLevel(player.elo);
                                player.wins += 1;
                                player.winStreak += 1;
                                player.bestWinStreak = Math.max(player.bestWinStreak, player.winStreak);
                                player.totalGames += 1;
                                player.lastPlayed = new Date();
                                player.save();
                                console.log(`💾 ELO güncellendi: ${player.firstName || player.username} +${eloChange}`);
                            }
                        }).catch(err => console.error('ELO güncelleme hatası:', err));
                    }
                }
            }
        }
        
        broadcastToRoom(ws.roomCode, { type: 'playerDisconnected' });
        deleteRoomFromDatabase(ws.roomCode);
        rooms.delete(ws.roomCode);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
