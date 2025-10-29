// Dosya Adı: game.js (EMOJİ BOMBA OYUNU İSTEMCİ)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let myName = '';
const BOMB_EMOJI = '💣';
const ANIMATION_DELAY = 1500; 

// --- DOM Referansları ---
const screens = { 
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen') 
};
const gameBoardEl = document.getElementById('gameBoard');
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const myNameEl = document.getElementById('myName'); 
const opponentNameEl = document.getElementById('opponentName'); 

const chatInputEl = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const messagesEl = document.getElementById('messages');

function playSound(soundKey) {
    const audioEl = document.getElementById(soundKey); 
    if (audioEl) {
        audioEl.currentTime = 0; 
        audioEl.play().catch(e => console.error("Ses çalınamadı:", e));
    } else {
        console.log(`Ses kaydı bulunamadı: ${soundKey}`);
    }
}

let gameData = {
    cardContents: [],
    matchedCards: new Set(),
    flippedCards: [],
    currentTurnId: null,
    isAnimating: false,
    isGameOver: false,
    scoreHost: 0,
    scoreGuest: 0
};

// --- TEMEL UI FONKSİYONLARI ---
export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen && screen.classList.remove('active'));
    if (screens[screenId]) { screens[screenId].classList.add('active'); }
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

function appendMessage(sender, text, isMe) {
    const messageItem = document.createElement('p');
    messageItem.className = `break-words ${isMe ? 'text-right text-blue-700' : 'text-left text-gray-800'}`;
    messageItem.innerHTML = `<span class="font-bold">${sender}:</span> ${text}`;
    messagesEl.appendChild(messageItem);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function handleSendMessage() {
    const message = chatInputEl.value.trim();
    if (message === "" || gameData.isGameOver || !socket || !socket.connected) return;

    socket.emit('sendMessage', {
        roomCode: currentRoomCode,
        message: message
    });
    
    chatInputEl.value = '';
}


// --- OYUN MANTIĞI VE ÇİZİM ---

function initializeGame(initialData) {
    gameData.cardContents = initialData.cardContents;
    gameData.currentTurnId = initialData.turn;
    gameData.isGameOver = false;
    gameData.isAnimating = false;
    gameData.flippedCards = initialData.flippedCards || [];
    gameData.matchedCards = new Set(initialData.matchedCards || []);
    gameData.scoreHost = initialData.scoreHost || 0;
    gameData.scoreGuest = initialData.scoreGuest || 0;
}

function updateStatusDisplay() {
    const myTurn = gameData.currentTurnId === socket.id;
    const myScore = isHost ? gameData.scoreHost : gameData.scoreGuest;
    const opponentScore = isHost ? gameData.scoreGuest : gameData.scoreHost;
    
    myNameEl.textContent = `${myName} (Skor: ${myScore})`;
    opponentNameEl.textContent = `${opponentName} (Skor: ${opponentScore})`;

    if (gameData.isGameOver) {
        turnStatusEl.textContent = "OYUN BİTTİ!";
    } else if (gameData.isAnimating) {
        turnStatusEl.textContent = "İşlem Bekleniyor...";
        turnStatusEl.classList.remove('text-green-600', 'text-red-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (myTurn) {
        turnStatusEl.textContent = "SIRA SİZDE! Kart seçin.";
        turnStatusEl.classList.remove('text-gray-600', 'text-red-600', 'text-yellow-600');
        turnStatusEl.classList.add('text-green-600');
    } else {
        turnStatusEl.textContent = `RAKİP OYNUYOR (${opponentName})...`;
        turnStatusEl.classList.remove('text-green-600', 'text-yellow-600');
        turnStatusEl.classList.add('text-red-600');
    }
    actionMessageEl.textContent = `Tahtada ${gameData.cardContents.length - gameData.matchedCards.size} kart kaldı.`;
}

function drawBoard() {
    let columns = 5; 
    gameBoardEl.className = `grid w-full max-w-sm mx-auto memory-board grid-cols-${columns}`; 
    gameBoardEl.innerHTML = '';
    
    const isMyTurn = gameData.currentTurnId === socket.id;
    const canClick = isMyTurn && !gameData.isAnimating && !gameData.isGameOver;

    gameData.cardContents.forEach((content, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';

        const card = document.createElement('div');
        card.className = `card`; 
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face front';
        front.textContent = '?';
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        back.textContent = content; 

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        const isMatched = gameData.matchedCards.has(index);
        const isFlipped = gameData.flippedCards.includes(index);

        if (isMatched || isFlipped) {
            card.classList.add('flipped');
            if (isMatched) { cardContainer.classList.add('matched'); }
            if (content === BOMB_EMOJI && isFlipped && !isMatched) {
                 card.classList.add('bomb-chosen');
            }
        }
        
        if (canClick && !isMatched && !isFlipped) {
            cardContainer.addEventListener('click', handleCardClick);
            cardContainer.classList.add('cursor-pointer');
        } else {
            cardContainer.classList.remove('cursor-pointer');
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    if (gameData.isAnimating || gameData.isGameOver || gameData.currentTurnId !== socket.id) {
        return;
    } 

    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);
    
    if (gameData.flippedCards.includes(cardIndex) || gameData.matchedCards.has(cardIndex)) return;
    
    if (gameData.flippedCards.length === 1) { 
        gameData.isAnimating = true; 
    }
    
    gameBoardEl.querySelectorAll('.card-container').forEach(el => el.removeEventListener('click', handleCardClick));
    
    sendMove(cardIndex);
}

function sendMove(index) {
    if (socket && socket.connected) {
        socket.emit('MOVE', {
            roomCode: currentRoomCode,
            cardIndex: index,
        });
    }
}

function handleGameStateUpdate(data) {
    const { flippedCardIndex, flippedCards, matchedCards, scoreHost, scoreGuest, cardContent } = data;
    
    gameData.flippedCards = flippedCards;
    gameData.matchedCards = new Set(matchedCards);
    gameData.scoreHost = scoreHost;
    gameData.scoreGuest = scoreGuest;

    const cardElement = document.querySelector(`.card[data-index="${flippedCardIndex}"]`);
    if (cardElement && !cardElement.classList.contains('flipped')) {
        cardElement.classList.add('flipped'); 
        
        if (flippedCards.length === 2) {
            gameData.isAnimating = true;
        }
    }
    
    drawBoard(); 
}

function handleTurnUpdate(data) {
    gameData.currentTurnId = data.turn;
    
    if (data.flippedCards && data.flippedCards.length === 0) {
        gameData.flippedCards.forEach(index => {
            const cardElement = document.querySelector(`.card[data-index="${index}"]`);
            if (cardElement) {
                cardElement.classList.remove('flipped');
                cardElement.classList.remove('bomb-chosen');
            }
        });
        gameData.flippedCards = [];
    }
    
    gameData.matchedCards = new Set(data.matchedCards || gameData.matchedCards);
    gameData.scoreHost = data.scoreHost;
    gameData.scoreGuest = data.scoreGuest;

    if (data.playSound) {
        playSound(data.playSound); 
    }

    showGlobalMessage(data.message, data.message.includes('Eşleşme') ? false : true);
    
    gameData.isAnimating = false;
    drawBoard(); 
}

function handleGameEnd(data) {
    gameData.isGameOver = true;
    let winnerText = data.winner === 'DRAW' ? 'BERABERE' : (data.winner === (isHost ? 'Host' : 'Guest') ? 'SİZ KAZANDINIZ 🎉' : 'RAKİP KAZANDI 😢');
    let endMessage = `OYUN BİTTİ! ${winnerText}. Skorlar - Siz: ${isHost ? data.scoreHost : data.scoreGuest}, Rakip: ${isHost ? data.scoreGuest : data.scoreHost}`;
    showGlobalMessage(endMessage, data.winner === 'DRAW' ? false : data.winner === (isHost ? 'Host' : 'Guest') ? false : true);
    updateStatusDisplay();
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, selfUsername, opponentUsername, initialData) {
    socket = s;
    currentRoomCode = roomCode;
    myName = selfUsername;
    opponentName = opponentUsername;
    
    const selfPlayer = initialData.players.find(p => p.id === socket.id);
    isHost = selfPlayer.isHost; 
    
    initializeGame(initialData); 
    drawBoard();
    showScreen('game');
    
    document.getElementById('roleStatus').textContent = `Rolünüz: ${isHost ? 'Host' : 'Guest'}`;
    
    socket.off('gameStateUpdate').on('gameStateUpdate', handleGameStateUpdate);
    socket.off('turnUpdate').on('turnUpdate', handleTurnUpdate); 
    socket.off('gameEnd').on('gameEnd', handleGameEnd);
    socket.off('opponentLeft').on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
    socket.off('newMessage').on('newMessage', (data) => {
        const isMe = data.sender === myName;
        appendMessage(data.sender, data.text, isMe);
    });

    sendChatBtn.onclick = handleSendMessage;
    chatInputEl.onkeypress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); 
            handleSendMessage();
        }
    };

}

export function resetGame() { 
    if (socket) {
        socket.disconnect();
    }
    window.location.reload(); 
}

export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    waitRoomCodeEl: document.getElementById('waitRoomCode'),
    showGlobalMessage, 
    resetGame
};
