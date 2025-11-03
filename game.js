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

// Level'a göre bomba sayısını belirleyen yardımcı fonksiyon
const getBombCount = (level) => level === 1 ? 3 : 4;
// Level'a göre kart sayısını belirleyen yardımcı fonksiyon
const getBoardSize = (level) => level === 1 ? 16 : 20;

// Oyun başlatma / seviye hazırlama
function initializeGame(boardSize) {
    gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Seviyeye göre can sayısını ayarla (Sunucudan gelen değerler ile güncellenecek, başlangıç değeri)
    const bombCount = getBombCount(level);
    
    // NOT: Canlar gameReady olayında sunucudan gelen değerlerle güncellenecek, bu sadece bir başlangıç.
    gameData.hostLives = bombCount;
    gameData.guestLives = bombCount;
    
    gameStage = 'WAITING'; 
    
    updateStatusDisplay();
    drawBoard(); 
}

// --- OYUN DURUMU ---
let level = 1; 
let gameStage = 'SELECTION'; // 'SELECTION', 'PLAY', 'WAITING' veya 'ENDED'
let selectedBombs = []; // Kendi seçtiğimiz bombaların indexleri (Artık sunucu yönetiyor, ancak değişkeni koruyalım)

let gameData = {
    board: [], 
    turn: 0,  // 0 = Host, 1 = Guest
    hostLives: getBombCount(1),  
    guestLives: getBombCount(1), 
    cardsLeft: getBoardSize(1),
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

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
    const boardSize = getBoardSize(level);
    
    // Grid düzenini sadece 4 sütun (4 aşağı inme) olarak ayarla
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; 
    
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        // Level 1'de 16 kart (4x4), Level 2+'de 20 kart (4x5)
        const rowCount = boardSize / 4;
        cardContainer.className = `card-container aspect-square card-rows-${rowCount}`;

        const card = document.createElement('div');
        card.className = `card cursor-pointer`;
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face front'; 
        front.textContent = '?';
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        back.textContent = cardState.content;

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        if (cardState.opened) {
            card.classList.add('flipped');
        } else {
            // SADECE SEÇEN KİŞİNİN GÖRMESİ İÇİN KIRMIZILIK (Bu özellik sunucuya devredildi, koruma amaçlı duruyor)
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

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIYOR...';
        actionMessageEl.textContent = `Seviye ${level} için bombalar yerleştiriliyor...`;
        turnStatusEl.classList.remove('text-red-600', 'text-green-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SENDE!';
            actionMessageEl.textContent = `Seviye ${level}: Bir kart aç! Rakibinizin ${getBombCount(level)} bombasından kaçının.`;
            turnStatusEl.classList.remove('text-red-600', 'text-yellow-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ RAKİBİN SIRASI';
            actionMessageEl.textContent = "Rakibinizin hamlesini bekleyin...";
            turnStatusEl.classList.remove('text-green-600', 'text-yellow-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver) {
        turnStatusEl.textContent = "✅ OYUN BİTTİ!";
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
    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) return; 
        
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

async function applyMove(index, emoji, isBomb, newHostLives, newGuestLives, newTurn) {
    if (gameData.board[index].opened) return;

    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    // Sunucudan gelen yeni can ve sıra değerlerini kullan
    gameData.hostLives = newHostLives;
    gameData.guestLives = newGuestLives;
    gameData.turn = newTurn; 

    if (isBomb) {
        gameData.board[index].content = '💣';
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Bombaya bastınız!`, true);
    } else {
        gameData.board[index].content = emoji; // Server'dan gelen emoji
        playSound(audioEmoji);
    }
    
    // Oyun tahtasını güncelle
    drawBoard();
    
    setTimeout(() => {
        updateStatusDisplay();
        
        // Oyunun bitip bitmediğini kontrol et (Can bitti mi?)
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            // Can bitimi nedeniyle seviye sonu/oyun sonu
            endGame(); 
        } else {
            // Tüm kartların açılıp açılmadığını kontrol et
            checkLevelCompletion();
        }
    }, 1000);
}

function endGame() {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    
    const hostDied = gameData.hostLives <= 0;
    const guestDied = gameData.guestLives <= 0;
    
    let winnerRole = 'DRAW';
    if (!hostDied && guestDied) winnerRole = 'Host';
    else if (hostDied && !guestDied) winnerRole = 'Guest';

    const myRole = isHost ? 'Host' : 'Guest';
    const iWon = (winnerRole === myRole);
    const isDraw = (winnerRole === 'DRAW');
    
    if (isDraw) {
        turnStatusEl.textContent = `🤝 BERABERLİK!`;
        actionMessageEl.textContent = `Her iki oyuncu da tüm canlarını kaybetti!`;
        showGlobalMessage('🤝 Beraberlik! Her ikiniz de harika oynadınız!', false);
    } else if (iWon) {
        turnStatusEl.textContent = `🎉 KAZANDIN!`;
        actionMessageEl.textContent = `Tebrikler! Rakibinizi yendiniz!`;
        showGlobalMessage('🎉 Tebrikler! Bu turu kazandınız!', false);
    } else {
        turnStatusEl.textContent = `😔 KAYBETTİN`;
        actionMessageEl.textContent = `Rakibiniz bu turu kazandı.`;
        showGlobalMessage('😔 Bu turu kaybettiniz. Bir sonrakinde daha dikkatli olun!', true);
    }
    
    // Can bitiminden dolayı seviye atlama
    triggerNextLevel(level + 1); 
}

function checkLevelCompletion() {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;
    if (!gameData.board || gameData.board.length === 0) return;
    
    const openedCards = gameData.board.filter(card => card && card.opened).length;
    const totalCards = gameData.board.length;
    
    console.log(`🔍 Seviye tamamlama kontrolü: Açılan ${openedCards}/${totalCards} kart`);
    
    if (openedCards === totalCards) {
        // Tüm kartlar açıldı, canlara bakılmaksızın seviye atla.
        showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
        triggerNextLevel(level + 1);
    }
};

function triggerNextLevel(nextLevel) {
    if (gameStage === 'ENDED' || gameStage === 'WAITING') return;
    
    gameStage = 'WAITING';
    gameData.isGameOver = true;
    updateStatusDisplay();

    // 2 saniye bekle ve yeni seviyeye geçişi sunucuya bildir
    setTimeout(() => {
        console.log(`🔄 Yeni seviyeye geçiş tetikleniyor: ${nextLevel}`);
        
        // Sunucuya seviye tamamlandı bilgisini gönder
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor: Seviye ${level} -> ${nextLevel}`);
            socket.emit('levelComplete', { 
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        } else {
            console.error('❌ Sunucuya bağlı değil! Level atlama gerçekleşmedi.');
            // Sunucu bağlantısı yoksa yerel olarak sıfırla (Geliştirme için)
            level = nextLevel;
            const newBoardSize = getBoardSize(level);
            initializeGame(newBoardSize);
            gameStage = 'PLAY';
            showGlobalMessage(`🔌 Bağlantı yok. Yerel Level ${level} başlatıldı.`, false);
        }
    }, 2000); // 2 saniye bekle
}


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
    level = 1; 
    const initialBoardSize = getBoardSize(level);
    initializeGame(initialBoardSize);
    
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
        gameData.hostLives = gameState.hostLives || getBombCount(level);
        gameData.guestLives = gameState.guestLives || getBombCount(level);
        gameData.turn = gameState.turn || 0;
        
        gameStage = 'PLAY';
        gameData.isGameOver = false;

        const boardSize = gameState.boardSize || getBoardSize(level); // Sunucudan gelen board size'ı kullan
        gameData.cardsLeft = boardSize;
        gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Seviye ${level} başlıyor! ${getBombCount(level)} bomba ile oynanıyor.`, false);
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Yeni seviye başlatılıyor:', data);
        
        // Seviye bilgisini güncelle
        level = parseInt(data.level) || 1;
        
        // Bomba sayısını hesapla
        const bombCount = getBombCount(level);
        const boardSize = getBoardSize(level);
        
        // Oyun durumunu sıfırla/güncelle
        gameData = {
            board: Array.from({ length: boardSize }, () => ({ opened: false, content: '' })),
            turn: 0, // Host başlasın
            hostLives: data.hostLives || bombCount,
            guestLives: data.guestLives || bombCount,
            cardsLeft: boardSize, 
            hostBombs: [], // Bombalar gameReady ile gelecek
            guestBombs: [],
            isGameOver: false
        };
        
        gameStage = 'WAITING'; // Yeni gameReady olayını beklerken
        
        // Yeni oyun tahtasını oluştur
        drawBoard();
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        showGlobalMessage(`🎮 Seviye ${level} yükleniyor! ${bombCount} bomba ve ${boardSize} kart ile.`, false);
    });

    // gameData Olayı (Hamle Geldi - Kendi veya Rakip)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY' || gameData.isGameOver) return;
        
        if (data.type === 'MOVE') {
            // Server tarafından onaylanmış hamleyi uygula (emoji ve bomba bilgisi ile)
            applyMove(
                data.cardIndex, 
                data.emoji, 
                data.isBomb, 
                data.hostLives, // Yeni host canı
                data.guestLives, // Yeni guest canı
                data.turn // Yeni sıra
            ); 
        }
    });

    // Hata mesajları için dinleyici
    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
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
