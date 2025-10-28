// Dosya Adı: game.js
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';
let startButton = null; // Yeni: Başlat butonu referansı
let selectionComplete = false; // Yeni: Kendi seçimimiz tamamlandı mı?
let opponentReady = false; // Yeni: Rakip hazır mı?

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

// --- OYUN DURUMU (Aynı Kalır) ---
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

// --- TEMEL UI FONKSİYONLARI (Aynı Kalır) ---
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
    // ... initializeGame içeriği (Aynı Kalır) ...
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
    gameData.hostBombs = [];
    gameData.guestBombs = [];
    selectedBombs = [];
    gameData.turn = 0;
    gameData.isGameOver = false;
    gameStage = 'SELECTION'; 
    
    // Yeni Seviye/Oyun Başlangıcında Buton ve Hazırlık durumunu sıfırla
    selectionComplete = false;
    opponentReady = false;
    if (startButton) {
        startButton.classList.remove('bg-red-500', 'bg-green-500');
        startButton.classList.add('bg-gray-400');
        startButton.disabled = true;
        startButton.textContent = '3 KART SEÇİN';
        startButton.classList.remove('hidden');
    }
}

function drawBoard() {
    // ... drawBoard içeriği (Aynı Kalır) ...
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
    // ... updateStatusDisplay içeriği (Aynı Kalır) ...
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));
    
    myLivesEl.className = myLives === 1 ? 'text-orange-500' : 'text-green-600';
    opponentLivesEl.className = opponentLives === 1 ? 'text-orange-500' : 'text-green-600';

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'SELECTION') {
        startButton.classList.remove('hidden');

        if (selectedBombs.length < 3) {
            turnStatusEl.textContent = `Bomba Seç: ${selectedBombs.length} / 3`;
            actionMessageEl.textContent = "3 adet gizli bombayı seçin.";
            startButton.disabled = true;
            startButton.classList.remove('bg-green-500');
            startButton.classList.add('bg-gray-400');
            startButton.textContent = '3 KART SEÇİN';

        } else if (!selectionComplete) {
            // Seçim tamamlandı ama henüz sunucuya göndermedik (butona basmadık)
            turnStatusEl.textContent = `Seçim Tamamlandı. BAŞLAT'a basın!`;
            actionMessageEl.textContent = "Hazırsanız BAŞLAT'a basıp rakibinizi bekleyin.";
            startButton.disabled = false;
            startButton.classList.remove('bg-gray-400', 'bg-red-500');
            startButton.classList.add('bg-green-500');
            startButton.textContent = 'BAŞLAT';

        } else if (selectionComplete) {
            // Seçim tamamlandı VE sunucuya gönderildi (Butona bastık)
            turnStatusEl.textContent = `Rakip bekleniyor...`;
            actionMessageEl.textContent = opponentReady ? "Rakip de HAZIR. Başlaması bekleniyor..." : `Rakibinizin (${opponentName}) BAŞLAT'a basması bekleniyor.`;
            startButton.disabled = true;
            startButton.classList.remove('bg-green-500');
            startButton.classList.add('bg-red-500');
            startButton.textContent = opponentReady ? 'RAKİP HAZIR!' : 'RAKİP BEKLENİYOR';
            
        }
        turnStatusEl.classList.remove('text-red-600', 'text-green-600');
        turnStatusEl.classList.add('text-gray-800');

    } else if (gameStage === 'PLAY') {
        startButton.classList.add('hidden'); // Oyun başladığında butonu gizle

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
        startButton.classList.add('hidden');
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    const cardElement = event.currentTarget.querySelector('.card');
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'SELECTION') {
        // Seçim tamamlandıktan sonra kart tıklamayı engelle
        if (selectionComplete) return; 

        if (selectedBombs.includes(cardIndex)) {
            selectedBombs = selectedBombs.filter(i => i !== cardIndex);
        } else if (selectedBombs.length < 3) {
            selectedBombs.push(cardIndex);
        }
        drawBoard(); 
        
    } else if (gameStage === 'PLAY') {
        // ... Oyun Oynama Mantığı (Aynı Kalır) ...
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) return; 
        
        sendMove(cardIndex);
    }
}

function handleStartGame() {
    if (selectedBombs.length === 3 && !selectionComplete) {
        selectionComplete = true; // Kendi hazır durumumuzu kaydet
        // Sunucuya bomba seçimimizi ve HAZIR olduğumuzu bildir
        socket.emit('bombSelectionComplete', { 
            roomCode: currentRoomCode, 
            isHost: isHost, 
            bombs: selectedBombs 
        });
        updateStatusDisplay();
    }
}

// ... Diğer Fonksiyonlar (sendMove, applyMove, endGame, vb. Aynı Kalır) ...
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
    // ... applyMove içeriği (Aynı Kalır) ...
    const cardElement = gameBoardEl.querySelector(`.card[data-index='${index}']`);
    if (!cardElement || cardElement.classList.contains('flipped')) return;

    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs;
    const hitBomb = opponentBombs.includes(index);
    
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
    // ... endGame içeriği (Aynı Kalır) ...
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
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
            
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
            }
            initializeGame(LEVELS[level - 1]);
            drawBoard();
            updateStatusDisplay();
            
        } else {
             showGlobalMessage("Oyun sona erdi (Maksimum seviyeye ulaşıldı).", false);
             resetGame();
        }
    }, 4000);
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex, startBtnElement) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    startButton = startBtnElement; // Başlat butonunu ata

    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";

    level = 1; 
    initializeGame(LEVELS[level - 1]);
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Bomba seçimine geçiliyor.`, false);
    
    // YENİ: Başlat butonu olay dinleyicisi
    startButton.addEventListener('click', handleStartGame);

    // --- SOCKET.IO İŞLEYİCİLERİ ---

    socket.on('bombSelectionComplete', ({ isHost: selectionHost, bombs }) => {
        // Gelen bomba seçimini kaydet
        if (selectionHost) {
            gameData.hostBombs = bombs;
            opponentReady = true; // Rakip Hazır sinyali
        } else {
            gameData.guestBombs = bombs;
            opponentReady = true; // Rakip Hazır sinyali
        }
        
        // KRİTİK DÜZELTME: İki taraf da tamamladıysa oyunu başlat
        if (gameData.hostBombs.length === 3 && gameData.guestBombs.length === 3 && selectionComplete && opponentReady) {
            if (gameStage === 'SELECTION') {
                gameStage = 'PLAY'; 
                gameData.turn = 0; // HOST başlar
                showGlobalMessage('İki oyuncu da hazır! Kart açma aşaması başladı.', false);
                // drawBoard çağrısı, updateStatusDisplay içinde gizlenecek
            }
        }
        updateStatusDisplay();
    });
    
    socket.on('gameData', (data) => {
        // ... gameData içeriği (Aynı Kalır) ...
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const nextTurn = gameData.turn === 0 ? 1 : 0; 
            applyMove(data.cardIndex, nextTurn); 
        }
    });

    socket.on('nextLevel', ({ newLevel }) => {
        // ... nextLevel içeriği (Aynı Kalır) ...
        level = newLevel;
        showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
        initializeGame(LEVELS[level - 1]);
        drawBoard();
        updateStatusDisplay();
    });
    
    socket.on('opponentLeft', (message) => {
        // ... opponentLeft içeriği (Aynı Kalır) ...
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
