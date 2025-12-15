// Game Configuration
const CONFIG = {
    SERVER_URL: 'https://mario-io-1.onrender.com',
    MONGO_URI: 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt',
    MAX_LEVEL: 10,
    ELO_PER_LEVEL: 100
};

// Game State
let gameState = {
    socket: null,
    player: {
        telegramId: null,
        username: null,
        elo: 1000,
        level: 1,
        levelIcon: '1-3'
    },
    game: {
        roomId: null,
        isRanked: false,
        currentTurn: null,
        board: [],
        tiles: [],
        validSpots: []
    },
    opponent: {
        username: null,
        elo: null,
        level: null,
        levelIcon: null
    }
};

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const lobbyContainer = document.getElementById('lobbyContainer');
const gameContainer = document.getElementById('gameContainer');
const leaderboardContainer = document.getElementById('leaderboardContainer');

// Level Icon Styles
const LEVEL_ICONS = {
    '1-3': {
        color: '#ffd700',
        gradient: 'linear-gradient(135deg, #ffd700, #ff8c00)',
        animation: 'simple-glow'
    },
    '4-6': {
        color: '#40e0d0',
        gradient: 'linear-gradient(135deg, #40e0d0, #667eea)',
        animation: 'pulse-glow'
    },
    '7-10': {
        color: '#ff0080',
        gradient: 'linear-gradient(135deg, #ff0080, #ff8c00, #40e0d0)',
        animation: 'rainbow-glow'
    }
};

// Initialize Game
async function initGame() {
    console.log('Initializing Dominoes Game...');
    
    // Check Telegram Web App
    if (window.Telegram && Telegram.WebApp) {
        const tg = Telegram.WebApp;
        tg.ready();
        
        gameState.player.telegramId = tg.initDataUnsafe.user?.id;
        gameState.player.username = tg.initDataUnsafe.user?.username || `Player_${Math.random().toString(36).substr(2, 9)}`;
        
        if (gameState.player.telegramId) {
            console.log('Telegram user authenticated:', gameState.player.username);
        }
    } else {
        // For testing without Telegram
        gameState.player.telegramId = 'test_' + Date.now();
        gameState.player.username = 'TestPlayer';
        console.log('Running in test mode (no Telegram)');
    }
    
    // Connect to WebSocket server
    connectToServer();
    
    // Load player data
    await loadPlayerData();
    
    // Update UI
    updatePlayerInfo();
    
    console.log('Game initialized successfully');
}

// Connect to WebSocket Server
function connectToServer() {
    try {
        gameState.socket = new WebSocket(CONFIG.SERVER_URL);
        
        gameState.socket.onopen = () => {
            console.log('Connected to game server');
            connectionStatus.textContent = 'Connected ✓';
            connectionStatus.className = 'connection-status connected';
            
            // Send authentication
            gameState.socket.send(JSON.stringify({
                type: 'auth',
                telegramId: gameState.player.telegramId,
                username: gameState.player.username
            }));
        };
        
        gameState.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };
        
        gameState.socket.onclose = () => {
            console.log('Disconnected from server');
            connectionStatus.textContent = 'Disconnected ✗';
            connectionStatus.className = 'connection-status disconnected';
            
            // Try to reconnect after 3 seconds
            setTimeout(connectToServer, 3000);
        };
        
        gameState.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
    } catch (error) {
        console.error('Connection failed:', error);
        connectionStatus.textContent = 'Connection Failed';
        connectionStatus.className = 'connection-status disconnected';
    }
}

// Handle Server Messages
function handleServerMessage(data) {
    console.log('Server message:', data);
    
    switch (data.type) {
        case 'auth_success':
            gameState.player.elo = data.elo || 1000;
            gameState.player.level = calculateLevel(gameState.player.elo);
            gameState.player.levelIcon = getLevelIconStyle(gameState.player.level);
            updatePlayerInfo();
            break;
            
        case 'room_created':
            showRoomCode(data.roomCode);
            break;
            
        case 'match_found':
            startGame(data.roomId, data.opponent, true);
            break;
            
        case 'player_joined':
            if (gameState.game.roomId === data.roomId) {
                startGame(data.roomId, data.opponent, false);
            }
            break;
            
        case 'game_start':
            initializeGameBoard(data.tiles, data.startingPlayer);
            break;
            
        case 'turn_update':
            updateTurn(data.currentPlayer);
            break;
            
        case 'valid_moves':
            showValidMoves(data.positions);
            break;
            
        case 'move_made':
            updateBoard(data.board, data.nextPlayer);
            break;
            
        case 'game_end':
            endGame(data.winner, data.eloChange);
            break;
            
        case 'leaderboard':
            displayLeaderboard(data.top10, data.userRank);
            break;
            
        case 'error':
            showError(data.message);
            break;
    }
}

