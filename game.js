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

// Oyun başlatma / seviye hazırlama
function initializeGame(levelData = {}) {
    const boardSize = levelData.level === 1 ? 16 : 20; // Level 1: 16 kart, sonraki seviyeler: 20 kart
    const bombCount = levelData.level === 1 ? 4 : 6; // Level 1: 4 bomba, sonraki seviyeler: 6 bomba
    
    gameData = {
        board: Array.from({ length: boardSize }, () => ({ opened: false, content: '' })),
        cardsLeft: boardSize - bombCount, // Sadece güvenli kartları say
        turn: 0, // Host başlar
        isGameOver: false,
        hostLives: levelData.hostLives || 3, // Varsayılan olarak 3 can
        guestLives: levelData.guestLives || 3, // Varsayılan olarak 3 can
        bombsLeft: bombCount,
        totalBombs: bombCount,
        level: levelData.level || 1
    };
    
    level = gameData.level; // Global level değişkenini güncelle
    gameStage = 'WAITING';
    
    // UI'ı güncelle
    updateStatusDisplay();
    
    console.log(`Yeni seviye başlatıldı: Level ${level}, ${bombCount} bomba, ${boardSize} kart`);
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
        front.className = 'card-face front'; // Sizin stilinize göre front/back
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
    
    // Canları güncelle
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));
    
    // Seviye ve bomba bilgisini göster
    const levelInfo = document.getElementById('levelInfo');
    if (levelInfo) {
        levelInfo.textContent = `Seviye: ${gameData.level || 1} | Kalan Bomba: ${gameData.bombsLeft || 0}/${gameData.totalBombs || 0}`;
    }

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING' || gameStage === 'SELECTION') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIR...';
        actionMessageEl.textContent = `Seviye ${gameData.level || 1} yükleniyor...`;
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SENDE!';
            actionMessageEl.textContent = `Seviye ${gameData.level || 1}: Bir kart aç! Kalan bomba: ${gameData.bombsLeft || 0}/${gameData.totalBombs || 0}`;
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ RAKİBİN SIRASI';
            actionMessageEl.textContent = `Seviye ${gameData.level || 1}: Rakibinizin hamlesini bekleyin...`;
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver && gameStage === 'ENDED') {
        const isWinner = (isHost && gameData.winner === 'host') || (!isHost && gameData.winner === 'guest');
        turnStatusEl.textContent = isWinner ? '🏆 KAZANDINIZ!' : '😢 KAYBETTİNİZ!';
        actionMessageEl.textContent = isWinner ? 'Tebrikler! Yeni bir oyuna başlamak için ana menüye dönün.' : 'Daha iyi şanslar bir dahaki sefere!';
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

    await triggerWaitAndVibrate();

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
        showGlobalMessage(`BOOM! Bombaya bastınız!`, true);
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
            showGlobalMessage(`🎉 Tüm bombalar patladı! Seviye ${nextLevel}'e geçiliyor...`, false);
            
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
        turnStatusEl.textContent = `🤝 BERABERLİK!`;
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
        
        console.log(`🎯 Tüm kartlar açıldı! Yeni seviye: ${nextLevel}`);
        showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
        
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
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex || 'Rakip';
    
    // Oyun başladığında
    socket.on('gameStart', (data) => {
        console.log('Oyun başladı!', data);
        opponentName = data.players.find(p => !p.isHost).username;
        opponentNameEl.textContent = opponentName;
        roleStatusEl.textContent = isHost ? '(SUNUCU)' : '(MISAFIR)';
        
        // Oyun tahtasını başlat (sunucudan gelen başlangıç durumuyla)
        initializeGame({ level: 1, hostLives: 3, guestLives: 3 });
        showScreen('game');
        
        // Oyun başlangıç animasyonu
        setTimeout(() => {
            gameStage = 'PLAY';
            updateStatusDisplay();
        }, 1000);
    });
    
    // Yeni seviye başladığında
    socket.on('levelUp', (data) => {
        console.log('Yeni seviye:', data);
        level = data.level;
        gameData.hostLives = data.hostLives;
        gameData.guestLives = data.guestLives;
        gameData.bombsLeft = data.bombsLeft;
        gameData.totalBombs = data.totalBombs;
        gameData.level = data.level;
        
        // Oyun tahtasını sıfırla
        const boardSize = level === 1 ? 16 : 20;
        gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
        gameData.cardsLeft = boardSize - data.totalBombs;
        gameData.isGameOver = false;
        
        // UI'ı güncelle
        updateStatusDisplay();
        drawBoard();
        
        // Bilgi mesajı göster
        showGlobalMessage(`Seviye ${level} başlıyor!`, false);
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
