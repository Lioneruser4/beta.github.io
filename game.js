// Dosya Adı: game.js

// 🚨 KRİTİK DÜZELTME: Socket.IO bağlantısı ve olay yöneticileri bu dosyanın en üstüne eklendi.
// Lütfen bu adresin Render'daki canlı adresiniz olduğundan emin olun:
const RENDER_SERVER_URL = "https://beta-github-io.onrender.com"; 

const socket = io(RENDER_SERVER_URL, {
    transports: ['websocket', 'polling']
});

let currentUsername = '';
let currentRoomCode = '';
let isHost = false;
let opponentName = '';
let level = 1; 
let gameStage = 'SELECTION'; // 'SELECTION', 'PLAY', 'WAITING' veya 'ENDED'

// Level'a göre bomba sayısını belirleyen yardımcı fonksiyon
const getBombCount = (level) => level === 1 ? 3 : 4;
// Level'a göre kart sayısını belirleyen yardımcı fonksiyon
const getBoardSize = (level) => level === 1 ? 16 : 20;

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


// --- DOM Referansları (Erişilebilir olması için tüm fonksiyonların dışında) ---
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

// Lobi Butonları
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const usernameInput = document.getElementById('username');
const matchBtn = document.getElementById('matchBtn'); // Placeholder olarak kalabilir

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
    
    const bombCount = getBombCount(level);
    
    gameData.hostLives = bombCount;
    gameData.guestLives = bombCount;
    
    gameStage = 'WAITING'; 
    
    updateStatusDisplay();
    drawBoard(); 
}

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

// --- TEMEL UI FONKSİYONLARI ---

function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
}

