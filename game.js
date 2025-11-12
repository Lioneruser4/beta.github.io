// Dosya Adı: game.js
// Socket.io bağlantısını daha erken başlatıyoruz
let socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['websocket']
});

// Bağlantı durumunu dinle
socket.on('connect', () => {
    console.log('Sunucuya bağlandı');
});

socket.on('disconnect', () => {
    console.log('Sunucu bağlantısı kesildi');});

socket.on('connect_error', (error) => {
    console.error('Bağlantı hatası:', error);
});

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

// Oyun başlatma / seviye hazırlama
function initializeGame(boardSize) {
    gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Tüm seviyelerde 4 can ve 4 bomba
    gameData.hostLives = 3; 
    gameData.guestLives = 3;
    
    gameStage = 'WAITING';
}

// --- OYUN DURUMU ---
let level = 1; 
// Kart sayıları: Level 1'de 16, sonraki tüm levellerde 20 kart
const LEVELS = [16, 20]; 
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; // Kendi seçtiğimiz bombaların indexleri

let gameData = {
    board: [], 
    turn: 0,  // 0 = Host, 1 = Guest
    hostLives: 0,  // Server'dan gelen değerlerle güncellenecek
    guestLives: 0, // Server'dan gelen değerlerle güncellenecek
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
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

// --- OYUN MANTIĞI VE ÇİZİM ---

function drawBoard() {
    const boardSize = LEVELS[level - 1] || 20; // Default 20
    
    // Grid düzenini sadece 4 sütun (4 aşağı inme) olarak ayarla
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; // 4 sütun (4x3, 4x4, 4x5 için)
    
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';

        const card = document.createElement('div');
        card.className = `card cursor-pointer`;
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face front';
        const frontContent = document.createElement('span');
        frontContent.textContent = '?';
        front.appendChild(frontContent);
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        const backContent = document.createElement('span');
        backContent.textContent = cardState.content;
        backContent.style.fontSize = '2rem'; // Emoji boyutunu büyüt
        backContent.style.webkitTextStroke = '1px transparent'; // iOS için emoji görünürlüğünü artır
        back.appendChild(backContent);

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        if (cardState.opened) {
            card.classList.add('flipped');
        } else {
            // SADECE SEÇEN KİŞİNİN GÖRMESİ İÇİN KIRMIZILIK
            if (gameStage === 'SELECTION' && selectedBombs.includes(index)) {
                card.classList.add('bomb-selected'); 
            }
            
            // KRİTİK DÜZELTME: TIKLAMA OLAYINI CARD-CONTAINER'A EKLE!
            cardContainer.addEventListener('click', handleCardClick);
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));
    
    // Skor göstergesini güncelle
    if (gameData.scores) {
        const myScore = isHost ? gameData.scores.host : gameData.scores.guest;
        const opponentScore = isHost ? gameData.scores.guest : gameData.scores.host;
        
        // Eğer isim bilgileri varsa onları kullan, yoksa varsayılan değerleri kullan
        const myName = isHost ? 'Sen' : (gameData.opponentName || 'Rakip');
        const opponentName = isHost ? (gameData.opponentName || 'Rakip') : 'Sen';
        
        scoreDisplayEl.textContent = `${myName} ${myScore} - ${opponentScore} ${opponentName}`;
        scoreDisplayEl.style.display = 'block';
    }

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING' || gameStage === 'SELECTION') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIR...';
        actionMessageEl.textContent = "Bombalar otomatik yerleştiriliyor...";
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SƏNDƏ !';
            actionMessageEl.textContent = "Bir kart aç! Rakibinizin bombalarından kaçınmaya çalışın.";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ ONUN SIRASI';
            actionMessageEl.textContent = "RƏQİBİNİZİ GÖZLƏYİN...";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver && gameStage === 'ENDED') {
        turnStatusEl.textContent = "✅ OYUN BİTDİ!";
        actionMessageEl.textContent = "Sonuçlar hesaplanıyor...";
    }
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

function handleCardClick(event) {
    // Tıklama olayını başlatan card-container'ı bul
    const cardContainer = event.currentTarget; 
    // İçindeki asıl .card elementini bul
    const cardElement = cardContainer.querySelector('.card');
    
    // Eğer card elementi zaten açılmışsa veya bulunamazsa dur.
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) return; 
        
        cardElement.classList.add('flipped');
        sendMove(cardIndex);
    }
}

function sendMove(index) {
    if (socket && socket.connected) {
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
        });
    }
}

