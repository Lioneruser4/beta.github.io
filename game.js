// Dosya Adı: game.js (Sıra Kontrollü Güncel Sürüm)
let socket;
let currentRoomCode = '';
export let isHost = false; // index.html'den gelen değerle güncellenecek
let opponentName = '';
export let myName = ''; 

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
const endGameBtn = document.getElementById('endGameBtn');

// SESLER (index.html'den alınır)
const audioBomb = document.getElementById('BOMB_SOUND'); 
const audioEmoji = document.getElementById('EMOJI_SOUND');
// const audioWait = document.getElementById('WAIT_SOUND'); // Şu an kullanılmıyor

function playSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {});
}

// --- OYUN DURUMU (Server'dan senkronize edilir) ---
export const LEVELS = [12, 16, 20]; // Dışarıya açıldı
export let level = 1; 
let selectedBombs = []; 
export let gameData = {
    board: [], 
    turn: 0,   // 0 = Host, 1 = Guest
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    gameStage: 'SELECTION', // 'SELECTION', 'PLAY', 'ENDED'
    isGameOver: false // Kullanılmıyor, gameStage ile yönetiliyor
};


// --- TEMEL UI FONKSİYONLARI ---

export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    if (screens[screenId]) screens[screenId].classList.add('active');
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

function drawBoard() {
    
    // Grid düzenini 4 sütun (4x3, 4x4, 4x5 için)
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; 
    
    gameBoardEl.innerHTML = '';
    
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    
    gameData.board.forEach((cardState, index) => {
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
        back.textContent = cardState.content;

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        // Kart açıldıysa çevir
        if (cardState.opened) {
            card.classList.add('flipped');
        } else {
            // Seçim aşamasında kendi seçtiğimiz bombaları göster
            if (gameData.gameStage === 'SELECTION' && selectedBombs.includes(index)) {
                card.classList.add('bomb-selected'); 
            }
            
            // Tıklama Olayı: Sadece sırası gelene veya seçim aşamasında
            const canClick = (gameData.gameStage === 'SELECTION') || (gameData.gameStage === 'PLAY' && isMyTurn);
            
            // Tıklama olayını her çizimde temizle ve yeniden ata
            cardContainer.removeEventListener('click', handleCardClick);
            if (canClick) {
                cardContainer.classList.add('cursor-pointer');
                cardContainer.addEventListener('click', handleCardClick);
            } else {
                cardContainer.classList.remove('cursor-pointer');
            }
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    // Canları güncelle
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives)) || '💀';
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives)) || '💀';

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    
    if (gameData.gameStage === 'ENDED') {
        turnStatusEl.textContent = 'OYUN BİTTİ!';
        turnStatusEl.classList.remove('text-green-600', 'text-red-600');
        turnStatusEl.classList.add('text-blue-700');
        return;
    }
    
    if (gameData.gameStage === 'SELECTION') {
        if (selectedBombs.length < 3) {
            turnStatusEl.textContent = `Bomba Seçimi: ${selectedBombs.length} / 3`;
            actionMessageEl.textContent = "3 adet gizli bombanın yerini seçin.";
            turnStatusEl.classList.add('text-green-600');
            turnStatusEl.classList.remove('text-red-600');
        } else {
            turnStatusEl.textContent = `Rakip Seçim Yapıyor...`;
            actionMessageEl.textContent = "Seçiminiz tamamlandı. Rakibi bekleyin.";
            turnStatusEl.classList.add('text-red-600');
            turnStatusEl.classList.remove('text-green-600');
        }
    } else if (gameData.gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = 'SIRA SENDE! (' + myName + ')';
            actionMessageEl.textContent = "Hemen bir kart aç!";
            turnStatusEl.classList.add('text-green-600');
            turnStatusEl.classList.remove('text-red-600');
        } else {
            turnStatusEl.textContent = 'RAKİBİN SIRASI (' + opponentName + ')';
            actionMessageEl.textContent = "Rakibin hareketini bekle. Kalan Kart: " + gameData.cardsLeft;
            turnStatusEl.classList.add('text-red-600');
            turnStatusEl.classList.remove('text-green-600');
        }
    }
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameData.gameStage === 'SELECTION') {
        if (selectedBombs.includes(cardIndex)) {
            selectedBombs = selectedBombs.filter(i => i !== cardIndex);
            cardElement.classList.remove('bomb-selected');
        } else if (selectedBombs.length < 3) {
            selectedBombs.push(cardIndex);
            cardElement.classList.add('bomb-selected');
        }
        drawBoard(); 
        
        if (selectedBombs.length === 3) {
            // Bombaları sunucuya gönder
            socket.emit('bombSelectionComplete', { roomCode: currentRoomCode, isHost: isHost, bombs: selectedBombs });
            // Hemen durumu güncelle ki tekrar tıklamasın
            updateStatusDisplay();
        }
    } else if (gameData.gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.gameStage === 'ENDED') return; 
        
        sendMove(cardIndex);
    }
}

