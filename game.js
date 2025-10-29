// Dosya Adı: game.js (EMOJİ BOMBA OYUNU İSTEMCİ)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let myName = '';
const BOMB_EMOJI = '💣';
const ANIMATION_DELAY = 1500; 

// --- DOM Referansları (Aynı) ---
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
// Sohbet aynı...

// Yeni Ses Fonksiyonu (index.html'e <audio> etiketlerini eklemeniz gerekmektedir)
function playSound(soundKey) {
    const audioEl = document.getElementById(soundKey); // Örneğin: <audio id="BOMB_SOUND" src="bomb.mp3"></audio>
    if (audioEl) {
        audioEl.currentTime = 0; // Başa sar
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

// --- TEMEL UI FONKSİYONLARI (Aynı) ---
export function showScreen(screenId) { /* ... */ }
export function showGlobalMessage(message, isError = true) { /* ... */ }
function appendMessage(sender, text, isMe) { /* ... */ }
function handleSendMessage() { /* ... */ }


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

        // Kartın içeriği (Emoji)
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
        }
        
        // Sadece sırası gelen, eşleşmemiş ve açık olmayan kartlara tıklama ekle
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
    
    // Tıklamaları hemen engelle (2. kartı beklerken)
    gameBoardEl.querySelectorAll('.card-container').forEach(el => el.removeEventListener('click', handleCardClick));
    
    // 2. kart çevriliyorsa, animasyon kilidini aç
    if (gameData.flippedCards.length === 1) { 
        gameData.isAnimating = true; 
    }
    
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

// Sunucudan Kart Açma Bilgisi Geldiğinde (KRİTİK DÜZELTME)
function handleGameStateUpdate(data) {
    const { flippedCardIndex, flippedCards, matchedCards, scoreHost, scoreGuest, cardContent } = data;
    
    gameData.flippedCards = flippedCards;
    gameData.matchedCards = new Set(matchedCards);
    gameData.scoreHost = scoreHost;
    gameData.scoreGuest = scoreGuest;

    // Açılan kartı görsel olarak çevir (Hem kendi hareketin hem rakibinki)
    const cardElement = document.querySelector(`.card[data-index="${flippedCardIndex}"]`);
    if (cardElement && !cardElement.classList.contains('flipped')) {
        cardElement.classList.add('flipped'); 
        
        // Eğer 2. kart çevrildiyse animasyon kilidini aç (turnUpdate gelene kadar)
        if (flippedCards.length === 2) {
            gameData.isAnimating = true;
        }
        
        // Bomba seçildi mi kontrol et (Hemen görsel geri bildirim için)
        if (cardContent === BOMB_EMOJI) {
             cardElement.classList.add('bomb-chosen');
             // Sadece kendi sıramızdaki ilk bomba seçiminde ses çalmak için buraya özel bir kontrol eklenebilir.
        }
    }
    
    drawBoard(); // Tahtayı güncelleyerek (özellikle tıklama olaylarını doğru ayarla)
}

// Sunucudan Sıra Değişikliği Bilgisi Geldiğinde (Bomba ve Skor Yönetimi)
function handleTurnUpdate(data) {
    gameData.currentTurnId = data.turn;
    
    // Kart Kapatma İşlemi
    if (data.flippedCards && data.flippedCards.length === 0) {
        // Kartları kapat
        gameData.flippedCards.forEach(index => {
            const cardElement = document.querySelector(`.card[data-index="${index}"]`);
            if (cardElement) {
                cardElement.classList.remove('flipped');
                cardElement.classList.remove('bomb-chosen');
            }
        });
        gameData.flippedCards = [];
    }
    
    // Puan ve Eşleşme Güncelleme
    gameData.matchedCards = new Set(data.matchedCards || gameData.matchedCards);
    gameData.scoreHost = data.scoreHost;
    gameData.scoreGuest = data.scoreGuest;

    // Ses ve Animasyon
    if (data.playSound) {
        playSound(data.playSound); 
        
        if (data.isBomb) {
            // Bomba Animasyonu (CSS ile patlama animasyonu tetiklenebilir)
            data.bombIndexes.forEach(index => {
                const cardContainer = document.querySelector(`.card-container > .card[data-index="${index}"]`);
                if (cardContainer) {
                    // cardContainer.classList.add('bomb-animation'); // CSS ile animasyonu tetikle
                    setTimeout(() => { 
                         cardContainer.classList.remove('bomb-chosen'); 
                         // cardContainer.classList.remove('bomb-animation'); 
                    }, 500);
                }
            });
        }
    }

    showGlobalMessage(data.message, data.message.includes('Eşleşme') ? false : true);
    
    gameData.isAnimating = false;
    drawBoard(); // Tahtayı yeniden çiz ve tıklama olaylarını doğru şekilde ekle
}

// ... (handleGameEnd, setupSocketHandlers, resetGame ve UIElements aynı kalır) ...
// setupSocketHandlers içinde 'gameStateUpdate' ve 'turnUpdate' dinleyicilerinin doğru atandığından emin olun.
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
    
    // Bağlantı dinleyicilerini bir kere atadığınızdan emin olun
    socket.off('gameStateUpdate').on('gameStateUpdate', handleGameStateUpdate);
    socket.off('turnUpdate').on('turnUpdate', handleTurnUpdate); 
    // ... (diğer dinleyiciler) ...
}

export function resetGame() { /* ... */ }
export const UIElements = { /* ... */ };
