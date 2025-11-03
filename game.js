// Dosya Adı: game.js (TAM VE DÜZELTİLMİŞ VERSİYON)
import { t, updateGameUI } from './languages.js';

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

// --- Genel DOM Referansları (Lobi'den) ---
export const UIElements = {
    usernameInput: document.getElementById('username'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    matchBtn: document.getElementById('matchBtn'),
    globalMessageEl: document.getElementById('globalMessage'),
    globalMessageTextEl: document.getElementById('globalMessageText'),
    resetGame: resetGame,
    showGlobalMessage: showGlobalMessage,
};

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

// OYUN KONFİGÜRASYONU (DÜZELTİLDİ: Level'a göre kart ve bomba sayısı)
const BOMB_COUNTS = {
    1: 3, // Level 1: 3 Bomba
    default: 4 // Level 2 ve sonrası: 4 Bomba
};
const CARD_COUNTS = {
    1: 16, // Level 1: 16 Kart (4x4)
    default: 20 // Level 2 ve sonrası: 20 Kart (5x4)
};
const MAX_LEVEL = 100;

// --- OYUN DURUMU ---
let level = 1; 
let gameStage = 'SELECTION'; // 'SELECTION', 'PLAY', 'WAITING', 'ENDED'
let gameData = {
    board: [], 
    turn: 0,  // 0 = Host, 1 = Guest
    hostLives: 0, 
    guestLives: 0, 
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    openedIndices: new Set(), // Açılan kartların indeksleri
    isGameOver: false
};

// ===========================================
// OYUN MANTIĞI VE UI FONKSİYONLARI
// ===========================================

/**
 * Global mesaj gösterir (Hata veya Bilgi)
 * @param {string} message - Gösterilecek mesaj
 * @param {boolean} isError - True ise kırmızı (hata), false ise varsayılan (yeşil/mavi)
 */
export function showGlobalMessage(message, isError) {
    const el = UIElements.globalMessageEl;
    const textEl = UIElements.globalMessageTextEl;

    textEl.textContent = message;
    el.classList.remove('hidden', 'bg-red-600', 'bg-green-600');
    
    if (isError) {
        el.classList.add('bg-red-600');
        el.classList.add('vibrate'); // Hata durumunda titreşim efekti
    } else {
        el.classList.add('bg-green-600');
    }
    el.classList.add('show');

    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('vibrate');
        }, 300);
    }, 3000);
}

/**
 * Ekranlar arası geçiş yapar
 * @param {string} screenName - 'lobby', 'wait' veya 'game'
 */
export function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    screens[screenName].classList.add('active');
}

/**
 * Oyunun başlangıcında veya seviye atlamada board'u oluşturur.
 * @param {number} currentLevel 
 */
function renderBoard(currentLevel) {
    const boardSize = CARD_COUNTS[currentLevel] || CARD_COUNTS.default;
    const columns = currentLevel === 1 ? 4 : 5; // Level 1: 4x4 (16), Level 2+: 5x4 (20)

    gameBoardEl.innerHTML = '';
    gameBoardEl.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

    for (let i = 0; i < boardSize; i++) {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container';
        cardContainer.dataset.index = i;
        cardContainer.addEventListener('click', handleCardClick);

        const card = document.createElement('div');
        card.className = 'card';

        const front = document.createElement('div');
        front.className = 'card-face front';
        front.textContent = '?';

        const back = document.createElement('div');
        back.className = 'card-face back';
        back.textContent = ''; // İçerik, açıldığında doldurulacak

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        gameBoardEl.appendChild(cardContainer);

        gameData.board[i] = { element: cardContainer, content: '', opened: false };
    }
    console.log(`[RENDER] Board hazırlandı: ${boardSize} kart (${columns}x${boardSize / columns})`);
}

/**
 * Canları ve durumu güncelleyen ana UI fonksiyonu
 */
function updateStatusDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;

    // Canlar
    const renderLives = (lives) => '❤️'.repeat(lives) || '💀';
    myLivesEl.textContent = renderLives(myLives);
    opponentLivesEl.textContent = renderLives(opponentLives);

    // Rakipleri ayarla
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? t('roleHost') : t('roleGuest');

    // Sıra durumu
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameData.isGameOver) {
        turnStatusEl.textContent = t('gameOver');
        turnStatusEl.classList.remove('text-red-600', 'text-green-600', 'animate-pulse');
        turnStatusEl.classList.add('text-gray-900');
    } else {
        turnStatusEl.textContent = isMyTurn ? t('yourTurn') : t('opponentTurn');
        turnStatusEl.classList.remove('text-gray-900', 'animate-pulse');
        turnStatusEl.classList.add(isMyTurn ? 'text-green-600' : 'text-red-600');
        turnStatusEl.classList.add('animate-pulse');
    }
    
    // Mesaj
    if (gameStage === 'PLAY') {
         actionMessageEl.textContent = isMyTurn ? t('selectCards') : t('waitingForPlayer');
    } else if (gameStage === 'ENDED') {
        actionMessageEl.textContent = t('level', { level: level });
    }
    
    updateGameUI(); // languages.js'deki UI güncellemesini tetikler
}


// --- LEVEL VE OYUN BAŞLANGIÇ MANTIĞI ---

/**
 * Oyunun başlangıcı veya seviye atlamada tahta verilerini sıfırlar.
 * @param {number} levelToInit 
 * @param {object} initialData - Sunucudan gelen ilk can/bomba bilgileri
 */
function initializeGame(levelToInit, initialData) {
    level = levelToInit;
    gameData.isGameOver = false;
    gameStage = 'PLAY';

    // Sunucudan gelen canlı verileri kullan
    gameData.hostLives = initialData.hostLives;
    gameData.guestLives = initialData.guestLives;
    gameData.hostBombs = initialData.hostBombs;
    gameData.guestBombs = initialData.guestBombs;
    gameData.turn = initialData.turn; 
    gameData.openedIndices.clear();
    
    const boardSize = CARD_COUNTS[level] || CARD_COUNTS.default;
    gameData.cardsLeft = boardSize;

    // Tahtayı çiz ve durumu güncelle
    renderBoard(level);
    updateStatusDisplay();
    showScreen('game');

    showGlobalMessage(t('levelStarting') + ` (Level ${level})`, false);
    console.log(`[INIT GAME] Level ${level} başlatıldı. Host Bombs: ${gameData.hostBombs.length}, Guest Bombs: ${gameData.guestBombs.length}`);
}


/**
 * Bir kart açıldıktan sonra oyunun seviye tamamlama durumunu kontrol eder.
 */
function checkLevelCompletion(hitBomb = false) {
    // Toplam kart sayısı
    const boardSize = CARD_COUNTS[level] || CARD_COUNTS.default;

    // 1. Durum: Bomba isabeti ve can bitişi (Anlık seviye bitişi)
    if (hitBomb && (gameData.hostLives <= 0 || gameData.guestLives <= 0)) {
        gameData.isGameOver = true;
        
        // Kimin canı bittiyse o kaybetti
        const winner = gameData.hostLives > gameData.guestLives ? 'Host' : 'Guest';
        const selfWon = (isHost && winner === 'Host') || (!isHost && winner === 'Guest');
        
        showGlobalMessage(t('gameOver') + ' ' + (selfWon ? t('youWon') : t('youLost')), !selfWon);
        endGame(selfWon);
        return true; 
    }

    // 2. Durum: Tüm kartlar açıldı
    if (gameData.openedIndices.size === boardSize) {
        // Beraberlik veya sonraki seviyeye geçiş
        gameStage = 'WAITING';
        
        // Host, sunucuya seviye tamamlandığını bildirir
        if (isHost) {
            const nextLevel = level + 1;
            socket.emit('levelComplete', { 
                roomCode: currentRoomCode, 
                level: level, 
                nextLevel: nextLevel > MAX_LEVEL ? MAX_LEVEL : nextLevel 
            });
            showGlobalMessage(t('nextLevel') + ' için bekleniyor...', false);
        } else {
            showGlobalMessage(t('nextLevel') + ' için rakipten onay bekleniyor...', false);
        }
        return true;
    }
    return false;
}

