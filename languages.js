// Language strings for the game
const languages = {
    az: {
        languageName: '🇦🇿 Azərbaycanca',
        // Lobby
        enterName: 'İstifadəçi Adınızı Daxil Edin',
        // --- Dəyişiklik 1: 'oyun' butonu (Otaq Qur) ---
        startGame: '✅ Otaq Qur / ➕ Otağa Bağlan ➕',
        // --- Dəyişiklik 2: 'baslayin' butonu (Odaya Bağlan) ---
        joinGame: '✅ Otaq Qur / ➕ Otağa Bağlan ➕',
        // --- Dəyişiklik 3: Otaq Kodu placeholder (əvvəlki kimi) ---
        roomCode: 'Otaq Kodu (Boş buraxın=Yeni Otaq)',
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
        enterName: 'Kullanıcı Adınızı Girin',
        // --- Dəyişiklik 1: 'oyun' butonu (Oda Kur) ---
        startGame: '✅ Otaq Qur / ➕ Odaya Bağlan ➕',
        // --- Dəyişiklik 2: 'baslayin' butonu (Odaya Bağlan) ---
        joinGame: '✅ Otaq Qur / ➕ Odaya Bağlan ➕',
        // --- Dəyişiklik 3: Otaq Kodu placeholder (əvvəlki kimi) ---
        roomCode: 'Oda Kodu (Boş Bırakın=Yeni Oda)',
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
        enterName: 'Enter Your Username',
        // --- Dəyişiklik 1: 'oyun' butonu (Create Room) ---
        startGame: '✅ Otaq Qur / ➕ Odaya Bağlan ➕',
        // --- Dəyişiklik 2: 'baslayin' butonu (Join Room) ---
        joinGame: '✅ Otaq Qur / ➕ Odaya Bağlan ➕',
        // --- Dəyişiklik 3: Otaq Kodu placeholder (əvvəlki kimi) ---
        roomCode: 'Room Code (Leave Blank=New Room)',
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

export function setLanguage(lang) {
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
export function t(key, params = {}) {
    let str = languages[currentLanguage][key] || key;
    
    // Replace placeholders with actual values
    Object.keys(params).forEach(param => {
        str = str.replace(`{${param}}`, params[param]);
    });
    
    return str;
}

// Toggle language selector
export function toggleLanguageSelector() {
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
export function initLanguage() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang && languages[savedLang]) {
        currentLanguage = savedLang;
    }
    updateUI();
}

// Update all UI elements with translations
function updateUI() {
    // Update language button
    const currentLangEl = document.getElementById('current-language');
    if (currentLangEl) {
        currentLangEl.textContent = languages[currentLanguage].languageName.substring(0, 5); // Sadece bayrak ve kısa kodu göster
    }

    // Update lobby text
    const nameInput = document.getElementById('username');
    const startBtn = document.getElementById('matchBtn');
    const roomInput = document.getElementById('roomCodeInput');
    
    // --- Bu hissə dəyişiklikləri tətbiq edir ---
    if (nameInput) nameInput.placeholder = t('enterName');
    if (startBtn) startBtn.textContent = t('startGame');
    if (roomInput) roomInput.placeholder = t('roomCode');
    // ----------------------------------------
    
    // Update game UI if in game
    updateGameUI();
}

// Update game-specific UI elements (game.js'den gelen global değişkenleri kullanır)
export function updateGameUI() {
    // Bu kısım oyun durumu bilgilerine erişemediği için (game.js'deki global değişkenler)
    // Yalnızca dil metinlerini güncelleyebilir.
    
    // TurnStatus ve ActionMessage güncellemeleri game.js'nin sorumluluğundadır.
    
    // Eğer isterseniz, game.js'den gelen verilere göre burada güncellemeleri yapabiliriz.
}

// Export functions
window.languageManager = {
    t,
    setLanguage,
    currentLanguage: () => currentLanguage,
    initLanguage,
    toggleLanguageSelector,
    updateGameUI
};
