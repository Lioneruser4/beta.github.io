// Dosya Adı: game.js
// Socket nesnesi (index.html'den gelecek)
let socket;
let currentRoomCode = '';
let isHost = false;

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
const matchBtn = document.getElementById('matchBtn'); // Lobi butonu
const usernameInput = document.getElementById('username');
const roomCodeInput = document.getElementById('roomCodeInput');

// SESLER
const audioBomb = new Audio('sound1.mp3'); 
const audioEmoji = new Audio('sound2.mp3');
const audioWait = new Audio('sound3.mp3'); 

// --- OYUN DURUMU ---
let level = 1; 
const LEVELS = [18, 22, 28]; 
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; // Kendi seçtiğimiz bombalar

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
    gameBoardEl.style.gridTemplateColumns = `repeat(${boardSize <= 22 ? 6 : 7}, 1fr)`;
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';

        const card = document.createElement('div');
        card.className = `card cursor-pointer`;
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face card-front text-gray-100';
        front.textContent = '?';
        
        const back = document.createElement('div');
        back.className = 'card-face card-back';
        back.textContent = cardState.content;

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        if (cardState.opened) {
            card.classList.add('is-flipped');
        } else {
            if (gameStage === 'SELECTION') {
               if (selectedBombs.includes(index)) {
                    card.classList.add('bomb-selected');
                }
            }
            card.addEventListener('click', handleCardClick);
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
        if (selectedBombs.length < 3) {
            turnStatusEl.textContent = `Bomba Seç: ${selectedBombs.length} / 3`;
            actionMessageEl.textContent = "3 adet gizli bombayı seçin.";
        } else {
            turnStatusEl.textContent = `Rakip Bombasını Seçiyor...`;
            actionMessageEl.textContent = "Seçiminiz tamamlandı. Rakibi bekleyin.";
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

// --- ANIMASYON VE SES ---

function startVibration() {
    const cardContainers = gameBoardEl.querySelectorAll('.card-container');
    cardContainers.forEach(container => {
        const card = container.querySelector('.card');
        if (!card.classList.contains('is-flipped')) {
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

async function triggerWaitAndVibrate() {
     if (gameData.cardsLeft < 8 && gameStage === 'PLAY') { 
        startVibration();
        await new Promise(resolve => setTimeout(resolve, 2000));
        stopVibration();
    }
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
            socket.emit('bombSelectionComplete', { roomCode: currentRoomCode, isHost, bombs: selectedBombs });
            updateStatusDisplay();
        }
    } else if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.board[cardIndex].opened || gameData.isGameOver) return; 
        
        sendMove(cardIndex);
        
        // Kendi hareketimizi hemen uygulamıyoruz, önce sunucuya gidip geri gelmesini bekliyoruz
        // Aksi takdirde senkronizasyon bozulabilir.
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

    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs;
    const hitBomb = opponentBombs.includes(index);
    
    if (hitBomb) {
        gameData.board[index].content = '💣';
        if (gameData.turn === 0) { // Host sırasıysa
            gameData.hostLives--;
        } else { // Guest sırasıysa
            gameData.guestLives--;
        }
        
        audioBomb.play().catch(() => {});
        showGlobalMessage(`BOOM! Bomba bulundu. Rakip: ${opponentLivesEl.textContent}`, true);
    } else {
        gameData.board[index].content = EMOTICONS[Math.floor(Math.random() * EMOTICONS.length)];
        audioEmoji.play().catch(() => {});
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
    
    setTimeout(() => {
        if (level < LEVELS.length) {
            level++;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart!`, false);
            
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
            }
             // Yeni seviye sinyali gelirse/giderse initializeGame çağrılacak
        } else {
             showGlobalMessage("Oyunun tüm seviyeleri tamamlandı!", false);
             // Tüm seviyeler bittiğinde lobiye dönme butonu vb. eklenebilir.
        }
    }, 4000);
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentName) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";

    initializeGame(LEVELS[level - 1]);
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Bomba seçimine geçiliyor.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Bomb Seçimi Tamamlandı
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

    // gameData Olayı (Rakibin Hareketi Geldi)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const opponentTurn = gameData.turn; 
            const nextTurn = 1 - opponentTurn; 
            
            applyMove(data.cardIndex, nextTurn); 
        }
    });

    // Seviye Atlama Sinyali
     socket.on('nextLevel', ({ newLevel }) => {
        level = newLevel;
        showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
        initializeGame(LEVELS[level - 1]);
        drawBoard();
        updateStatusDisplay();
    });
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

function resetGame() {
    // Tüm oyun ayarlarını sıfırlar ve lobiye döner
    // Bu fonksiyonu index.html'deki butonlar kullanacak
    currentRoomCode = '';
    level = 1;
    showScreen('lobby');
    // Sayfayı yeniden yüklemek en temizidir
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz
export const UIElements = {
    matchBtn, roomCodeInput, usernameInput, showGlobalMessage, resetGame
};
