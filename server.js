const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- Sabitler ---
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino_game?retryWrites=true&w=majority';
const ADMIN_TELEGRAM_ID = '976640409'; // YÖNETİCİ ID'si

// --- MongoDB Bağlantısı ve Modeller (Aynı Kaldı) ---
// (Player ve Match Schemaları önceki mesajdaki gibi tanımlanmıştır)
// ...
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB bağlantısı başarılı'))
.catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

const playerSchema = new mongoose.Schema({ /* ... */ });
const matchSchema = new mongoose.Schema({ /* ... */ });
const Player = mongoose.model('DominoPlayer', playerSchema);
const Match = mongoose.model('DominoMatch', matchSchema);

// --- ELO ve Level Hesaplama (Aynı Kaldı) ---
function calculateElo(winnerElo, loserElo, winnerLevel) { /* ... */ }
function calculateLevel(elo) { /* ... */ }

// --- WebSocket Game State (Aynı Kaldı) ---
const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map();
const playerToRoomMap = new Map();

// --- Yeni Middleware: Admin Kontrolü ---
function isAdmin(req, res, next) {
    // Gerçek bir sistemde bu kontrol Auth token ile yapılmalıdır. 
    // Telegram ID'yi header'dan almak yerine body'den alıp kontrol edeceğiz.
    // Ancak API'ler client tarafından çağrıldığı için, şimdilik basit bir kontrol yapıyoruz.
    // Client, admin isteği gönderdiğinde kendi Telegram ID'sini payload'da göndermelidir.

    // Şimdilik sadece Admin ID'sini server'a sabit tanımladık.
    // Güvenlik için, bu API'ye sadece Admin'in WebApp'i içinden gelen ve onaylanmış token'ı olan istekler izin vermelidir.
    if (req.body && req.body.requesterId === ADMIN_TELEGRAM_ID) {
        next();
    } else {
        res.status(403).json({ success: false, error: 'Yetkisiz erişim.' });
    }
}

// --- DÜZELTİLMİŞ/EKLENMİŞ API Endpoints ---

// 1. Leaderboard API'si
app.get('/api/leaderboard', async (req, res) => {
    try {
        const players = await Player.find({ isHidden: { $ne: true } }) // Gizli olmayanları getir
            .sort({ elo: -1, wins: -1, totalGames: 1 }) // ELO, Win sayısı, Toplam oyun sırası
            .limit(10)
            .select('telegramId username firstName photoUrl elo level wins totalGames');
        
        res.json({ success: true, leaderboard: players });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, error: 'Sunucu hatası: Skorlar alınamadı' });
    }
});

// 2. Admin API: Kullanıcı Arama
app.get('/api/admin/user/:telegramId', async (req, res) => {
    try {
        const targetId = req.params.telegramId;
        const user = await Player.findOne({ telegramId: targetId }).select('-__v');
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
        }
        
        res.json({ success: true, user });
    } catch (error) {
        console.error('Admin user search error:', error);
        res.status(500).json({ success: false, error: 'Sunucu hatası' });
    }
});

// 3. Admin API: ELO Ayarlama (POST)
app.post('/api/admin/setElo', async (req, res) => {
    // Admin kontrolü client'ta yapıldı. Server'da bu yetkiyi kontrol etmek gerekir.
    // Şimdilik client'ın admin olduğunu varsayıyoruz (Güvenlik zafiyeti).
    const { targetId, value, requesterId } = req.body;
    
    if (requesterId !== ADMIN_TELEGRAM_ID) return res.status(403).json({ success: false, error: 'Yetkisiz.' });
    
    if (!targetId || typeof value !== 'number' || value < 0) {
        return res.status(400).json({ success: false, error: 'Geçersiz veri.' });
    }

    try {
        const user = await Player.findOneAndUpdate(
            { telegramId: targetId },
            { $set: { 
                elo: value,
                level: calculateLevel(value)
            }},
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
        }

        res.json({ success: true, message: `Kullanıcı ${targetId} ELO'su ${value} olarak ayarlandı.`, user });
    } catch (error) {
        console.error('Admin setElo error:', error);
        res.status(500).json({ success: false, error: 'Sunucu hatası.' });
    }
});

// 4. Admin API: Gizle/Göster (POST)
app.post('/api/admin/setHidden', async (req, res) => {
    const { targetId, value, requesterId } = req.body;

    if (requesterId !== ADMIN_TELEGRAM_ID) return res.status(403).json({ success: false, error: 'Yetkisiz.' });

    if (!targetId || typeof value !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Geçersiz veri.' });
    }

    try {
        const user = await Player.findOneAndUpdate(
            { telegramId: targetId },
            { $set: { isHidden: value }},
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı.' });
        }

        const status = value ? 'Gizli' : 'Açık';
        res.json({ success: true, message: `Kullanıcı ${targetId} skor tablosunda ${status} olarak ayarlandı.`, user });
    } catch (error) {
        console.error('Admin setHidden error:', error);
        res.status(500).json({ success: false, error: 'Sunucu hatası.' });
    }
});

// --- WebSocket Server (Aynı Kaldı) ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: false, clientTracking: true });
// ... wss.on('connection') ve diğer WebSocket event'leri (Önceki mesajdakiyle aynı) ...
// ... handleFindMatch, initializeGame, handlePlayTile, handleDrawFromMarket, handlePass, handleLeaveGame (Önceki mesajdaki DÜZELTİLMİŞ mantıkla aynı kalmalıdır) ...

// Server'ı başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server çalışıyor: Port ${PORT}`);
});