/**
 * Oyunu sonlandırır ve skorları gösterir
 * @param {boolean} selfWon - Kendi kazanıp kazanmadığı
 */
function endGame(selfWon) {
    gameStage = 'ENDED';
    gameData.isGameOver = true;

    updateStatusDisplay();
    // Tüm kartları ters çevir ve bombaları göster
    gameBoardEl.querySelectorAll('.card-container').forEach(container => {
        const card = container.querySelector('.card');
        const index = parseInt(container.dataset.index);
        
        card.classList.add('flipped');
        const back = card.querySelector('.card-face.back');

        // Host'un ve Guest'in tüm bombalarını göster
        let isFinalBomb = false;
        if (gameData.hostBombs.includes(index) && gameData.guestBombs.includes(index)) {
             // Hem Host'un hem Guest'in bombası (Çok nadir)
             back.textContent = '💥';
             isFinalBomb = true;
        } else if (gameData.hostBombs.includes(index)) {
            back.textContent = '💣 (Host)';
            isFinalBomb = true;
        } else if (gameData.guestBombs.includes(index)) {
            back.textContent = '💣 (Guest)';
            isFinalBomb = true;
        }
        
        if (isFinalBomb) {
             back.style.backgroundColor = '#f1c40f'; // Sarı ton
        }
    });

    // Sonuç mesajı
    const message = selfWon ? t('youWon') : t('youLost');
    showGlobalMessage(t('gameOver') + ' - ' + message, !selfWon);

    // 5 saniye sonra lobiye dön (veya yeniden başlatma butonu gösterilebilir)
    setTimeout(resetGame, 10000); 
}

/**
 * Oyun durumunu sıfırlar ve lobiye döner
 */
function resetGame() {
    if (socket) {
        socket.disconnect(); // Sunucu bağlantısını kes
    }
    level = 1;
    gameStage = 'SELECTION';
    currentRoomCode = '';
    isHost = false;
    gameBoardEl.innerHTML = '';
    showScreen('lobby');
    UIElements.roomCodeInput.value = '';
    showGlobalMessage(t('gameStarting'), false);
    // Sayfanın yeniden yüklenmesini sağlamak için tam bir yeniden bağlanma mantığı uygulanmalıdır
    // Basitlik için sadece ekranı değiştiriyoruz.
}


// --- HAMLE MANTIĞI ---

/**
 * Kart tıklama işleyicisi (yalnızca kendi sıranızdayken)
 * @param {Event} e 
 */
function handleCardClick(e) {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    if (!isMyTurn) {
        playSound(audioWait);
        showGlobalMessage(t('opponentTurn'), true); // Rakibinizin sırası
        return;
    }

    let targetContainer = e.currentTarget;
    const cardIndex = parseInt(targetContainer.dataset.index);
    
    // Zaten açılmış kartı engelle
    if (gameData.openedIndices.has(cardIndex)) {
        return;
    }

    // Kartı görsel olarak bomba olarak işaretle (Sadece kendi ekranınızda geçici)
    targetContainer.classList.add('bomb-selected');
    
    // Sunucuya hamleyi gönder
    socket.emit('gameData', {
        type: 'MOVE',
        roomCode: currentRoomCode,
        cardIndex: cardIndex
    });
    
    // Geçici olarak tahtayı kilitle (Hamle sunucudan geri gelene kadar)
    gameStage = 'WAITING';
}

/**
 * Sunucudan gelen hamle verilerini uygular
 * @param {object} data - Hamle verileri { cardIndex, emoji, isBomb }
 */
