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
const levelDisplayEl = document.getElementById('levelDisplay');
const myLivesEl = document.getElementById('myLives');
const opponentLivesEl = document.getElementById('opponentLives');
const opponentNameEl = document.getElementById('opponentName');
const myRoleEl = document.getElementById('myRole');
const opponentRoleEl = document.getElementById('opponentRole');

// Chat Elementləri
const chatMessagesEl = document.getElementById('chatMessages');
const chatInputEl = document.getElementById('chatInput');
const chatSendBtnEl = document.getElementById('chatSendBtn');

// Oyun Vəziyyəti (Serverdən gələn məlumatla dolacaq)
let gameData = {
    level: 1,
    boardSize: 20,
    turn: 0, 
    hostLives: 0, 
    guestLives: 0,
    hostBombs: [], 
    guestBombs: [],
    opened: [] // Açılmış kartların indeksləri
};

// --- TEMEL UI FONKSİYONLARI (Export edilir) ---

export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    const globalMessageText = document.getElementById('globalMessageText');
    
    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600', 'hidden');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.add('show');
    
    setTimeout(() => { 
        globalMessage.classList.remove('show');
        globalMessage.classList.add('hidden');
    }, 4000);
}

// Oyunu sıfırla (Ən təhlükəsiz yol: Səhifəni yenilə)
export function resetGame() {
    window.location.reload(); 
}

// --- OYUN MƏNTİQİ VƏ ÇƏKİM ---

// Oyun taxtasını çəkir
function drawBoard() {
    gameBoardEl.innerHTML = '';
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; // 4x5 = 20 Kart
    
    for (let i = 0; i < gameData.boardSize; i++) {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container';

        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = i;

        const front = document.createElement('div');
        front.className = 'card-face front';
        front.textContent = '?';
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        // Məzmunu serverdən gələn məlumata görə təyin edəcəyik

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        // Klikləmə hadisəsi
        cardContainer.addEventListener('click', handleCardClick);
        gameBoardEl.appendChild(cardContainer);
    }
}

// UI-da Can, Səviyyə və Növbəni yeniləyir
function updateStatusDisplay() {
    // Canlar
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, isHost ? gameData.hostLives : gameData.guestLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, isHost ? gameData.guestLives : gameData.hostLives));
    
    // Səviyyə
    levelDisplayEl.textContent = gameData.level;
    
    // Rollar
    myRoleEl.textContent = t(isHost ? 'roleHost' : 'roleGuest');
    opponentRoleEl.textContent = t(isHost ? 'roleGuest' : 'roleHost');
    opponentNameEl.textContent = opponentName.toUpperCase();

    // Növbə
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    
    if (isMyTurn) {
        turnStatusEl.textContent = t('yourTurn');
        turnStatusEl.classList.remove('text-red-600', 'animate-pulse');
        turnStatusEl.classList.add('text-green-600');
    } else {
        turnStatusEl.textContent = t('opponentTurn');
        turnStatusEl.classList.remove('text-green-600');
        turnStatusEl.classList.add('text-red-600', 'animate-pulse');
    }
}

// Kartı çevir (Serverdən gələn məlumata görə)
function flipCard(index, emoji, isBomb, newTurn) {
    const card = gameBoardEl.querySelector(`.card[data-index="${index}"]`);
    if (!card || card.classList.contains('flipped')) return;

    card.classList.add('flipped');
    card.querySelector('.back').textContent = emoji;
    gameData.opened.push(index); // Açılanlara əlavə et
    
    // Növbəni yenilə
    gameData.turn = newTurn;

    if (isBomb) {
        // Hərəkəti edən oyunçu can itirir
        const playerWhoMovedWasHost = (newTurn === 1); // Növbə qonağa keçdisə, host oynamışdı
        
        if (playerWhoMovedWasHost) {
            gameData.hostLives--;
        } else {
            gameData.guestLives--;
        }
        
        card.classList.add('vibrate'); // Titrəmə effekti
        showGlobalMessage(t('bombExploded'), true);
        
        // Oyun bitdimi yoxla (Can itkisi ilə)
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            endGame();
        }

    } else {
        // Kart bomba deyilsə, səviyyə bitdimi yoxla
        checkLevelCompletion();
    }
    
    // UI-ı yenilə
    updateStatusDisplay();
}