function sendMove(index) {
    if (socket && socket.connected) {
        // Tıklanan kartı hemen çevir (kullanıcıya anında geri bildirim)
        const cardElement = document.querySelector(`.card[data-index="${index}"]`);
        if(cardElement) cardElement.classList.add('flipped');

        // Tıklamayı devredışı bırak
        gameBoardEl.querySelectorAll('.card-container').forEach(el => el.removeEventListener('click', handleCardClick));
        
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
        });
    }
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
// KRİTİK: isHostStatus parametresi index.html'den doğru gelmeli!
export function setupSocketHandlers(s, roomCode, selfUsername, opponentUsername, isHostStatus, initialGameData) {
    socket = s;
    currentRoomCode = roomCode;
    myName = selfUsername;
    opponentName = opponentUsername;
    isHost = isHostStatus; // Host bilgisi index.html'den alındı

    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST (Başlatıcı)" : "Rolünüz: GUEST (Katılımcı)";

    // Oyun durumunu sunucudan gelenle başlat
    gameData = { ...gameData, ...initialGameData };
    level = gameData.level;
    selectedBombs = isHost ? gameData.hostBombs : gameData.guestBombs; // Bombası önceden seçilmişse yükle

    drawBoard();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! Bomba seçimine geçiliyor.`, false);
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // YENİ: Rakip Seçim Yaptı
    socket.off('opponentSelectionMade').on('opponentSelectionMade', () => {
        actionMessageEl.textContent = "Rakip bombasını seçti. Lütfen siz de 3 bomba seçin.";
    });

    // YENİ: Seçim Tamamlandı
    socket.off('selectionComplete').on('selectionComplete', (data) => {
        gameData.gameStage = data.gameStage;
        gameData.turn = data.turn;
        showGlobalMessage('Herkes bombasını seçti! Kart açma aşaması başlıyor.', false);
        drawBoard(); 
    });

    // YENİ VE KRİTİK: Oyun Durumu Güncellemesi (Hareketten Sonra)
    socket.off('gameStateUpdate').on('gameStateUpdate', (data) => {
        
        // 1. Oyun Verilerini Güncelle
        gameData.board = data.newBoardState;
        gameData.turn = data.turn;
        gameData.hostLives = data.hostLives;
        gameData.guestLives = data.guestLives;
        gameData.cardsLeft = data.cardsLeft;

        // 2. Ses ve Mesaj
        if (data.hitBomb) {
            playSound(audioBomb);
            showGlobalMessage(`BOOM! ${isHost ? opponentName : myName} bombaya bastı!`, true);
        } else {
            playSound(audioEmoji);
        }
        
        // 3. Tahtayı Çiz ve Durumu Güncelle
        drawBoard(); 
        
        // 4. Oyun Sonu Kontrolü
        if (data.winner) {
            gameData.gameStage = 'ENDED';
            const winnerText = data.winner === 'DRAW' ? 'BERABERE' : 
                               (data.winner === (isHost ? 'Host' : 'Guest') ? 'SİZ KAZANDINIZ 🎉' : `${opponentName} KAZANDI 😢`);
            turnStatusEl.textContent = `OYUN BİTTİ! ${winnerText}`;
            actionMessageEl.textContent = isHost ? 'Yeni seviyeye geçmek için butona basın.' : 'Host yeni seviyeye geçmesini bekleyin.';
            
            if (isHost) {
                 endGameBtn.textContent = "Yeni Seviye / Oyunu Bitir";
            }
        }
    });

    // YENİ: Seviye Başlatma Sinyali (Host'tan Gelir)
    socket.off('levelStart').on('levelStart', ({ initialGameData: newGameData, newLevel }) => {
        level = newLevel;
        gameData = { ...gameData, ...newGameData };
        // Bombalar sıfırlandığı için tekrar seçmek gerekecek
        selectedBombs = []; 
        
        showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Tekrar Bomb Seçimi Başlıyor...`, false);
        drawBoard();
    });
    
    // Rakip Ayrıldı
    socket.off('opponentLeft').on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    // Sayfayı yenileyerek tam sıfırlama yapar
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz (index.html'in kullanması için)
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    waitRoomCode: document.getElementById('roomCodeDisplay'), 
    showGlobalMessage, 
    resetGame
};
