// Dosya Adı: language.js
// Language strings for the game
const languages = {
    az: {
        languageName: '🇦🇿 Azərbaycanca',
        // Menu
        gameTitle: '2 OYUN 1 UCUZ',
        selectGame: 'Oyun Seçin',
        memoryGame: '💣 BOMBA KARTLARI (Hafıza)',
        pongGame: '🏓 PİNG PONG (Sürətli Çubuğ)',
        // Lobby
        enterName: 'İstifadəçi Adınızı Daxil Edin',
        startGame: '✅ Otaq Qur',
        joinGame: '➕ Otağa Bağlan',
        roomCode: 'Otaq Kodu (Boş buraxın=Yeni Otaq)',
        // Game (Memory)
        yourTurn: '✅ SİZİN NÖVBƏNİZ!',
        opponentTurn: '⏳ Rəqibin növbəsi',
        gameStarting: '🎮 Oyun başlayır!',
        selectCards: '📌 Kart seçin',
        gameOver: '🎮 Oyun bitdi!',
        youWon: '🎉 QAZANDIN!',
        youLost: '😔 Məğlub oldun',
        draw: '🤝 Bərabərə',
        nextLevel: 'Növbəti səviyyə',
        // Pong 
        pongGameStatus: 'Rəqib: {name}', 
        // Chat
        send: 'Göndər',
        typeMessage: 'Mesaj yazın...',
        // Messages
        playerLeft: 'Oyuncu ayrıldı. Menüye dönülür...',
        waitingForPlayer: 'Oyunçu gözlənilir...',
        bombExploded: 'BOMBA! Partladın!',
        levelStarting: 'Səviyyə {level} başlayır, {lives} can ilə...',
        // UI
        lives: '{lives}',
        level: 'Səviyyə: {level}',
        opponent: 'Rəqib: {name}',
        roleHost: '🎮 Rol: HOST (Sən başla)',
        roleGuest: '🎮 Rol: QONAQ (Rəqib başlayır)'
    },
    tr: {
        languageName: '🇹🇷 Türkçe',
        // Menu
        gameTitle: '2 OYUN 1 FİYATINA',
        selectGame: 'Oyun Seçin',
        memoryGame: '💣 BOMBA KARTLARI (Hafıza)',
        pongGame: '🏓 PİNG PONG (Hızlı Raket)',
        // Lobby
        enterName: 'Kullanıcı Adınızı Girin',
        startGame: '✅ Oda Kur',
        joinGame: '➕ Odaya Bağlan',
        roomCode: 'Oda Kodu (Boş Bırakın=Yeni Oda)',
        // Game (Memory)
        yourTurn: '✅ SIRADA SİZ!',
        opponentTurn: '⏳ RAKİBİN SIRASI',
        gameStarting: '🎮 Oyun Başlıyor!',
        selectCards: '📌 Kart seçin',
        gameOver: '🎮 Oyun Bitti!',
        youWon: '🎉 KAZANDIN!',
        youLost: '😔 KAYBETTİN',
        draw: '🤝 BERABERE',
        nextLevel: 'Sonraki Seviye',
        // Pong
        pongGameStatus: 'Rakip: {name}', 
        // Chat
        send: 'Gönder',
        typeMessage: 'Mesaj yazın...',
        // Messages
        playerLeft: 'Oyuncu ayrıldı. Menüye dönülüyor...',
        waitingForPlayer: 'Oyuncu bekleniyor...',
        bombExploded: 'BOMBA! Patladın!',
        levelStarting: 'Seviye {level} başlıyor, {lives} can ile...',
        // UI
        lives: '{lives}',
        level: 'Seviye: {level}',
        opponent: 'Rakip: {name}',
        roleHost: '🎮 Rol: EV SAHİBİ (Sen başla)',
        roleGuest: '🎮 Rol: MİSAFİR (Rakip başlar)'
    },
    en: {
        languageName: '🇬🇧 English',
        // Menu
        gameTitle: '2 GAMES FOR 1',
        selectGame: 'Select Game',
        memoryGame: '💣 BOMB CARDS (Memory)',
        pongGame: '🏓 PING PONG (Fast Paddle)',
        // Lobby
        enterName: 'Enter Your Username',
        startGame: '✅ Create Room',
        joinGame: '➕ Join Room',
        roomCode: 'Room Code (Leave Blank=New Room)',
        // Game (Memory)
        yourTurn: '✅ YOUR TURN!',
        opponentTurn: '⏳ OPPONENT\'S TURN',
        gameStarting: '🎮 Game Starting!',
        selectCards: '📌 Select cards',
        gameOver: '🎮 Game Over!',
        youWon: '🎉 YOU WON!',
        youLost: '😔 YOU LOST',
        draw: '🤝 DRAW',
        nextLevel: 'Next Level',
        // Pong
        pongGameStatus: 'Opponent: {name}', 
        // Chat
        send: 'Send',
        typeMessage: 'Type a message...',
        // Messages
        playerLeft: 'Player left. Returning to menu...',
        waitingForPlayer: 'Waiting for player...',
        bombExploded: 'BOOM! You hit a bomb!',
        levelStarting: 'Level {level} starting with {lives} lives...',
        // UI
        lives: '{lives}',
        level: 'Level: {level}',
        opponent: 'Opponent: {name}',
        roleHost: '🎮 Role: HOST (You start)',
        roleGuest: '🎮 Role: GUEST (Opponent starts)'
    }
};

// Detect user's language based on IP or browser settings
function detectLanguage() {
    let lang = 'az';
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');
    
    if (langParam && languages[langParam]) {
        return langParam;
    }
    
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
        const url = new URL(window.location);
        url.searchParams.set('lang', lang);
        window.history.pushState({}, '', url);
        localStorage.setItem('preferredLanguage', lang);
        updateUI();
    }
}

// Get a translated string
function t(key, params = {}) {
    let str = languages[currentLanguage][key] || key;
    
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
    
    // Update data-lang-key elements
    document.querySelectorAll('[data-lang-key]').forEach(el => {
        const key = el.getAttribute('data-lang-key');
        if (languages[currentLanguage][key]) {
            el.textContent = languages[currentLanguage][key];
        }
    });

    // Update lobby text (placeholders)
    const nameInput = document.getElementById('username');
    const roomInput = document.getElementById('roomCodeInput');
    if (nameInput) nameInput.placeholder = t('enterName');
    if (roomInput) roomInput.placeholder = t('roomCode');
    
    // Update chat UI
    const messageInput = document.getElementById('chat-input');
    if (messageInput) messageInput.placeholder = t('typeMessage');
}

// Export functions to global scope
window.languageManager = {
    t,
    setLanguage,
    currentLanguage: () => currentLanguage,
    initLanguage,
    toggleLanguageSelector,
    updateUI
};
