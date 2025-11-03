// Dosya Adı: language.js
const languages = {
    az: {
        languageName: '🇦🇿 Azərbaycanca',
        // Başlıq və Qaydalar
        title: '💣 Emoji Bombası',
        rulesTitle: '📋 Oyun Qaydaları (YENİ):',
        rule1: 'Bütün səviyyələr 20 kartdan ibarətdir.',
        rule2: 'Level 1: Hər oyunçunun 3 bombası (3 canı) var.',
        rule3: 'Level 2+: Hər oyunçunun 4 bombası (4 canı) var.',
        rule4: 'Bütün təhlükəsiz kartlar açıldıqda növbəti səviyyəyə keçirsiniz.',
        // Lobi
        enterName: 'İstifadəçi Adınızı Daxil Edin',
        roomCode: 'Otaq Kodu (Boş buraxın=Yeni Otaq)',
        joinGame: '➕ Otaq Qur / Odaya Bağlan',
        // Gözləmə
        creatingRoom: 'Otaq Qurulur...',
        roomCreated: 'Otağınız Quruldu!',
        roomCodeTitle: 'Otaq Kodunuz:',
        copyCode: 'Kopyala',
        waitingForPlayer: 'Rəqib gözlənilir...',
        pleaseWait: 'Zəhmət olmasa gözləyin...',
        joiningRoom: 'Otağa Qoşulma:',
        joining: 'Qoşulunur...',
        cancel: 'Ləğv Et',
        // Oyun Ekranı
        you: 'SƏN',
        levelTitle: 'SƏVİYYƏ',
        waiting: 'Rəqib gözlənilir...',
        roleHost: 'Rol: HOST',
        roleGuest: 'Rol: QONAQ',
        yourTurn: '✅ SƏNİN NÖVBƏN!',
        opponentTurn: '⏳ RƏQİBİN NÖVBƏSİ',
        exitGame: '🚪 Oyundan Çıx',
        // Chat
        typeMessage: 'Mesaj yazın...',
        send: 'Göndər',
        // Xəbərdarlıqlar və Mesajlar
        connected: 'Serverə qoşuldu.',
        disconnected: 'Bağlantı kəsildi. Yenidən qoşulunur...',
        errorConnect: 'XƏTA: Serverə daxil olmaq mümkün deyil.',
        errorUsername: 'Zəhmət olmasa etibarlı bir istifadəçi adı daxil edin.',
        copied: 'Otaq Kodu Kopyalandı!',
        copyFailed: 'Kopyalama uğursuz oldu.',
        bombExploded: 'BOOM! Bombaya basdınız!',
        gameOver: 'Oyun Bitdi!',
        youWon: '🎉 QAZANDIN!',
        youLost: '😔 MƏĞLUB OLDUN.',
        draw: '🤝 BƏRABƏRƏ!',
        levelComplete: 'Səviyyə {level} tamamlandı! Növbəti səviyyə...',
        levelStarting: 'Səviyyə {level} başlayır ({lives} can).',
        cardOpened: 'Bu kart artıq açılıb.',
    },
    tr: {
        languageName: '🇹🇷 Türkçe',
        // Başlıq ve Kurallar
        title: '💣 Emoji Bombası',
        rulesTitle: '📋 Oyun Kuralları (YENİ):',
        rule1: 'Tüm seviyeler 20 karttan oluşur.',
        rule2: 'Level 1: Her oyuncunun 3 bombası (3 canı) var.',
        rule3: 'Level 2+: Her oyuncunun 4 bombası (4 canı) var.',
        rule4: 'Tüm güvenli kartlar açıldığında sonraki seviyeye geçilir.',
        // Lobi
        enterName: 'Kullanıcı Adınızı Girin',
        roomCode: 'Oda Kodu (Boş Bırakın=Yeni Oda)',
        joinGame: '➕ Oda Kur / Odaya Katıl',
        // Bekleme
        creatingRoom: 'Oda Kuruluyor...',
        roomCreated: 'Odanız Kuruldu!',
        roomCodeTitle: 'Oda Kodunuz:',
        copyCode: 'Kopyala',
        waitingForPlayer: 'Rakip bekleniyor...',
        pleaseWait: 'Lütfen bekleyin...',
        joiningRoom: 'Odaya Katılma:',
        joining: 'Katılınılıyor...',
        cancel: 'İptal Et',
        // Oyun Ekranı
        you: 'SEN',
        levelTitle: 'SEVİYE',
        waiting: 'Rakip bekleniyor...',
        roleHost: 'Rol: EV SAHİBİ',
        roleGuest: 'Rol: MİSAFİR',
        yourTurn: '✅ SIRA SENDE!',
        opponentTurn: '⏳ RAKİBİN SIRASI',
        exitGame: '🚪 Oyundan Çık',
        // Chat
        typeMessage: 'Mesaj yazın...',
        send: 'Gönder',
        // Uyarılar ve Mesajlar
        connected: 'Sunucuya bağlandı.',
        disconnected: 'Bağlantı kesildi. Yeniden bağlanılıyor...',
        errorConnect: 'HATA: Sunucuya erişilemiyor.',
        errorUsername: 'Lütfen geçerli bir kullanıcı adı girin.',
        copied: 'Oda Kodu Kopyalandı!',
        copyFailed: 'Kopyalama başarısız.',
        bombExploded: 'BOOM! Bombaya bastınız!',
        gameOver: 'Oyun Bitti!',
        youWon: '🎉 KAZANDIN!',
        youLost: '😔 KAYBETTİN.',
        draw: '🤝 BERABERE!',
        levelComplete: 'Seviye {level} tamamlandı! Sonraki seviye...',
        levelStarting: 'Seviye {level} başlıyor ({lives} can).',
        cardOpened: 'Bu kart zaten açık.',
    },
    en: {
        languageName: '🇬🇧 English',
        // Title and Rules
        title: '💣 Emoji Bomb',
        rulesTitle: '📋 Game Rules (NEW):',
        rule1: 'All levels consist of 20 cards.',
        rule2: 'Level 1: Each player has 3 bombs (3 lives).',
        rule3: 'Level 2+: Each player has 4 bombs (4 lives).',
        rule4: 'When all safe cards are opened, you advance to the next level.',
        // Lobby
        enterName: 'Enter Your Username',
        roomCode: 'Room Code (Leave Blank=New Room)',
        joinGame: '➕ Create / Join Room',
        // Waiting
        creatingRoom: 'Creating Room...',
        roomCreated: 'Your Room is Ready!',
        roomCodeTitle: 'Your Room Code:',
        copyCode: 'Copy',
        waitingForPlayer: 'Waiting for opponent...',
        pleaseWait: 'Please wait...',
        joiningRoom: 'Joining Room:',
        joining: 'Joining...',
        cancel: 'Cancel',
        // Game Screen
        you: 'YOU',
        levelTitle: 'LEVEL',
        waiting: 'Waiting for opponent...',
        roleHost: 'Role: HOST',
        roleGuest: 'Role: GUEST',
        yourTurn: '✅ YOUR TURN!',
        opponentTurn: '⏳ OPPONENT\'S TURN',
        exitGame: '🚪 Exit Game',
        // Chat
        typeMessage: 'Type a message...',
        send: 'Send',
        // Alerts and Messages
        connected: 'Connected to server.',
        disconnected: 'Disconnected. Reconnecting...',
        errorConnect: 'ERROR: Cannot connect to server.',
        errorUsername: 'Please enter a valid username.',
        copied: 'Room Code Copied!',
        copyFailed: 'Copy failed.',
        bombExploded: 'BOOM! You hit a bomb!',
        gameOver: 'Game Over!',
        youWon: '🎉 YOU WON!',
        youLost: '😔 YOU LOST.',
        draw: '🤝 IT\'S A DRAW!',
        levelComplete: 'Level {level} complete! Next level...',
        levelStarting: 'Level {level} starting ({lives} lives).',
        cardOpened: 'This card is already open.',
    }
};

