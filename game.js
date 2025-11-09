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
const levelInfoEl = document.getElementById('levelInfo'); // Yeni eklendi
const endGameBtn = document.getElementById('endGameBtn'); // Yeni eklendi

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

// --- OYUN AYARLARI ---
let level = 1; 
const LEVELS = [16, 20]; // Level 1: 16 Kart, Level 2+: 20 Kart
let gameStage = 'WAITING'; // 'WAITING', 'PLAY', 'ENDED'

let gameData = {
    board: [], 
    turn: 0, 
    hostLives: 0, 
    guestLives: 0,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱', '🚀', '🧠', '👑', '🔥', '🏆', '💯', '🌈', '💡', '🔔', '💰'];

// DÜZƏLİŞ 1: initializeGame canları təyin etməməlidir, yalnız taxtanı sıfırlamalıdır.
function initializeGame(boardSize, initialHostLives, initialGuestLives) {
    gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Canlar serverdan gələcək, lakin əgər sıfırdırsa ilkin dəyəri təyin edirik.
    gameData.hostLives = initialHostLives !== undefined ? initialHostLives : (level === 1 ? 4 : 6); 
    gameData.guestLives = initialGuestLives !== undefined ? initialGuestLives : (level === 1 ? 4 : 6);
    
    gameStage = 'WAITING';
    console.log(`Initial Game Data (Level ${level}): Board Size ${boardSize}, Lives H:${gameData.hostLives}, G:${gameData.guestLives}`);
}

// --- TEMEL UI FONKSİYONLARI ---

export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    const globalMessageText = document.getElementById('globalMessageText');
    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600', 'bg-yellow-600');
    globalMessage.classList.add(isError === true ? 'bg-red-600' : (isError === false ? 'bg-green-600' : 'bg-yellow-600'));
    globalMessage.classList.remove('hidden');
    globalMessage.classList.add('show');
    setTimeout(() => { globalMessage.classList.add('hidden'); globalMessage.classList.remove('show'); }, 4000);
}

// --- OYUN MANTIĞI VƏ ÇİZİM ---

function drawBoard() {
    const boardSize = LEVELS[level - 1] || 20; 
    const isSmallBoard = boardSize === 16;
    
    // Grid düzenini kart sayısına göre ayarla (4x4 veya 4x5)
    gameBoardEl.className = 'game-board'; // Özel CSS sınıfını kullan
    
    // DÜZƏLİŞ 2: Grid şablonunu dinamik olaraq ayırmağa ehtiyac yoxdur, CSS bunu static olaraq 4 sütun (4, 1fr) olaraq təyin edir.
    
    gameBoardEl.innerHTML = '';
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square'; // CSS'ten gelen kart stili
        
        const card = document.createElement('div');
        // 'card' sınıfı index.html'deki CSS'ten transform/transition özelliklerini alır.
        card.className = `card cursor-pointer ${cardState.opened ? 'flipped' : ''} ${gameStage === 'PLAY' ? '' : 'pointer-events-none'}`;
        card.dataset.index = index;

        // Kartın Ön Yüzü (Kapalı Hal)
        const front = document.createElement('div');
        front.className = 'card-face front';
        const frontContent = document.createElement('span');
        frontContent.textContent = '?';
        // '?' işareti için özel boyutlandırma/mərkəzləmə gerekebilir
        front.appendChild(frontContent);
        
        // Kartın Arka Yüzü (Açık Hal - Emoji)
        const back = document.createElement('div');
        back.className = 'card-face back';
        const backContent = document.createElement('span');
        backContent.textContent = cardState.content || '';
        // DÜZƏLİŞ 3: Emoji boyutunu CSS'ten almak için ek bir sınıf kullanmaya gerek yok, 
        // card-face sinifindəki CSS (font-size: 2rem/2.5rem) bunu halletməlidir.
        back.appendChild(backContent);

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        if (!cardState.opened && gameStage !== 'ENDED') {
            // SADECE SEÇİM AŞAMASINDA KENDİ SEÇTİĞİMİZ BOMBALAR GÖSTERİLİR
            if (gameStage === 'SELECTION' && selectedBombs.includes(index)) {
                card.classList.add('bomb-selected'); 
            }
            // KRİTİK: Tıklama olayını sadece PLAY aşamasında ve kapalı kartlara ekle
            if (gameStage === 'PLAY') {
                cardContainer.addEventListener('click', handleCardClick);
            }
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
    levelInfoEl.textContent = `Seviye: ${level}`;

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    // Durum Mesajlarını Güncelle
    if (gameStage === 'WAITING') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIR...';
        actionMessageEl.textContent = "Bağlantı bekleniyor...";
        turnStatusEl.classList.remove('text-red-600', 'text-green-600');
        turnStatusEl.classList.add('text-yellow-400'); // Koyu arka plana uygun ton
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SENDE!';
            actionMessageEl.textContent = "Bir kart aç! Rakibinizin bombalarından kaçınmaya çalışın.";
            turnStatusEl.classList.remove('text-red-600', 'text-yellow-400');
            turnStatusEl.classList.add('text-green-400'); // Koyu arka plana uygun ton
        } else {
            turnStatusEl.textContent = `⏳ ${opponentName.toUpperCase()}'UN SIRASI`;
            actionMessageEl.textContent = "Rakibinizin hamlesini bekleyin...";
            turnStatusEl.classList.remove('text-green-400', 'text-yellow-400');
            turnStatusEl.classList.add('text-red-400'); // Koyu arka plana uygun ton
        }
    } else if (gameStage === 'ENDED') {
        // end Game fonksiyonu durumu ayarlar
        turnStatusEl.classList.remove('text-green-400', 'text-red-400', 'text-yellow-400');
        turnStatusEl.classList.add('text-blue-400'); 
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
    // ... (Vibration kodunda bir değişiklik yok)
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
    // ... (Vibration kodunda bir değişiklik yok)
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
        if (!isMyTurn || gameData.isGameOver) {
            showGlobalMessage("Sıra sizdə deyil!", true);
            return;
        } 
        
        sendMove(cardIndex);
    }
}

