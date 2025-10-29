// Dosya Adı: game.js (HATASIZ - HAFIZA OYUNU İSTEMCİ)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let myName = '';
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

// Sohbet Referansları
const chatInputEl = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const messagesEl = document.getElementById('messages');

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

// --- TEMEL UI FONKSİYONLARI (Değişiklik Yok) ---
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

function drawBoard() {
    let columns = 5; 
    gameBoardEl.className = `grid w-full max-w-sm mx-auto memory-board grid-cols-${columns}`; 
    gameBoardEl.innerHTML = '';
    
    const isMyTurn = gameData.currentTurnId === socket.id;

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
        back.textContent = content; // EMOJİ BURADA DOĞRU GÖSTERİLİYOR

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        const isMatched = gameData.matchedCards.has(index);
        const isFlipped = gameData.flippedCards.includes(index);

        if (isMatched || isFlipped) {
            card.classList.add('flipped');
            if (isMatched) { cardContainer.classList.add('matched'); }
        }
        
        // Sadece sırası gelen ve eşleşmemiş/çevrilmemiş kartlara tıklama ekle
        if (isMyTurn && !isMatched && !isFlipped && !gameData.isAnimating && !gameData.isGameOver) {
            cardContainer.addEventListener('click', handleCardClick);
            cardContainer.classList.add('cursor-pointer');
        } else {
            cardContainer.classList.remove('cursor-pointer');
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const myTurn = gameData.currentTurnId === socket.id;
    const myScore = isHost ? gameData.scoreHost : gameData.scoreGuest;
    const opponentScore = isHost ? gameData.scoreGuest : gameData.scoreHost;
    
    myNameEl.textContent = `${myName} (Skor: ${myScore})`;
    opponentNameEl.textContent = `${opponentName} (Skor: ${opponentScore})`;

    if (gameData.isGameOver) {
        turnStatusEl.textContent = "OYUN BİTTİ!";
    } else if (myTurn) {
        turnStatusEl.textContent = "SIRA SİZDE! Kart seçin.";
        turnStatusEl.classList.remove('text-gray-600', 'text-red-600');
        turnStatusEl.classList.add('text-green-600');
    } else {
        // Rakibin sırası geldiğinde, rakip kart çevirirken kilitle
        const opponentIsPlaying = gameData.currentTurnId !== socket.id && !gameData.isAnimating;
        turnStatusEl.textContent = opponentIsPlaying ? `RAKİP OYNUYOR (${opponentName})...` : 'Bekleniyor...';
        turnStatusEl.classList.remove('text-green-600');
        turnStatusEl.classList.add('text-red-600');
    }
    actionMessageEl.textContent = `Tahtada ${gameData.cardContents.length - gameData.matchedCards.size} kart kaldı.`;
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
    
    // Tıklanan kart zaten açık veya eşleşmişse gönderimi engelle
    if (gameData.flippedCards.includes(cardIndex) || gameData.matchedCards.has(cardIndex)) return;

    sendMove(cardIndex);
    
    // 1. Kart açılırken animasyon kilidi kaldırılmaz, sadece 2. karttan sonra kilitlenir.
    if (gameData.flippedCards.length === 1) { // Eğer bu hamle 2. hamle ise
        gameData.isAnimating = true; // Sunucudan sonuç gelene kadar kilitle
    }
    
    // Görsel geri bildirim hemen
    cardElement.classList.add('flipped');
    // Tıklama olayını hemen kaldır
    cardContainer.removeEventListener('click', handleCardClick);
    cardContainer.classList.remove('cursor-pointer');
}

function sendMove(index) {
    if (socket && socket.connected) {
        socket.emit('MOVE', {
            roomCode: currentRoomCode,
            cardIndex: index,
        });
    }
}

// Sunucudan Kart Açma Bilgisi Geldiğinde
function handleGameStateUpdate(data) {
    const { cardIndex, flippedCards, matchedCards, scoreHost, scoreGuest } = data;
    
    gameData.flippedCards = flippedCards;
    gameData.matchedCards = new Set(matchedCards);
    gameData.scoreHost = scoreHost;
    gameData.scoreGuest = scoreGuest;

    // RAKİP HAREKETİNİ GÖRSEL OLARAK ÇEVİR
    const cardElement = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (cardElement && !cardElement.classList.contains('flipped')) {
        cardElement.classList.add('flipped'); 
    }
    
    // 2. kart açıldığında, oyuncu kim olursa olsun, sıra değişimi beklenirken tahtayı kitle
    if (flippedCards.length === 2) {
        gameData.isAnimating = true; 
    } else {
        gameData.isAnimating = false;
    }
    
    drawBoard(); // Tahtayı güncelleyerek tıklama olaylarını doğru ayarla
}

// Sunucudan Sıra Değişikliği Bilgisi Geldiğinde
function handleTurnUpdate(data) {
    gameData.currentTurnId = data.turn;
    
    // Eşleşme yoksa kartları kapat ve puanı güncelle
    if (data.flippedCards && data.flippedCards.length === 0) {
        // Görsel olarak kapanan kartları UI'dan kaldır
        gameData.flippedCards.forEach(index => {
            const cardElement = document.querySelector(`.card[data-index="${index}"]`);
            if (cardElement) {
                cardElement.classList.remove('flipped');
            }
        });
        gameData.flippedCards = [];
    }

    gameData.matchedCards = new Set(data.matchedCards || gameData.matchedCards);
    gameData.scoreHost = data.scoreHost;
    gameData.scoreGuest = data.scoreGuest;
    
    showGlobalMessage(data.message, data.message.includes('Eşleşmedi') ? true : false);
    
    gameData.isAnimating = false;
    drawBoard(); // Sıra değişince tahtayı yeniden çiz
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
    
    // Eski eventleri kaldırıp yenilerini ekle (çakışmayı önler)
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
