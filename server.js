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
    elo: { type: Number, default: 1000 }, // Varsayılan ELO 1000 yapıldı
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
    gameType: { type: String, enum: ['ranked', 'private', 'friendly'], default: 'ranked' },
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
                photoUrl,
                elo: 1000
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
                elo: player.elo,
                level: player.level,
                wins: player.wins
            }
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Domino WebSocket Server',
        players: playerConnections.size,
        rooms: rooms.size,
        queue: matchQueue.length
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

// OYUN BAŞLATMA MANTIĞI (DÜZELTİLDİ)
function initializeGame(roomCode, player1Obj, player2Obj) {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14); // Kalan taşlar pazar

    const player1Id = player1Obj.telegramId;
    const player2Id = player2Obj.telegramId;

    // En yüksek çifti bul (6|6, 5|5, ...)
    let startingPlayer = player1Id;
    let highestDouble = -1;
    
    // Player 1 kontrol
    for (let tile of player1Hand) {
        if (tile[0] === tile[1] && tile[0] > highestDouble) {
            highestDouble = tile[0];
            startingPlayer = player1Id;
        }
    }
    // Player 2 kontrol
    for (let tile of player2Hand) {
        if (tile[0] === tile[1] && tile[0] > highestDouble) {
            highestDouble = tile[0];
            startingPlayer = player2Id;
        }
    }
    
    // Eğer kimsede çift yoksa, en yüksek toplamlı taşı olan başlar
    if (highestDouble === -1) {
        // Basitlik için rastgele seçelim veya elindeki en yüksek taş
        startingPlayer = Math.random() < 0.5 ? player1Id : player2Id;
    }

    // Oda yapısını oluştur
    const room = {
        code: roomCode,
        players: [player1Obj, player2Obj], // Oyuncu objelerini sakla
        spectators: [],
        gameState: {
            board: [],
            players: {
                [player1Id]: { hand: player1Hand, name: player1Obj.username, wins: 0 },
                [player2Id]: { hand: player2Hand, name: player2Obj.username, wins: 0 }
            },
            market: market,
            currentPlayer: startingPlayer,
            turn: 1,
            lastMove: null,
            startingDouble: highestDouble
        }
    };

    rooms.set(roomCode, room);
    console.log(`🎮 Oyun başlatıldı Oda: ${roomCode} - Başlayan: ${startingPlayer}`);
    
    // Oyuncuların bağlantı bilgilerini güncelle
    playerConnections.set(player1Obj.ws, { playerId: player1Id, roomCode });
    playerConnections.set(player2Obj.ws, { playerId: player2Id, roomCode });

    return room.gameState;
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

function sendMessage(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(message)); } catch (e) {}
    }
}

function sendGameState(roomCode, playerId) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    // Odadaki ilgili oyuncuyu bul
    const playerObj = room.players.find(p => p.telegramId === playerId);
    if (!playerObj || !playerObj.ws) return;

    try {
        playerObj.ws.send(JSON.stringify({
            type: 'gameUpdate',
            gameState: { ...room.gameState, playerId: playerId }
        }));
    } catch (error) { console.error(error); }
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws) => {
    ws.isAlive = true;
    const connectionId = uuidv4();

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'findMatch': handleFindMatch(ws, data); break;
                case 'cancelSearch': handleCancelSearch(ws); break;
                // Oyun içi hamleler buraya eklenebilir (playTile, draw vs.)
            }
        } catch (error) {
            console.error('Hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));
    sendMessage(ws, { type: 'connected', message: 'Sunucuya bağlandınız' });
});


// --- MATCHMAKING (DÜZELTİLMİŞ) ---

