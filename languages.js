// Language strings for the game
const languages = {
    az: {
        languageName: '🇦🇿 Azərbaycanca',
        // Lobby
        enterName: 'Adınızı daxil edin',
        startGame: 'Oyun başlasın',
        joinGame: 'Oyuna qoşul',
        roomCode: 'Otaq kodu',
        // Game
        yourTurn: '✅ SİZİN NÖVBƏNİZ!',
        opponentTurn: '⏳ Rəqibin növbəsi',
        gameStarting: '🎮 Oyun başlayır!',
        selectCards: '📌 Kart seçin',
        gameOver: '🎮 Oyun bitdi!',
        youWon: '🎉 QAZANDIN!',
        youLost: '😔 Məğlub oldun',
        draw: '🤝 Bərabərə',
        nextLevel: 'Növbəti səviyyə',
        // Chat
        send: 'Göndər',
        typeMessage: 'Mesaj yazın...',
        // Messages
        playerLeft: 'Oyuncu ayrıldı',
        waitingForPlayer: 'Oyunçu gözlənilir...',
        bombExploded: 'BOMBA! Partladın!',
        levelStarting: 'Səviyyə başlayır...',
        // UI
        lives: 'Can: {lives}',
        level: 'Səviyyə: {level}',
        opponent: 'Rəqib: {name}',
        roleHost: '🎮 Rol: HOST (Sən başla)',
        roleGuest: '🎮 Rol: QONAQ (Rəqib başlayır)'
    },
    tr: {
        languageName: '🇹🇷 Türkçe',
        // Lobby
        enterName: 'Adınızı girin',
        startGame: 'Oyun Başlasın',
        joinGame: 'Oyuna Katıl',
        roomCode: 'Oda Kodu',
        // Game
        yourTurn: '✅ SIRADA SİZ!',
        opponentTurn: '⏳ RAKİBİN SIRASI',
        gameStarting: '🎮 Oyun Başlıyor!',
        selectCards: '📌 Kart seçin',
        gameOver: '🎮 Oyun Bitti!',
        youWon: '🎉 KAZANDIN!',
        youLost: '😔 KAYBETTİN',
        draw: '🤝 BERABERE',
        nextLevel: 'Sonraki Seviye',
        // Chat
        send: 'Gönder',
        typeMessage: 'Mesaj yazın...',
        // Messages
        playerLeft: 'Oyuncu ayrıldı',
        waitingForPlayer: 'Oyuncu bekleniyor...',
        bombExploded: 'BOMBA! Patladın!',
        levelStarting: 'Seviye başlıyor...',
        // UI
        lives: 'Can: {lives}',
        level: 'Seviye: {level}',
        opponent: 'Rakip: {name}',
        roleHost: '🎮 Rol: EV SAHİBİ (Sen başla)',
        roleGuest: '🎮 Rol: MİSAFİR (Rakip başlar)'
    },
    en: {
        languageName: '🇬🇧 English',
        // Lobby
        enterName: 'Enter your name',
        startGame: 'Start Game',
        joinGame: 'Join Game',
        roomCode: 'Room Code',
        // Game
        yourTurn: '✅ YOUR TURN!',
        opponentTurn: '⏳ OPPONENT\'S TURN',
        gameStarting: '🎮 Game Starting!',
        selectCards: '📌 Select cards',
        gameOver: '🎮 Game Over!',
        youWon: '🎉 YOU WON!',
        youLost: '😔 YOU LOST',
        draw: '🤝 DRAW',
        nextLevel: 'Next Level',
        // Chat
        send: 'Send',
        typeMessage: 'Type a message...',
        // Messages
        playerLeft: 'Player left',
        waitingForPlayer: 'Waiting for player...',
        bombExploded: 'BOOM! You hit a bomb!',
        levelStarting: 'Level starting...',
        // UI
        lives: 'Lives: {lives}',
        level: 'Level: {level}',
        opponent: 'Opponent: {name}',
        roleHost: '🎮 Role: HOST (You start)',
        roleGuest: '🎮 Role: GUEST (Opponent starts)'
    }
};

