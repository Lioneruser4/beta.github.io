// --- PROFESSIONAL DOMINO 101 GAME CLIENT ---
// WebSocket Connection
const WS_URL = 'wss://beta-github-io.onrender.com';
const API_URL = 'https://beta-github-io.onrender.com/api'; // API URL'si
const ADMIN_TELEGRAM_ID = '976640409'; // YÖNETİCİ ID'si

const ws = new WebSocket(WS_URL);

// Game State
let gameState = { /* ... önceki mesajdakiyle aynı ... */
    board: [],
    marketSize: 0,
    currentPlayer: null,
    myPlayerId: null,
    isMyTurn: false,
    roomCode: null,
    status: 'waiting',
    myHand: [],
    opponentHandSize: 0
};
let playerData = null; // Telegram verisi buraya atanacak
let screenChanger = null; // Ekran değiştirme fonksiyonu

// UI State (Önceki mesajdakiyle aynı)
let selectedTileIndex = null;
let validMoves = [];
let isSearching = false;

// DOM Elements (Yeni butonlar eklendi)
const boardContainer = document.getElementById('board-container');
const handContainer = document.getElementById('hand-container');
const turnIndicator = document.getElementById('turn-indicator');
const marketSizeDisplay = document.getElementById('market-size');
const opponentHandSizeDisplay = document.getElementById('opponent-hand-size');
const drawMarketButton = document.getElementById('draw-market-btn');
const passTurnButton = document.getElementById('pass-turn-btn');

// --- Helper Functions ---
function setPlayerData(data) {
    playerData = data;
    console.log("Player Data Set:", playerData);
}

function setScreenChanger(changer) {
    screenChanger = changer;
}

function showGameScreen() {
    if (screenChanger) screenChanger('game');
}

function showLobbyScreen() {
    if (screenChanger) screenChanger('main');
}