async function handleFindMatch(ws, data) {
    try {
        const { telegramId, isGuest = false, gameType = 'ranked' } = data;
        
        // 1. Önceki kuyruk girişlerini temizle
        const existingQueueIndex = matchQueue.findIndex(p => p.ws === ws || p.telegramId === telegramId);
        if (existingQueueIndex !== -1) {
            matchQueue.splice(existingQueueIndex, 1);
        }
        
        // 2. Oyuncu zaten bir odada mı kontrol et
        for (const [code, room] of rooms.entries()) {
            const existingPlayer = room.players.find(p => p.telegramId === telegramId);
            if (existingPlayer) {
                existingPlayer.ws = ws; // WS güncelle
                playerConnections.set(ws, { playerId: telegramId, roomCode: code });
                sendMessage(ws, { type: 'reconnect', roomCode: code });
                return sendGameState(code, telegramId);
            }
        }
        
        // 3. Oyuncu objesini oluştur
        const player = {
            ws,
            telegramId,
            isGuest,
            gameType, // ÖNEMLİ: Oyun türünü kaydediyoruz
            elo: 1000,
            username: isGuest ? `Misafir_${Math.floor(Math.random() * 1000)}` : 'Oyuncu',
            searchStartTime: Date.now()
        };

        // DB'den gerçek verileri çek
        if (!isGuest) {
            const dbPlayer = await Player.findOne({ telegramId });
            if (dbPlayer) {
                player.elo = dbPlayer.elo || 1000;
                player.username = dbPlayer.username;
            }
        }

        console.log(`🔍 Eşleşme aranıyor: ${player.username} (${gameType}) - ELO: ${player.elo}`);
        
        // 4. Eşleşme Kontrolü
        const matchIndex = matchQueue.findIndex(p => {
            // Kendi kendine eşleşme olmasın
            if (p.telegramId === player.telegramId) return false;
            
            // Oyun türü (Ranked/Friendly) aynı olmalı!
            if (p.gameType !== player.gameType) return false;
            
            // Guest vs Telegram ayrımı (İsteğe bağlı, ranked için guest engellenebilir)
            if (gameType === 'ranked') {
                if (p.isGuest || player.isGuest) return false; // Ranked sadece kayıtlı üyeler
                
                // ELO Farkı kontrolü (Örn: +- 300 puan)
                const eloDiff = Math.abs(p.elo - player.elo);
                if (eloDiff > 300) return false;
            }
            
            return true;
        });

        if (matchIndex !== -1) {
            // EŞLEŞME BULUNDU!
            const opponent = matchQueue[matchIndex];
            matchQueue.splice(matchIndex, 1); // Rakibi kuyruktan sil

            console.log(`✅ Eşleşme Başarılı: ${player.username} vs ${opponent.username}`);
            
            const roomCode = generateRoomCode();
            
            // Oyunu başlat ve odayı kur
            const gameState = initializeGame(roomCode, player, opponent);
            
            // İki oyuncuya da bildir
            sendMessage(player.ws, { 
                type: 'matchFound', 
                roomCode,
                color: 'blue',
                opponent: { username: opponent.username, elo: opponent.elo }
            });
            
            sendMessage(opponent.ws, { 
                type: 'matchFound', 
                roomCode,
                color: 'red',
                opponent: { username: player.username, elo: player.elo }
            });

            // İlk oyun durumunu gönder
            setTimeout(() => {
                sendGameState(roomCode, player.telegramId);
                sendGameState(roomCode, opponent.telegramId);
            }, 500);

        } else {
            // Eşleşme bulunamadı, kuyruğa ekle
            matchQueue.push(player);
            sendMessage(ws, { 
                type: 'searchStatus', 
                message: `${gameType === 'ranked' ? 'Dereceli' : 'Normal'} maç aranıyor...`,
                queueLength: matchQueue.length
            });
        }

    } catch (error) {
        console.error('Match error:', error);
        sendMessage(ws, { type: 'error', message: 'Eşleşme hatası' });
    }
}

function handleCancelSearch(ws) {
    const index = matchQueue.findIndex(p => p.ws === ws);
    if (index !== -1) {
        matchQueue.splice(index, 1);
        sendMessage(ws, { type: 'searchCancelled', message: 'Arama iptal edildi' });
    }
}

function handleDisconnect(ws) {
    // Kuyruktan sil
    handleCancelSearch(ws);

    // Aktif oyun kontrolü
    const connection = playerConnections.get(ws);
    if (connection) {
        const { roomCode, playerId } = connection;
        const room = rooms.get(roomCode);
        
        if (room) {
            // Rakibe bildir
            const otherPlayer = room.players.find(p => p.telegramId !== playerId);
            if (otherPlayer && otherPlayer.ws) {
                sendMessage(otherPlayer.ws, {
                    type: 'opponentDisconnected',
                    message: 'Rakip bağlantısı koptu. Oyunu kazandınız.'
                });
                // Ranked ise burada ELO güncellemeleri yapılmalı (veritabanı işlemleri)
            }
            rooms.delete(roomCode);
        }
        playerConnections.delete(ws);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
