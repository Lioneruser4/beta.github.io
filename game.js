// Dosya Adı: game.js (DOMINO İSTEMCİ)
let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let gameData = {};
let selectedTileIndex = -1; // Seçilen taşın indeksi

// --- DOM Referansları ---
const screens = { 
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen') 
};
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const opponentNameEl = document.getElementById('opponentName');
const roleStatusEl = document.getElementById('roleStatus');
const playerHandEl = document.getElementById('playerHand');
const tableEl = document.getElementById('dominoTable');
const deckSizeEl = document.getElementById('deckSize');
const opponentTileCountEl = document.getElementById('opponentTileCount');
const drawBtn = document.getElementById('drawTileBtn');
const playLeftBtn = document.getElementById('playLeftBtn');
const playRightBtn = document.getElementById('playRightBtn');


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

// --- DOMINO TAŞI GÖRSELLEŞTİRME ---
function formatTile(tile) {
    return `${tile.p1}:${tile.p2}`;
}

function createTileElement(tile, isHand = true, index = -1) {
    const div = document.createElement('div');
    div.className = `domino-tile ${isHand ? 'cursor-pointer' : 'shadow-lg'}`;
    div.textContent = formatTile(tile);
    div.dataset.p1 = tile.p1;
    div.dataset.p2 = tile.p2;
    if (isHand) {
        div.dataset.index = index;
        div.addEventListener('click', handleTileSelect);
    }
    return div;
}

function updateStatusDisplay(isMyTurn) {
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";
    
    const leftEnd = gameData.table.length > 0 ? gameData.table[0].p1 : '?';
    const rightEnd = gameData.table.length > 0 ? gameData.table[gameData.table.length - 1].p2 : '?';

    if (isMyTurn) {
        turnStatusEl.textContent = 'SIRA SENDE!';
        actionMessageEl.textContent = `Masa Uçları: [${leftEnd}] ve [${rightEnd}]. Hamle Yap!`;
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-green-600');
        
        // Hamle butonlarını aç
        drawBtn.disabled = false;
        playLeftBtn.disabled = selectedTileIndex === -1;
        playRightBtn.disabled = selectedTileIndex === -1;

    } else {
        turnStatusEl.textContent = 'RAKİBİN SIRASI';
        actionMessageEl.textContent = 'Lütfen Rakibini Bekle.';
        turnStatusEl.classList.remove('text-green-600');
        turnStatusEl.classList.add('text-red-600');
        
        // Hamle butonlarını kapat
        drawBtn.disabled = true;
        playLeftBtn.disabled = true;
        playRightBtn.disabled = true;
        selectedTileIndex = -1; // Seçimi temizle
    }
}

