// Socket.io bağlantısı
const socket = io('https://mario-io-1.onrender.com', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
});

// Bağlantı durumu
let isConnected = false;
let isReconnecting = false;
let lastGameState = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const ADMIN_TELEGRAM_ID = '976640409';
// Oyun durumu
let gameState = {
    myHand: [],
    opponentHandSize: 0,
    board: [], // Yere açılan taşların uçları
    bazaarSize: 0,
    currentTurn: null, // Sırası gelen oyuncunun socketId'si
    myPlayerId: null,
    isMyTurn: false,
    roomCode: null,
    isSearching: false, // Bu istemciye özel durum
    gameStarted: false,
    selectedTile: null, // Oyuncunun seçtiği taş
    isAdmin: false // Oyuncunun admin olup olmadığı
};

// Rakip oyuncu bilgileri
let opponentInfo = {
    name: 'Rakip',
    photoUrl: 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png',
    elo: 0,
    level: 1
};

// Timer
let searchTimer = null;
let searchTime = 0;

// UI elementleri
const loader = document.getElementById('loader');
const mainLobby = document.getElementById('main-lobby');
const rankedLobby = document.getElementById('ranked-lobby');
const friendLobby = document.getElementById('friend-lobby');
const gameScreen = document.getElementById('game-screen');
const connectionStatus = document.getElementById('connection-status');
const dereceliBtn = document.getElementById('dereceli-btn');
const friendBtn = document.getElementById('friend-btn');
const cancelRankedBtn = document.getElementById('cancel-ranked-btn');
const createRoomBtn = document.getElementById('create-room-btn');
const backToMainBtn = document.getElementById('back-to-main-btn');
const rankedStatus = document.getElementById('ranked-status');
const roomCodeOutput = document.getElementById('room-code-output');
const copyCodeBtn = document.getElementById('copy-code-btn');
const joinRoomInput = document.getElementById('join-room-input');
const joinRoomBtn = document.getElementById('join-room-btn');
const boardElement = document.getElementById('board');
const currentTurnDisplay = document.getElementById('current-turn-display');
const turnText = document.getElementById('turn-text');
const leaveGameBtn = document.getElementById('leave-game-btn');
const messageModal = document.getElementById('message-modal');
const modalMessage = document.getElementById('modal-message');
const modalCloseBtn = document.getElementById('modal-close-btn');
const opponentHandCount = document.getElementById('opponent-hand-count');
const bazaarButton = document.getElementById('bazaar-button');
const bazaarCount = document.getElementById('bazaar-count');
const adminPanelBtn = document.getElementById('admin-panel-btn');
const adminPanel = document.getElementById('admin-panel');
const adminResetEloBtn = document.getElementById('admin-reset-elo-btn');
const adminToggleVisibilityBtn = document.getElementById('admin-toggle-visibility-btn');
const adminTargetIdInput = document.getElementById('admin-target-id-input');

// --- Socket.io Eventleri ---

// Bağlantı durumu takibi
socket.on('connect', (attemptNumber) => {
    console.log(`✅ Sunucuya bağlandı. Soket ID: ${socket.id}`);
    isConnected = true;
    isReconnecting = false;
    reconnectAttempts = 0;
    updateConnectionStatus(true);
    gameState.myPlayerId = socket.id;
    // Bu kısım normalde Telegram'dan gelen auth verisiyle dolmalı.
    // Şimdilik, admin kontrolünü sağlamak için bir varsayım yapıyoruz.
    // Gerçek bir auth sisteminde bu bilgi sunucudan gelmeli.
    const loggedInUser = JSON.parse(localStorage.getItem('domino_user'));
    gameState.isAdmin = loggedInUser?.telegramId === ADMIN_TELEGRAM_ID;
    checkAdminAccess();
    hideMessage();
    
    // Eğer önceki bir oyun durumu varsa, sunucudan güncel durumu iste
    if (gameState.roomCode) {
        console.log('Önceki oyun durumu kurtarılıyor...');
        socket.emit('rejoinGame', { roomCode: gameState.roomCode, playerId: gameState.myPlayerId });
    } else {
        showScreen('main');
    }
});

