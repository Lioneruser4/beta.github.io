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

// SESLER
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
const LEVELS = [12, 16, 20]; // Kart sayıları
const BOMB_COUNTS = [2, 3, 4]; // Level'a göre bomba sayısı
let gameStage = 'PLAY'; // Oyun her zaman PLAY olarak başlar

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

function initializeGame(initialBoardSize, hostBombs, guestBombs, currentLevel) {
    level = currentLevel;
    gameData.hostBombs = hostBombs;
    gameData.guestBombs = guestBombs;
    
    const pairs = initialBoardSize / 2; 
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji);
    }
    
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[i], cardContents[j]];
    }

    gameData.board = cardContents.map(content => ({
        opened: false,
        content: content,
    }));

    gameData.cardsLeft = initialBoardSize;

    if (level === 1) {
        gameData.hostLives = 2;
        gameData.guestLives = 2;
    }
    
    gameData.turn = 0; // Host Başlar
    gameData.isGameOver = false;
    gameStage = 'PLAY'; 
}

function drawBoard() {
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
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    const bombCount = BOMB_COUNTS[level - 1];

    if (gameStage === 'PLAY') {
        const levelInfo = `Level ${level} (${LEVELS[level-1]} Kart, ${bombCount} Bomba)`;
        
        if (isMyTurn) {
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
    } else if (gameStage === 'ENDED') {
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
}

// --- HAREKET İŞLEYİCİLERİ (KRİTİK DÜZELTMELER BURADA) ---

function handleCardClick(event) {
    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'PLAY') {
        // Kontrol 1: Sıra bende mi?
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) return; 
        
        // Kontrol 2: Kart açılmış mı? (Zaten yukarıda kontrol ediliyor ama emin olalım)
        if (gameData.board[cardIndex].opened) return;
        
        sendMove(cardIndex);
    }
}

function sendMove(index) {
    if (socket && socket.connected) {
        // Kart açma hareketini yerel olarak uygula
        applyMove(index); 
        
        // Hareketi rakibe ilet
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
        });
    }
}

async function applyMove(index) {
    if (gameData.board[index].opened) return;

    // Şu anki oyuncunun rolünü belirle
    const isCurrentPlayerHost = gameData.turn === 0;
    
    // Rakibin bombasına bakılır
    const bombsToCheck = isCurrentPlayerHost ? gameData.guestBombs : gameData.hostBombs;

    const hitOpponentBomb = bombsToCheck.includes(index); 
    
    
    if (hitOpponentBomb) {
        // Can kaybeden oyuncu: Hareket yapan oyuncudur
        if (isCurrentPlayerHost) {
            gameData.hostLives--;
        } else {
            gameData.guestLives--;
        }
    }
    
    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (hitOpponentBomb) {
        gameData.board[index].content = '💣';
        playSound(audioBomb);
        // Can kaybeden tarafı kullanıcıya göster
        const loserRoleDisplay = (isHost === isCurrentPlayerHost) ? 'SİZ' (isHost ? gameData.hostLives : gameData.guestLives) : 'RAKİP' ;
        showGlobalMessage(`BOOM! ${loserRoleDisplay} bombaya bastı! Can: -1`, true);

    } else {
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    // Oyun bitiş veya devam etme kontrolü
    setTimeout(() => {
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = (gameData.hostLives <= 0 && gameData.guestLives <= 0) ? 'DRAW' : (gameData.hostLives <= 0 ? 'Guest' : 'Host');
            endGame(winner);
        } else if (gameData.cardsLeft === 0) {
            endGame('LEVEL_COMPLETE');
        } else {
            // KRİTİK DÜZELTME: Oyun devam ediyorsa, sırayı değiştir.
            gameData.turn = gameData.turn === 0 ? 1 : 0;
            updateStatusDisplay(); // Sıra değişimi yansıtılır
        }
        
    }, 1000); 
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';

    let winnerDisplay = winnerRole;

    if (winnerRole === 'LEVEL_COMPLETE' && level < LEVELS.length) {
        winnerDisplay = "SEVİYE TAMAMLANDI";
        turnStatusEl.textContent = `SEVİYE ${level} TAMAMLANDI!`;
        actionMessageEl.textContent = `Level ${level + 1}'e geçiliyor...`;
        
        setTimeout(() => {
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level + 1 });
            }
        }, 3000);
        
    } else if (winnerRole === 'LEVEL_COMPLETE' && level >= LEVELS.length) {
        winnerDisplay = "OYUN KAZANILDI!";
        turnStatusEl.textContent = winnerDisplay;
        actionMessageEl.textContent = "Tüm seviyeler tamamlandı!";
        setTimeout(resetGame, 5000);
        
    } else {
        // Can bitimiyle biten oyun
        winnerDisplay = (winnerRole === 'Host') === isHost ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
        if (winnerRole === 'DRAW') winnerDisplay = "BERABERLİK";

        turnStatusEl.textContent = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
        actionMessageEl.textContent = `Lobiye dönülüyor...`;
        setTimeout(resetGame, 5000);
    }
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
        LEVELS[initialData.level - 1], 
        initialData.hostBombs, 
        initialData.guestBombs, 
        initialData.level
    );
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Başarılar.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // gameData Olayı (Rakibin Hareketi Geldi)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            // applyMove fonksiyonu artık kendi içinde sırayı değiştiriyor.
            applyMove(data.cardIndex);
        }
    });

    // Seviye Atlama Sinyali
    socket.on('nextLevel', ({ newLevel, hostBombs, guestBombs }) => {
        showGlobalMessage(`Yeni Seviye: ${LEVELS[newLevel-1]} Kart!`, false);
        initializeGame(
            LEVELS[newLevel - 1], 
            hostBombs, 
            guestBombs, 
            newLevel
        );
        drawBoard();
        updateStatusDisplay();
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