function drawGame() {
    // El Çizimi
    playerHandEl.innerHTML = '';
    gameData.myHand.forEach((tile, index) => {
        const tileEl = createTileElement(tile, true, index);
        if (index === selectedTileIndex) {
            tileEl.classList.add('selected-tile');
        }
        playerHandEl.appendChild(tileEl);
    });

    // Masa Çizimi
    tableEl.innerHTML = '';
    gameData.table.forEach(tile => {
        tableEl.appendChild(createTileElement(tile, false));
    });

    // Durum Çizimi
    deckSizeEl.textContent = gameData.deckSize;
    const opponentHandSize = isHost ? gameData.guestHandSize : gameData.hostHandSize;
    opponentTileCountEl.textContent = `${opponentHandSize} Taş`;
    
    const myTurnId = isHost ? 0 : 1;
    updateStatusDisplay(gameData.turn === myTurnId);
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleTileSelect(event) {
    const tileEl = event.currentTarget;
    const index = parseInt(tileEl.dataset.index);

    if (index === selectedTileIndex) {
        selectedTileIndex = -1; // Seçimi kaldır
        tileEl.classList.remove('selected-tile');
    } else {
        // Eski seçimi kaldır
        if (selectedTileIndex !== -1) {
            document.querySelector(`.domino-tile[data-index="${selectedTileIndex}"]`).classList.remove('selected-tile');
        }
        selectedTileIndex = index; // Yeni seçimi kaydet
        tileEl.classList.add('selected-tile');
    }
    const myTurnId = isHost ? 0 : 1;
    updateStatusDisplay(gameData.turn === myTurnId); // Buton durumlarını güncelle
}

function sendDominoMove(endToPlay) {
    if (selectedTileIndex === -1) {
        showGlobalMessage("Lütfen oynamak istediğiniz taşı seçin.", true);
        return;
    }
    
    // Hamleyi sunucuya gönder
    socket.emit('DOMINO_MOVE', {
        roomCode: currentRoomCode,
        tileIndex: selectedTileIndex,
        endToPlay: endToPlay 
    });
}

function sendDrawMove() {
    socket.emit('DOMINO_DRAW', { roomCode: currentRoomCode });
}

// --- SOCKET.IO HANDLERS ---

export function setupSocketHandlers(s, roomCode, isHostPlayer, opponentNameFromIndex, initialData) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = isHostPlayer;
    opponentName = opponentNameFromIndex;
    
    gameData = {
        myHand: initialData.myHand,
        table: initialData.table,
        deckSize: initialData.deckSize,
        turn: initialData.initialTurn,
        hostHandSize: isHost ? initialData.myHand.length : 7, 
        guestHandSize: isHost ? 7 : initialData.myHand.length,
    };

    drawGame();
    showScreen('game');
    showGlobalMessage(`Oyun ${opponentName} ile başladı! ${isHostPlayer ? 'Sıra Sende.' : 'Rakibini Bekle.'}`, false);
    
    // Olay Dinleyicilerini Ata
    drawBtn.onclick = sendDrawMove;
    playLeftBtn.onclick = () => sendDominoMove('left');
    playRightBtn.onclick = () => sendDominoMove('right');

    // Sunucudan gelen genel oyun durumu güncellemesi
    socket.on('dominoUpdate', (data) => {
        gameData.table = data.table;
        gameData.deckSize = data.deckSize;
        gameData.turn = data.newTurn;

        // Kendi elini güncelle (Eğer çekme hamlesi değilse el boyutu değişir)
        if (isHost) {
            gameData.hostHandSize = data.hostHandSize;
            if (data.myHand) gameData.myHand = data.myHand; // Çekme hamlesinde kullanılır
            gameData.guestHandSize = data.guestHandSize;
        } else {
            gameData.guestHandSize = data.guestHandSize;
            if (data.myHand) gameData.myHand = data.myHand; // Çekme hamlesinde kullanılır
            gameData.hostHandSize = data.hostHandSize;
        }

        selectedTileIndex = -1; // Seçimi temizle
        drawGame();
        
        // Hangi oyuncunun hamle yaptığını göster
        const playerMadeMove = (data.lastMove.player === (isHost ? 0 : 1)) ? 'SİZ' : 'Rakibiniz';
        if (data.lastMove.drew) {
             showGlobalMessage(`${playerMadeMove} stoktan taş çekti ve pas geçti.`, false);
        } else {
             showGlobalMessage(`${playerMadeMove} bir taş oynadı.`, false);
        }
    });
    
    // Stoktan çekme sadece çeken oyuncuya gelir
    socket.on('drawUpdate', (data) => {
        gameData.myHand = data.myHand;
        gameData.deckSize = data.deckSize;
        drawGame();
        showGlobalMessage("Stoktan yeni taş çekildi.", false);
    });

    socket.on('invalidMove', (message) => {
        showGlobalMessage(message, true);
    });

    socket.on('gameOver', (data) => {
        const winner = (data.winner === (isHost ? 0 : 1)) ? 'SİZ KAZANDINIZ!' : 'RAKİP KAZANDI!';
        showGlobalMessage(`OYUN BİTTİ: ${winner}`, false);
        setTimeout(resetGame, 5000);
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
