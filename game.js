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
// Düzeltme: index.html'den doğru çekilir
const readyToPlayBtn = document.getElementById('readyToPlayBtn'); 

// SESLER (Varsayım: Bu dosyalar projenizde mevcut.)
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

// --- OYUN DURUMU ---
let level = 1; 
const LEVELS = [16, 20, 24]; 
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; 

let gameData = {
    board: [], 
    turn: 0,   // 0 = Host, 1 = Guest
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

// --- KEEP ALIVE ---
function startKeepAlive() {
    setInterval(() => {
        fetch(window.location.origin + '/', { method: 'GET' })
            .catch(error => {});
    }, 600000); 
}

// --- TEMEL UI FONKSİYONLARI ---
export function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        if (screen) { 
            screen.classList.remove('active');
        }
    });
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
function initializeGame(initialBoardSize) {
    const pairs = initialBoardSize / 2; 
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji);
    }
    
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[j], cardContents[i]];
    }

    gameData.board = Array(initialBoardSize).fill(null).map((_, index) => ({
        opened: false,
        content: cardContents[index], 
        isBomb: false
    }));
    
    gameData.cardsLeft = initialBoardSize;
    gameData.hostLives = 2;
    gameData.guestLives = 2;
    gameData.hostBombs = [];
    gameData.guestBombs = [];
    selectedBombs = [];
    gameData.turn = 0;
    gameData.isGameOver = false;
    gameStage = 'SELECTION'; 
    if (readyToPlayBtn) {
         readyToPlayBtn.classList.remove('ready-sent');
         readyToPlayBtn.textContent = 'HAZIR';
    }
}

function drawBoard() {
    const boardSize = LEVELS[level - 1];
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; 
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
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
        back.textContent = cardState.content; 

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        if (cardState.opened) {
            card.classList.add('flipped');
        } else {
            if (gameStage === 'SELECTION' && selectedBombs.includes(index)) {
                card.classList.add('bomb-selected'); 
            }
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

    if (gameStage === 'SELECTION') {
        const myBombsCount = selectedBombs.length;
        
        if (myBombsCount < 3) {
            turnStatusEl.textContent = `Bomba Seç: ${myBombsCount} / 3`;
            actionMessageEl.textContent = "3 adet gizli bombayı seçin.";
            if (readyToPlayBtn) readyToPlayBtn.style.display = 'none'; 
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            if (readyToPlayBtn && readyToPlayBtn.classList.contains('ready-sent')) {
                turnStatusEl.textContent = `Rakip bekleniyor...`;
                actionMessageEl.textContent = "Hazır sinyaliniz gönderildi. Rakip bekleniyor.";
                if (readyToPlayBtn) readyToPlayBtn.style.display = 'none'; 
            } else {
                turnStatusEl.textContent = `HAZIR MISIN?`;
                actionMessageEl.textContent = "3 bombayı seçtin. BAŞLAMAK İÇİN HAZIR'a bas.";
                if (readyToPlayBtn) {
                     readyToPlayBtn.style.display = 'block';
                     readyToPlayBtn.disabled = false; 
                }
            }
        }
    } else if (gameStage === 'PLAY') {
        if (readyToPlayBtn) readyToPlayBtn.style.display = 'none'; 
        
        if (isMyTurn) {
            turnStatusEl.textContent = 'SIRA SENDE!';
            actionMessageEl.textContent = "Bir kart aç!";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = 'RAKİBİN SIRASI';
            actionMessageEl.textContent = "Rakibin hareketini bekle.";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver) {
        if (readyToPlayBtn) readyToPlayBtn.style.display = 'none';
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
}

// ... (Animasyonlar) ...
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

    if (gameStage === 'SELECTION') {
        if (selectedBombs.includes(cardIndex)) {
            selectedBombs = selectedBombs.filter(i => i !== cardIndex);
        } else if (selectedBombs.length < 3) {
            selectedBombs.push(cardIndex);
        }
        drawBoard(); 
        
        if (selectedBombs.length === 3 && readyToPlayBtn) {
            readyToPlayBtn.disabled = false;
        }
    } else if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) return; 
        
        sendMove(cardIndex);
    }
}

