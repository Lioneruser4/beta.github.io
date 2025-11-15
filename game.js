// Dosya Adı: game.js
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';

// --- DOM Referansları ---
const screens = { 
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen') 
};
const gameBoardEl = document.getElementById('gameBoard');
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const myLivesEl = document.getElementById('myLives');
const opponentLivesEl = document.getElementById('opponentLives');
const opponentNameEl = document.getElementById('opponentName');
const roleStatusEl = document.getElementById('roleStatus');
const scoreDisplayEl = document.getElementById('scoreDisplay'); // Skor göstergesi

// SESLER
const audioBomb = new Audio('sound1.mp3'); 
const audioEmoji = new Audio('sound2.mp3');
const audioWait = new Audio('sound3.mp3'); 

// Lag-free Sound Playback Function
function playSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {});
}

// Oyun tahtasını başlat
function initializeBoard() {
    // 20 kartlık oyun tahtası oluştur
    gameBoard = Array(20).fill(null);
    gameStage = 'PLAY';
    
    // Oyun tahtasını oluştur
    const gameBoardHTML = gameBoard.map((_, index) => `
        <div class="card" data-index="${index}">
            <div class="card-inner">
                <div class="card-front"></div>
                <div class="card-back">?</div>
            </div>
        </div>
    `).join('');
    
    gameBoardEl.innerHTML = gameBoardHTML;
    
    // Kartlara tıklama olaylarını ekle
    document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => handleCardClick(card.dataset.index));
    });
    
    updateStatusDisplay();
}

// --- OYUN DURUMU ---
const BOARD_SIZE = 20; // 20 kartlık oyun tahtası
let gameStage = 'WAITING'; // 'WAITING', 'PLAY', 'GAME_OVER'
let gameBoard = [];

// Oyun durumu
let gameData = {
    board: [],
    turn: 0,  // 0 = Host, 1 = Guest
    hostLives: 3,
    guestLives: 3,
    cardsLeft: 20,
    hostBombs: [],
    guestBombs: [],
    isGameOver: false,
    scores: { host: 0, guest: 0 },
    opened: [] // Açılan kartların indeksleri
};

// Tüm cihazlarda güvenle çalışacak emojiler
const EMOTICONS = [
    '😀', // Gülümseyen yüz
    '😊', // Gözleri kapalı gülümseyen yüz
    '😎', // Güneş gözlüklü yüz
    '😍', // Kalp gözlü yüz
    '😜', // Dil çıkaran yüz
    '😇', // Halo melek yüzü
    '😴', // Uyuyan yüz
    '😷', // Maske takan yüz
    '🤖', // Robot
    '👻', // Hayalet
    '👽', // Uzaylı
    '🤡', // Palyaço
    '🔥',
    '🌊',
    '🌚',
    '😺',
    '🌼' 
];

// --- TEMEL UI FONKSİYONLARI ---

export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    const globalMessageText = document.getElementById('globalMessageText');
    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.remove('hidden');
    globalMessage.classList.add('show');
    setTimeout(() => { globalMessage.classList.add('hidden'); globalMessage.classList.remove('show'); }, 4000);
}

// Skor tablosunu güncelle
function updateScoreDisplay() {
    const scoreDisplay = document.getElementById('scoreDisplay');
    const playerName = document.getElementById('telegramUsername')?.textContent || 'SEN';
    const opponentName = document.getElementById('opponentName')?.textContent || 'RAKİP';
    
    if (scoreDisplay) {
        scoreDisplay.innerHTML = `
            <div class="flex justify-center items-center gap-4">
                <div class="text-center min-w-[100px]">
                    <div class="font-bold text-xs text-gray-300 truncate">${isHost ? playerName : opponentName}</div>
                    <div class="text-2xl font-bold ${isHost ? 'text-green-400' : 'text-white'}">${isHost ? scores.host : scores.guest}</div>
                </div>
                <div class="text-xl font-bold">-</div>
                <div class="text-center min-w-[100px]">
                    <div class="font-bold text-xs text-gray-300 truncate">${!isHost ? playerName : opponentName}</div>
                    <div class="text-2xl font-bold ${!isHost ? 'text-green-400' : 'text-white'}">${!isHost ? scores.host : scores.guest}</div>
                </div>
            </div>
        `;
        scoreDisplay.style.display = 'block';
    }
}

// --- OYUN MANTIĞI VE ÇİZİM ---

function drawBoard() {
    // Oyun tahtası zaten initializeBoard'da oluşturuldu
    updateStatusDisplay();
}

function handleCardClick(index) {
    if (gameStage !== 'PLAY' || gameData.opened.includes(parseInt(index))) return;
    
    // Sıra kontrolü
    if ((isHost && gameData.turn !== 0) || (!isHost && gameData.turn !== 1)) {
        showGlobalMessage('Sıra sizde değil!', true);
        return;
    }
    
    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (!card) return;
    
    // Kartı çevir
    card.classList.add('flipped');
    
    // Hamleyi sunucuya gönder
    sendMove(parseInt(index));
}