function sendMove(index) {
    if (socket && socket.connected) {
        // Hamle yapıldığı anda kartın tıklanmasını önlemek için geçici olarak kaldır
        gameBoardEl.querySelectorAll('.card-container').forEach(el => el.removeEventListener('click', handleCardClick));
        
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
        });
    }
}

async function applyMove(index, emoji, isBomb) {
    if (gameData.board[index].opened) return;

    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    const cardElement = gameBoardEl.querySelector(`.card[data-index="${index}"]`);
    if (cardElement) {
        cardElement.classList.add('flipped');
        const backContentEl = cardElement.querySelector('.card-face.back span');
        if (backContentEl) {
             backContentEl.textContent = isBomb ? '💣' : emoji;
        }
    }

    if (isBomb) {
        // SADECE CAN KAYBEDEN OYUNCU İÇİN MESAJ
        const currentTurn = gameData.turn;
        
        // Hamle yapan oyuncu can kaybeder
        const currentPlayerIsHost = currentTurn === 0;
        if (currentPlayerIsHost) {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        playSound(audioBomb);
        
        const isSelf = (isHost && currentTurn === 0) || (!isHost && currentTurn === 1);
        if (isSelf) {
            showGlobalMessage(`BOOM! Bombaya basdınız! Canınız ${isHost ? gameData.hostLives : gameData.guestLives} qaldı.`, true);
        } else {
            showGlobalMessage(`${opponentName} bombaya basdı! Canı ${!isHost ? gameData.hostLives : gameData.guestLives} qaldı.`, false);
        }
    } else {
        gameData.board[index].content = emoji; // Server'dan gelen emoji
        playSound(audioEmoji);
    }
    
    // UI'ı hemen güncelle (canlar ve kart görünümü)
    updateStatusDisplay();
    // drawBoard'u çağır, böylece artık tıklanamaz olur
    // Aslında sadece bir kart açıldığı için tüm board'u yeniden çizmeye gerek yok, ama 
    // sadəlik üçün bu şəkildə saxlayaq.
    drawBoard(); 
    
    setTimeout(() => {
        // Sıranı değiştir
        gameData.turn = gameData.turn === 0 ? 1 : 0;
        updateStatusDisplay();
        
        // Oyun sonu kontrolü
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = gameData.hostLives <= 0 ? 'Guest' : 'Host';
            endGame(winner);
        } else {
            // Oyun davam edir, sıradaki oyuncunun hamle yapabilmesi için dinleyicileri tekrar ekle
            gameBoardEl.querySelectorAll('.card-container').forEach(el => {
                const card = el.querySelector('.card');
                if (!card.classList.contains('flipped')) {
                    el.addEventListener('click', handleCardClick);
                }
            });
            checkLevelCompletion(); // Tüm kartlar açıldı mı kontrol et
        }
    }, 1000); // Kartın çevrilme animasyonu için bekle
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    
    const myRole = isHost ? 'Host' : 'Guest';
    const iWon = (winnerRole !== 'DRAW' && winnerRole !== myRole && gameData.hostLives <= 0 && gameData.guestLives <= 0) || // Her ikisi de 0 ise BERABERLİK
                 (winnerRole === myRole && ((myRole === 'Host' && gameData.hostLives > 0) || (myRole === 'Guest' && gameData.guestLives > 0)));

    const isDraw = (gameData.hostLives <= 0 && gameData.guestLives <= 0) || (winnerRole === 'DRAW');
    
    // Tüm kartların tıklanmasını engelle
    gameBoardEl.querySelectorAll('.card-container').forEach(el => el.removeEventListener('click', handleCardClick));
    
    if (isDraw) {
        turnStatusEl.textContent = `🤝 BERABERLİK!`;
        actionMessageEl.textContent = `Hər iki oyunçu da bütün canlarını itirdi!`;
        showGlobalMessage('🤝 Bərabərlik! Hər ikiniz də əla oynadınız!', false);
    } else if (iWon) {
        turnStatusEl.textContent = `🎉 QAZANDIN!`;
        actionMessageEl.textContent = `Təbrikler! Rəqibinizi məğlub etdiniz!`;
        showGlobalMessage('🎉 Təbrikler! Bu turu qazandınız!', false);
    } else {
        turnStatusEl.textContent = `😔 UDUZDUN!`;
        actionMessageEl.textContent = `Rəqibiniz bu turu qazandı.`;
        showGlobalMessage('😔 Bu turu uduzdunuz. Növbətində daha diqqətli olun!', true);
    }
    
    // Sunucuya oyun bitti bilgisini gönder (Bu, yeni seviyenin başlamasına yol açar)
    setTimeout(() => {
         if (socket && socket.connected) {
             console.log(`📤 Sunucuya levelComplete gönderiliyor (endGame): Seviye ${level} tamamlandı`);
             socket.emit('levelComplete', {
                 roomCode: currentRoomCode,
                 level: level,
                 // Server bu bilgileri kullanarak yeni bir seviye başlatıp 'newLevel' gönderecek
             });
         }
    }, 3000); // 3 saniye bekle
}