async function applyMove(index, emoji, isBomb) {
    if (gameData.board[index].opened) return;

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (isBomb) {
        gameData.board[index].content = '💣';
        // Hamle yapan oyuncu can kaybeder
        const currentPlayerIsHost = gameData.turn === 0;
        if (currentPlayerIsHost) {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        playSound(audioBomb);
        showGlobalMessage(`❗ BOOM ! Bombanı Partladı ❗`, true);
    } else {
        gameData.board[index].content = emoji; // Server'dan gelen emoji
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    // Oyun tahtasını güncelle
    drawBoard();
    
    setTimeout(() => {
        // Sırayı değiştir
        gameData.turn = gameData.turn === 0 ? 1 : 0;
        updateStatusDisplay();
        
        // Tüm bombalar patladı mı kontrol et
        const allBombsExploded = (gameData.hostLives <= 0 && gameData.guestLives <= 0);
        
        if (allBombsExploded) {
            // Tüm bombalar patladı, bir sonraki seviyeye geç
            const nextLevel = level + 1;
            showGlobalMessage(`🎉 Bütün bombalar partladı! Level ${nextLevel}'e geçilir...`, false);
            
            // Sunucuya seviye tamamlandı bilgisini gönder
            if (socket && socket.connected) {
                socket.emit('levelComplete', { 
                    roomCode: currentRoomCode,
                    level: level,
                    nextLevel: nextLevel
                });
            }
        } else if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            // Normal oyun bitişi (bir oyuncu tüm canlarını kaybetti)
            const winner = gameData.hostLives <= 0 ? 'Guest' : 'Host';
            endGame(winner);
        } else {
            // Oyun devam ediyor, sıradaki oyuncu
            checkLevelCompletion();
        }
        
    }, 1000);
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    
    const myRole = isHost ? 'Host' : 'Guest';
    const iWon = (winnerRole === myRole);
    const isDraw = (winnerRole === 'DRAW');
    
    if (isDraw) {
        turnStatusEl.textContent = `🤝 BƏRABƏRLİK!`;
        actionMessageEl.textContent = `Her iki oyuncu da tüm canlarını kaybetti!`;
        showGlobalMessage('🤝 Beraberlik! Her ikiniz de harika oynadınız!', false);
    } else if (iWon) {
        turnStatusEl.textContent = `🎉 QAZANDIN!`;
        actionMessageEl.textContent = `Tebrikler! Rakibinizi yendiniz!`;
        showGlobalMessage('🎉 Tebrikler! Bu turu kazandınız!', false);
    } else {
        turnStatusEl.textContent = `😔 UDUZDUN!`;
        actionMessageEl.textContent = `Rakibiniz bu turu kazandı.`;
        showGlobalMessage('😔 Bu turu kaybettiniz. Bir sonrakinde daha dikkatli olun!', true);
    }
    
    // 2 saniye bekle ve sunucuya oyun bitti bilgisini gönder
    // Sunucu yeni seviyeyi başlatma işini yapacaktır.
    setTimeout(() => {
        const nextLevel = level + 1;
        
        console.log(`🔄 Oyun bitti, sunucudan yeni seviye bekleniyor: ${nextLevel}`);
        
        // Sunucuya levelComplete olayını gönder (Bu, yeni seviyenin başlamasına yol açar)
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor (endGame): Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', {
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        } else {
            console.error('❌ Sunucuya bağlı değil, yeni seviyeye geçilemiyor!');
        }
    }, 2000); // 2 saniye bekle
}

// --- SEVİYE TAMAMLAMA KONTROLÜ (GLOBAL ALAN) ---
// Bu fonksiyonu global alana taşıyarak, applyMove içerisinden erişilebilir kıldık.
function checkLevelCompletion() {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;
    if (!gameData.board || gameData.board.length === 0) return;
    
    // Açılan kart sayısını kontrol et
    const openedCards = gameData.board.filter(card => card && card.opened).length;
    const totalCards = gameData.board.length;
    
    console.log(`🔍 Seviye tamamlama kontrolü: Açılan ${openedCards}/${totalCards} kart`);
    
    if (openedCards === totalCards) {
        const nextLevel = level + 1;
        
        console.log(`🎯 Bütün Kartlar Açıldı ! Digər Level: ${nextLevel}`);
        showGlobalMessage(`🎉 Level ${level} tamamlandı! Yeni level yüklənir...`, false);
        
        // Oyun durumunu güncelle (geçiş anında hamle yapılmasın)
        gameStage = 'WAITING';
        gameData.isGameOver = true;
        
        // Sunucuya seviye tamamlandı bilgisini gönder
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor: Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', { 
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        } else {
            console.error('❌ Sunucuya bağlı değil!');
        }
        
        // 1 saniye bekle, bu arada sunucudan 'newLevel' olayının gelmesini bekle.
        setTimeout(() => {
            console.log(`🔄 Sunucudan Seviye ${nextLevel} bilgisini bekle...`);
        }, 1000);
    }
}
// --- SON ---


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!', { roomCode, isHost: host, opponent: opponentNameFromIndex });
    
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

    // Oyun Başlasın! (Bombalar otomatik seçildi)
    socket.on('gameReady', (gameState) => {
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