// Lobby Functions
function startRankedMatchmaking() {
    if (!gameState.socket || gameState.socket.readyState !== WebSocket.OPEN) {
        showError('Not connected to server');
        return;
    }
    
    console.log('Starting ranked matchmaking...');
    
    gameState.socket.send(JSON.stringify({
        type: 'find_ranked_match',
        telegramId: gameState.player.telegramId,
        elo: gameState.player.elo
    }));
    
    // Show matchmaking interface
    const buttons = document.querySelector('.buttons-container');
    buttons.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <h2 style="color: #40e0d0; margin-bottom: 20px;">🎮 Searching for Opponent...</h2>
            <div style="width: 50px; height: 50px; border: 5px solid #40e0d0; border-top-color: transparent; border-radius: 50%; margin: 0 auto; animation: spin 1s linear infinite;"></div>
            <button class="lobby-button" onclick="cancelMatchmaking()" style="margin-top: 30px; background: linear-gradient(135deg, #e74c3c, #c0392b);">
                ❌ Cancel Search
            </button>
        </div>
    `;
}

function cancelMatchmaking() {
    gameState.socket.send(JSON.stringify({
        type: 'cancel_matchmaking'
    }));
    
    // Reload lobby
    location.reload();
}

function createPrivateRoom() {
    if (!gameState.socket || gameState.socket.readyState !== WebSocket.OPEN) {
        showError('Not connected to server');
        return;
    }
    
    gameState.socket.send(JSON.stringify({
        type: 'create_private_room',
        telegramId: gameState.player.telegramId
    }));
}

function showRoomCode(code) {
    document.getElementById('roomCode').textContent = code;
    document.getElementById('roomCodeContainer').style.display = 'block';
    document.getElementById('joinContainer').style.display = 'none';
}

function showJoinRoom() {
    document.getElementById('joinContainer').style.display = 'block';
    document.getElementById('roomCodeContainer').style.display = 'none';
}

function joinRoom() {
    const code = document.getElementById('roomCodeInput').value;
    if (code.length !== 4) {
        showError('Please enter a valid 4-digit code');
        return;
    }
    
    gameState.socket.send(JSON.stringify({
        type: 'join_private_room',
        roomCode: code,
        telegramId: gameState.player.telegramId
    }));
}

function copyRoomCode() {
    const code = document.getElementById('roomCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        alert('Room code copied to clipboard!');
    });
}

// Game Functions
function startGame(roomId, opponent, isRanked) {
    gameState.game.roomId = roomId;
    gameState.game.isRanked = isRanked;
    gameState.opponent = opponent;
    
    // Update opponent info
    document.getElementById('opponentName').textContent = opponent.username;
    document.getElementById('opponentElo').textContent = `Elo: ${opponent.elo}`;
    updateLevelIcon('opponentLevelIcon', opponent.level);
    
    // Show game container
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    
    console.log('Game started in room:', roomId);
}

function initializeGameBoard(tiles, startingPlayer) {
    gameState.game.tiles = tiles;
    gameState.game.currentTurn = startingPlayer;
    
    // Clear board
    const board = document.getElementById('gameBoard');
    board.innerHTML = '';
    
    // Render player tiles
    renderPlayerTiles();
    
    // Update turn indicator
    updateTurn(startingPlayer);
}

function renderPlayerTiles() {
    const board = document.getElementById('gameBoard');
    
    // Clear existing tiles
    board.innerHTML = '';
    
    // Render each tile
    gameState.game.tiles.forEach((tile, index) => {
        const tileElement = document.createElement('div');
        tileElement.className = 'tile';
        tileElement.style.left = `${100 + index * 90}px`;
        tileElement.style.bottom = '20px';
        tileElement.innerHTML = `
            <div style="font-size: 24px; color: #333;">${tile[0]}</div>
            <div style="font-size: 24px; color: #333;">${tile[1]}</div>
        `;
        
        tileElement.addEventListener('click', () => selectTile(tile, index));
        
        board.appendChild(tileElement);
    });
}

function selectTile(tile, index) {
    if (gameState.game.currentTurn !== gameState.player.telegramId) {
        showError('Not your turn!');
        return;
    }
    
    // Ask server for valid moves
    gameState.socket.send(JSON.stringify({
        type: 'get_valid_moves',
        tile: tile,
        roomId: gameState.game.roomId
    }));
}

function showValidMoves(positions) {
    // Clear previous valid spots
    gameState.game.validSpots.forEach(spot => spot.remove());
    gameState.game.validSpots = [];
    
    const board = document.getElementById('gameBoard');
    
    // Create visual indicators for valid positions
    positions.forEach(pos => {
        const spot = document.createElement('div');
        spot.className = 'valid-spot';
        spot.style.left = `${pos.x - 50}px`;
        spot.style.top = `${pos.y - 90}px`;
        
        spot.addEventListener('click', () => makeMove(pos));
        
        board.appendChild(spot);
        gameState.game.validSpots.push(spot);
    });
}

function makeMove(position) {
    gameState.socket.send(JSON.stringify({
        type: 'make_move',
        position: position,
        roomId: gameState.game.roomId
    }));
    
    // Clear valid spots
    gameState.game.validSpots.forEach(spot => spot.remove());
    gameState.game.validSpots = [];
}

function updateBoard(boardState, nextPlayer) {
    gameState.game.board = boardState;
    gameState.game.currentTurn = nextPlayer;
    
    // Render updated board
    renderBoard();
    updateTurn(nextPlayer);
}

function renderBoard() {
    const board = document.getElementById('gameBoard');
    
    // Clear existing board tiles
    const existingTiles = board.querySelectorAll('.board-tile');
    existingTiles.forEach(tile => tile.remove());
    
    // Render board tiles
    gameState.game.board.forEach((tileData, index) => {
        const tileElement = document.createElement('div');
        tileElement.className = 'tile board-tile';
        tileElement.style.left = `${tileData.x}px`;
        tileElement.style.top = `${tileData.y}px`;
        tileElement.style.transform = `rotate(${tileData.rotation}deg)`;
        tileElement.innerHTML = `
            <div style="font-size: 24px; color: #333;">${tileData.tile[0]}</div>
            <div style="font-size: 24px; color: #333;">${tileData.tile[1]}</div>
        `;
        
        board.appendChild(tileElement);
    });
}

function updateTurn(playerId) {
    const isMyTurn = playerId === gameState.player.telegramId;
    
    // Update turn indicator
    const myInfo = document.querySelector('.player-you');
    const oppInfo = document.querySelector('.player-opponent');
    
    if (isMyTurn) {
        myInfo.style.boxShadow = '0 0 30px #40e0d0';
        oppInfo.style.boxShadow = 'none';
    } else {
        oppInfo.style.boxShadow = '0 0 30px #ff0080';
        myInfo.style.boxShadow = 'none';
    }
}

function endGame(winner, eloChange) {
    // Update player ELO
    if (gameState.game.isRanked && eloChange) {
        gameState.player.elo += eloChange;
        gameState.player.level = calculateLevel(gameState.player.elo);
        gameState.player.levelIcon = getLevelIconStyle(gameState.player.level);
        updatePlayerInfo();
    }
    
    // Show result modal
    const result = winner === gameState.player.telegramId ? 'Victory! 🎉' : 'Defeat! 💀';
    const eloText = eloChange ? `Elo Change: ${eloChange > 0 ? '+' : ''}${eloChange}` : '';
    
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e, #16213e);
                   padding: 40px;
                   border-radius: 20px;
                   text-align: center;
                   max-width: 500px;
                   width: 90%;
                   border: 3px solid ${winner === gameState.player.telegramId ? '#40e0d0' : '#ff0080'};">
            <h1 style="font-size: 3rem; margin-bottom: 20px; color: ${winner === gameState.player.telegramId ? '#40e0d0' : '#ff0080'};">${result}</h1>
            <p style="font-size: 1.5rem; margin-bottom: 30px; color: #fff;">${eloText}</p>
            <button class="lobby-button" onclick="returnToLobby()" style="background: linear-gradient(135deg, #667eea, #764ba2);">
                🏠 Return to Lobby
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function returnToLobby() {
    location.reload();
}

// Leaderboard Functions
async function showLeaderboard() {
    if (!gameState.socket || gameState.socket.readyState !== WebSocket.OPEN) {
        showError('Not connected to server');
        return;
    }
    
    // Request leaderboard data
    gameState.socket.send(JSON.stringify({
        type: 'get_leaderboard',
        telegramId: gameState.player.telegramId
    }));
    
    lobbyContainer.style.display = 'none';
    leaderboardContainer.style.display = 'block';
}

function hideLeaderboard() {
    leaderboardContainer.style.display = 'none';
    lobbyContainer.style.display = 'block';
}

function displayLeaderboard(top10, userRank) {
    const leaderboardList = document.getElementById('leaderboardList');
    leaderboardList.innerHTML = '';
    
    // Display top 10
    top10.forEach((entry, index) => {
        const rank = index + 1;
        const entryElement = document.createElement('div');
        entryElement.className = `leaderboard-entry rank-${rank}`;
        
        entryElement.innerHTML = `
            <div style="font-size: 1.5rem; font-weight: bold; margin-right: 20px; min-width: 40px; text-align: center;">
                ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
            </div>
            <div style="flex-grow: 1;">
                <div style="font-size: 1.2rem; font-weight: bold;">${entry.username}</div>
                <div style="font-size: 0.9rem; color: #a0a0c0;">Level ${entry.level} • ${entry.elo} Elo</div>
            </div>
            <div class="level-icon" style="width: 40px; height: 40px; 
                background: ${getLevelIcon(entry.level).gradient};
                animation: ${getLevelIcon(entry.level).animation} 2s infinite alternate;">
                ${entry.level}
            </div>
        `;
        
        leaderboardList.appendChild(entryElement);
    });
    
    // Display user's personal ranking
    const userRankElement = document.getElementById('userRank');
    userRankElement.innerHTML = `
        <div style="display: flex; align-items: center; gap: 20px; margin-top: 10px;">
            <div style="font-size: 1.3rem; font-weight: bold;">${userRank.rank}:</div>
            <div style="font-size: 1.2rem;">${userRank.username}</div>
            <div class="level-icon" style="width: 30px; height: 30px; 
                background: ${getLevelIcon(userRank.level).gradient};
                animation: ${getLevelIcon(userRank.level).animation} 2s infinite alternate;">
                ${userRank.level}
            </div>
            <div style="color: #ffd700;">${userRank.elo} points</div>
        </div>
    `;
}

// Utility Functions
function calculateLevel(elo) {
    return Math.min(CONFIG.MAX_LEVEL, Math.floor(elo / CONFIG.ELO_PER_LEVEL) + 1);
}

function getLevelIconStyle(level) {
    if (level <= 3) return '1-3';
    if (level <= 6) return '4-6';
    return '7-10';
}

function getLevelIcon(level) {
    return LEVEL_ICONS[getLevelIconStyle(level)];
}

function updateLevelIcon(elementId, level) {
    const element = document.getElementById(elementId);
    const iconStyle = getLevelIcon(level);
    
    element.textContent = level;
    element.style.background = iconStyle.gradient;
    element.style.color = '#fff';
}

function updatePlayerInfo() {
    document.getElementById('playerName').textContent = gameState.player.username;
    document.getElementById('playerElo').textContent = `Elo: ${gameState.player.elo}`;
    updateLevelIcon('playerLevelIcon', gameState.player.level);
}

async function loadPlayerData() {
    // In a real implementation, this would fetch from MongoDB
    // For now, we'll use localStorage for demo
    const savedData = localStorage.getItem(`dominoes_player_${gameState.player.telegramId}`);
    
    if (savedData) {
        const data = JSON.parse(savedData);
        gameState.player.elo = data.elo || 1000;
        gameState.player.level = data.level || 1;
    }
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(231, 76, 60, 0.9);
        color: white;
        padding: 15px 30px;
        border-radius: 10px;
        z-index: 10000;
        font-weight: bold;
        animation: fadeInOut 3s ease-in-out;
    `;
    
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 3000);
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', initGame);