// --- SEVİYE TAMAMLAMA KONTROLÜ (GLOBAL ALAN) ---
function checkLevelCompletion() {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;
    if (!gameData.board || gameData.board.length === 0) return;
    
    const openedCards = gameData.board.filter(card => card && card.opened).length;
    const totalCards = gameData.board.length;
    
    // Bomba sayısı kadar kapalı kart kaldıysa (yani bombalar açılmadıysa) seviye bitmez.
    // Ancak bu oyun türünde tüm bombalar zaten açılır (çünkü canlar biter).
    // Burada kontrol, eğer *tüm* kartlar açılıbsa yapılmalıdır:
    if (openedCards === totalCards) {
        console.log(`🎯 Bütün kartlar açıldı! Yeni səviyyə gözlənilir.`);
        showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
        
        gameStage = 'WAITING';
        gameData.isGameOver = true;
        
        // Sunucuya seviye tamamlandı bilgisini gönder
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor: Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', { 
                roomCode: currentRoomCode,
                level: level,
            });
        }
    }
}
// --- SON ---


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!');
    
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "🎮 Rol: HOST (Sən başla)" : "🎮 Rol: Qonaq (Rəqib başlar)";

    level = 1; // Oyuna başlarkən səviyyəni 1-ə sıfırla
    const boardSize = LEVELS[level - 1]; // 16 kart ile başla

    // DÜZƏLİŞ 4: initializeGame-i çağırın, lakin canları gameReady'də serverdən gələn dəyərlərlə yeniləyin.
    initializeGame(boardSize, 4, 4); // Varsayılan canları ayarla

    drawBoard();
    showScreen('game');
    showGlobalMessage(`🎮 Oyun ${opponentName} ilə başladı! 🚀 Serverdən məlumat gözlənilir...`, false);
    
    console.log('📡 Socket dinləyiciləri qurulur...');

    // Oyun Başlasın! (Bombalar otomatik seçildi)
    socket.on('gameReady', (gameState) => {
        console.log('🚀 gameReady EVENT ALINDI!', gameState);
        
        // Serverdan gelen can değerlerini, bombaları ve sırayı kullan
        gameData.hostBombs = gameState.hostBombs || [];
        gameData.guestBombs = gameState.guestBombs || [];
        gameData.hostLives = gameState.hostLives; // KRİTİK: Server'dan gelen canları kullan
        gameData.guestLives = gameState.guestLives;
        gameData.turn = gameState.turn || 0;
        
        gameStage = 'PLAY';
        
        drawBoard();
        updateStatusDisplay();
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Səviyyə ${level} başladı! ${gameData.hostLives} canla oynanılır.`, false);
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Yeni seviye başlatılıyor:', data);
        
        level = parseInt(data.level) || 1;
        const boardSize = LEVELS[level - 1] || 20;

        // initializeGame'i yeni değerlerle çağır
        initializeGame(boardSize, data.hostLives, data.guestLives);
        
        // HostBombs ve GuestBombs'u da serverdan gelenle güncelle
        gameData.hostBombs = data.hostBombs || [];
        gameData.guestBombs = data.guestBombs || [];
        
        gameStage = 'PLAY';
        
        drawBoard();
        updateStatusDisplay();
        
        showGlobalMessage(`🎮 Səviyyə ${level} başladı! ${gameData.hostLives} canla oynanılır.`, false);
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
        showGlobalMessage(message || 'Rəqibiniz ayrıldı. Lobbiyə qayıdılır.', true);
        resetGame();
    });
}

export function resetGame() {
    // Tüm oyun ayarlarını sıfırlar ve lobiye döner (En güvenli yol: Sayfayı yenilemek)
    // Oyundan çıxma butonunun tətbiqi üçün istifadə olunur.
    if (socket && socket.connected && currentRoomCode) {
        socket.emit('leaveRoom', { roomCode: currentRoomCode });
    }
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz (index.html'in kullanması için)
export const UIElements = {
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame,
    // Diğer elementler
};