// Detect user's language based on IP or browser settings
function detectLanguage() {
    // Default to Azerbaijani
    let lang = 'az';
    
    // Try to get from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');
    
    if (langParam && languages[langParam]) {
        return langParam;
    }
    
    // Try to get from browser settings
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang) {
        if (browserLang.startsWith('tr')) {
            lang = 'tr';
        } else if (browserLang.startsWith('en')) {
            lang = 'en';
        }
    }
    
    return lang;
}

// Set language and update UI
let currentLanguage = detectLanguage();

function setLanguage(lang) {
    if (languages[lang]) {
        currentLanguage = lang;
        // Update URL without reloading the page
        const url = new URL(window.location);
        url.searchParams.set('lang', lang);
        window.history.pushState({}, '', url);
        
        // Save to localStorage for persistence
        localStorage.setItem('preferredLanguage', lang);
        
        // Update UI elements
        updateUI();
    }
}

// Get a translated string
function t(key, params = {}) {
    let str = languages[currentLanguage][key] || key;
    
    // Replace placeholders with actual values
    Object.keys(params).forEach(param => {
        str = str.replace(`{${param}}`, params[param]);
    });
    
    return str;
}

// Toggle language selector
function toggleLanguageSelector() {
    const selector = document.getElementById('language-selector');
    if (selector) {
        selector.style.display = selector.style.display === 'block' ? 'none' : 'block';
    }
}

// Close language selector when clicking outside
document.addEventListener('click', (e) => {
    const selector = document.getElementById('language-selector');
    const button = document.getElementById('language-button');
    
    if (selector && button && !selector.contains(e.target) && !button.contains(e.target)) {
        selector.style.display = 'none';
    }
});

// Initialize language from localStorage if available
function initLanguage() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang && languages[savedLang]) {
        currentLanguage = savedLang;
    }
    updateUI();
}

// Update all UI elements with translations
function updateUI() {
    // Update language button
    const langButton = document.getElementById('language-button');
    if (langButton) {
        langButton.textContent = languages[currentLanguage].languageName;
    }
    
    // Update lobby text
    const nameInput = document.getElementById('username');
    const startBtn = document.getElementById('matchBtn');
    const joinBtn = document.getElementById('joinBtn');
    const roomInput = document.getElementById('roomCodeInput');
    
    if (nameInput) nameInput.placeholder = t('enterName');
    if (startBtn) startBtn.textContent = t('startGame');
    if (joinBtn) joinBtn.textContent = t('joinGame');
    if (roomInput) roomInput.placeholder = t('roomCode');
    
    // Update game UI if in game
    updateGameUI();
}

// Update game-specific UI elements
function updateGameUI() {
    if (!document.getElementById('gameScreen')?.classList.contains('active')) return;
    
    // Update turn status
    const turnStatusEl = document.getElementById('turnStatus');
    const actionMessageEl = document.getElementById('actionMessage');
    const opponentNameEl = document.getElementById('opponentName');
    const roleStatusEl = document.getElementById('roleStatus');
    
    if (turnStatusEl) {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        turnStatusEl.textContent = isMyTurn ? t('yourTurn') : t('opponentTurn');
    }
    
    if (actionMessageEl) {
        actionMessageEl.textContent = t('selectCards');
    }
    
    if (opponentNameEl && opponentName) {
        opponentNameEl.textContent = t('opponent', { name: opponentName });
    }
    
    if (roleStatusEl) {
        roleStatusEl.textContent = isHost ? t('roleHost') : t('roleGuest');
    }
    
    // Update chat UI
    const messageInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');
    
    if (messageInput) messageInput.placeholder = t('typeMessage');
    if (sendButton) sendButton.textContent = t('send');
}

// Export functions
window.languageManager = {
    t,
    setLanguage,
    currentLanguage: () => currentLanguage,
    initLanguage,
    updateGameUI
};
