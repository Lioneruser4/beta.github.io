// Dosya Adı: game.js (YENİ TASARIM: Sunucu Kontrollü Sıra)
let socket;
let currentRoomCode = '';
let isHost = false; // Bu client HOST mu? (true/false)
let opponentName = '';
let isProcessingMove = false; // Hareket işlenirken birden fazla tıklamayı engeller

// --- DOM Referansları (Aynı) ---
const screens = { /* ... */ };
const gameBoardEl = document.getElementById('gameBoard');
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const myLivesEl = document.getElementById('myLives');
const opponentLivesEl = document.getElementById('opponentLives');
const opponentNameEl = document.getElementById('opponentName');
const roleStatusEl = document.getElementById('roleStatus');

// SESLER (Aynı)
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
const BOMB_COUNTS = [2, 3, 4];
let gameStage = 'PLAY'; 

let gameData = {
    board: [], 
    turn: 0,   // 0 = Host'un sırası, 1 = Guest'in sırası (Sunucudan güncellenir)
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

// --- TEMEL UI FONKSİYONLARI (Aynı) ---
export function showScreen(screenId) { /* ... */ }
export function showGlobalMessage(message, isError = true) { /* ... */ }

// --- OYUN MANTIĞI VE ÇİZİM ---

function initializeGame(initialBoardSize, hostBombs, guestBombs, currentLevel, initialTurn) {
    level = currentLevel;
    gameData.hostBombs = hostBombs;
    gameData.guestBombs = guestBombs;
    
    // ... (Kart içerikleri oluşturma ve karıştırma kodu aynı) ...
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
    gameData.board = cardContents.map(content => ({ opened: false, content: content, }));
    gameData.cardsLeft = initialBoardSize;

    if (level === 1) {
        gameData.hostLives = 2;
        gameData.guestLives = 2;
    }
    
    gameData.turn = initialTurn; // Başlangıç sırası sunucudan gelir
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

    // Sıra kontrolü
    const myTurnId = isHost ? 0 : 1;
    const isMyTurn = gameData.turn === myTurnId;
    
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

// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    if (isProcessingMove) return; // Hareket işlenirken yeni tıklamayı engelle

    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'PLAY') {
        const myTurnId = isHost ? 0 : 1;
        const isMyTurn = gameData.turn === myTurnId;
        
        if (!isMyTurn || gameData.isGameOver) return; 
        
        if (gameData.board[cardIndex].opened) return;
        
        sendMove(cardIndex);
    }
}

function sendMove(index) {
    if (socket && socket.connected) {
        isProcessingMove = true; // Tıklamayı engelle
        // Sadece hareketi sunucuya bildir, sırayı sunucu değiştirecek
        socket.emit('MOVE', {
            roomCode: currentRoomCode,
            cardIndex: index,
        });
    }
}

// KRİTİK: applyMove artık sadece kartı açar ve canı düşürür, sırayı değiştirmez.
async function applyMove(index) {
    if (gameData.board[index].opened) return;
    
    // Hareketi hangi oyuncu yaptıysa onun rolünü bulmak için mevcut sıraya bakılır.
    const isCurrentPlayerHost = gameData.turn === 0; 
    
    // Rakibin bombasına bakılır
    const bombsToCheck = isCurrentPlayerHost ? gameData.guestBombs : gameData.hostBombs;
    const hitOpponentBomb = bombsToCheck.includes(index); 
    
    
    if (hitOpponentBomb) {
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
        const loserRoleDisplay = (isHost === isCurrentPlayerHost) ? 'SİZ' : 'RAKİP';
        showGlobalMessage(`BOOM! ${loserRoleDisplay} bombaya bastı! Can: -1`, true);

    } else {
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    // Oyun bitiş kontrolü (Sıra değişimini buradan kaldırıldı!)
    setTimeout(() => {
        isProcessingMove = false; // Kart açma animasyonu bitince engel kalkar
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = (gameData.hostLives <= 0 && gameData.guestLives <= 0) ? 'DRAW' : (gameData.hostLives <= 0 ? 'Guest' : 'Host');
            endGame(winner);
        } else if (gameData.cardsLeft === 0) {
            endGame('LEVEL_COMPLETE');
        } 
        // Sıra değişimi artık sunucudan gelecek!
    }, 1000); 
}

function endGame(winnerRole) { /* ... (Aynı) */ }

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
        initialData.level,
        initialData.initialTurn // YENİ: Başlangıç sırası
    );
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Başarılar.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // KRİTİK: Rakibin hareketini al
    socket.on('playerMove', (data) => {
        if (gameStage !== 'PLAY') return;
        // applyMove çağrıldığında, gameData.turn hala hareket yapan oyuncunun sırasındadır.
        applyMove(data.cardIndex);
    });

    // KRİTİK: Sunucudan gelen sıra değişikliğini al
    socket.on('turnChange', (data) => {
        if (gameData.isGameOver) return;
        gameData.turn = data.newTurn;
        updateStatusDisplay();
    });

    // Seviye Atlama Sinyali
    socket.on('nextLevel', ({ newLevel, hostBombs, guestBombs, initialTurn }) => {
        showGlobalMessage(`Yeni Seviye: ${LEVELS[newLevel-1]} Kart!`, false);
        initializeGame(
            LEVELS[newLevel - 1], 
            hostBombs, 
            guestBombs, 
            newLevel,
            initialTurn // YENİ
        );
        drawBoard();
        updateStatusDisplay();
    });
    
    // Rakip Ayrıldı (Aynı)
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    window.location.reload(); 
}

export const UIElements = { /* ... (Aynı) ... */ };