function showSearchingScreen() {
    if (screenChanger) screenChanger('searching');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

// --- WebSocket Events ve Handlers (Önceki mesajdakiyle aynı) ---
ws.onopen = () => {
    console.log('✅ Connected to server');
    showNotification('Sunucuya bağlandı', 'success');
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
};

ws.onclose = () => {
    console.log('❌ Disconnected from server');
    showNotification('Bağlantı kesildi', 'error');
    if (screenChanger) screenChanger('main');
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showNotification('Bağlantı hatası', 'error');
};

function handleServerMessage(data) {
    console.log('Received:', data.type, data);
    
    switch(data.type) {
        case 'gameStart':
        case 'gameUpdate':
            // State güncelleme (Önceki mesajdakiyle aynı)
            gameState.board = data.gameState.board || [];
            gameState.marketSize = data.gameState.marketSize || 0;
            gameState.currentPlayer = data.gameState.currentPlayer;
            gameState.myPlayerId = data.gameState.myPlayerId;
            gameState.isMyTurn = data.gameState.isMyTurn;
            gameState.roomCode = data.gameState.roomCode;
            gameState.status = data.gameState.status;
            gameState.myHand = data.gameState.myHand || [];
            gameState.opponentHandSize = data.gameState.opponentHandSize || 0;

            if (data.type === 'gameStart') {
                 showGameScreen();
                 isSearching = false;
            }
            selectedTileIndex = null;
            validMoves = [];
            updateUI();
            break;
            
        case 'gameEnd':
            handleGameEnd(data);
            break;
            
        case 'error':
            showNotification(data.message, 'error');
            isSearching = false;
            if (screenChanger) screenChanger('main'); // Hata durumunda loby'ye dön
            break;
            
        case 'matchFound':
            showNotification('Maç bulundu! Yükleniyor...', 'success');
            break;
            
        case 'searchCancelled':
            showNotification(data.message, 'info');
            if (screenChanger) screenChanger('main');
            isSearching = false;
            break;

        default:
            // console.log('Unknown message type:', data.type);
    }
}

// --- Game/Match Functions ---

function findMatch(playerData) {
    if (isSearching) return;
    if (!playerData || !playerData.telegramId) {
        return showNotification('Giriş bilgileri eksik. Ranked maç için Telegram ile giriş yapmalısınız.', 'error');
    }
    
    isSearching = true;
    showSearchingScreen();
    
    ws.send(JSON.stringify({
        type: 'findMatch',
        telegramId: playerData.telegramId,
        username: playerData.username,
        firstName: playerData.firstName,
        photoUrl: playerData.photoUrl
    }));
}

function cancelSearch() {
    if (!isSearching) return;
    isSearching = false;
    ws.send(JSON.stringify({ type: 'cancelSearch' }));
}

function playTile(tileIndex, position) {
    if (!gameState.isMyTurn || selectedTileIndex === null) return;
    
    ws.send(JSON.stringify({
        type: 'playTile',
        tileIndex: tileIndex,
        position: position
    }));
}

function drawFromMarket() {
    if (!gameState.isMyTurn) return;
    ws.send(JSON.stringify({ type: 'drawFromMarket' }));
}

function passTurn() {
    if (!gameState.isMyTurn) return;
    ws.send(JSON.stringify({ type: 'pass' }));
}

function leaveGame() {
    if (!gameState.roomCode) return;
    
    if (confirm('Oyundan çıkmak istediğinize emin misiniz? Mağlubiyet olarak kaydedilecektir.')) {
        ws.send(JSON.stringify({
            type: 'leaveGame',
            roomCode: gameState.roomCode
        }));
        if (screenChanger) screenChanger('main');
        gameState.roomCode = null;
    }
}

function handleGameEnd(data) {
    let message;
    // ... (Önceki mesajdaki handleGameEnd mantığı aynı) ...
    if (data.winner === 'DRAW') {
        message = '🤝 Oyun Berabere!';
        showNotification(message, 'info');
    } else {
        const isWinner = data.winner === gameState.myPlayerId;
        message = isWinner ? `🎉 Kazandın! (${data.reason})` : `😔 Kaybettin! (${data.reason})`;
        
        // ELO bilgisi varsa ekle
        if (data.myEloChange) {
            message += ` | ELO: ${data.myEloChange > 0 ? '+' : ''}${data.myEloChange}`;
        }
        showNotification(message, isWinner ? 'success' : 'error');
    }

    setTimeout(() => {
        if (screenChanger) screenChanger('main');
    }, 5000);
}

// --- Leaderboard Functions ---
async function loadLeaderboard() {
    const leaderboardList = document.getElementById('leaderboard-list');
    leaderboardList.innerHTML = '<li>Skorlar yükleniyor...</li>';

    try {
        const response = await fetch(`${API_URL}/leaderboard`);
        if (!response.ok) throw new Error('Sunucudan skorlar alınamadı');
        
        const data = await response.json();
        const leaderboard = data.leaderboard;

        if (leaderboard.length === 0) {
            leaderboardList.innerHTML = '<li>Skor tablosu boş.</li>';
            return;
        }

        leaderboardList.innerHTML = '';
        leaderboard.forEach((player, index) => {
            const li = document.createElement('li');
            li.className = `leaderboard-item ${index < 3 ? 'top3' : ''}`;
            
            li.innerHTML = `
                <div class="player-info">
                    <span class="rank">#${index + 1}</span>
                    <span>${player.firstName} (${player.username})</span>
                </div>
                <div class="elo">${player.elo} ELO</div>
            `;
            leaderboardList.appendChild(li);
        });

    } catch (error) {
        console.error('Leaderboard yükleme hatası:', error);
        showNotification('Skor tablosu yüklenirken hata oluştu.', 'error');
        leaderboardList.innerHTML = '<li>Skorlar yüklenemedi. Sunucu hatası.</li>';
    }
}

// --- Admin Panel Functions ---
const admin = {
    targetUserId: null,
    
    async searchUser() {
        const targetId = document.getElementById('admin-target-id').value.trim();
        const infoP = document.getElementById('admin-user-info');
        infoP.textContent = 'Aranıyor...';
        this.targetUserId = null;
        
        if (!targetId) {
            infoP.textContent = 'Lütfen bir Telegram ID girin.';
            return;
        }

        try {
            const response = await fetch(`${API_URL}/admin/user/${targetId}`);
            const data = await response.json();

            if (!response.ok) {
                infoP.textContent = `Hata: ${data.error}`;
                return;
            }
            
            this.targetUserId = targetId;
            infoP.innerHTML = `
                Kullanıcı: <b>${data.user.username}</b> (ID: ${data.user.telegramId})<br>
                ELO: ${data.user.elo} | Wins: ${data.user.wins} | Hidden: ${data.user.isHidden}
            `;
        } catch (error) {
            infoP.textContent = 'Kullanıcı bulunamadı veya sunucu hatası.';
            console.error('Admin Search Error:', error);
        }
    },

    async setElo() {
        if (!this.targetUserId) {
            showNotification('Önce bir kullanıcı arayın.', 'error');
            return;
        }
        
        const newElo = parseInt(document.getElementById('admin-elo-value').value.trim());
        if (isNaN(newElo) || newElo < 0) {
            showNotification('Geçerli bir ELO değeri girin.', 'error');
            return;
        }

        await this.adminAction('setElo', { targetId: this.targetUserId, value: newElo });
    },

    async setHiddenStatus() {
        if (!this.targetUserId) {
            showNotification('Önce bir kullanıcı arayın.', 'error');
            return;
        }
        
        const isHidden = document.getElementById('admin-hide-action').value === 'true';
        await this.adminAction('setHidden', { targetId: this.targetUserId, value: isHidden });
    },
    
    async adminAction(actionType, payload) {
        if (!playerData || playerData.telegramId !== ADMIN_TELEGRAM_ID) {
            return showNotification('Yetkiniz yok.', 'error');
        }
        
        try {
            const response = await fetch(`${API_URL}/admin/${actionType}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Gerçek hayatta burada bir Auth Token olmalıdır.
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                showNotification(`İşlem Başarılı: ${data.message}`, 'success');
                // İşlem sonrası bilgileri yenile
                this.searchUser();
            } else {
                showNotification(`Admin Hata: ${data.error}`, 'error');
            }
        } catch (error) {
            showNotification('Sunucu bağlantı hatası.', 'error');
            console.error(`Admin Action (${actionType}) Error:`, error);
        }
    }
};


// --- UI Functions (Aynı, sadece global olarak tanımlanır) ---
// (Önceki mesajdaki updateUI, updateBoardDisplay, updateHandDisplay, vs. fonksiyonları buraya yapıştırılmalıdır.)

// ... (Burada tüm UI ve Game Logic fonksiyonları olmalıdır: updateUI, createTileElement, canPlayTile, handleTileClick, vs.)

// ... UI ve Game Logic Fonksiyonları buraya yapıştırılmalıdır ...
function canPlayTile(tile) {
    const board = gameState.board;
    if (board.length === 0) return true;
    
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    return (tile[0] === leftEnd || tile[1] === leftEnd ||
            tile[0] === rightEnd || tile[1] === rightEnd);
}

function getValidMoves(tile) { /* ... */
    const board = gameState.board;
    if (board.length === 0) return ['start'];
    
    const moves = [];
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

function handleTileClick(index) { /* ... */
    if (!gameState.isMyTurn) return;
    
    const myHand = gameState.myHand;
    const tile = myHand[index];

    if (!canPlayTile(tile)) {
        showNotification('Bu taş tahtaya uymuyor.', 'info');
        if (selectedTileIndex === index) {
            selectedTileIndex = null;
            validMoves = [];
        }
        updateHandDisplay();
        return;
    }
    
    if (selectedTileIndex === index) {
        selectedTileIndex = null;
        validMoves = [];
    } else {
        selectedTileIndex = index;
        validMoves = getValidMoves(tile);
    }
    
    updateHandDisplay();
    updateBoardDisplay(); 
}

function updateUI() { /* ... */
    updateBoardDisplay();
    updateHandDisplay();
    updateTurnIndicator();
    updateGameInfo();
    updateControlButtons();
}
function updateControlButtons() { /* ... */
    const hasPlayableTile = gameState.myHand.some(tile => canPlayTile(tile));
    
    if (gameState.isMyTurn) {
        drawMarketButton.disabled = hasPlayableTile || gameState.marketSize === 0;
        passTurnButton.disabled = hasPlayableTile || gameState.marketSize > 0;
    } else {
        drawMarketButton.disabled = true;
        passTurnButton.disabled = true;
    }
}
function updateBoardDisplay() { /* ... */
    if (!boardContainer) return;
    
    boardContainer.innerHTML = '';
    
    if (gameState.board.length === 0) {
        boardContainer.innerHTML = '<div style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Tahta boş - İlk taşı oynamak için elinizden bir taş seçin</div>';
    }
    
    gameState.board.forEach((tile, index) => {
        const tileElement = createTileElement(tile, false, false, true); 
        boardContainer.appendChild(tileElement);
    });
    
    if (gameState.isMyTurn && selectedTileIndex !== null) {
        addValidMoveIndicators();
    }
}
function updateHandDisplay() { /* ... */
    if (!handContainer) return;
    
    handContainer.innerHTML = '';
    const myHand = gameState.myHand;
    
    myHand.forEach((tile, index) => {
        const isSelected = selectedTileIndex === index;
        const isPlayable = canPlayTile(tile);
        
        const tileElement = createTileElement(tile, isPlayable, isSelected, false); 
        
        if (isPlayable) {
            tileElement.addEventListener('click', () => handleTileClick(index));
        } else {
            tileElement.style.opacity = '0.6';
            tileElement.style.cursor = 'default';
        }

        handContainer.appendChild(tileElement);
    });
}
function updateTurnIndicator() { /* ... */
    if (!turnIndicator) return;
    
    if (gameState.isMyTurn) {
        turnIndicator.innerHTML = '<div style="background-color: #ffcc00; color: #1a1a2e; padding: 8px 15px; border-radius: 20px; font-weight: bold; animation: pulse 1s infinite;">⚡ SENİN SIRAN ⚡</div>';
    } else {
        turnIndicator.innerHTML = '<div style="background-color: #3e4c6b; color: white; padding: 8px 15px; border-radius: 20px;">⏳ Rakip oynuyor...</div>';
    }
}
function updateGameInfo() { /* ... */
    if (marketSizeDisplay) {
        marketSizeDisplay.textContent = `Pazar: ${gameState.marketSize}`;
    }
    
    if (opponentHandSizeDisplay) {
        opponentHandSizeDisplay.textContent = `Rakip: ${gameState.opponentHandSize} taş`;
    }
}
function createTileElement(tile, isClickable = false, isSelected = false, isHorizontal = false) { /* ... */
    const tileDiv = document.createElement('div');
    tileDiv.className = `domino-tile ${isClickable ? 'clickable' : ''} ${isSelected ? 'selected' : ''}`;
    
    if (isHorizontal) {
        tileDiv.style.width = '120px';
        tileDiv.style.height = '60px';
        tileDiv.style.flexDirection = 'row';
        tileDiv.style.padding = '0 5px';
    } else {
        tileDiv.style.width = '60px';
        tileDiv.style.height = '120px';
        tileDiv.style.flexDirection = 'column';
        tileDiv.style.padding = '5px 0';
    }
    
    const half1 = document.createElement('div');
    half1.className = 'tile-half';
    half1.appendChild(createPips(tile[0]));
    
    const half2 = document.createElement('div');
    half2.className = 'tile-half';
    half2.appendChild(createPips(tile[1]));

    if (isHorizontal) {
        half1.style.borderBottom = 'none';
        half1.style.borderRight = '2px solid #333';
        half1.style.width = '50%';
        half1.style.height = '100%';
        half2.style.width = '50%';
        half2.style.height = '100%';
        tileDiv.appendChild(half1);
        tileDiv.appendChild(half2);
    } else {
        half1.style.borderBottom = '2px solid #333';
        half1.style.height = '50%';
        half1.style.width = '100%';
        half2.style.height = '50%';
        half2.style.width = '100%';
        tileDiv.appendChild(half1);
        tileDiv.appendChild(half2);
    }
    
    return tileDiv;
}
function createPips(number) { /* ... */
    const pipsContainer = document.createElement('div');
    pipsContainer.className = 'pips-container';
    
    const pipPositions = {
        0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 1, 2, 6, 7, 8]
    };
    
    const positions = pipPositions[number] || [];
    
    for (let i = 0; i < 9; i++) {
        const pip = document.createElement('div');
        pip.className = 'pip';
        if (positions.includes(i)) {
            pip.classList.add('active');
        }
        pipsContainer.appendChild(pip);
    }
    
    return pipsContainer;
}
function addValidMoveIndicators() { /* ... */
    if (!boardContainer) return;
    
    const boardSection = document.getElementById('board-section');
    boardSection.querySelectorAll('.valid-move-indicator').forEach(el => el.remove());
    
    const tile = gameState.myHand[selectedTileIndex];
    if (!tile) return;

    if (gameState.board.length === 0) {
        if (validMoves.includes('start')) {
            const startIndicator = document.createElement('div');
            startIndicator.className = 'valid-move-indicator start';
            startIndicator.innerHTML = '🎯 OYUNA BAŞLA';
            startIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'start'));
            boardSection.appendChild(startIndicator);
        }
        return;
    }
    
    if (validMoves.includes('left')) {
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'valid-move-indicator left';
        leftIndicator.innerHTML = 'SOL ◀';
        leftIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'left'));
        boardSection.appendChild(leftIndicator);
    }
    
    if (validMoves.includes('right')) {
        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'valid-move-indicator right';
        rightIndicator.innerHTML = 'SAĞ ▶';
        rightIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'right'));
        boardSection.appendChild(rightIndicator);
    }
}
// ... (Tüm UI ve Game Logic Fonksiyonları) ...


// Export functions for global access
window.gameClient = {
    findMatch,
    cancelSearch,
    playTile,
    drawFromMarket,
    passTurn,
    leaveGame,
    setPlayerData,
    setScreenChanger,
    loadLeaderboard,
    showNotification,
    playerData,
    ADMIN_TELEGRAM_ID,
    admin
};
