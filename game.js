// --- PROFESSIONAL DOMINO 101 GAME CLIENT ---
// WebSocket Connection
const ws = new WebSocket('wss://beta-github-io.onrender.com');

// Game State
let gameState = {
    board: [],
    marketSize: 0,
    currentPlayer: null,
    myPlayerId: null,
    isMyTurn: false,
    roomCode: null,
    status: 'waiting',
    myHand: []
};

// UI State
let selectedTileIndex = null;
let validMoves = [];
let isSearching = false;

// DOM Elements
const boardContainer = document.getElementById('board-container');
const handContainer = document.getElementById('hand-container');
const turnIndicator = document.getElementById('turn-indicator');
const marketSizeDisplay = document.getElementById('market-size');
const opponentHandSizeDisplay = document.getElementById('opponent-hand-size');
const findMatchButton = document.getElementById('find-match-btn');
const drawMarketButton = document.getElementById('draw-market-btn');
const passTurnButton = document.getElementById('pass-turn-btn');

// --- WebSocket Events ---
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
    showLobbyScreen();
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showNotification('Bağlantı hatası', 'error');
};

// --- Message Handlers ---
function handleServerMessage(data) {
    console.log('Received:', data.type, data);
    
    switch(data.type) {
        case 'gameStart':
        case 'gameUpdate':
            // Sunucudan gelen state'i kabul et
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

            // Client-side UI durumunu sıfırla
            selectedTileIndex = null;
            validMoves = [];

            updateUI();
            break;
            
        case 'gameEnd':
            handleGameEnd(data);
            break;
            
        case 'error':
            showNotification(data.message, 'error');
            break;
            
        case 'matchFound':
            showNotification('Maç bulundu! Yükleniyor...', 'success');
            break;
            
        case 'searchStatus':
            // Arama durumu mesajları
            break;

        case 'searchCancelled':
            showNotification(data.message, 'info');
            showLobbyScreen();
            isSearching = false;
            break;

        default:
            console.log('Unknown message type:', data.type);
    }
}

// --- Game Functions (Sadece Server'a Komut Gönderme) ---

// Telegram ID doğrulama ve sunucuya gönderme, Server API'sini kullanmak en doğrusudur.
// Bu client sadece WebSocket'i kullanır, bu yüzden basit oyuncu verisi gönderilir.
function findMatch(playerData) {
    if (isSearching) return;
    
    // Telegram ID'si var ise önce Auth API'sini çağırıp ELO bilgilerini alması gerekir.
    // Şimdilik doğrudan WebSocket ile bağlanıp temel bilgileri gönderiyoruz.
    
    // Not: Telegram ID'yi HTML'den alıp gönderiyoruz. Server bunu kullanarak DB'den verileri çekecek.
    
    isSearching = true;
    showSearchingScreen();
    
    ws.send(JSON.stringify({
        type: 'findMatch',
        telegramId: playerData.telegramId,
        username: playerData.username,
        photoUrl: playerData.photoUrl
        // ELO, Level server tarafından çekilecek
    }));
}

function cancelSearch() {
    if (!isSearching) return;
    
    isSearching = false;
    ws.send(JSON.stringify({ type: 'cancelSearch' }));
}

function playTile(tileIndex, position) {
    if (!gameState.isMyTurn || selectedTileIndex === null) return;
    
    // Sunucuya oynaması için komut gönder
    ws.send(JSON.stringify({
        type: 'playTile',
        tileIndex: tileIndex,
        position: position
    }));
    
    // Client UI durumu server'dan gelecek update ile sıfırlanacağı için
    // local'de sıfırlamaya gerek yok, hata durumunda tekrar seçili kalması daha iyi.
}

function drawFromMarket() {
    if (!gameState.isMyTurn) return;
    
    // Server kontrolü yapacak. Elinde oynanabilir taş varsa hata mesajı dönecek.
    ws.send(JSON.stringify({ type: 'drawFromMarket' }));
}

function passTurn() {
    if (!gameState.isMyTurn) return;
    
    // Server kontrolü yapacak. Pazarda taş varken veya oynanabilir taş varken hata mesajı dönecek.
    ws.send(JSON.stringify({ type: 'pass' }));
}

