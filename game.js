// Dosya Adı: game.js (BOMBALI HAFIZA İSTEMCİ V3)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
const ANIMATION_DELAY = 1000; // Kart açma animasyonu süresi (MS)

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

// --- SESLER (Kullanılmıyorsa kaldırılabilir, örnek amaçlı tutulmuştur)
// const audioBomb = new Audio('sound1.mp3'); 
// const audioEmoji = new Audio('sound2.mp3');

// --- OYUN DURUMU ---
let gameData = {
    board: [], // Sadece içeriği tutar (Emoji)
    openedCards: [], // Açık kartların indeksleri
    turn: 0,   
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    level: 1,
    isGameOver: false,
    isAnimating: false // Sadece animasyon süresince tıklamayı engeller
};

const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉'];

// --- TEMEL UI FONKSİYONLARI ---
export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen && screen.classList.remove('active'));
    if (screens[screenId]) {
        screens[screenId].classList.add('active');
    }
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    const globalMessageText = document.getElementById('globalMessageText');
    if (!globalMessage || !globalMessageText) return;

    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.remove('hidden');
    globalMessage.classList.add('show');
    setTimeout(() => { globalMessage.classList.add('hidden'); globalMessage.classList.remove('show'); }, 4000);
}

// --- OYUN MANTIĞI VE ÇİZİM ---

function initializeGame(boardSize, hostBombs, guestBombs, currentLevel, initialTurn, initialLives) {
    gameData.level = currentLevel;
    gameData.hostBombs = hostBombs;
    gameData.guestBombs = guestBombs;
    gameData.hostLives = initialLives;
    gameData.guestLives = initialLives;
    gameData.openedCards = [];
    gameData.cardsLeft = boardSize;
    gameData.turn = initialTurn; 
    gameData.isGameOver = false;
    gameData.isAnimating = false;
    
    // Kart içerikleri oluşturma ve karıştırma
    const pairs = boardSize / 2; 
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji);
    }
    
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[i], cardContents[j]];
    }

    gameData.board = cardContents;
}

