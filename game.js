// Dosya Adı: game.js
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';

// --- DOM Referansları (index.html'den alınmıştır) ---
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
const LEVELS = [12, 16, 20]; 
let gameStage = 'SELECTION'; 
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
    // Kart içeriklerini (Emoji çiftlerini) rastgele dağıtır
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
        content: cardContents[index], // Emoji burada atanır
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
            // SADECE SEÇENİN GÖRDÜĞÜ KIRMIZILIK
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
    
    // Can durumuna göre kalp rengini güncelle (index.html'deki stil kullanılır)
    myLivesEl.className = myLives === 1 ? 'text-orange-500' : 'text-green-600';
    opponentLivesEl.className = opponentLives === 1 ? 'text-orange-500' : 'text-green-600';

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

// --- ANIMASYON VE SES --- (Aynı kalır)
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
        
        // 3 bomba seçildiğinde otomatik olarak gönder
        if (selectedBombs.length === 3) {
            socket.emit('bombSelectionComplete', { roomCode: currentRoomCode, isHost: isHost, bombs: selectedBombs });
            updateStatusDisplay();
        }
    } else if (gameStage === 'PLAY') {
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

async function applyMove(index, nextTurn) {
    if (gameData.board[index].opened) return;

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
        // Kart içeriği zaten initializeGame'de atanmıştı, burada sadece açıyoruz.
        // Eşleşen kart bulma mantığı sunucuda yapılmalı. Burada sadece açılan emojiyi gösteriyoruz.
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    setTimeout(() => {
        gameData.turn = nextTurn;
        updateStatusDisplay();
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0 || gameData.cardsLeft === 0) {
            let winner;
            if (gameData.hostLives <= 0 && gameData.guestLives <= 0) {
                winner = 'DRAW';
            } else if (gameData.hostLives <= 0) {
                winner = 'Guest';
            } else if (gameData.guestLives <= 0) {
                winner = 'Host';
            } else {
                winner = 'LEVEL_UP';
            }
            endGame(winner);
        }
        
    }, 1000);
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    let winnerDisplay = '';
    
    if (winnerRole === 'LEVEL_UP' || gameData.cardsLeft === 0) {
        winnerDisplay = "SEVİYE YÜKSELTİLİYOR";
    } else if (winnerRole === 'DRAW') {
        winnerDisplay = 'BERABERLİK';
    } else {
        winnerDisplay = winnerRole === (isHost ? 'Host' : 'Guest') ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
    }

    turnStatusEl.textContent = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
    actionMessageEl.textContent = `Devam etmek için bekleniyor...`;
    
    setTimeout(() => {
        if (winnerRole === 'LEVEL_UP' && level < LEVELS.length) {
            level++;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
            
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
            }
            initializeGame(LEVELS[level - 1]);
            drawBoard();
            updateStatusDisplay();
            
        } else {
             showGlobalMessage("Oyun sona erdi veya tüm seviyeler tamamlandı.", false);
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

    level = 1; 
    initializeGame(LEVELS[level - 1]);
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Bomba seçimine geçiliyor.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    socket.on('bombSelectionComplete', ({ isHost: selectionHost, bombs }) => {
        if (selectionHost) {
            gameData.hostBombs = bombs;
        } else {
            gameData.guestBombs = bombs;
        }
        
        if (gameData.hostBombs.length === 3 && gameData.guestBombs.length === 3) {
            if (gameStage !== 'PLAY') {
                gameStage = 'PLAY'; 
                gameData.turn = 0; // HOST başlar
                showGlobalMessage('İki oyuncu da hazır! Kart açma aşaması başladı.', false);
                drawBoard(); 
            }
        } else {
            actionMessageEl.textContent = "Rakip bombasını seçti. Lütfen siz de 3 bomba seçin.";
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