function sendMove(cardIndex) {
    if (!socket) return;
    
    socket.emit('gameData', {
        type: 'MOVE',
        cardIndex: cardIndex,
        roomCode: currentRoomCode
    });
}

function applyMove(index, emoji, isBomb) {
    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (!card) return;
    
    // Kartı aç
    card.classList.add('flipped');
    gameData.opened.push(parseInt(index));
    
    // Arka yüze emojiyi yerleştir
    const cardBack = card.querySelector('.card-back');
    cardBack.textContent = emoji;
    
    // Eğer bomba ise can azalt
    if (isBomb) {
        if (isHost) {
            gameData.hostLives--;
            playSound(audioBomb);
        } else {
            gameData.guestLives--;
            playSound(audioBomb);
        }
    } else {
        playSound(audioEmoji);
    }
    
    // Sırayı değiştir
    gameData.turn = gameData.turn === 0 ? 1 : 0;
    
    // Oyun durumunu güncelle
    updateStatusDisplay();
    
    // Oyun bitiş kontrolü
    checkGameEnd();
}

function checkGameEnd() {
    if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
        gameStage = 'GAME_OVER';
        const winner = gameData.hostLives <= 0 ? 'guest' : 'host';
        endGame(winner);
    }
}

function endGame(winner) {
    gameStage = 'GAME_OVER';
    const isWinner = (winner === 'host' && isHost) || (winner === 'guest' && !isHost);
    
    actionMessageEl.textContent = isWinner ? 'Kazandınız! 🎉' : 'Kaybettiniz! 😢';
    actionMessageEl.className = isWinner ? 'win' : 'lose';
    
    // 3 saniye sonra yeni oyun başlat
    setTimeout(() => {
        if (isHost) {
            socket.emit('levelComplete', {
                roomCode: currentRoomCode,
                level: 1, // Varsayılan seviye
                nextLevel: 1
            });
        }
    }, 3000);
}

// --- ANIMASYON VE SES ---

async function triggerWaitAndVibrate() {
    if (gameData.cardsLeft < 8 && gameStage === 'PLAY') { 
        startVibration();
        await new Promise(resolve => setTimeout(resolve, 2000));
        stopVibration();
    }
}

function startVibration() {
    const cardContainers = gameBoardEl.querySelectorAll('.card-container');
    cardContainers.forEach(container => {
        const card = container.querySelector('.card');
        if (card && !card.classList.contains('flipped')) {
            card.classList.add('vibrate');
        }
    });
    playSound(audioWait);
}

function stopVibration() {
    const cardContainers = gameBoardEl.querySelectorAll('.card-container');
    cardContainers.forEach(container => {
        const card = container.querySelector('.card');
        if (card) {
            card.classList.remove('vibrate');
        }
    });
    audioWait.pause();
    audioWait.currentTime = 0;
}

// --- HAREKET İŞLEYİCİLERİ ---

// Kart tıklama işleyicisi (handleCellClick yerine kullanılacak)
function handleCardClick(index) {
    if (gameStage !== 'PLAY' || gameData.opened.includes(parseInt(index))) return;
    
    // Sıra kontrolü
    if ((isHost && gameData.turn !== 0) || (!isHost && gameData.turn !== 1)) {
        showGlobalMessage('Sıra sizde değil!', true);
        return;
    }
    
    // Hamleyi sunucuya gönder
    if (socket && socket.connected) {
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: parseInt(index)
        });
    }
}

// --- SON ---

// Yükleme mesajını göster/gizle fonksiyonları
function showLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        console.log('🔵 Yükleme mesajı gösteriliyor');
        loadingMessage.classList.remove('hidden');
        loadingMessage.classList.add('show');
        loadingMessage.style.display = 'flex';
    }
}

function hideLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        console.log('🔴 Yükleme mesajı gizleniyor');
        loadingMessage.classList.remove('show');
        loadingMessage.classList.add('hidden');
        // 300ms sonra tamamen gizle (CSS geçişi için süre)
        setTimeout(() => {
            loadingMessage.style.display = 'none';
        }, 300);
    }
}

// Sayfa yüklendiğinde yükleme mesajını göster
document.addEventListener('DOMContentLoaded', () => {
    showLoadingMessage();
});