socket.on('disconnect', (reason) => {
    console.log(`❌ Sunucu bağlantısı kesildi: ${reason}`);
    isConnected = false;
    updateConnectionStatus(false);
    
    if (gameState.gameStarted && !isReconnecting && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        isReconnecting = true;
        showMessage('Sunucuya bağlanılıyor...', false);
        attemptReconnect();
    } else if (!gameState.gameStarted) {
        showMessage('Sunucu bağlantısı kesildi. Lütfen sayfayı yenileyin.', true);
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log(`✅ Tekrar bağlanıldı (${attemptNumber}. deneme)`);
    isConnected = true;
    isReconnecting = false;
    updateConnectionStatus(true);
    hideMessage();
    
    // Oyun durumunu senkronize et
    if (gameState.roomCode) {
        socket.emit('rejoinGame', { roomCode: gameState.roomCode, playerId: gameState.myPlayerId });
    }
});

socket.on('reconnect_failed', () => {
    console.error('❌ Tekrar bağlanma başarısız oldu');
    isReconnecting = false;
    updateConnectionStatus(false);
    showMessage('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', true);
});

// Bağlantı durumunu güncelle
function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatus.textContent = 'Çevrimiçi';
        connectionStatus.className = 'text-green-500';
    } else {
        connectionStatus.textContent = 'Çevrimdışı';
        connectionStatus.className = 'text-red-500';
    }
}