function showGlobalMessage(message, isError = true) {
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
    
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; 
    
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
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
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "🎮 Rol: HOST" : "🎮 Rol: GUEST";

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

// --- HAREKET İŞLEYİCİLERİ ---

async function handleCardClick(event) {
    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) {
            showGlobalMessage('Sıra sende değil!', true);
            return;
        } 
        
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

    // Vibration ve ses mantığı buraya eklenebilir

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    gameData.hostLives = newHostLives;
    gameData.guestLives = newGuestLives;
    gameData.turn = newTurn; 

    if (isBomb) {
        gameData.board[index].content = '💣';
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Bombaya bastınız!`, true);
    } else {
        gameData.board[index].content = emoji;
        playSound(audioEmoji);
    }
    
    drawBoard();
    
    setTimeout(() => {
        updateStatusDisplay();
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            endGame(); 
        } else {
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
        showGlobalMessage('🤝 Beraberlik! Yeniden dene.', false);
    } else if (iWon) {
        showGlobalMessage('🎉 Kazandın! Yeni seviyeye geçiliyor...', false);
    } else {
        showGlobalMessage('😔 Kaybettin. Yeni seviyeye geçiliyor...', true);
    }
    
    triggerNextLevel(level + 1); 
}

function checkLevelCompletion() {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;
    
    const openedCards = gameData.board.filter(card => card && card.opened).length;
    const totalCards = gameData.board.length;
    
    if (openedCards === totalCards) {
        showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
        triggerNextLevel(level + 1);
    }
};

function triggerNextLevel(nextLevel) {
    if (gameStage === 'ENDED' || gameStage === 'WAITING') return;
    
    gameStage = 'WAITING';
    gameData.isGameOver = true;
    updateStatusDisplay();

    setTimeout(() => {
        if (socket && socket.connected) {
            socket.emit('levelComplete', { 
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        }
    }, 2000);
}

function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    level = 1; 
    const initialBoardSize = getBoardSize(level);
    initializeGame(initialBoardSize);
}

function resetGame() {
    window.location.reload(); 
}

// --- SOCKET.IO İŞLEYİCİLERİ ---

// 1. BAĞLANTI VE HATA YÖNETİMİ
socket.on('connect', () => {
    console.log(`[SOCKET] Sunucuya başarıyla bağlandı. ID: ${socket.id}`);
    showGlobalMessage('Sunucuya bağlandı. Oda kurabilir veya katılabilirsiniz.', false);
    if (createRoomBtn && joinRoomBtn) {
        createRoomBtn.disabled = false;
        joinRoomBtn.disabled = false;
    }
});

socket.on('connect_error', (err) => {
    console.error(`[SOCKET HATA] Bağlantı hatası: ${err.message}`);
    showGlobalMessage('Sunucuya bağlanılamadı. Lütfen Render URL\'nizi kontrol edin.', true);
});

// 2. ODA KURMA
createRoomBtn.addEventListener('click', () => {
    currentUsername = usernameInput.value.trim();
    if (!currentUsername) {
        showGlobalMessage('Lütfen kullanıcı adınızı girin.', true);
        return;
    }
    socket.emit('createRoom', { username: currentUsername });
});

socket.on('roomCreated', (roomCode) => {
    console.log(`[EVENT] Oda başarıyla kuruldu: ${roomCode}`);
    showScreen('wait');
    document.getElementById('roomCodeDisplay').textContent = roomCode;
    setupSocketHandlers(socket, roomCode, true, 'Rakip bekleniyor...');
});

// 3. ODAYA KATILMA
joinRoomBtn.addEventListener('click', () => {
    currentUsername = usernameInput.value.trim();
    const roomCode = roomCodeInput.value.trim();
    
    if (!currentUsername || !roomCode) {
        showGlobalMessage('Lütfen hem kullanıcı adınızı hem de oda kodunu girin.', true);
        return;
    }
    socket.emit('joinRoom', { username: currentUsername, roomCode: roomCode });
});

socket.on('roomJoined', (roomCode) => {
    console.log(`[EVENT] Odaya başarıyla katıldı: ${roomCode}`);
});

socket.on('joinFailed', (message) => {
    console.log(`[EVENT] Odaya katılamadı: ${message}`);
    showGlobalMessage(message, true);
});

// 4. OYUN BAŞLATMA
socket.on('gameStart', (data) => {
    console.log(`[EVENT] Oyun başlıyor: Oda ${data.roomCode}`);
    const myId = socket.id;
    
    const hostPlayer = data.players.find(p => p.isHost);
    const guestPlayer = data.players.find(p => !p.isHost);

    const isHostNow = myId === hostPlayer.id;
    const opponent = isHostNow ? guestPlayer : hostPlayer;
    
    setupSocketHandlers(socket, data.roomCode, isHostNow, opponent.username);
    showScreen('game');
    showGlobalMessage(`🎮 Oyun ${opponent.username} ile başladı!`, false);
});

// 5. OYUN DÖNGÜSÜ
socket.on('gameReady', (gameState) => {
    console.log('🚀 gameReady EVENT ALINDI!', gameState);
    
    gameData.hostBombs = gameState.hostBombs || [];
    gameData.guestBombs = gameState.guestBombs || [];
    gameData.hostLives = gameState.hostLives || getBombCount(level);
    gameData.guestLives = gameState.guestLives || getBombCount(level);
    gameData.turn = gameState.turn || 0;
    
    gameStage = 'PLAY';
    gameData.isGameOver = false;

    level = gameState.level || 1;
    const boardSize = gameState.boardSize || getBoardSize(level);
    gameData.cardsLeft = boardSize;
    gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
    
    playSound(audioEmoji);
    showGlobalMessage(`🚀 Seviye ${level} başlıyor!`, false);
    
    drawBoard();
    updateStatusDisplay();
});

socket.on('gameData', (data) => {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;
    
    if (data.type === 'MOVE') {
        applyMove(
            data.cardIndex, 
            data.emoji, 
            data.isBomb, 
            data.hostLives, 
            data.guestLives, 
            data.turn
        ); 
    }
});

socket.on('newLevel', (data) => {
    console.log('🆕 Yeni seviye başlatılıyor:', data);
    
    level = parseInt(data.level) || 1;
    const bombCount = getBombCount(level);
    const boardSize = getBoardSize(level);
    
    gameData = {
        board: Array.from({ length: boardSize }, () => ({ opened: false, content: '' })),
        turn: 0,
        hostLives: data.hostLives || bombCount,
        guestLives: data.guestLives || bombCount,
        cardsLeft: boardSize, 
        hostBombs: [],
        guestBombs: [],
        isGameOver: false
    };
    
    gameStage = 'WAITING';
    drawBoard();
    updateStatusDisplay();
    showGlobalMessage(`🎮 Seviye ${level} yükleniyor!`, false);
});

socket.on('error', (message) => {
    showGlobalMessage(message, true);
});

socket.on('opponentLeft', (message) => {
    showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
    resetGame();
});

// ******************************************************************************
// * NOT: Bu dosya artık tüm bağlantı ve oyun mantığını içerdiği için,           *
// * index.html dosyanızda sadece bu dosyayı yüklemeniz yeterlidir.             *
// ******************************************************************************
