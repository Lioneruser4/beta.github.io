// Dosya Adı: game.js (EŞ ZAMANLI V5 - KESİN DÜZELTME)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let myName = '';
const ANIMATION_DELAY = 1000;

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
const myNameEl = document.getElementById('myName');

// --- SOHBET REFERANSLARI ---
const chatInputEl = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const messagesEl = document.getElementById('messages');
// ----------------------------

// --- OYUN DURUMU ---
let gameData = {
    cardContents: [], // Sunucudan alınan karıştırılmış ve atanmış içerikler
    openedCards: new Set(), // Açık kartların indekslerini tutar
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    isGameOver: false,
    isAnimating: false
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

// --- SOHBET YARDIMCI FONKSİYONLARI ---
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
// -------------------------------------


// --- OYUN MANTIĞI VE ÇİZİM ---

function initializeGame(initialData) {
    gameData.cardContents = initialData.cardContents; 
    gameData.hostLives = initialData.initialLives;
    gameData.guestLives = initialData.initialLives;
    gameData.openedCards = new Set();
    gameData.cardsLeft = initialData.boardSize;
    gameData.isGameOver = false;
    gameData.isAnimating = false;
}

function drawBoard() {
    let columns = 5; 
    
    gameBoardEl.className = `grid w-full max-w-sm mx-auto memory-board grid-cols-${columns}`; 
    gameBoardEl.innerHTML = '';
    
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
        
        let displayContent = content;
        
        // Bomba ise özel sınıf ekle
        if (displayContent === '💣') {
            back.classList.add('bg-red-200');
        }

        back.textContent = displayContent; // Emoji veya Bomba göster

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        const isOpened = gameData.openedCards.has(index);

        if (isOpened) {
            card.classList.add('flipped');
        } 
        
        // KRİTİK DÜZELTME: Tıklama dinleyicisini Host/Guest ayrımı yapmadan ekle.
        if (!isOpened && !gameData.isGameOver) {
            card.classList.add('cursor-pointer');
            
            // Dinleyiciyi kaldırıp tekrar eklemek, çift tetiklenmeyi önler.
            cardContainer.removeEventListener('click', handleCardClick);
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
    myNameEl.textContent = myName;

    if (gameData.isGameOver) {
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
        turnStatusEl.classList.remove('text-green-600');
        turnStatusEl.classList.add('text-red-600');
    } else {
        turnStatusEl.textContent = 'EŞ ZAMANLI AV';
        actionMessageEl.textContent = `Toplam ${gameData.cardsLeft} kart kaldı. Hızlı ol!`;
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-green-600');
    }
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    
    // YALNIZCA KİLİT/ANİMASYON DURUMU VEYA OYUN SONU İSE ÇIK
    if (gameData.isAnimating || gameData.isGameOver) {
        // console.log("Tıklama engellendi: Animasyon veya Oyun Bitti.");
        return;
    } 

    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    // Kart zaten açıksa veya element yoksa çık
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    sendMove(cardIndex);
    gameData.isAnimating = true; // Sunucudan yanıt gelene kadar kilitler
}

function sendMove(index) {
    if (socket && socket.connected) {
        socket.emit('MOVE', {
            roomCode: currentRoomCode,
            cardIndex: index,
        });
    }
}

async function handleGameStateUpdate(data) {
    
    const { moveResult, hostLives, guestLives, cardsLeft, openedCardsIndices } = data;
    const { cardIndex, hitBomb, gameOver, winner, moverName } = moveResult;
    
    // 1. Yeni Açılan Kartı Bul ve Çevir (Görsel Animasyon)
    const cardElement = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (cardElement) {
        cardElement.classList.add('flipped'); 
        if (hitBomb) { cardElement.classList.add('vibrate'); }
    }
    
    // 2. Client Durumunu Güncelle
    gameData.hostLives = hostLives;
    gameData.guestLives = guestLives;
    gameData.cardsLeft = cardsLeft;
    gameData.openedCards = new Set(openedCardsIndices); 

    // 3. Mesaj Göster
    if (hitBomb) { showGlobalMessage(`${moverName} bombaya bastı! Canı: -1`, true); } 
    else { showGlobalMessage(`${moverName} güvenli kart açtı.`, false); }
    
    // 4. Animasyon Bitişini Bekle
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAY));
    
    // 5. Animasyon Kilitini Kaldır ve Titreşimi Temizle
    gameData.isAnimating = false;
    if (cardElement) { cardElement.classList.remove('vibrate'); }

    // 6. Oyun Bitiş Kontrolü
    if (gameOver) {
        gameData.isGameOver = true;
        handleGameEnd(winner);
        return;
    }

    // 7. UI'yi Çiz (Yeni durumla)
    drawBoard();
}

function handleGameEnd(winnerRole) {
    let endMessage = "";
    
    if (winnerRole === 'DRAW') {
        endMessage = "OYUN BERABERE!";
        showGlobalMessage(endMessage, true);
    } else {
        const winnerName = (winnerRole === 'Host') === isHost ? myName : opponentName;
        
        if ((winnerRole === 'Host') === isHost) {
            endMessage = `TEBRİKLER! KAZANDINIZ!`;
            showGlobalMessage(endMessage, false);
        } else {
            endMessage = `OYUN BİTTİ. ${winnerName} KAZANDI!`;
            showGlobalMessage(endMessage, true);
        }
    }
    
    updateStatusDisplay();
    setTimeout(resetGame, 5000);
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---

export function setupSocketHandlers(s, roomCode, selfUsername, opponentUsername, initialData) {
    socket = s;
    currentRoomCode = roomCode;
    myName = selfUsername;
    opponentName = opponentUsername;
    
    const selfPlayer = initialData.players.find(p => p.id === socket.id);
    isHost = selfPlayer.isHost; 
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rol: HOST" : "Rol: GUEST";
    
    initializeGame(initialData); 
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Başarılar.`, false);
    
    // --- SOCKET.IO OYUN İŞLEYİCİLERİ ---
    socket.on('gameStateUpdate', handleGameStateUpdate);

    socket.on('infoMessage', (data) => {
        showGlobalMessage(data.message, data.isError);
        gameData.isAnimating = false; 
    });
    
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });

    // --- SOCKET.IO SOHBET İŞLEYİCİLERİ ---
    socket.on('newMessage', (data) => {
        const isMe = data.sender === myName;
        appendMessage(data.sender, data.text, isMe);
    });

    // 2. DOM olay dinleyicileri
    sendChatBtn.addEventListener('click', handleSendMessage);
    
    // 3. Enter tuşu ile gönderme
    chatInputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); 
            handleSendMessage();
        }
    });
}

export function resetGame() { window.location.reload(); }

export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