// Tekrar bağlanmayı dene
function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showMessage('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', true);
        return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff
    
    console.log(`Tekrar bağlanılıyor... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(() => {
        if (!isConnected) {
            socket.connect();
            attemptReconnect();
        }
    }, delay);
}

// Mesaj göster
function showMessage(message, isError = false) {
    modalMessage.textContent = message;
    modalMessage.className = isError ? 'text-red-500' : 'text-white';
    messageModal.classList.remove('hidden');
}

// Mesajı gizle
function hideMessage() {
    messageModal.classList.add('hidden');
}

// Oyunu (El, Masa, Pazar) çiz
function renderGame() {
    if (!gameState.gameStarted) return;

    boardElement.innerHTML = '';
    opponentHandCount.textContent = `Rakip: ${gameState.opponentHandSize} taş`;
    bazaarCount.textContent = gameState.bazaarSize;

    // 1. Masadaki taşları çiz
    const boardContainer = document.createElement('div');
    boardContainer.className = 'board-container flex flex-wrap justify-center items-center gap-1 p-2';
    gameState.board.forEach(tile => {
        boardContainer.appendChild(createTileElement(tile, 'board'));
    });
    boardElement.appendChild(boardContainer);

    // Oyuncunun elini göster
    const myHandElement = document.createElement('div');
    myHandElement.className = 'my-hand-container flex justify-center items-end gap-1 p-2 flex-wrap';
    
    gameState.myHand.forEach(tile => {
        const tileElement = createTileElement(tile, 'hand');
        tileElement.onclick = () => handleTileClick(tile);

        if (gameState.selectedTile && areTilesEqual(gameState.selectedTile, tile)) {
            tileElement.classList.add('selected');
        }

        myHandElement.appendChild(tileElement);
    });
    boardElement.appendChild(myHandElement);

    // Pazar butonunun durumunu güncelle
    const canPlay = gameState.bazaarSize > 0 && gameState.myHand.some(tile => canPlayTile(tile, gameState.board));
    if (gameState.isMyTurn && !canPlay) {
        bazaarButton.disabled = false;
        bazaarButton.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        bazaarButton.disabled = true;
        bazaarButton.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

function createTileElement(tile, type) {
    const tileEl = document.createElement('div');
    tileEl.className = `tile ${type}-tile`;
    tileEl.innerHTML = `
        <div class="tile-inner">
            <span class="tile-num">${tile.value1}</span>
            <div class="tile-divider"></div>
            <span class="tile-num">${tile.value2}</span>
        </div>
    `;
    // Çift taşları dikey yap
    if (tile.value1 === tile.value2) {
        tileEl.classList.add('double');
    }
    return tileEl;
}

function areTilesEqual(tile1, tile2) {
    return (tile1.value1 === tile2.value1 && tile1.value2 === tile2.value2) ||
           (tile1.value1 === tile2.value2 && tile1.value2 === tile2.value1);
}

function canPlayTile(tile, board) {
    if (board.length === 0) return true;
    const leftEnd = board[0].value1;
    const rightEnd = board[board.length - 1].value2;
    return tile.value1 === leftEnd || tile.value2 === leftEnd ||
           tile.value1 === rightEnd || tile.value2 === rightEnd;
}

function showPlayOptions(tile) {
    // Önceki seçenekleri temizle
    const existingOptions = document.getElementById('play-options');
    if (existingOptions) existingOptions.remove();

    const optionsContainer = document.createElement('div');
    optionsContainer.id = 'play-options';
    optionsContainer.className = 'absolute bottom-24 left-1/2 -translate-x-1/2 flex gap-4 z-20';

    const leftEnd = gameState.board.length > 0 ? gameState.board[0].value1 : null;
    const rightEnd = gameState.board.length > 0 ? gameState.board[gameState.board.length - 1].value2 : null;

    let canPlayLeft = false;
    let canPlayRight = false;

    if (gameState.board.length === 0) {
        canPlayLeft = true; // İlk taş her yere oynanabilir
    } else {
        canPlayLeft = tile.value1 === leftEnd || tile.value2 === leftEnd;
        canPlayRight = tile.value1 === rightEnd || tile.value2 === rightEnd;
    }

    if (canPlayLeft) {
        const playLeftBtn = document.createElement('button');
        playLeftBtn.textContent = 'SOLA OYNA';
        playLeftBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-lg';
        playLeftBtn.onclick = () => {
            socket.emit('playTile', { roomCode: gameState.roomCode, tile: tile, position: 'left' });
            gameState.selectedTile = null;
            optionsContainer.remove();
        };
        optionsContainer.appendChild(playLeftBtn);
    }

    if (canPlayRight) {
        const playRightBtn = document.createElement('button');
        playRightBtn.textContent = 'SAĞA OYNA';
        playRightBtn.className = 'bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow-lg';
        playRightBtn.onclick = () => {
            socket.emit('playTile', { roomCode: gameState.roomCode, tile: tile, position: 'right' });
            gameState.selectedTile = null;
            optionsContainer.remove();
        };
        optionsContainer.appendChild(playRightBtn);
    }

    document.body.appendChild(optionsContainer);
}

// Sıra göstergesini güncelle
function updateTurnDisplay() {
    if (gameState.isMyTurn) {
        turnText.textContent = 'Sıra Sizde';
        turnText.className = 'text-green-400';
    } else {
        turnText.textContent = 'Rakibin Sırası';
        turnText.className = 'text-red-400';
    }
}

// Taş tıklama işleyicisi
function handleTileClick(tile) {
    if (!gameState.isMyTurn || !gameState.gameStarted) {
        console.log("Sıra sizde değil veya oyun başlamadı.");
        return;
    }

    if (gameState.selectedTile && areTilesEqual(gameState.selectedTile, tile)) {
        // Aynı taşa tekrar tıklandı, seçimi kaldır
        gameState.selectedTile = null;
        const existingOptions = document.getElementById('play-options');
        if (existingOptions) existingOptions.remove();
    } else if (canPlayTile(tile, gameState.board)) {
        // Oynanabilir bir taş seçildi
        gameState.selectedTile = tile;
        showPlayOptions(tile);
    } else {
        showMessage('Bu taşı oynayamazsınız.', true);
    }
    renderGame(); // Seçimi göstermek için UI'ı yeniden çiz
}

socket.on('matchFound', (data) => {
    console.log('🎉 Rakip bulundu!', data);
    gameState.roomCode = data.roomCode;
    clearInterval(searchTimer);
    searchTimer = null;
    
    showMessage('Rakip bulundu! Oyun başlıyor...');
    showScreen('game');
    updateGameUI();
});

socket.on('searchStatus', (data) => {
    console.log('🔍 Arama durumu:', data);
    rankedStatus.textContent = data.message || 'Rakip aranıyor...';
});

socket.on('searchCancelled', (data) => {
    showMessage(data.message);
    clearInterval(searchTimer);
    searchTimer = null;
    showScreen('main');
});

socket.on('roomCreated', (data) => {
    gameState.roomCode = data.roomCode;
    roomCodeOutput.textContent = data.roomCode;
    console.log('🏠 Oda oluşturuldu:', data.roomCode);
});

socket.on('opponentJoined', (data) => {
    console.log('👥 Rakip katıldı! Oyun başlıyor...');
    // gameStart olayı beklenecek
});

// Oyun durumunu senkronize etme
socket.on('gameUpdate', (data) => {
    console.log('Oyun durumu güncellendi:', data.gameState);
    const newState = data.gameState;
    gameState.board = newState.board;
    gameState.myHand = newState.myHand;
    gameState.opponentHandSize = newState.opponentHandSize;
    gameState.bazaarSize = newState.bazaarSize;
    gameState.isMyTurn = newState.isMyTurn;
    gameState.currentTurn = newState.currentPlayer;

    // Hamle yapıldıktan sonra seçimi ve seçenekleri temizle
    gameState.selectedTile = null;
    const existingOptions = document.getElementById('play-options');
    if (existingOptions) existingOptions.remove();

    updateGameUI();
});

socket.on('info', (data) => {
    showMessage(data.message, false);
});

socket.on('gameStart', (data) => {
    console.log("Oyun başlıyor!", data.gameState);
    gameState = { ...gameState, ...data.gameState, gameStarted: true };
    showScreen('game');
    updateGameUI();
});

socket.on('error', (message) => {
    console.error('Sunucudan hata geldi:', message);
    showMessage(typeof message === 'object' ? message.message : message, true);
    gameState.isSearching = false;
    clearInterval(searchTimer);
    searchTimer = null;
    showScreen('main'); // Oyunda hata olursa ana menüye dön
}

function showScreen(screen) {
    loader.classList.add('hidden');
    mainLobby.classList.add('hidden');
    rankedLobby.classList.add('hidden');
    friendLobby.classList.add('hidden');
    gameScreen.classList.add('hidden');

    if (screen === 'main') {
        mainLobby.classList.remove('hidden');
        gameState.isSearching = false;
        clearInterval(searchTimer);
        searchTimer = null;
        rankedStatus.textContent = ''; // Zamanlayıcı metnini temizle
    } else if (screen === 'ranked') {
        rankedLobby.classList.remove('hidden');
        gameState.isSearching = true;
        searchTime = 0;
        startSearchTimer();
    } else if (screen === 'friend') {
        friendLobby.classList.remove('hidden');
        gameState.isSearching = false;
        clearInterval(searchTimer);
        searchTimer = null;
        rankedStatus.textContent = ''; // Zamanlayıcı metnini temizle
    } else if (screen === 'game') {
        gameScreen.classList.remove('hidden');
        clearInterval(searchTimer);
        searchTimer = null;
    } else if (screen === 'admin') {
        adminPanel.classList.remove('hidden');
        clearInterval(searchTimer);
        searchTimer = null;
    } else {
        loader.classList.remove('hidden');
    }
}

function startSearchTimer() {
    clearInterval(searchTimer);
    searchTimer = setInterval(() => {
        searchTime++;
        const minutes = Math.floor(searchTime / 60);
        const seconds = searchTime % 60;
        const timeString = minutes + ':' + seconds.toString().padStart(2, '0');
        rankedStatus.textContent = 'Rakip aranıyor... (' + timeString + ')';
    }, 1000);
}

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// --- Domino 101 Oyun Mantığı Fonksiyonları (Taslak) ---

function dealTiles(tiles) {
    // Sunucudan gelen taşları oyunculara dağıt
}

function drawFromBazaar() {
    // Pazardan taş çekme isteği gönder
    socket.emit('drawFromMarket');
}

function updateGameUI() {
    if (!gameState.gameStarted) return;
    
    turnText.textContent = gameState.isMyTurn ? 'Sıra Sizde!' : 'Rakip Oynuyor...';
    currentTurnDisplay.className = 'w-full max-w-md mb-4 p-4 rounded-xl bg-gray-800 shadow-xl text-center ' + 
        (gameState.isMyTurn ? 'bg-green-700' : 'bg-yellow-700');
    
    renderGame();
}

// --- Event Handlers ---

// Oyundan çıkış işlemi
function handleLeaveGame() {
    if (gameState.gameStarted && !confirm('Oyundan çıkmak istediğinize emin misiniz? Dereceli maçtan ayrılırsanız ELO kaybedersiniz.')) {
        return;
    }
    
    if (socket && socket.connected) {
        socket.emit('leaveGame');
    }
    setTimeout(() => {
        resetGameState();
        showScreen('main');
    }, 500);
}

// Sunucudan gelen oyundan atılma/çıkış mesajlarını dinle
socket.on('playerLeft', (data) => {
    if (data.playerId !== socket.id) { // Kendi çıkışımız değilse
        showMessage('Rakibiniz oyundan ayrıldı. Ana menüye yönlendiriliyorsunuz...', false);
        setTimeout(() => {
            window.location.reload();
        }, 3000);
    }
});

// Rakip bağlandığında
socket.on('opponentConnected', (playerData) => {
    opponentInfo = {
        name: playerData.name || 'Rakip',
        photoUrl: playerData.photoUrl || 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png',
        elo: playerData.elo || 0,
        level: playerData.level || 1
    };
    updateOpponentInfo();
    showMessage(`${opponentInfo.name} oyuna katıldı!`, false);
});

// Rakip bilgilerini güncelle
function updateOpponentInfo() {
    const opponentNameEl = document.getElementById('opponent-name');
    const opponentPhotoEl = document.getElementById('opponent-photo');
    const opponentEloEl = document.getElementById('opponent-elo');
    const opponentLevelEl = document.getElementById('opponent-level');
    
    if (opponentNameEl) opponentNameEl.textContent = opponentInfo.name;
    if (opponentPhotoEl) {
        opponentPhotoEl.src = opponentInfo.photoUrl;
        opponentPhotoEl.alt = opponentInfo.name;
    }
    if (opponentEloEl) opponentEloEl.textContent = `ELO: ${opponentInfo.elo}`;
    if (opponentLevelEl) opponentLevelEl.textContent = `Seviye ${opponentInfo.level}`;
}

// Oyun sonu mesajı
socket.on('gameEnd', (data) => {
    gameState.gameStarted = false;
    let message = `Oyun Bitti! ${data.winnerName} kazandı.`;
    let isError = false;

    if (data.winner === 'DRAW') {
        message = "Oyun berabere bitti!";
    } else if (data.winner === gameState.myPlayerId) {
        message = "Tebrikler, kazandınız!";
        if (data.isRanked && data.eloChanges) {
            message += ` (+${data.eloChanges.winner} ELO)`;
        }
    } else {
        message = "Kaybettiniz.";
        isError = true;
        if (data.isRanked && data.eloChanges) {
            message += ` (${data.eloChanges.loser} ELO)`;
        }
    }

    // Oyun kilitlenmesi durumu
    if (data.reason === 'GAME_LOCKED') {
        message = "Oyun Kilitlendi, Puanlar Hesaplanıyor... " + message;
    }
    showMessage(message, isError);

    // Oyun durumunu sıfırla ve 3 saniye sonra ana menüye dön
    setTimeout(() => {
        resetGameState();
        showScreen('main');
    }, 3000);
});

// Oyun durumunu başlangıç değerlerine döndüren fonksiyon
function resetGameState() {
    gameState = {
        myHand: [],
        opponentHandSize: 0,
        board: [],
        bazaarSize: 0,
        currentTurn: null,
        myPlayerId: socket.id, // Socket ID'mizi koruyoruz
        isMyTurn: false,
        roomCode: null,
        isSearching: false,
        gameStarted: false,
        selectedTile: null
        // isAdmin durumu korunur
    };
}

// --- Button Eventleri ---

dereceliBtn.onclick = () => {
    console.log('🎮 Dereceli butona tiklandi');
    socket.emit('findMatch');
    showScreen('ranked');
};

friendBtn.onclick = () => {
    showScreen('friend');
};

cancelRankedBtn.onclick = () => {
    gameState.isSearching = false;
    socket.emit('cancelSearch');
};

createRoomBtn.onclick = () => {
    const roomCode = generateRoomCode();
    gameState.roomCode = roomCode;
    socket.emit('createRoom', { roomCode });
};

backToMainBtn.onclick = () => {
    showScreen('main');
};

copyCodeBtn.onclick = () => {
    const code = roomCodeOutput.textContent;
    if (code && code !== '...') {
        navigator.clipboard.writeText(code).then(() => {
            showMessage('Oda kodu (' + code + ') kopyalandı!');
        }).catch(() => {
            showMessage("Kopyalama hatası: Kodu manuel olarak kopyalayın.");
        });
    }
};

joinRoomBtn.onclick = () => {
    const roomCode = joinRoomInput.value.trim();
    if (roomCode.length !== 4) {
        showMessage("Lütfen 4 haneli oda kodunu girin.");
        return;
    }
    
    gameState.roomCode = roomCode;
    socket.emit('joinRoom', { roomCode });
};

bazaarButton.onclick = () => {
    if (gameState.isMyTurn) {
        drawFromBazaar();
    }
};

modalCloseBtn.onclick = () => {
    messageModal.classList.add('hidden');
};

function checkAdminAccess() {
    if (gameState.isAdmin) {
        adminPanelBtn.classList.remove('hidden');
    } else {
        adminPanelBtn.classList.add('hidden');
    }
}

async function handleAdminAction(action, params = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'x-admin-id': JSON.parse(localStorage.getItem('domino_user'))?.telegramId
    };

    let url = '';
    let options = {
        method: 'POST',
        headers: headers,
    };

    if (action === 'resetElo') {
        url = '/api/admin/reset-all-elos';
        if (!confirm("Tüm oyuncuların ELO puanlarını ve maç geçmişini sıfırlamak istediğinizden emin misiniz? Bu işlem geri alınamaz!")) {
            return;
        }
    } else if (action === 'toggleVisibility') {
        url = '/api/admin/toggle-visibility';
        options.body = JSON.stringify({ targetTelegramId: params.targetId });
        if (!params.targetId) {
            showMessage("Lütfen hedef oyuncunun Telegram ID'sini girin.", true);
            return;
        }
    }

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (response.ok) {
            showMessage(data.message, false);
        } else {
            throw new Error(data.error || 'Bilinmeyen bir hata oluştu.');
        }
    } catch (error) {
        showMessage(`Hata: ${error.message}`, true);
    }
}

adminPanelBtn.onclick = () => {
    showScreen('admin');
};

adminResetEloBtn.onclick = () => handleAdminAction('resetElo');

adminToggleVisibilityBtn.onclick = () => {
    handleAdminAction('toggleVisibility', { targetId: adminTargetIdInput.value });
};

// Çıkış butonuna event listener ekle
document.addEventListener('DOMContentLoaded', () => {
    const leaveGameBtn = document.getElementById('leave-game-btn');
    if (leaveGameBtn) {
        leaveGameBtn.addEventListener('click', handleLeaveGame);
    }
    connectionStatus.textContent = 'Sunucuya bağlanılıyor...';
    connectionStatus.classList.add('text-yellow-400', 'animate-pulse');
});
