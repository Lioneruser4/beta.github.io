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

// SESLER (Yeni stildeki gibi cloneNode ile oynatma ekledik)
const audioBomb = new Audio('sound1.mp3'); 
const audioEmoji = new Audio('sound2.mp3');
const audioWait = new Audio('sound3.mp3'); 

// Lag-free Sound Playback Function
function playSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {}); // Otomatik oynatma hatalarını engelle
}

// --- OYUN DURUMU ---
let level = 1; 
const LEVELS = [18, 22, 28]; 
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; 

let gameData = {
    board: [], 
    turn: 0,   
    hostLives: 2,
    guestLives: 2,
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

function initializeGame(initialBoardSize) {
    gameData.board = Array(initialBoardSize).fill(null).map(() => ({
        opened: false,
        content: '?',
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
}

function drawBoard() {
    const boardSize = LEVELS[level - 1];
    // Yeni grid düzeni ve kart aralığı için CSS sınıfı ekle
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.classList.add(boardSize === 18 ? 'grid-6x3' : boardSize === 22 ? 'grid-6x4' : 'grid-7x4');
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
            
            card.addEventListener('click', handleCardClick);
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

function updateStatusDisplay() {
    // ... (UI Güncelleme Mantığı önceki gibi doğru çalışır) ...
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'SELECTION') {
        if (selectedBombs.length < 3) {
            turnStatusEl.textContent = `Bomba Seç: ${selectedBombs.length} / 3`;
            actionMessageEl.textContent = "3 adet gizli bombayı seçin.";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = `Rakip Bombasını Seçiyor...`;
            actionMessageEl.textContent = "Seçiminiz tamamlandı. Rakibi bekleyin.";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    } else if (gameStage === 'PLAY') {
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
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
}

// ... (triggerWaitAndVibrate, startVibration, stopVibration aynı kalır)

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
        if (!card.classList.contains('flipped')) {
            card.classList.add('vibrate');
        }
    });
    audioWait.play().catch(() => {});
}

function stopVibration() {
    const cardContainers = gameBoardEl.querySelectorAll('.card-container');
    cardContainers.forEach(container => {
        const card = container.querySelector('.card');
        card.classList.remove('vibrate');
    });
    audioWait.pause();
    audioWait.currentTime = 0;
}


// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    const cardElement = event.currentTarget.querySelector('.card');
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'SELECTION') {
        if (selectedBombs.includes(cardIndex)) {
            selectedBombs = selectedBombs.filter(i => i !== cardIndex);
        } else if (selectedBombs.length < 3) {
            selectedBombs.push(cardIndex);
        }
        drawBoard(); 
        
        if (selectedBombs.length === 3) {
            // Önemli: Host rolünü de gönderiyoruz.
            socket.emit('bombSelectionComplete', { roomCode: currentRoomCode, isHost: isHost, bombs: selectedBombs });
            updateStatusDisplay();
        }
    } else if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.board[cardIndex].opened || gameData.isGameOver) return; 
        
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

async function applyMove(index, nextTurn) {
    if (gameData.board[index].opened) return;

    // ÖNEMLİ: KARTIN AÇILMASI BİZİM TAHTAMIZDAKİ GİZLİ BOMBA LİSTESİNE GÖRE BELİRLENİR.
    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs;
    const hitBomb = opponentBombs.includes(index);
    
    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (hitBomb) {
        gameData.board[index].content = '💣';
        if (gameData.turn === 0) {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Rakip ${isHost ? 'Guest' : 'Host'} bombanıza bastı.`, true);
    } else {
        gameData.board[index].content = EMOTICONS[Math.floor(Math.random() * EMOTICONS.length)];
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    setTimeout(() => {
        gameData.turn = nextTurn;
        updateStatusDisplay();
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = gameData.hostLives <= 0 ? 'Guest' : 'Host';
            endGame(winner);
        }
        
    }, 1000);
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    turnStatusEl.textContent = `OYUN BİTTİ! KAZANAN: ${winnerRole}!`;
    actionMessageEl.textContent = `Yeni seviyeye geçiliyor...`;
    
    // ... (Seviye atlama mantığı aynı kalır)
    setTimeout(() => {
        if (level < LEVELS.length) {
            level++;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart!`, false);
            
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
            }
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

    initializeGame(LEVELS[level - 1]);
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Bomba seçimine geçiliyor.`, false);
    
    // ... (Socket olayları (bombSelectionComplete, gameData, nextLevel, opponentLeft) aynı kalır, sadece isHost değerinin doğru gönderildiğinden emin olduk)
    socket.on('bombSelectionComplete', ({ isHost: selectionHost, bombs }) => {
        if (selectionHost) {
            gameData.hostBombs = bombs;
        } else {
            gameData.guestBombs = bombs;
        }
        
        if (gameData.hostBombs.length === 3 && gameData.guestBombs.length === 3) {
            gameStage = 'PLAY';
            showGlobalMessage('Herkes bombasını seçti! Kart açma aşaması başlıyor.', false);
            drawBoard(); 
        } else {
            actionMessageEl.textContent = "Rakip bombasını seçti. Lütfen siz de 3 bomba seçin.";
        }
        updateStatusDisplay();
    });

    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const opponentTurn = gameData.turn; 
            const nextTurn = 1 - opponentTurn; 
            
            applyMove(data.cardIndex, nextTurn); 
        }
    });

    socket.on('nextLevel', ({ newLevel }) => {
        level = newLevel;
        showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
        initializeGame(LEVELS[level - 1]);
        drawBoard();
        updateStatusDisplay();
    });
    
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    // Sadece lobiye dönmek için kullanılır.
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