function drawBoard() {
    // Board boyutuna göre grid sayısını ayarla
    let columns = 4;
    if (gameData.board.length === 20) columns = 5;
    
    gameBoardEl.className = `grid w-full max-w-sm mx-auto memory-board grid-cols-${columns}`; 
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((content, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';

        const card = document.createElement('div');
        card.className = `card cursor-pointer`;
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face front';
        front.textContent = '?';
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        
        // Bomba mı emoji mi olduğunu belirle
        const isMyBomb = isHost ? gameData.hostBombs.includes(index) : gameData.guestBombs.includes(index);
        const isOpponentBomb = isHost ? gameData.guestBombs.includes(index) : gameData.hostBombs.includes(index);
        
        let displayContent = content;
        if (isOpponentBomb) {
            displayContent = '💣';
            back.classList.add('bg-red-200');
        } else if (isMyBomb) {
            // Kendi bombamızı rakibe göstermeyiz, sadece rakibin bombası önemlidir
        }

        back.textContent = displayContent;


        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        // Açık kartlar kontrolü
        if (gameData.openedCards.includes(index)) {
            card.classList.add('flipped');
        } else {
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

    const myTurnId = isHost ? 0 : 1;
    const isMyTurn = gameData.turn === myTurnId;
    
    const levelInfo = `Level ${gameData.level} - ${gameData.board.length} Kart`;
        
    if (gameData.isGameOver) {
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
    else if (isMyTurn) {
        turnStatusEl.textContent = 'SIRA SENDE!';
        actionMessageEl.textContent = levelInfo + " - Bir kart aç!";
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-green-600');
    } else {
        turnStatusEl.textContent = 'RAKİBİN SIRASI';
        actionMessageEl.textContent = levelInfo + " - Rakibini bekle.";
        turnStatusEl.classList.remove('text-green-600');
        turnStatusEl.classList.add('text-red-600');
    }
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    
    if (gameData.isAnimating || gameData.isGameOver) return; 

    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    const myTurnId = isHost ? 0 : 1;
    const isMyTurn = gameData.turn === myTurnId;
        
    if (!isMyTurn) {
         showGlobalMessage("Sıra sende değil.", true);
         return;
    }
    
    // Hamleyi sunucuya gönder, gerisini sunucu halledecek
    sendMove(cardIndex);
    gameData.isAnimating = true; // Animasyon bitene kadar tıklamayı engelle
}

function sendMove(index) {
    if (socket && socket.connected) {
        socket.emit('MOVE', {
            roomCode: currentRoomCode,
            cardIndex: index,
        });
    }
}

// KRİTİK: Sunucudan gelen oyun durumunu işler
async function handleGameStateUpdate(data) {
    
    const { moveResult, newTurn, hostLives, guestLives, cardsLeft } = data;
    const { cardIndex, hitBomb, gameOver, winner } = moveResult;
    
    // 1. Kartı Aç (Görsel Animasyon)
    const cardElement = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (cardElement) {
        cardElement.classList.add('flipped');
        
        // Bombaysa titreşim ekle
        if (hitBomb) {
            cardElement.classList.add('vibrate');
        }
    }
    
    // 2. Client Durumunu Güncelle (Hemen)
    gameData.hostLives = hostLives;
    gameData.guestLives = guestLives;
    gameData.cardsLeft = cardsLeft;
    gameData.openedCards.push(cardIndex);

    // 3. Mesaj Göster
    const playerWhoMoved = (gameData.turn === (isHost ? 0 : 1)) ? 'SİZ' : 'Rakibiniz';
    if (hitBomb) {
         showGlobalMessage(`${playerWhoMoved} bombaya bastı! Can: -1`, true);
    } else {
         showGlobalMessage(`${playerWhoMoved} güvenli kart açtı.`, false);
    }
    
    // 4. Animasyon Bitişini Bekle
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAY));
    
    // 5. Animasyon Kilitini Kaldır ve Titreşimi Temizle
    gameData.isAnimating = false;
    if (cardElement) {
        cardElement.classList.remove('vibrate');
    }

    // 6. Oyun Bitiş Kontrolü
    if (gameOver) {
        gameData.isGameOver = true;
        handleGameEnd(winner);
        return;
    }

    // 7. Sırayı Güncelle ve UI'yi Çiz
    gameData.turn = newTurn;
    drawBoard();
}

function handleGameEnd(winnerRole) {
    
    let endMessage = "";
    
    if (winnerRole === 'LEVEL_COMPLETE' && gameData.level < 3) { // 3 Max seviye kabul edelim
        endMessage = `SEVİYE ${gameData.level} TAMAMLANDI! ${gameData.level + 1}. seviyeye geçiliyor...`;
        showGlobalMessage(endMessage, false);
        
        if (isHost) {
            // Sadece Host, yeni seviye sinyalini gönderir
            setTimeout(() => {
                 socket.emit('nextLevelReady', { roomCode: currentRoomCode });
            }, 3000);
        }
        
    } else if (winnerRole === 'LEVEL_COMPLETE' && gameData.level >= 3) {
        endMessage = "TEBRİKLER! TÜM SEVİYELERİ KAZANDINIZ!";
        showGlobalMessage(endMessage, false);
        setTimeout(resetGame, 5000);
        
    } else {
        const winnerDisplay = (winnerRole === 'Host') === isHost ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
        if (winnerRole === 'DRAW') winnerDisplay = "BERABERLİK";
        
        endMessage = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
        showGlobalMessage(endMessage, winnerRole === 'DRAW' || (winnerRole === 'Host') !== isHost);
        setTimeout(resetGame, 5000);
    }
    
    updateStatusDisplay();
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---

export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex, initialData) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";
    
    initializeGame(
        initialData.boardSize, 
        initialData.hostBombs, 
        initialData.guestBombs, 
        initialData.level,
        initialData.initialTurn,
        initialData.initialLives 
    );
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı!`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Oyun Durumu Güncellemesi (Hareketin sonucu)
    socket.on('gameStateUpdate', handleGameStateUpdate);

    // Sunucudan gelen bilgilendirme mesajları (örn: geçersiz hamle)
    socket.on('infoMessage', (data) => {
        showGlobalMessage(data.message, data.isError);
        gameData.isAnimating = false; // Hata olduysa animasyon kilidini kaldır
    });

    // Seviye Atlama Sinyali
    socket.on('nextLevel', (data) => {
        showGlobalMessage(`Yeni Seviye: ${data.boardSize} Kart!`, false);
        initializeGame(
            data.boardSize, 
            data.hostBombs, 
            data.guestBombs, 
            data.newLevel,
            data.initialTurn,
            data.initialLives
        );
        drawBoard();
    });
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    window.location.reload(); 
}

export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
