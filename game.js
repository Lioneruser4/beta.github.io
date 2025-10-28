// Dosya Adı: game.js (Otomatik Bomba Seçimi ve Direkt Başlangıç)
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';

// --- DOM Referansları (Aynı Kalır) ---
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
// Başlat butonu kaldırıldı, yine de referansı alalım ve gizleyelim
const startButton = document.getElementById('startButton');

// SESLER (Aynı Kalır)
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
let level = 1; 
const LEVELS = [12, 16, 20]; 
let gameStage = 'PLAY'; // OYUN HER ZAMAN PLAY AŞAMASINDA BAŞLAR

let gameData = {
    board: [], 
    turn: 0, // 0 = Host, 1 = Guest
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

// --- OYUN MANTIĞI VE ÇİZİM ---

// Yeni seviye veya oyun başladığında oyunu initialize eder.
// Bomba listeleri sunucudan (veya Host'tan) gelmelidir.
function initializeGame(initialBoardSize, newHostBombs, newGuestBombs) {
    const cardContents = [];
    for (let i = 0; i < initialBoardSize; i++) {
        cardContents.push(EMOTICONS[Math.floor(Math.random() * EMOTICONS.length)]);
    }
    
    gameData.board = Array(initialBoardSize).fill(null).map((_, index) => ({
        opened: false,
        content: cardContents[index], 
        isBomb: false
    }));
    
    gameData.cardsLeft = initialBoardSize;
    gameData.hostLives = 2;
    gameData.guestLives = 2;
    gameData.turn = 0;
    gameData.isGameOver = false;
    gameStage = 'PLAY'; 
    
    // Bomba listelerini ata (Bu veriler sunucudan geliyor)
    gameData.hostBombs = newHostBombs;
    gameData.guestBombs = newGuestBombs;

    if (startButton) startButton.classList.add('hidden'); 
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
    
    myLivesEl.className = myLives === 1 ? 'text-orange-500' : 'text-green-600';
    opponentLivesEl.className = opponentLives === 1 ? 'text-orange-500' : 'text-green-600';

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'PLAY') {
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
    } else if (gameStage === 'ENDED') {
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
}

// --- HAREKET İŞLEYİCİLERİ ---
function handleCardClick(event) {
    const cardElement = event.currentTarget.querySelector('.card');
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

async function applyMove(index, nextTurn) {
    const cardElement = gameBoardEl.querySelector(`.card[data-index='${index}']`);
    if (!cardElement || cardElement.classList.contains('flipped')) return;

    // Rakibin bombası olup olmadığını kontrol et
    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs;
    const hitBomb = opponentBombs.includes(index);
    
    // Animasyon (Yardımcı fonksiyonlar aşağıdadır, aynı kaldığı varsayılır)
    await triggerWaitAndVibrate(); 

    cardElement.classList.add('flipped'); 
    
    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (hitBomb) {
        if (gameData.turn === 0) {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        cardElement.querySelector('.card-face.back').textContent = '💣';
        
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Rakip ${isHost ? 'Guest' : 'Host'} bombanıza bastı! Can: -1`, true);
    } else {
        playSound(audioEmoji);
    }
    
    await new Promise(resolve => setTimeout(resolve, 600)); 
    
    gameData.turn = nextTurn;
    updateStatusDisplay();
    
    // Oyun Bitti mi Kontrolü (Aynı Kalır)
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
        if (level < LEVELS.length) {
            level++;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Yeni Bombalar Rastgele Seçiliyor...`, false);
            
            // Host, sunucuya yeni seviyeyi bildirir. Sunucu yeni bombaları belirler.
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
            }
            // GUEST, yeni bomba sinyalini bekler. HOST ise sinyal geldikten sonra kendi başlatır (Çift Kontrol)
            
        } else {
             showGlobalMessage("Oyun sona erdi (Maksimum seviyeye ulaşıldı).", false);
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

    // Host, oyunun başladığını sunucudan alacak. Guest de öyle.
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Bombalar rastgele seçiliyor...`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Oyun Başlangıç Sinyali: Sunucudan rastgele seçilen bombalar ve seviye ile gelir.
    socket.on('startGameWithBombs', ({ hostBombs, guestBombs, level: startLevel }) => {
        level = startLevel;
        initializeGame(LEVELS[level - 1], hostBombs, guestBombs);
        drawBoard();
        updateStatusDisplay();
        showGlobalMessage(`Oyun başladı! Bombalar rastgele seçildi. ${isHost ? 'Sıra Sende!' : 'Rakibin sırası bekleniyor.'}`, false);
    });

    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const nextTurn = gameData.turn === 0 ? 1 : 0; 
            applyMove(data.cardIndex, nextTurn); 
        }
    });

    // Seviye Atlatma Sinyali: Sunucudan yeni bombalar ve seviye ile gelir.
    socket.on('nextLevel', ({ newLevel, hostBombs, guestBombs }) => {
        level = newLevel;
        showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Yeni Bombalar Rastgele Seçildi...`, false);
        initializeGame(LEVELS[level - 1], hostBombs, guestBombs);
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

// --- Yardımcı Fonksiyonlar (Aynı kalmalı) ---
async function triggerWaitAndVibrate() {
    if (gameData.cardsLeft < 8 && gameStage === 'PLAY') { 
        startVibration();
        await new Promise(resolve => setTimeout(resolve, 1500));
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
// ---------------------------------------------


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
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
