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
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; // Kendi seçtiğimiz bombaların indexleri

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
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
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
    // Kart içeriklerini rastgele dağıt
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

    gameData.board = cardContents.map(content => ({
        opened: false,
        content: content,
    }));

    gameData.cardsLeft = initialBoardSize;
    gameData.hostLives = 2;
    gameData.guestLives = 2;
    // Bomba listeleri yeni seçim için sıfırlanmaz, sunucudan gelen değerler kullanılır.
    // gameData.hostBombs = [];
    // gameData.guestBombs = [];
    selectedBombs = [];
    gameData.turn = 0;
    gameData.isGameOver = false;
    // gameStage bu fonksiyondan sonra SELECTION olarak kalacak
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
        
        // PLAY aşamasında arka yüz içeriği normal kart içeriği olmalı
        if (gameStage === 'PLAY') {
             back.textContent = cardState.content; 
        } else {
             // SELECTION aşamasında arka yüz içeriği "Bomb Seçimi"nden gelmiyor, normal kalmalı
             back.textContent = cardState.content;
        }


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
        const opponentSelected = (isHost && gameData.guestBombs.length === 3) || (!isHost && gameData.hostBombs.length === 3);
        
        if (selectedBombs.length < 3) {
            turnStatusEl.textContent = `Bomba Seç: ${selectedBombs.length} / 3`;
            actionMessageEl.textContent = "3 adet gizli bombayı seçin.";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else if (opponentSelected) {
             // Bu durum, "allBombsSelected" gelene kadar geçici bir durumdur.
             turnStatusEl.textContent = `OYUN BAŞLIYOR...`;
             actionMessageEl.textContent = "Rakip ve siz seçimi tamamladınız.";
             turnStatusEl.classList.remove('text-green-600', 'text-red-600');
        }
        else {
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

// --- ANIMASYON VE SES ---

async function triggerWaitAndVibrate() {
    if (gameData.cardsLeft < 8 && gameStage === 'PLAY') { 
        // startVibration();
        // await new Promise(resolve => setTimeout(resolve, 2000));
        // stopVibration();
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
        
        if (selectedBombs.length === 3) {
            // Bombaları sunucuya gönder
            socket.emit('bombSelectionComplete', { roomCode: currentRoomCode, isHost: isHost, bombs: selectedBombs });
            
            // Kendi tarafımda bomb listesini hemen güncelle
            if (isHost) {
                gameData.hostBombs = selectedBombs;
            } else {
                gameData.guestBombs = selectedBombs;
            }
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
        // Hamleyi hemen uygula (Gecikmeyi azaltmak için)
        const nextTurn = gameData.turn === 0 ? 1 : 0;
        applyMove(index, nextTurn); 

        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
            // Rakibe yeni turn'ü ve can bilgilerini göndermeye gerek yok, o kendi applyMove'da hesaplayacak
        });
    }
}

async function applyMove(index, nextTurn) {
    if (gameData.board[index].opened) return;

    const myBombs = isHost ? gameData.hostBombs : gameData.guestBombs;
    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs;

    const isCurrentPlayerHost = gameData.turn === 0;

    // Şu anki oyuncu rakibinin bombasına mı bastı? (Yani kendi canı mı gidecek?)
    const hitOpponentBomb = isCurrentPlayerHost ? opponentBombs.includes(index) : opponentBombs.includes(index); 
    
    // Hangi can gidecek?
    let lifeToLose = null;
    if (hitOpponentBomb) {
        lifeToLose = isCurrentPlayerHost ? 'hostLives' : 'guestLives';
        
        if (lifeToLose === 'hostLives') {
            gameData.hostLives--;
        } else {
            gameData.guestLives--;
        }
    }
    
    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (hitOpponentBomb) {
        // Kartı bomba olarak göster
        gameData.board[index].content = '💣';
        playSound(audioBomb);
        const loserRoleDisplay = (isHost === isCurrentPlayerHost) ? 'SİZ' : 'RAKİP';
        showGlobalMessage(`BOOM! ${loserRoleDisplay} bombaya bastı! Can: -1`, true);

    } else {
        // Zaten initializeGame'de rastgele atanmış içeriği gösterir.
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    setTimeout(() => {
        gameData.turn = nextTurn;
        updateStatusDisplay();
        
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = (gameData.hostLives <= 0 && gameData.guestLives <= 0) ? 'DRAW' : (gameData.hostLives <= 0 ? 'Guest' : 'Host');
            endGame(winner);
        } else if (gameData.cardsLeft === 0) {
            endGame('LEVEL_COMPLETE');
        }
        
    }, 1000);
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';

    let winnerDisplay = winnerRole;

    if (winnerRole === 'LEVEL_COMPLETE') {
        winnerDisplay = "SEVİYE TAMAMLANDI";
    } else if (winnerRole === 'Host') {
        winnerDisplay = isHost ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
    } else if (winnerRole === 'Guest') {
        winnerDisplay = isHost ? 'RAKİP KAZANDI' : 'SİZ KAZANDINIZ';
    } else if (winnerRole === 'DRAW') {
        winnerDisplay = "BERABERLİK";
    }

    turnStatusEl.textContent = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
    actionMessageEl.textContent = `Yeni seviyeye geçiliyor...`;
    
    setTimeout(() => {
        if (winnerRole === 'LEVEL_COMPLETE' && level < LEVELS.length) {
            const nextLevel = level + 1;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[nextLevel - 1]} Kart!`, false);
            
            if (isHost) {
                // Sadece Host, yeni seviye sinyalini gönderir.
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: nextLevel });
            }
            // level güncellenecek, initializeGame tekrar çağrılacak (ya sinyalle ya da kendisi)
        } else {
             showGlobalMessage("Oyunun tüm seviyeleri tamamlandı veya bitti. Lobiye dönülüyor.", false);
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
    gameStage = 'SELECTION'; // Başlangıçta seçim aşaması
    gameData.hostBombs = []; // Host'un bomba listesini sıfırla
    gameData.guestBombs = []; // Guest'in bomba listesini sıfırla
    
    initializeGame(LEVELS[level - 1]);
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! 3 Bombanızı seçin.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // RAKİP BOMB SEÇİMİNİ TAMAMLADI (Sadece bilgi için)
    socket.on('opponentBombSelectionComplete', () => {
        // Rakip bombasını seçti, UI'yi güncelle
        updateStatusDisplay();
    });

    // KRİTİK İŞLEYİCİ: İKİ TARAF DA BOMB SEÇİMİNİ TAMAMLADI
    socket.on('allBombsSelected', ({ hostBombs, guestBombs }) => {
        gameData.hostBombs = hostBombs;
        gameData.guestBombs = guestBombs;
        
        gameStage = 'PLAY'; // KRİTİK: Oyun aşamasını başlat!
        gameData.turn = 0;  // Host başlar
        
        showGlobalMessage('Herkes bombasını seçti! Kart açma aşaması BAŞLIYOR.', false);
        drawBoard(); // Tahtayı tekrar çizerek UI'yi PLAY moduna geçirir
    });


    // gameData Olayı (Rakibin Hareketi Geldi)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const nextTurn = gameData.turn === 0 ? 1 : 0; 
            // Rakibin yaptığı hamleyi uygula.
            applyMove(data.cardIndex, nextTurn);
        }
    });

    // Seviye Atlama Sinyali
    socket.on('nextLevel', ({ newLevel }) => {
        level = newLevel;
        gameStage = 'SELECTION'; // Yeni seviyede tekrar seçim aşaması
        gameData.hostBombs = []; 
        gameData.guestBombs = [];
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