function leaveGame() {
    if (!gameState.roomCode) return;
    
    if (confirm('Oyundan çıkmak istediğinize emin misiniz? Mağlubiyet olarak kaydedilecektir.')) {
        ws.send(JSON.stringify({
            type: 'leaveGame',
            roomCode: gameState.roomCode // Server tarafından işlenecek
        }));
        // UI'yı hemen loby'ye çevir
        showLobbyScreen();
        gameState.roomCode = null;
    }
}

// --- Game Logic (Client-Side Validasyon ve UI Hazırlığı) ---

// Bu fonksiyonlar sadece UI'da nelerin mümkün olduğunu göstermek için kullanılır.
// Nihai kontrol her zaman sunucudadır.
function canPlayTile(tile) {
    const board = gameState.board;
    if (board.length === 0) return true;
    
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    return (tile[0] === leftEnd || tile[1] === leftEnd ||
            tile[0] === rightEnd || tile[1] === rightEnd);
}

function getValidMoves(tile) {
    const board = gameState.board;
    if (board.length === 0) return ['start'];
    
    const moves = [];
    // Board üzerindeki taşlar ters çevrilmiş olabilir, bu yüzden her zaman uçları kontrol etmeliyiz.
    // Sunucudan gelen board dizisi, zaten uçları doğru şekilde gösterir (ör: [[6,6], [6,5], [5,2]])
    
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    
    // Sol uç
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    // Sağ uç
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

function handleTileClick(index) {
    if (!gameState.isMyTurn) return;
    
    const myHand = gameState.myHand;
    const tile = myHand[index];

    // Bu taş oynanabilir mi? (UI'a oynanamaz taşları tıklatmamak daha iyi olabilir)
    if (!canPlayTile(tile)) {
        showNotification('Bu taş tahtaya uymuyor.', 'info');
        // Seçiliyse kaldır
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
        // Eğer tek bir geçerli hamle varsa (sadece sol veya sadece sağ),
        // ve board boş değilse, otomatik olarak hamleyi yapabiliriz.
        if (validMoves.length === 1 && validMoves[0] !== 'start') {
             // Tek hamleyi hemen yap. Bu davranış oyun hızını artırır.
             // playTile(selectedTileIndex, validMoves[0]);
             // Bunun yerine, kullanıcının tıklamasını bekleyelim.
        }
    }
    
    updateHandDisplay();
    updateBoardDisplay(); // Valid move indikatörlerini güncelle
}

// --- UI Functions ---
function updateUI() {
    updateBoardDisplay();
    updateHandDisplay();
    updateTurnIndicator();
    updateGameInfo();
    updateControlButtons();
}

function updateControlButtons() {
    const hasPlayableTile = gameState.myHand.some(tile => canPlayTile(tile));
    
    if (gameState.isMyTurn) {
        drawMarketButton.disabled = hasPlayableTile || gameState.marketSize === 0;
        passTurnButton.disabled = hasPlayableTile || gameState.marketSize > 0;
    } else {
        drawMarketButton.disabled = true;
        passTurnButton.disabled = true;
    }
}

function updateBoardDisplay() {
    if (!boardContainer) return;
    
    boardContainer.innerHTML = '';
    
    if (gameState.board.length === 0) {
        boardContainer.innerHTML = '<div style="color: rgba(255,255,255,0.5); text-align: center; padding: 20px;">Tahta boş - İlk taşı oynamak için elinizden bir taş seçin</div>';
    }
    
    gameState.board.forEach((tile, index) => {
        // Tahtadaki taşlar yatay gösterilir (Domino stili ile)
        const tileElement = createTileElement(tile, false, false, true); 
        boardContainer.appendChild(tileElement);
    });
    
    // Add valid move indicators
    if (gameState.isMyTurn && selectedTileIndex !== null) {
        addValidMoveIndicators();
    }
}

function updateHandDisplay() {
    if (!handContainer) return;
    
    handContainer.innerHTML = '';
    const myHand = gameState.myHand;
    
    myHand.forEach((tile, index) => {
        const isSelected = selectedTileIndex === index;
        // Oynanabilir taşları farklı renklendirebiliriz, ancak şimdilik sadece tıklanabilir yapalım.
        const isPlayable = canPlayTile(tile);
        
        const tileElement = createTileElement(tile, isPlayable, isSelected, false); // Dikey gösterim
        
        if (isPlayable) {
            tileElement.addEventListener('click', () => handleTileClick(index));
        } else {
            tileElement.style.opacity = '0.6';
            tileElement.style.cursor = 'default';
        }

        handContainer.appendChild(tileElement);
    });
}

function updateTurnIndicator() {
    if (!turnIndicator) return;
    
    if (gameState.isMyTurn) {
        turnIndicator.innerHTML = '<div style="background-color: #ffcc00; color: #1a1a2e; padding: 8px 15px; border-radius: 20px; font-weight: bold; animation: pulse 1s infinite;">⚡ SENİN SIRAN ⚡</div>';
    } else {
        turnIndicator.innerHTML = '<div style="background-color: #3e4c6b; color: white; padding: 8px 15px; border-radius: 20px;">⏳ Rakip oynuyor...</div>';
    }
}

function updateGameInfo() {
    if (marketSizeDisplay) {
        marketSizeDisplay.textContent = `Pazar: ${gameState.marketSize}`;
    }
    
    if (opponentHandSizeDisplay) {
        opponentHandSizeDisplay.textContent = `Rakip: ${gameState.opponentHandSize} taş`;
    }
}

// isHorizontal: Tahtadaki taşlar için True, Eldeki taşlar için False
function createTileElement(tile, isClickable = false, isSelected = false, isHorizontal = false) {
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

function createPips(number) {
    const pipsContainer = document.createElement('div');
    pipsContainer.className = 'pips-container';
    
    const pipPositions = {
        0: [],
        1: [4],
        2: [0, 8],
        3: [0, 4, 8],
        4: [0, 2, 6, 8],
        5: [0, 2, 4, 6, 8],
        6: [0, 1, 2, 6, 7, 8] // 6 için yeni pozisyonlar (3 ve 5 yerine orta sütunu kullanmak daha klasik)
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

function addValidMoveIndicators() {
    if (!boardContainer) return;
    
    const boardSection = document.getElementById('board-section');
    
    // Geçerli hamle göstergelerini temizle
    boardSection.querySelectorAll('.valid-move-indicator').forEach(el => el.remove());
    
    const tile = gameState.myHand[selectedTileIndex];
    if (!tile) return;

    // Board boşsa sadece 'start' gösterilir
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
    
    // Add left indicator
    if (validMoves.includes('left')) {
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'valid-move-indicator left';
        leftIndicator.innerHTML = 'SOL ◀';
        leftIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'left'));
        boardSection.appendChild(leftIndicator);
    }
    
    // Add right indicator
    if (validMoves.includes('right')) {
        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'valid-move-indicator right';
        rightIndicator.innerHTML = 'SAĞ ▶';
        rightIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'right'));
        boardSection.appendChild(rightIndicator);
    }
}

// --- Screen Management ---
function showLobbyScreen() {
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('searching-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
}

function showSearchingScreen() {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('searching-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';
}

function showGameScreen() {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('searching-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
}

function handleGameEnd(data) {
    let message;
    if (data.winner === 'DRAW') {
        message = '🤝 Oyun Berabere!';
        showNotification(message, 'info');
    } else {
        const isWinner = data.winner === gameState.myPlayerId;
        message = isWinner ? `🎉 Kazandın! (${data.reason})` : `😔 Kaybettin! (${data.reason})`;
        showNotification(message, isWinner ? 'success' : 'error');
    }

    // ELO bilgisi varsa ekle
    if (data.myEloChange) {
        message += ` | ELO Değişimi: ${data.myEloChange > 0 ? '+' : ''}${data.myEloChange}`;
        showNotification(message, isWinner ? 'success' : 'error');
    }
    
    setTimeout(() => {
        showLobbyScreen();
    }, 5000); // Maç sonucu gösterimi için 5 saniye bekle
}

// --- Notifications ---
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    showLobbyScreen();
});

// Export functions for global access
window.gameClient = {
    findMatch,
    cancelSearch,
    playTile,
    drawFromMarket,
    passTurn,
    leaveGame
};
