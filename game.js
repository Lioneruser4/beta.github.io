// --- PROFESSIONAL DOMINO 101 GAME CLIENT ---
// WebSocket Connection
const ws = new WebSocket('wss://beta-github-io.onrender.com');

// Game State
let gameState = {
    board: [],
    market: [],
    players: {},
    currentPlayer: null,
    myPlayerId: null,
    isMyTurn: false,
    roomCode: null,
    status: 'waiting'
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
const opponentHandSize = document.getElementById('opponent-hand-size');

// WebSocket Events
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
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showNotification('Bağlantı hatası', 'error');
};

// Message Handlers
function handleServerMessage(data) {
    console.log('Received:', data);
    
    switch(data.type) {
        case 'gameStart':
            gameState = data.gameState;
            gameState.myPlayerId = ws.playerId;
            updateUI();
            showGameScreen();
            break;
            
        case 'gameUpdate':
            gameState = data.gameState;
            updateUI();
            break;
            
        case 'gameEnd':
            handleGameEnd(data);
            break;
            
        case 'error':
            showNotification(data.message, 'error');
            break;
            
        case 'matchFound':
            showNotification('Maç bulundu!', 'success');
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

// Game Functions
function findMatch(playerData) {
    if (isSearching) return;
    
    isSearching = true;
    showSearchingScreen();
    
    ws.send(JSON.stringify({
        type: 'findMatch',
        ...playerData
    }));
}

function cancelSearch() {
    if (!isSearching) return;
    
    isSearching = false;
    ws.send(JSON.stringify({ type: 'cancelSearch' }));
    showLobbyScreen();
}

function playTile(tileIndex, position) {
    if (!gameState.isMyTurn || selectedTileIndex === null) return;
    
    ws.send(JSON.stringify({
        type: 'playTile',
        tileIndex: tileIndex,
        position: position
    }));
    
    selectedTileIndex = null;
    validMoves = [];
}

function drawFromMarket() {
    if (!gameState.isMyTurn) return;
    
    // Check if player has playable tiles
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    const hasPlayableTile = myHand.some(tile => canPlayTile(tile));
    
    if (hasPlayableTile) {
        showNotification('Elinde oynayabileceğin taş var!', 'warning');
        return;
    }
    
    if (gameState.market.length === 0) {
        showNotification('Pazarda taş kalmadı!', 'error');
        return;
    }
    
    ws.send(JSON.stringify({ type: 'drawFromMarket' }));
}

function passTurn() {
    if (!gameState.isMyTurn) return;
    
    if (gameState.market.length > 0) {
        showNotification('Pazarda taş varken pas geçemezsin!', 'warning');
        return;
    }
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    const hasPlayableTile = myHand.some(tile => canPlayTile(tile));
    
    if (hasPlayableTile) {
        showNotification('Oynayabileceğin taş varken pas geçemezsin!', 'warning');
        return;
    }
    
    ws.send(JSON.stringify({ type: 'pass' }));
}

function leaveGame() {
    if (!gameState.roomCode) return;
    
    if (confirm('Oyundan çıkmak istediğinize emin misiniz?')) {
        ws.send(JSON.stringify({
            type: 'leaveGame',
            roomCode: gameState.roomCode
        }));
        showLobbyScreen();
    }
}

// Game Logic
function canPlayTile(tile) {
    if (gameState.board.length === 0) return true;
    
    const leftEnd = gameState.board[0][0];
    const rightEnd = gameState.board[gameState.board.length - 1][1];
    
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

function getValidMoves(tile) {
    if (gameState.board.length === 0) return ['start'];
    
    const moves = [];
    const leftEnd = gameState.board[0][0];
    const rightEnd = gameState.board[gameState.board.length - 1][1];
    
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

function handleTileClick(index) {
    if (!gameState.isMyTurn) return;
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    const tile = myHand[index];
    
    if (selectedTileIndex === index) {
        selectedTileIndex = null;
        validMoves = [];
    } else {
        selectedTileIndex = index;
        validMoves = getValidMoves(tile);
    }
    
    updateHandDisplay();
}

// UI Functions
function updateUI() {
    gameState.isMyTurn = gameState.currentPlayer === gameState.myPlayerId;
    
    updateBoardDisplay();
    updateHandDisplay();
    updateTurnIndicator();
    updateGameInfo();
}

function updateBoardDisplay() {
    if (!boardContainer) return;
    
    boardContainer.innerHTML = '';
    
    if (gameState.board.length === 0) {
        boardContainer.innerHTML = '<div class="text-white/50 text-center p-8">Tahta boş - İlk taşı oynayın</div>';
        return;
    }
    
    gameState.board.forEach((tile, index) => {
        const tileElement = createTileElement(tile, false, false);
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
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    
    myHand.forEach((tile, index) => {
        const isSelected = selectedTileIndex === index;
        const tileElement = createTileElement(tile, true, isSelected);
        
        tileElement.addEventListener('click', () => handleTileClick(index));
        handContainer.appendChild(tileElement);
    });
}

function updateTurnIndicator() {
    if (!turnIndicator) return;
    
    if (gameState.isMyTurn) {
        turnIndicator.innerHTML = '<div class="bg-yellow-500 text-black px-4 py-2 rounded-full font-bold animate-pulse">⚡ SENİN SIRAN ⚡</div>';
    } else {
        turnIndicator.innerHTML = '<div class="bg-gray-600 text-white px-4 py-2 rounded-full">⏳ Rakip oynuyor...</div>';
    }
}

function updateGameInfo() {
    if (marketSizeDisplay) {
        marketSizeDisplay.textContent = `Pazar: ${gameState.market.length}`;
    }
    
    if (opponentHandSize) {
        const opponentId = Object.keys(gameState.players).find(id => id !== gameState.myPlayerId);
        const opponentHand = gameState.players[opponentId]?.hand || [];
        opponentHandSize.textContent = `Rakip: ${opponentHand.length} taş`;
    }
}

function createTileElement(tile, isClickable = false, isSelected = false) {
    const tileDiv = document.createElement('div');
    tileDiv.className = `domino-tile ${isClickable ? 'clickable' : ''} ${isSelected ? 'selected' : ''}`;
    
    const topHalf = document.createElement('div');
    topHalf.className = 'tile-half';
    topHalf.appendChild(createPips(tile[0]));
    
    const bottomHalf = document.createElement('div');
    bottomHalf.className = 'tile-half';
    bottomHalf.appendChild(createPips(tile[1]));
    
    tileDiv.appendChild(topHalf);
    tileDiv.appendChild(bottomHalf);
    
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
        6: [0, 2, 3, 5, 6, 8]
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
    
    // Add left indicator
    if (validMoves.includes('left')) {
        const leftIndicator = document.createElement('div');
        leftIndicator.className = 'valid-move-indicator left';
        leftIndicator.innerHTML = '◀';
        leftIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'left'));
        boardContainer.insertBefore(leftIndicator, boardContainer.firstChild);
    }
    
    // Add right indicator
    if (validMoves.includes('right')) {
        const rightIndicator = document.createElement('div');
        rightIndicator.className = 'valid-move-indicator right';
        rightIndicator.innerHTML = '▶';
        rightIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'right'));
        boardContainer.appendChild(rightIndicator);
    }
    
    // Add start indicator (for first move)
    if (validMoves.includes('start')) {
        const startIndicator = document.createElement('div');
        startIndicator.className = 'valid-move-indicator start';
        startIndicator.innerHTML = '🎯 OYUNA BAŞLA';
        startIndicator.addEventListener('click', () => playTile(selectedTileIndex, 'start'));
        boardContainer.appendChild(startIndicator);
    }
}

// Screen Management
function showLobbyScreen() {
    document.getElementById('lobby-screen').style.display = 'block';
    document.getElementById('searching-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
}

function showSearchingScreen() {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('searching-screen').style.display = 'block';
    document.getElementById('game-screen').style.display = 'none';
}

function showGameScreen() {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('searching-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
}

function handleGameEnd(data) {
    const isWinner = data.winner === gameState.myPlayerId;
    const message = isWinner ? '🎉 Kazandın!' : '😔 Kaybettin!';
    
    showNotification(message, isWinner ? 'success' : 'error');
    
    setTimeout(() => {
        showLobbyScreen();
    }, 3000);
}

// Notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
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