// HAZIR BUTONU İŞLEYİCİSİ
if (readyToPlayBtn) { 
    readyToPlayBtn.addEventListener('click', () => {
        if (selectedBombs.length === 3 && socket && socket.connected) {
            // Sunucuya bombaları göndererek hazır olduğunu bildir
            socket.emit('bombSelectionComplete', { roomCode: currentRoomCode, bombs: selectedBombs });
            
            readyToPlayBtn.disabled = true;
            readyToPlayBtn.classList.add('ready-sent');
            readyToPlayBtn.textContent = 'BEKLENİYOR...';
            updateStatusDisplay();
        }
    });
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

async function applyMove(index, nextTurn) {
    if (gameData.board[index].opened) return;

    const currentTurnRole = gameData.turn === 0 ? 'Host' : 'Guest';
    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs; 
    const hitBomb = opponentBombs.includes(index); 
    
    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    const cardElement = gameBoardEl.querySelector(`.card[data-index='${index}']`);
    if (cardElement) {
         cardElement.classList.add('flipped'); 
    }
    
    if (hitBomb) {
        if (currentTurnRole === 'Host') {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        if (cardElement) {
            cardElement.querySelector('.card-face.back').textContent = '💣';
        }
        
        playSound(audioBomb);
        
        const loserRoleDisplay = currentTurnRole === (isHost ? 'Host' : 'Guest') ? 'SİZ' : 'RAKİP';
        showGlobalMessage(`BOOM! ${loserRoleDisplay} bombaya bastı! Can: -1`, true);
    } else {
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    setTimeout(() => {
        gameData.turn = nextTurn;
        updateStatusDisplay();
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0 || gameData.cardsLeft === 0) {
            let winnerRole;
            if (gameData.hostLives <= 0 && gameData.guestLives <= 0) {
                winnerRole = 'DRAW';
            } else if (gameData.hostLives <= 0) {
                winnerRole = 'Guest';
            } else if (gameData.guestLives <= 0) {
                winnerRole = 'Host';
            } else {
                winnerRole = 'LEVEL_UP'; 
            }
            endGame(winnerRole);
        }
    }, 1000);
}

// ... (endGame fonksiyonu) ...
function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';

    let reason = "";
    let winnerDisplay = "";
    
    if (winnerRole === 'DRAW') {
        reason = "Canlar bittiği için";
        winnerDisplay = "BERABERLİK";
    } else if (winnerRole === 'Host' || winnerRole === 'Guest') {
        reason = "Canlar bittiği için";
        winnerDisplay = winnerRole === (isHost ? 'Host' : 'Guest') ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
    } else if (winnerRole === 'LEVEL_UP' || gameData.cardsLeft === 0) {
        reason = "Seviye tamamlandı";
        winnerDisplay = "SEVİYE YÜKSELTİLİYOR";
    }

    turnStatusEl.textContent = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
    actionMessageEl.textContent = `${reason} seviye ilerleniyor...`;
    
    setTimeout(() => {
        if (level < LEVELS.length) {
            level++;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
            socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
        } else {
             showGlobalMessage("Oyunun tüm seviyeleri tamamlandı!", false);
             resetGame();
        }
    }, 4000);
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";

    if (readyToPlayBtn) {
        readyToPlayBtn.classList.remove('ready-sent');
        readyToPlayBtn.textContent = 'HAZIR';
    }

    level = 1; 
    initializeGame(LEVELS[level - 1]);
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! ${LEVELS[level-1]} kartlık bomba seçimine geçiliyor.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---
    socket.on('bombSelectionComplete', ({ isHost: selectionHost, bombs }) => {
        if (selectionHost) {
            gameData.hostBombs = bombs;
        } else {
            gameData.guestBombs = bombs;
        }
        
        const hostReady = gameData.hostBombs.length === 3;
        const guestReady = gameData.guestBombs.length === 3;

        if (hostReady && guestReady) {
            if (gameStage !== 'PLAY') {
                gameStage = 'PLAY'; 
                gameData.turn = 0; // HOST başlar
                showGlobalMessage('İki oyuncu da HAZIR! Kart açma aşaması başladı.', false);
                drawBoard(); 
            }
        } 
        updateStatusDisplay(); 
    });

    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const nextTurn = gameData.turn === 0 ? 1 : 0; 
            applyMove(data.cardIndex, nextTurn); 
        }
    });

    socket.on('nextLevel', ({ newLevel }) => {
        level = newLevel;
        initializeGame(LEVELS[level - 1]); // Yeni seviye kartlarını hazırlar
        drawBoard();
        updateStatusDisplay();
    });
    
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });

    startKeepAlive();
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
