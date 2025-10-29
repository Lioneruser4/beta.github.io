// Dosya Adı: game.js (PROFESYONEL İSTEMCİ)
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
const messagesEl = document.getElementById('messages');
const chatInputEl = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

let gameData = {
    cardContents: [],
    matchedCards: new Set(),
    flippedCards: [], // Sadece yerel olarak çevrilen kartları tutar
    currentTurnId: null,
    isAnimating: false,
    isGameOver: false,
    scoreHost: 0,
    scoreGuest: 0
};

// --- UI / SES Fonksiyonları ---
function playSound(soundKey) {
    const audioEl = document.getElementById(soundKey); 
    if (audioEl) {
        audioEl.currentTime = 0; 
        audioEl.play().catch(e => console.error("Ses çalınamadı:", e));
    }
}

export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen && screen.classList.remove('active'));
    if (screens[screenId]) { screens[screenId].classList.add('active'); }
}

export function showGlobalMessage(message, isError = true) {
    // ... (Global mesaj gösterme mantığı) ...
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
            // Bomba durumunu ekle
            if (content === BOMB_EMOJI && isFlipped && !isMatched) {
                 card.classList.add('bomb-chosen');
            }
        }
        
        // Tıklama işleyicisi
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
    if (gameData.isAnimating || gameData.isGameOver || gameData.currentTurnId !== socket.id) return; 

    const cardElement = event.currentTarget.querySelector('.card');
    const cardIndex = parseInt(cardElement.dataset.index);
    
    if (gameData.flippedCards.includes(cardIndex) || gameData.matchedCards.has(cardIndex)) return;
    
    // İkinci kart çevriliyorsa animasyon beklenmeli
    if (gameData.flippedCards.length === 1) { 
        gameData.isAnimating = true; 
        gameBoardEl.querySelectorAll('.card-container').forEach(el => el.removeEventListener('click', handleCardClick));
    }
    
    // Kartı yerel olarak anında çevir ve sunucuya gönder
    gameData.flippedCards.push(cardIndex);
    drawBoard(); 
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

// Sunucudan Kart Açma Bilgisi Geldiğinde (Anlık Senkronizasyon)
function handleGameStateUpdate(data) {
    const { flippedCardIndex, flippedCards, cardContent } = data;
    
    // Sadece rakip çevirdiyse, yerel state'i güncelle
    if (socket.id !== gameData.currentTurnId) {
        gameData.flippedCards = flippedCards;
        drawBoard(); 
    }
}

// Sunucudan Sıra Değişikliği Bilgisi Geldiğinde 
function handleTurnUpdate(data) {
    gameData.currentTurnId = data.turn;
    
    gameData.matchedCards = new Set(data.matchedCards || gameData.matchedCards);
    gameData.scoreHost = data.scoreHost;
    gameData.scoreGuest = data.scoreGuest;

    if (data.playSound) { playSound(data.playSound); }
    showGlobalMessage(data.message, data.message.includes('Eşleşme') ? false : true);
    
    
    // Eşleşme olmadıysa veya bomba açıldıysa kartları kapat
    if (data.turnChange) {
        data.flippedIndexesToClose.forEach(index => {
             const cardElement = document.querySelector(`.card[data-index="${index}"]`);
             if (cardElement) {
                 cardElement.classList.remove('flipped');
                 cardElement.classList.remove('bomb-chosen');
             }
        });
    }

    gameData.flippedCards = []; // Yerel olarak çevrilen kartları sıfırla
    gameData.isAnimating = false;
    drawBoard(); // Yeni durumu yansıt
}

function handleGameEnd(data) {
    gameData.isGameOver = true;
    let winnerName = (data.winner === myName) ? "SİZ KAZANDINIZ 🎉" : (data.winner === opponentName ? "RAKİP KAZANDI 😢" : "BERABERE");
    let endMessage = `OYUN BİTTİ! ${winnerName}. Skorlar - Siz: ${isHost ? data.scoreHost : data.scoreGuest}, Rakip: ${isHost ? data.scoreGuest : data.scoreHost}`;
    showGlobalMessage(endMessage, data.winner === myName ? false : true);
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
    
    gameData.cardContents = initialData.cardContents;
    gameData.currentTurnId = initialData.turn;
    gameData.matchedCards = new Set(initialData.matchedCards);

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
    // ... (Sohbet mantığı) ...
}

export function resetGame() { 
    if (socket) { socket.disconnect(); }
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