function applyMove(data) {
    const { cardIndex, emoji, isBomb } = data;
    const isPlayerHost = gameData.turn === 0; // Hamleyi yapan player'ın rolü
    
    const cardContainer = gameBoardEl.querySelector(`.card-container[data-index="${cardIndex}"]`);
    if (!cardContainer) return;
    
    const card = cardContainer.querySelector('.card');
    const back = card.querySelector('.card-face.back');
    
    // Görsel efektleri temizle/uygula
    cardContainer.classList.remove('bomb-selected');
    card.classList.add('flipped');
    back.textContent = emoji;
    
    gameData.openedIndices.add(cardIndex);

    // Bomba isabeti varsa canı düşür
    if (isBomb) {
        playSound(audioBomb);
        showGlobalMessage(t('bombExploded'), true);

        // Can kaybeden taraf, sırası gelenin rakibidir
        if (isPlayerHost) { 
             // Host oynadı, Guest'in bombasına bastı -> Guest can kaybeder (Host turn 0)
             gameData.guestLives = Math.max(0, gameData.guestLives - 1);
        } else {
             // Guest oynadı, Host'un bombasına bastı -> Host can kaybeder (Guest turn 1)
             gameData.hostLives = Math.max(0, gameData.hostLives - 1);
        }
    } else {
        playSound(audioEmoji);
    }
    
    // Sırayı değiştir (Sunucu zaten bu bilgiyi gönderir, ancak client side state'i güncelleyelim)
    gameData.turn = isPlayerHost ? 1 : 0; 
    
    // Oyunu aç (Sıra değişti)
    gameStage = 'PLAY'; 
    
    updateStatusDisplay();

    // Seviye tamamlama kontrolü (Bomba isabeti canı 0'a düşürdüyse veya tüm kartlar açıldıysa)
    checkLevelCompletion(isBomb);
}

// ===========================================
// SOCKET İŞLEYİCİLERİ
// ===========================================

/**
 * Socket olay dinleyicilerini ayarlar.
 * @param {Socket} newSocket 
 * @param {string} code 
 * @param {boolean} isHostRole 
 * @param {string} oppName 
 */
export function setupSocketHandlers(newSocket, code, isHostRole, oppName) {
    socket = newSocket;
    currentRoomCode = code;
    isHost = isHostRole;
    opponentName = oppName;
    level = 1; 

    // Server'dan oyunun hazır olduğunu belirten sinyal (Level 1 başlangıcı veya yeni level)
    socket.on('gameReady', (gameState) => {
        console.log("Sunucudan gameReady alındı:", gameState);
        // Level bilgisi sunucudan gelmediği için client side'daki level'ı kullanıyoruz
        initializeGame(level, gameState); 
    });

    // Server'dan hamle verisi
    socket.on('gameData', (data) => {
        if (data.type === 'MOVE') {
            applyMove(data);
        }
    });

    // Server'dan seviye tamamlama sinyali
    socket.on('levelComplete', ({ completedLevel, nextLevel }) => {
        showGlobalMessage(t('nextLevel') + 'e geçiliyor...', false);
        console.log(`[LEVEL END] Seviye ${completedLevel} tamamlandı. Hazırlanıyor: ${nextLevel}`);
    });

    // Server'dan yeni seviye bilgisi
    socket.on('newLevel', (data) => {
        // Yeni seviye bilgisini kaydet (level 2, 3, ...)
        level = data.level;
        gameData.hostLives = data.hostLives;
        gameData.guestLives = data.guestLives;
        console.log(`[NEW LEVEL] Yeni seviye bilgisi alındı: Level ${level}`);
        // gameReady sinyali yeni bombalarla tekrar gönderilecek ve initializeGame çağrılacak.
        showGlobalMessage(t('levelStarting') + ` (Level ${level})`, false);
    });

    // Rakip ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message, true);
        resetGame();
    });

    // Genel hata
    socket.on('error', (message) => {
        showGlobalMessage(`Hata: ${message}`, true);
    });
    
    // UI güncellemelerini tetikle
    updateStatusDisplay();
}

// Socket handler'larını diğer modüllere aç (index.html'in içindeki script tag'i kullanıyor)
export { setupSocketHandlers, showScreen };