// Basit bir ping endpoint'i ekleyelim
export function setupPingEndpoint(app) {
    app.get('/ping', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.status(200).json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            server: 'KartBomBot Server',
            version: '1.0.0'
        });
    });
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!', { roomCode, isHost: host, opponent: opponentNameFromIndex });
    
    // Show loading message when setting up socket handlers
    console.log('📡 Yükleme mesajı gösteriliyor...');
    showLoadingMessage();
    
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "🎮 Rol: HOST (Sen başla)" : "🎮 Rol: GUEST (Rakip başlar)";

    // Oyun başlatılıyor
    level = 1; // Yeni oyuna başlarken seviyeyi 1'e sıfırla
    
    // İlk seviye için board boyutunu ayarla (16 kart ile başla)
    const boardSize = LEVELS[level - 1]; // İlk seviye 16 kart
    initializeGame(boardSize);
    
    // Can sayılarını server'dan gelen bilgiyle güncelle
    socket.once('gameReady', ({ hostBombs, guestBombs }) => {
        // Seviyeye göre can sayılarını ayarla
        if (level === 1) {
            gameData.hostLives = 3;
            gameData.guestLives = 3;
        } else {
            gameData.hostLives = 4;
            gameData.guestLives = 4;
        }
        updateStatusDisplay();
    });
    
    drawBoard();
    showScreen('game');
    showGlobalMessage(`🎮 Oyun ${opponentName} ile başladı! 🚀 Bombalar yerleştiriliyor...`, false);
    
    console.log('📡 Socket dinleyicileri kuruluyor...');
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Bağlantı durumunu dinle
    socket.on('connect', () => {
        console.log('✅ Sunucuya bağlandı');
        // Oyun hazır olduğunda gizlenecek
    });

    // Bağlantı hatası olduğunda
    socket.on('connect_error', (error) => {
        console.error('❌ Sunucu bağlantı hatası:', error);
        showGlobalMessage('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.', true);
        hideLoadingMessage();
    });

    // Oyun Başlasın! (Bombalar otomatik seçildi)
    socket.on('gameReady', (gameState) => {
        console.log('🎮 Oyun hazır, yükleme mesajı kaldırılıyor...');
        // Oyun hazır olduğunda yükleme mesajını gizle
        hideLoadingMessage();
        
        // Ekstra güvenlik için 2 saniye sonra tekrar kontrol et
        setTimeout(() => {
            const loadingMessage = document.getElementById('loadingMessage');
            if (loadingMessage && !loadingMessage.classList.contains('hidden')) {
                console.log('🔄 Yükleme mesajı hala görünür, tekrar kaldırılıyor...');
                loadingMessage.classList.add('hidden');
                loadingMessage.style.display = 'none';
            }
        }, 2000);
        console.log('🚀 gameReady EVENT ALINDI!', gameState);
        
        // Oyun durumunu güncelle
        gameData.hostBombs = gameState.hostBombs || [];
        gameData.guestBombs = gameState.guestBombs || [];
        // Server'dan gelen can değerlerini kullan
        gameData.hostLives = gameState.hostLives || (level === 1 ? 3 : 4);
        gameData.guestLives = gameState.guestLives || (level === 1 ? 3 : 4);
        gameData.turn = gameState.turn || 0;
        
        // Skor bilgilerini güncelle
        if (gameState.scores) {
            gameData.scores = gameState.scores;
        }
        if (gameState.hostName) {
            gameData.hostName = gameState.hostName;
        }
        if (gameState.guestName) {
            gameData.guestName = gameState.guestName;
        }
        
        gameStage = 'PLAY';
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Level ${level} Başladı! ${gameData.hostLives} bomba ile oynanıyor.`, false);
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Digər Levelə Geçilir:', data);
        
        // Seviye bilgisini güncelle
        level = parseInt(data.level) || 1;
        
        // Oyun durumunu sıfırla ve yeni canları ayarla
        gameData = {
            board: [],
            turn: 0, // Host başlar
            hostLives: data.hostLives,
            guestLives: data.guestLives,
            cardsLeft: data.boardSize, // Server'dan gelen kart sayısını kullan
            hostBombs: [], 
            guestBombs: [],
            isGameOver: false
        };
        
        gameStage = 'PLAY';
        
        // Skor ve isim bilgilerini güncelle
        if (data.scores) {
            gameData.scores = data.scores;
        }
        if (data.hostName) {
            gameData.hostName = data.hostName;
        }
        if (data.guestName) {
            gameData.guestName = data.guestName;
        }
        
        // Yeni oyun tahtasını oluştur
        initializeGame(data.boardSize);
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        showGlobalMessage(`🎮 Seviye ${level} başladı! ${data.hostLives} can ile oynanıyor.`, false);
    });

    // gameData Olayı (Hamle Geldi - Kendi veya Rakip)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            // Server tarafından onaylanmış hamleyi uygula (emoji ve bomba bilgisi ile)
            applyMove(data.cardIndex, data.emoji, data.isBomb); 
        }
    });

    // Hata mesajları için dinleyici
    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rəqibiniz Oyundan Çıxdı. Lobiye gedilir.', true);
        resetGame();
    });
}

export function resetGame() {
    // Tüm oyun ayarlarını sıfırlar ve lobiye döner (En güvenli yol: Sayfayı yenilemek)
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz (index.html'in kullanması için)
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