// Oyun sonu
function endGame() {
    gameData.stage = 'ENDED'; // Yeni hərəkətlərin qarşısını al
    
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;

    let msgKey;
    if (myLives > opponentLives) msgKey = 'youWon';
    else if (myLives < opponentLives) msgKey = 'youLost';
    else msgKey = 'draw'; // Adətən canlar bərabər bitmir, amma ehtimaldır

    turnStatusEl.textContent = t(msgKey);
    showGlobalMessage(t('gameOver') + " " + t(msgKey), myLives <= 0);

    // 4 saniyə sonra lobiyə (səhifə yenilənməsi)
    setTimeout(() => {
        resetGame();
    }, 4000);
}

// Səviyyə tamamlanmasını yoxla
function checkLevelCompletion() {
    if (gameData.stage === 'ENDED') return;

    const totalBombs = gameData.hostBombs.length + gameData.guestBombs.length;
    const totalNonBombs = gameData.boardSize - totalBombs;

    if (gameData.opened.length === totalNonBombs) {
        // Bütün təhlükəsiz kartlar açıldı!
        gameData.stage = 'LEVEL_UP';
        showGlobalMessage(t('levelComplete', { level: gameData.level }), false);

        // Yalnız Host növbəti səviyyə üçün serverə müraciət edir
        if (isHost) {
            setTimeout(() => {
                socket.emit('levelComplete', {
                    roomCode: currentRoomCode,
                    level: gameData.level
                });
            }, 2000); // 2 saniyə gözlə
        }
    }
}

// --- HƏRƏKƏT İŞLƏYİCİLƏRİ (Event Handlers) ---

function handleCardClick(event) {
    // Tıklanan elementin `.card`-ın özü olduğundan əmin ol
    const card = event.currentTarget.querySelector('.card');
    if (!card) return;
    
    const cardIndex = parseInt(card.dataset.index);

    // Oyun vəziyyətini yoxla
    if (gameData.stage !== 'PLAY') return;
    
    // Növbəni yoxla
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    if (!isMyTurn) {
        showGlobalMessage(t('opponentTurn'), true);
        return;
    }
    
    // Kartın artıq açılıb-açılmadığını yoxla
    if (gameData.opened.includes(cardIndex)) {
        showGlobalMessage(t('cardOpened'), true);
        return;
    }

    // Hərəkəti serverə göndər
    socket.emit('gameData', {
        roomCode: currentRoomCode,
        type: 'MOVE',
        cardIndex: cardIndex,
    });
}

// Chat mesajı göndərmə
function handleSendMessage() {
    const message = chatInputEl.value.trim();
    if (message && socket) {
        socket.emit('chatMessage', { roomCode: currentRoomCode, message });
        chatInputEl.value = '';
    }
}

// Gələn chat mesajını göstər
function displayChatMessage(username, message) {
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<strong class="text-blue-600">${username}:</strong> ${message}`;
    chatMessagesEl.appendChild(msgDiv);
    // Avtomatik aşağı çək
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// --- SOCKET.IO ÜÇÜN ƏSAS FUNKSİYA (Export edilir) ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    showScreen('game'); // Oyun ekranına keçid
    
    // Chat düymələrini aktivləşdir
    chatSendBtnEl.onclick = handleSendMessage;
    chatInputEl.onkeypress = (e) => {
        if (e.key === 'Enter') handleSendMessage();
    };

    // --- Socket Dinləyiciləri (Oyun üçün) ---

    // Oyun hazır (Level 1 və ya növbəti səviyyə)
    socket.on('gameReady', (gameState) => {
        gameData = { ...gameState, opened: [] }; // Vəziyyəti tamamilə yenilə
        gameData.stage = 'PLAY';
        
        drawBoard(); // Taxtanı çək
        updateStatusDisplay(); // UI-ı yenilə
        
        showGlobalMessage(t('levelStarting', { level: gameData.level, lives: gameData.hostLives }), false);
    });

    // Hərəkət gəldi (Kart çevrildi)
    socket.on('gameData', (data) => {
        if (data.type === 'MOVE') {
            flipCard(data.cardIndex, data.emoji, data.isBomb, data.turn);
        }
    });

    // Chat mesajı gəldi
    socket.on('chatMessage', ({ username, message }) => {
        displayChatMessage(username, message);
    });

    // Rəqib ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rəqibiniz ayrıldı.', true);
        setTimeout(resetGame, 3000);
    });

    // Server xətası
    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
}


// Lobi elementlərini index.html-dəki <script type="module"> üçün export et
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
