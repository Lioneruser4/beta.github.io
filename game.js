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
const readyToPlayBtn = document.getElementById('readyToPlayBtn'); 

// SESLER (Lütfen bu dosyaların varlığını kontrol edin)
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

let gameData = {
    board: [], // { content: 'emoji', opened: false, isBomb: false }
    turn: 0,   // 0 = Host, 1 = Guest
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    myBombIndex: -1, // Benim attığım bomba
    opponentBombIndex: -1, // Rakibin attığı bomba
    isGameOver: false
};

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

    gameData.board = Array(boardSize).fill(null).map((_, index) => ({
        opened: false,
        content: cardContents[index], 
    }));
    
    // Bombaları Oyun Verisine Atama (Sadece Rakibin Bombası Gerekli)
    gameData.myBombIndex = isHost ? hostBombs[0] : guestBombs[0];
    gameData.opponentBombIndex = isHost ? guestBombs[0] : hostBombs[0];
    
    gameData.hostLives = 2;
    gameData.guestLives = 2;
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; 
    gameData.isGameOver = false;
    
    drawBoard();
    updateStatusDisplay();
}

function drawBoard() {
    const boardSize = BOARD_SIZES[currentLevel - 1];
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
}

// ... (Animasyonlar) ...
async function triggerWaitAndVibrate() {
     if (gameData.cardsLeft < 8) { 
         // startVibration();
         // await new Promise(resolve => setTimeout(resolve, 2000));
         // stopVibration();
     }
}

// --- HAREKET İŞLEYİCİLERİ ---
function handleCardClick(event) {
    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    if (!isMyTurn || gameData.isGameOver) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);
    sendMove(cardIndex);
}

function sendMove(index) {
    if (!socket || !socket.connected) return;

    // CLIENT tarafında hamleyi uygula ve canları hesapla (Latency azaltma)
    const nextTurn = gameData.turn === 0 ? 1 : 0; 
    const { hitBomb, newHostLives, newGuestLives, cardsLeft } = applyMoveLogic(index, gameData.hostLives, gameData.guestLives, gameData.cardsLeft);

    // Sunucuya hamleyi, yeni canları ve sırayı gönder
    socket.emit('gameMove', {
        roomCode: currentRoomCode,
        cardIndex: index,
        nextTurn: nextTurn,
        newHostLives: newHostLives,
        newGuestLives: newGuestLives,
        cardsLeft: cardsLeft
    });
    
    // Hamleyi kendi ekranımızda hemen uygula (Daha hızlı hissettirir)
    // applyMove(index, nextTurn, newHostLives, newGuestLives, cardsLeft);
}


// Yeni: Hamle Uygulama Mantığı (Client ve Server'da kullanılabilir)
function applyMoveLogic(index, hostLives, guestLives, cardsLeft) {
    let hitBomb = false;
    let newHostLives = hostLives;
    let newGuestLives = guestLives;

    // Hangi bombaya basıldı?
    const opponentBomb = gameData.opponentBombIndex;
    const selfBomb = gameData.myBombIndex;

    const currentTurn = gameData.turn; // 0=Host, 1=Guest

    if (index === opponentBomb || index === selfBomb) {
        hitBomb = true;
        if (currentTurn === 0) { // Host bastı
            newHostLives = Math.max(0, hostLives - 1);
        } else { // Guest bastı
            newGuestLives = Math.max(0, guestLives - 1);
        }
    }
    
    cardsLeft -= 1;

    return { hitBomb, newHostLives, newGuestLives, cardsLeft };
}


async function applyMove(index, nextTurn, newHostLives, newGuestLives, cardsLeft) {
    if (gameData.board[index].opened) return;

    const isCurrentPlayerHost = gameData.turn === 0;
    const isMyMove = (isHost === isCurrentPlayerHost); 
    
    // Canlar client'tan geldiği için hesaplamaya gerek yok, direkt ata
    const oldHostLives = gameData.hostLives;
    const oldGuestLives = gameData.guestLives;
    gameData.hostLives = newHostLives;
    gameData.guestLives = newGuestLives;
    gameData.cardsLeft = cardsLeft;

    const hitBomb = (isCurrentPlayerHost ? oldHostLives : oldGuestLives) > (isCurrentPlayerHost ? newHostLives : newGuestLives);
    
    await triggerWaitAndVibrate();

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
        
        const loserRoleDisplay = isMyMove ? 'SİZ' : 'RAKİP';
        showGlobalMessage(`BOOM! ${loserRoleDisplay} bombaya bastı! Can: -1`, true);
    } else {
        playSound(audioEmoji);
    }
    
    drawBoard(); // Güncel durumu yansıtır
    
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
    actionMessageEl.textContent = `Lütfen bekleyin, ${isHost ? 'Yeni Seviye Sinyali Gönderiliyor...' : 'Host Bekleniyor...'}`;
    
    // Sadece Host seviye atlama isteğini gönderir
    if (isHost && gameData.cardsLeft === 0) {
        setTimeout(() => {
            if (currentLevel < BOARD_SIZES.length) {
                showGlobalMessage(`Yeni Seviye: ${BOARD_SIZES[currentLevel]} Kart!`, false);
                socket.emit('nextLevelRequest', { roomCode: currentRoomCode, currentLevel: currentLevel });
            } else {
                 showGlobalMessage("Oyunun tüm seviyeleri tamamlandı!", false);
                 resetGame();
            }
        }, 4000);
    } else if (!isHost) {
         actionMessageEl.textContent = "Host'un bir sonraki seviyeyi başlatması bekleniyor...";
         // Guest sadece dinler.
    } else {
         // Canlar bitti, yeniden başlat.
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
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Seviye ${initialLevel}: ${boardSize} kart!`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Rakibin Hamlesini Uygula
    socket.on('gameMove', (data) => {
        // Rakibin hamlesini uygula
        applyMove(data.cardIndex, data.nextTurn, data.newHostLives, data.newGuestLives, data.cardsLeft); 
    });

    // Yeni Seviye Başladı
    socket.on('gameStart', ({ players, initialLevel: newLevel, boardSize: newBoardSize }) => {
        const room = players.find(p => p.roomCode === currentRoomCode);
        if (!room) return; // Güvenlik kontrolü
        
        const self = players.find(p => p.id === socket.id);
        const opponent = players.find(p => p.id !== socket.id);

        showGlobalMessage(`Yeni Seviye ${newLevel} başladı! ${newBoardSize} kart!`, false);
        initializeGame(newBoardSize, room.hostBombs, room.guestBombs, newLevel);
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
