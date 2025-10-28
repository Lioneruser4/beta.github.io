// Dosya Adı: game.js (BOMBALI HAFIZA İSTEMCİ V4 - KESİN DÜZELTME)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let myName = '';
const ANIMATION_DELAY = 1000; // Kart açma animasyonu süresi (MS)

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

// --- OYUN DURUMU ---
let gameData = {
    board: [], // Tüm kartların emoji içeriklerini tutar
    openedCards: [], // Açık kartların indeksleri
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false,
    isAnimating: false // Sadece animasyon süresince tıklamayı engeller
};

// 10 farklı emoji, 20 kart için
const EMOTICONS = ['🍉', '🍇', '🍒', '🍕', '🐱', '⭐', '🚀', '🔥', '🌈', '🎉'];

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

function initializeGame(boardSize, hostBombs, guestBombs, initialLives) {
    gameData.hostBombs = hostBombs;
    gameData.guestBombs = guestBombs;
    gameData.hostLives = initialLives;
    gameData.guestLives = initialLives;
    gameData.openedCards = [];
    gameData.cardsLeft = boardSize;
    gameData.isGameOver = false;
    gameData.isAnimating = false;
    
    // Kart içerikleri oluşturma ve karıştırma
    const pairs = boardSize / 2; 
    let cardContents = [];
    for (let i = 0; i < pairs; i++) {
        const emoji = EMOTICONS[i % EMOTICONS.length]; 
        cardContents.push(emoji, emoji); // Her emojiyi çift olarak ekle
    }
    
    // Fisher-Yates shuffle ile karıştır
    for (let i = cardContents.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardContents[i], cardContents[j]] = [cardContents[j], cardContents[i]];
    }

    gameData.board = cardContents;
}

function drawBoard() {
    // 20 kart için 5x4 grid
    let columns = 5; 
    
    gameBoardEl.className = `grid w-full max-w-sm mx-auto memory-board grid-cols-${columns}`; 
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((content, index) => {
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
        
        // Bu oyuncunun canını düşürecek olan RAKİBİNİN bombasıdır.
        const isOpponentBomb = isHost ? gameData.guestBombs.includes(index) : gameData.hostBombs.includes(index);
        
        let displayContent = content; // Karıştırılmış emojiyi alıyoruz
        if (isOpponentBomb) {
            displayContent = '💣';
            back.classList.add('bg-red-200');
        }

        back.textContent = displayContent; // Emoji veya Bomba göster

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        const isOpened = gameData.openedCards.includes(index);

        if (isOpened) {
            card.classList.add('flipped');
        } else if (!gameData.isGameOver && !gameData.isAnimating) {
            // Oyun bitmediyse ve animasyon yoksa herkes tıklayabilir
            card.classList.add('cursor-pointer');
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
    
    if (gameData.isAnimating || gameData.isGameOver) return; 

    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    // Hamleyi sunucuya gönder, gerisini sunucu halledecek
    sendMove(cardIndex);
    gameData.isAnimating = true; // Animasyon bitene kadar tıklamayı engelle
}

function sendMove(index) {
    if (socket && socket.connected) {
        socket.emit('MOVE', {
            roomCode: currentRoomCode,
            cardIndex: index,
        });
    }
}

// KRİTİK: Sunucudan gelen oyun durumunu işler
async function handleGameStateUpdate(data) {
    
    const { moveResult, hostLives, guestLives, cardsLeft } = data;
    const { cardIndex, hitBomb, gameOver, winner, moverName } = moveResult;
    
    // 1. Kartı Aç (Görsel Animasyon)
    const cardElement = document.querySelector(`.card[data-index="${cardIndex}"]`);
    if (cardElement) {
        // Tıklanan kartı hemen çevir (animasyon kilidini aşmak için)
        cardElement.classList.add('flipped'); 
        
        if (hitBomb) {
            cardElement.classList.add('vibrate');
        }
    }
    
    // 2. Client Durumunu Güncelle (Hemen)
    gameData.hostLives = hostLives;
    gameData.guestLives = guestLives;
    gameData.cardsLeft = cardsLeft;
    gameData.openedCards.push(cardIndex);

    // 3. Mesaj Göster
    if (hitBomb) {
         showGlobalMessage(`${moverName} bombaya bastı! Canı: -1`, true);
    } else {
         showGlobalMessage(`${moverName} güvenli kart açtı.`, false);
    }
    
    // 4. Animasyon Bitişini Bekle
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DELAY));
    
    // 5. Animasyon Kilitini Kaldır ve Titreşimi Temizle
    gameData.isAnimating = false;
    if (cardElement) {
        cardElement.classList.remove('vibrate');
    }

    // 6. Oyun Bitiş Kontrolü
    if (gameOver) {
        gameData.isGameOver = true;
        handleGameEnd(winner, hostLives, guestLives);
        return;
    }

    // 7. UI'yi Çiz (Yeni durumla ve güncellenmiş kartlar listesiyle)
    drawBoard();
}

function handleGameEnd(winnerRole, finalHostLives, finalGuestLives) {
    
    let endMessage = "";
    
    if (winnerRole === 'DRAW') {
        endMessage = "OYUN BERABERE! (Canlar eşit veya çakışan can bitişi)";
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

        if (gameData.cardsLeft === 0) {
            endMessage += ` (Kartlar bittiği için can üstünlüğüyle kazandı.)`;
        } else {
            endMessage += ` (Canı 0'a düşen kaybetti.)`;
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
    const hostPlayer = initialData.players.find(p => p.isHost);
    isHost = selfPlayer.id === hostPlayer.id; // Rolü doğru ayarla
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rol: HOST" : "Rol: GUEST";
    
    initializeGame(
        initialData.boardSize, 
        initialData.hostBombs, 
        initialData.guestBombs, 
        initialData.initialLives 
    );
    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Başarılar.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---
    socket.on('gameStateUpdate', handleGameStateUpdate);

    socket.on('infoMessage', (data) => {
        showGlobalMessage(data.message, data.isError);
        gameData.isAnimating = false; 
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
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