// --- Dil Meneceri (Dəyişməyib) ---

// Get a translated string
function t(key, params = {}) {
    let lang = window.languageManager.currentLanguage;
    if (!languages[lang] || !languages[lang][key]) {
        // Fallback to English if key not found
        lang = 'en';
    }
    let str = languages[lang][key] || key;
    
    Object.keys(params).forEach(param => {
        str = str.replace(`{${param}}`, params[param]);
    });
    return str;
}

function detectLanguage() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang && languages[savedLang]) return savedLang;

    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');
    if (langParam && languages[langParam]) return langParam;

    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang) {
        if (browserLang.startsWith('tr')) return 'tr';
        if (browserLang.startsWith('en')) return 'en';
    }
    return 'az'; // Default
}

function setLanguage(lang) {
    if (languages[lang]) {
        window.languageManager.currentLanguage = lang;
        localStorage.setItem('preferredLanguage', lang);
        updateUI();
    }
}

function updateUI() {
    const lang = window.languageManager.currentLanguage;
    
    // Update language button
    const langButtonFlag = document.getElementById('current-language-flag');
    if (langButtonFlag) {
        langButtonFlag.textContent = languages[lang].languageName.split(' ')[0];
    }
    
    // Update all elements with data-lang-key
    document.querySelectorAll('[data-lang-key]').forEach(el => {
        const key = el.getAttribute('data-lang-key');
        const translation = t(key);
        
        // Check if element is an input placeholder
        if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
            el.placeholder = translation;
        } else {
            el.textContent = translation;
        }
    });
}

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

// Initialize
function initLanguage() {
    window.languageManager.currentLanguage = detectLanguage();
    updateUI();
}

// Export functions to global scope
window.languageManager = {
    t,
    setLanguage,
    currentLanguage: detectLanguage(),
    initLanguage,
    toggleLanguageSelector,
    updateUI
};
