// Dosya Adı: game.js (DOMINO V2 - İSTEMCİ)
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
function formatTileContent(tile) {
    // Görsel olarak domino taşının iki parçasını ayır
    return `<div class="p-part">${tile.p1}</div><div class="p-divider"></div><div class="p-part">${tile.p2}</div>`;
}

function createTileElement(tile, isHand = true, index = -1) {
    const div = document.createElement('div');
    div.className = `domino-tile ${isHand ? 'cursor-pointer' : 'shadow-lg'}`;
    div.innerHTML = formatTileContent(tile);
    div.dataset.p1 = tile.p1;
    div.dataset.p2 = tile.p2;
    
    // Çift taşlar dikey, diğerleri yatay görünür
    if (tile.p1 !== tile.p2 && !isHand) {
        div.classList.add('horizontal-tile');
    } else if (tile.p1 === tile.p2 && !isHand) {
        div.classList.add('double-tile');
    }
    
    if (isHand) {
        div.dataset.index = index;
        div.addEventListener('click', handleTileSelect);
    }
    return div;
}

function updateStatusDisplay() {
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";
    
    const myTurnId = isHost ? 0 : 1;
    const isMyTurn = gameData.turn === myTurnId;

    let leftEnd = '?';
    let rightEnd = '?';
    if (gameData.table.length > 0) {
        leftEnd = gameData.table[0].p1;
        rightEnd = gameData.table[gameData.table.length - 1].p2;
    }
    
    const tileSelected = selectedTileIndex !== -1;

    if (isMyTurn) {
        turnStatusEl.textContent = 'SIRA SENDE!';
        actionMessageEl.textContent = `Masa Uçları: [${leftEnd}] ve [${rightEnd}].`;
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-green-600');
        
        // Hamle butonlarını aç/kapat
        drawBtn.disabled = gameData.deckSize === 0;
        playLeftBtn.disabled = !tileSelected;
        playRightBtn.disabled = !tileSelected;

    } else {
        turnStatusEl.textContent = 'RAKİBİN SIRASI';
        actionMessageEl.textContent = 'Lütfen Rakibini Bekle.';
        turnStatusEl.classList.remove('text-green-600');
        turnStatusEl.classList.add('text-red-600');
        
        // Butonları kapat
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
    
    updateStatusDisplay();
}

// --- HAREKET İŞLEYİCİLERİ ---

function handleTileSelect(event) {
    const myTurnId = isHost ? 0 : 1;
    if (gameData.turn !== myTurnId) {
        showGlobalMessage("Sıra sende değil.", true);
        return;
    }

    const tileEl = event.currentTarget;
    const index = parseInt(tileEl.dataset.index);

    // Tüm seçimi kaldır
    document.querySelectorAll('.domino-tile.selected-tile').forEach(el => el.classList.remove('selected-tile'));

    if (index === selectedTileIndex) {
        selectedTileIndex = -1; 
    } else {
        selectedTileIndex = index; 
        tileEl.classList.add('selected-tile');
    }
    updateStatusDisplay(); 
}

function sendDominoMove(endToPlay) {
    if (selectedTileIndex === -1) {
        showGlobalMessage("Lütfen oynamak istediğiniz taşı seçin.", true);
        return;
    }
    
    // Butonları geçici olarak kapat
    playLeftBtn.disabled = true;
    playRightBtn.disabled = true;
    drawBtn.disabled = true;
    
    socket.emit('DOMINO_MOVE', {
        roomCode: currentRoomCode,
        tileIndex: selectedTileIndex,
        endToPlay: endToPlay 
    });
}

function sendDrawMove() {
    // Butonları geçici olarak kapat
    playLeftBtn.disabled = true;
    playRightBtn.disabled = true;
    drawBtn.disabled = true;

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

        if (isHost) {
            gameData.hostHandSize = data.hostHandSize;
            gameData.guestHandSize = data.guestHandSize;
        } else {
            gameData.guestHandSize = data.guestHandSize;
            gameData.hostHandSize = data.hostHandSize;
        }

        // Hamleyi yapan oyuncu kimdi?
        const playerMadeMove = (data.lastMove.player === (isHost ? 0 : 1)) ? 'SİZ' : 'Rakibiniz';
        
        if (data.lastMove.passed) {
             showGlobalMessage(`${playerMadeMove} pas geçti. Sıra ${data.newTurn === (isHost ? 0 : 1) ? 'Size' : 'Rakibinize'} geçti.`, false);
        } else {
             showGlobalMessage(`${playerMadeMove} bir taş oynadı.`, false);
        }

        selectedTileIndex = -1; 
        drawGame();
    });
    
    // Stoktan çekme sadece çeken oyuncuya gelir (elini günceller)
    socket.on('drawUpdate', (data) => {
        gameData.myHand = data.myHand;
        gameData.deckSize = data.deckSize;
        drawGame();
        showGlobalMessage("Stoktan yeni taş çekildi.", false);
    });

    socket.on('infoMessage', (data) => {
        showGlobalMessage(data.message, false);
        drawGame(); // Butonları yeniden açar
    });

    socket.on('invalidMove', (message) => {
        showGlobalMessage(message, true);
        drawGame(); // Butonları yeniden açar (kapatılma durumu varsa)
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
