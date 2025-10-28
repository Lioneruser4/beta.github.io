// Dosya Adı: game.js
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';

// --- DOM Referansları (Game.js'in DOM'u doğru bulması için) ---
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

function playSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {});
}

// --- OYUN DURUMU ---
let currentLevel = 1; 
const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];
const BOARD_SIZES = [16, 20, 24];
const INITIAL_LIVES = 2;

let gameData = {
    board: [], 
    turn: 0,   
    hostLives: INITIAL_LIVES,
    guestLives: INITIAL_LIVES,
    cardsLeft: 0,
    myBombIndex: -1, 
    opponentBombIndex: -1, 
    isGameOver: false
};

// --- UI FONKSİYONLARI ---
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
function initializeGame(boardSize, hostBombs, guestBombs, level) {
    currentLevel = level;
    const pairs = boardSize / 2; 
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji);
    }
    
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[j], cardContents[i]];
    }

    gameData.board = cardContents.map(content => ({
        opened: false,
        content: content, 
    }));
    
    // Bombalar
    gameData.myBombIndex = isHost ? hostBombs[0] : guestBombs[0];
    gameData.opponentBombIndex = isHost ? guestBombs[0] : hostBombs[0];
    
    gameData.hostLives = INITIAL_LIVES;
    gameData.guestLives = INITIAL_LIVES;
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; 
    gameData.isGameOver = false;
    
    drawBoard();
    updateStatusDisplay();
}

function drawBoard() {
    const boardSize = BOARD_SIZES[currentLevel - 1];
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
            cardContainer.addEventListener('click', handleCardClick);
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
}

function updateStatusDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameData.isGameOver) {
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    } else {
        turnStatusEl.classList.remove('text-red-600', 'text-green-600');
        if (isMyTurn) {
            turnStatusEl.textContent = 'SIRA SENDE!';
            actionMessageEl.textContent = "Bir kart aç!";
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = 'RAKİBİN SIRASI';
            actionMessageEl.textContent = "Rakibin hareketini bekle.";
            turnStatusEl.classList.add('text-red-600');
        }
    }
}

function handleCardClick(event) {
    const cardElement = event.currentTarget.querySelector('.card');
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    if (!isMyTurn || gameData.isGameOver) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);
    sendMove(cardIndex);
}

function sendMove(index) {
    if (!socket || !socket.connected || gameData.board[index].opened) return;

    // Client Tarafında Hamle Hesaplama
    const nextTurn = gameData.turn === 0 ? 1 : 0; 
    const { hitBomb, newHostLives, newGuestLives, cardsLeft } = applyMoveLogic(index, gameData.hostLives, gameData.guestLives, gameData.cardsLeft);

    // Sunucuya gönder
    socket.emit('gameMove', {
        roomCode: currentRoomCode,
        cardIndex: index,
        nextTurn: nextTurn,
        newHostLives: newHostLives,
        newGuestLives: newGuestLives,
        cardsLeft: cardsLeft
    });
    
    // Hamleyi kendi ekranımızda hemen uygula (Gecikmeyi azaltmak için)
    applyMove(index, nextTurn, newHostLives, newGuestLives, cardsLeft);
}

function applyMoveLogic(index, hostLives, guestLives, cardsLeft) {
    let newHostLives = hostLives;
    let newGuestLives = guestLives;

    const currentTurn = gameData.turn; 
    const isBomb = (index === gameData.opponentBombIndex || index === gameData.myBombIndex);

    if (isBomb) {
        if (currentTurn === 0) { // Host bastı
            newHostLives = Math.max(0, hostLives - 1);
        } else { // Guest bastı
            newGuestLives = Math.max(0, guestLives - 1);
        }
    }
    
    cardsLeft -= 1;
    return { hitBomb: isBomb, newHostLives, newGuestLives, cardsLeft };
}

async function applyMove(index, nextTurn, newHostLives, newGuestLives, cardsLeft) {
    if (gameData.board[index].opened) return;

    const isCurrentPlayerHost = gameData.turn === 0;
    const oldLives = isCurrentPlayerHost ? gameData.hostLives : gameData.guestLives;
    
    gameData.hostLives = newHostLives;
    gameData.guestLives = newGuestLives;
    gameData.cardsLeft = cardsLeft;

    const hitBomb = (isCurrentPlayerHost ? gameData.hostLives : gameData.guestLives) < oldLives;
    
    gameData.board[index].opened = true;
    
    const cardElement = gameBoardEl.querySelector(`.card[data-index='${index}']`);
    if (cardElement) {
         cardElement.classList.add('flipped'); 
    }
    
    if (hitBomb) {
        if (cardElement) {
            cardElement.querySelector('.card-face.back').textContent = '💣';
        }
        playSound(audioBomb);
        const loserRoleDisplay = (isHost === isCurrentPlayerHost) ? 'SİZ' : 'RAKİP';
        showGlobalMessage(`BOOM! ${loserRoleDisplay} bombaya bastı! Can: -1`, true);
    } else {
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    setTimeout(() => {
        gameData.turn = nextTurn;
        updateStatusDisplay();
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0 || gameData.cardsLeft === 0) {
            endGame();
        }
    }, 1000);
}

function endGame() {
    gameData.isGameOver = true;

    let winnerDisplay = "";
    if (gameData.hostLives <= 0 && gameData.guestLives <= 0) {
        winnerDisplay = "BERABERLİK";
    } else if (gameData.hostLives <= 0) {
        winnerDisplay = isHost ? 'RAKİP KAZANDI' : 'SİZ KAZANDINIZ';
    } else if (gameData.guestLives <= 0) {
        winnerDisplay = isHost ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
    } else if (gameData.cardsLeft === 0) {
        winnerDisplay = "SEVİYE TAMAMLANDI";
    }

    turnStatusEl.textContent = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
    actionMessageEl.textContent = `Lütfen bekleyin...`;
    
    // Seviye Atlama Sadece Host'ta tetiklenir
    if (isHost && gameData.cardsLeft === 0 && currentLevel < BOARD_SIZES.length) {
        setTimeout(() => {
            showGlobalMessage(`Yeni Seviye: ${BOARD_SIZES[currentLevel]} Kart!`, false);
            socket.emit('nextLevelRequest', { roomCode: currentRoomCode, currentLevel: currentLevel });
        }, 4000);
    } else {
         setTimeout(resetGame, 5000);
    }
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex, initialLevel, boardSize, hostBombs, guestBombs) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";

    initializeGame(boardSize, hostBombs, guestBombs, initialLevel);
    showScreen('game');
    
    socket.on('gameMove', (data) => {
        const isMyTurn = (isHost && data.nextTurn === 0) || (!isHost && data.nextTurn === 1);
        if (isMyTurn) {
             applyMove(data.cardIndex, data.nextTurn, data.newHostLives, data.newGuestLives, data.cardsLeft); 
        }
    });

    socket.on('gameStart', ({ players, initialLevel: newLevel, boardSize: newBoardSize }) => {
        const self = players.find(p => p.id === socket.id);
        const opponent = players.find(p => p.id !== socket.id);

        showGlobalMessage(`Yeni Seviye ${newLevel} başladı! ${newBoardSize} kart!`, false);
        // Yeniden başlatma yerine direkt initializeGame çağrısı
        initializeGame(newBoardSize, players[0].bombIndexes, players[1].bombIndexes, newLevel);
    });
    
    socket.on('finalGameEnd', (data) => {
        showGlobalMessage(data.message, false);
        setTimeout(resetGame, 5000);
    });

    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    window.location.reload(); 
}

export const UIElements = {
    showGlobalMessage, 
    resetGame
};
