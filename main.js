// ============================================
// MAIN APPLICATION
// ============================================

const SERVER_URL = 'wss://mario-io-1.onrender.com';

// State
let ws = null;
let connectionStatus = 'disconnected';
let game = new DominoGame();
let eloSystem = new EloSystem();
let selectedTile = null;
let playablePositions = [];
let myPlayerId = 'player-0';
let isSearching = false;
let searchTime = 0;
let searchInterval = null;
let roomCode = null;
let currentScreen = 'lobby';

// User stats (demo data - would come from server)
let userStats = {
    name: 'Oyuncu',
    level: 1,
    elo: 0,
    wins: 0,
    losses: 0,
    rank: 1
};

// Demo leaderboard
let leaderboard = [
    { rank: 1, name: 'ProGamer', level: 10, elo: 1250, wins: 150, losses: 30 },
    { rank: 2, name: 'DominoKing', level: 9, elo: 980, wins: 120, losses: 45 },
    { rank: 3, name: 'MasterPlay', level: 8, elo: 850, wins: 100, losses: 50 },
    { rank: 4, name: 'TileChamp', level: 7, elo: 720, wins: 85, losses: 55 },
    { rank: 5, name: 'QuickWin', level: 6, elo: 650, wins: 70, losses: 40 },
    { rank: 6, name: 'LuckyDom', level: 5, elo: 550, wins: 60, losses: 50 },
    { rank: 7, name: 'NightOwl', level: 5, elo: 520, wins: 55, losses: 45 },
    { rank: 8, name: 'StarPlayer', level: 4, elo: 450, wins: 50, losses: 40 },
    { rank: 9, name: 'RookieRise', level: 4, elo: 380, wins: 40, losses: 35 },
    { rank: 10, name: 'NewHero', level: 3, elo: 280, wins: 30, losses: 25 }
];

// ============================================
// WEBSOCKET CONNECTION
// ============================================

function connectWebSocket() {
    updateConnectionStatus('connecting');

    try {
        ws = new WebSocket(SERVER_URL);

        ws.onopen = () => {
            updateConnectionStatus('connected');
            showToast('Sunucuya bağlandı!', 'success');
        };

        ws.onclose = () => {
            updateConnectionStatus('disconnected');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
            updateConnectionStatus('error');
            console.error('WebSocket error:', error);
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        };
    } catch (e) {
        updateConnectionStatus('error');
        setTimeout(connectWebSocket, 5000);
    }
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function handleServerMessage(message) {
    switch (message.type) {
        case 'MATCH_FOUND':
            stopSearching();
            startGame(message.payload);
            break;
        case 'ROOM_CREATED':
            roomCode = message.payload.code;
            showRoomCode();
            break;
        case 'GAME_STATE_UPDATE':
            updateGameState(message.payload);
            break;
        case 'PLAYER_JOINED':
            showToast(`${message.payload.name} odaya katıldı!`, 'info');
            break;
        case 'PLAYER_LEFT':
            handlePlayerLeft(message.payload);
            break;
        case 'GAME_OVER':
            handleGameOver(message.payload);
            break;
    }
}

// ============================================
// UI UPDATES
// ============================================

function updateConnectionStatus(status) {
    connectionStatus = status;
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    dot.className = 'status-dot ' + status;

    const statusTexts = {
        disconnected: 'Bağlantı kesildi',
        connecting: 'Bağlanıyor...',
        connected: 'Bağlı',
        error: 'Bağlantı hatası'
    };

    text.textContent = statusTexts[status];
}

function updateUserStats() {
    const level = eloSystem.getLevelFromElo(userStats.elo);
    const levelClass = eloSystem.getLevelClass(level);

    document.getElementById('level-icon').className = 'level-icon ' + levelClass;
    document.getElementById('level-icon').textContent = level;
    document.getElementById('level-text').textContent = `Seviye ${level}`;
    document.getElementById('elo-text').textContent = `${userStats.elo} ELO`;
    document.getElementById('user-rank').textContent = userStats.rank;
    document.getElementById('wins').textContent = userStats.wins;
    document.getElementById('losses').textContent = userStats.losses;

    // Update in-game level display
    document.getElementById('my-level').textContent = level;
    document.getElementById('my-level').className = 'level-icon ' + levelClass;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// LOBBY FUNCTIONS
// ============================================

function startSearching() {
    isSearching = true;
    searchTime = 0;

    const container = document.getElementById('ranked-container');
    container.innerHTML = `
        <div class="searching-state">
            <div class="spinner"></div>
            <div class="searching-text">Rakip Aranıyor...</div>
            <div class="search-time" id="search-time">0:00</div>
            <button class="cancel-btn" onclick="cancelSearch()">İptal</button>
        </div>
    `;

    searchInterval = setInterval(() => {
        searchTime++;
        const mins = Math.floor(searchTime / 60);
        const secs = (searchTime % 60).toString().padStart(2, '0');
        document.getElementById('search-time').textContent = `${mins}:${secs}`;
    }, 1000);

    sendMessage('START_RANKED_SEARCH', { userId: userStats.name });

    // Demo: Start game after 3 seconds
    setTimeout(() => {
        if (isSearching) {
            stopSearching();
            startDemoGame(true);
        }
    }, 3000);
}

function stopSearching() {
    isSearching = false;
    if (searchInterval) {
        clearInterval(searchInterval);
        searchInterval = null;
    }
}

function cancelSearch() {
    stopSearching();
    sendMessage('CANCEL_SEARCH', {});
    resetRankedButton();
    showToast('Arama iptal edildi', 'info');
}

function resetRankedButton() {
    const container = document.getElementById('ranked-container');
    container.innerHTML = `
        <button class="game-btn ranked" id="ranked-btn" onclick="startSearching()">
            <div class="btn-icon">⚔️</div>
            <div class="btn-content">
                <div class="btn-title">DERECELİ</div>
                <div class="btn-desc">Çevrimiçi rakip bul ve ELO kazan</div>
            </div>
        </button>
    `;
}

function createRoom() {
    roomCode = generateRoomCode();
    sendMessage('CREATE_ROOM', { code: roomCode });
    showRoomCode();
}

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function showRoomCode() {
    const container = document.getElementById('friend-container');
    container.innerHTML = `
        <div class="room-code-display">
            <div class="room-code-label">Oda Kodu:</div>
            <div class="room-code">${roomCode}</div>
            <button class="copy-btn" onclick="copyRoomCode()">📋 Kopyala</button>
            <div class="room-code-hint">Arkadaşınla bu kodu paylaş</div>
            <button class="cancel-btn" style="margin-top: 15px" onclick="cancelRoom()">İptal</button>
        </div>
    `;

    // Demo: Start game after 3 seconds
    setTimeout(() => {
        if (roomCode) {
            startDemoGame(false);
        }
    }, 3000);
}

function copyRoomCode() {
    navigator.clipboard.writeText(roomCode);
    showToast('Oda kodu kopyalandı!', 'success');
}

function cancelRoom() {
    roomCode = null;
    resetFriendButton();
}

function resetFriendButton() {
    const container = document.getElementById('friend-container');
    container.innerHTML = `
        <button class="game-btn friend" id="friend-btn" onclick="createRoom()">
            <div class="btn-icon">👥</div>
            <div class="btn-content">
                <div class="btn-title">ARKADAŞLA OYNA</div>
                <div class="btn-desc">Özel oda oluştur ve arkadaşını davet et</div>
            </div>
        </button>
    `;
}

function showJoinInput() {
    const container = document.getElementById('join-container');
    container.innerHTML = `
        <div class="join-room-panel">
            <input type="text" class="join-input" id="join-code-input" 
                   placeholder="XXXX" maxlength="4" 
                   oninput="this.value = this.value.toUpperCase()">
            <div class="join-btns">
                <button class="join-cancel-btn" onclick="cancelJoin()">İptal</button>
                <button class="join-confirm-btn" onclick="joinRoom()">Bağlan</button>
            </div>
        </div>
    `;
    document.getElementById('join-code-input').focus();
}

function cancelJoin() {
    const container = document.getElementById('join-container');
    container.innerHTML = `
        <button class="game-btn join" id="join-btn" onclick="showJoinInput()">
            <div class="btn-icon">🔑</div>
            <div class="btn-content">
                <div class="btn-title">ODAYA KATIL</div>
                <div class="btn-desc">Oda kodu ile arkadaşına katıl</div>
            </div>
        </button>
    `;
}

function joinRoom() {
    const code = document.getElementById('join-code-input').value;
    if (code.length !== 4) {
        showToast('Lütfen 4 haneli oda kodunu girin!', 'error');
        return;
    }

    sendMessage('JOIN_ROOM', { code: code });
    showToast('Odaya bağlanılıyor...', 'info');

    // Demo: Start game
    setTimeout(() => {
        startDemoGame(false);
    }, 1500);
}

// ============================================
// GAME FUNCTIONS
// ============================================

function startDemoGame(isRanked) {
    game.initializeGame(['Sen', 'Rakip'], isRanked);
    myPlayerId = 'player-0';
    currentScreen = 'game';

    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    renderGame();
}

function startGame(payload) {
    game.initializeGame([payload.player1, payload.player2], payload.isRanked);
    myPlayerId = payload.myPlayerId;
    currentScreen = 'game';

    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';

    renderGame();
}

function renderGame() {
    renderOpponentArea();
    renderBoard();
    renderPlayerHand();
    updateTurnIndicator();
    updateBoardEnds();
}

function renderOpponentArea() {
    const opponent = game.players.find(p => p.id !== myPlayerId);
    if (!opponent) return;

    document.getElementById('opponent-name').textContent = opponent.name;

    const container = document.getElementById('opponent-tiles');
    container.innerHTML = '';

    for (let i = 0; i < opponent.tiles.length; i++) {
        const tile = document.createElement('div');
        tile.className = 'hidden-tile';
        container.appendChild(tile);
    }

    // Update opponent level
    const level = eloSystem.getLevelFromElo(opponent.elo || 0);
    const levelEl = document.getElementById('opponent-level');
    levelEl.textContent = level;
    levelEl.className = 'level-icon ' + eloSystem.getLevelClass(level);
}

function renderBoard() {
    const container = document.getElementById('board-tiles');
    container.innerHTML = '';

    if (game.board.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted);">İlk taşı oyna</div>';
        return;
    }

    game.board.forEach(placedTile => {
        const tileEl = createTileElement(placedTile, true, false);
        container.appendChild(tileEl);
    });
}

function renderPlayerHand() {
    const player = game.players.find(p => p.id === myPlayerId);
    if (!player) return;

    const container = document.getElementById('hand-tiles');
    container.innerHTML = '';

    const isMyTurn = game.getCurrentPlayer().id === myPlayerId;
    const playableTiles = isMyTurn ? game.getPlayableTiles() : [];

    player.tiles.forEach(tile => {
        const isPlayable = playableTiles.some(t => t.id === tile.id);
        const isSelected = selectedTile && selectedTile.id === tile.id;
        const tileEl = createTileElement(tile, false, isPlayable, isSelected);

        if (isMyTurn && isPlayable) {
            tileEl.onclick = () => selectTile(tile);
        }

        container.appendChild(tileEl);
    });

    // Update pass button
    const passBtn = document.getElementById('pass-btn');
    passBtn.disabled = !isMyTurn || playableTiles.length > 0;

    // Show/hide play positions
    const positionsEl = document.getElementById('play-positions');
    if (selectedTile && playablePositions.length > 0) {
        positionsEl.classList.remove('hidden');

        const leftBtn = document.getElementById('play-left-btn');
        const rightBtn = document.getElementById('play-right-btn');

        const canPlayLeft = playablePositions.some(p => p.side === 'left');
        const canPlayRight = playablePositions.some(p => p.side === 'right');

        leftBtn.style.display = canPlayLeft ? 'block' : 'none';
        rightBtn.style.display = canPlayRight ? 'block' : 'none';
    } else {
        positionsEl.classList.add('hidden');
    }
}

function createTileElement(tile, isOnBoard, isPlayable, isSelected = false) {
    const div = document.createElement('div');
    div.className = 'domino-tile';

    if (isOnBoard) {
        div.classList.add('horizontal');
    }

    if (isPlayable) {
        div.classList.add('playable');
    } else if (!isOnBoard && game.getCurrentPlayer().id === myPlayerId) {
        const playableTiles = game.getPlayableTiles();
        if (!playableTiles.some(t => t.id === tile.id)) {
            div.classList.add('not-playable');
        }
    }

    if (isSelected) {
        div.classList.add('selected');
    }

    // Determine display values
    let leftVal = tile.left;
    let rightVal = tile.right;

    if (tile.flipped) {
        leftVal = tile.right;
        rightVal = tile.left;
    }

    div.innerHTML = `
        <div class="tile-half">${createPips(leftVal)}</div>
        <div class="tile-half">${createPips(rightVal)}</div>
    `;

    return div;
}

function createPips(value) {
    const pipPositions = {
        0: [],
        1: ['pip-1'],
        2: ['pip-2-tl', 'pip-2-br'],
        3: ['pip-3-tl', 'pip-3-c', 'pip-3-br'],
        4: ['pip-4-tl', 'pip-4-tr', 'pip-4-bl', 'pip-4-br'],
        5: ['pip-5-tl', 'pip-5-tr', 'pip-5-c', 'pip-5-bl', 'pip-5-br'],
        6: ['pip-6-tl', 'pip-6-tr', 'pip-6-ml', 'pip-6-mr', 'pip-6-bl', 'pip-6-br']
    };

    return pipPositions[value].map(pos => `<div class="pip ${pos}"></div>`).join('');
}

function selectTile(tile) {
    if (game.getCurrentPlayer().id !== myPlayerId) return;

    const positions = game.getPlayablePositions(tile);
    if (positions.length === 0) return;

    selectedTile = tile;
    playablePositions = positions;

    // If only one position, play immediately
    if (positions.length === 1 || game.board.length === 0) {
        playTile(positions[0].side);
        return;
    }

    renderPlayerHand();
    updateBoardEnds();
}

function playTile(side) {
    if (!selectedTile) return;

    const result = game.placeTile(selectedTile.id, side);

    if (result.success) {
        sendMessage('PLACE_TILE', {
            tileId: selectedTile.id,
            side: side
        });

        if (result.gameOver) {
            handleGameOver({ winner: result.winner, isRanked: game.isRanked });
        }
    }

    selectedTile = null;
    playablePositions = [];
    renderGame();

    // Demo: AI plays after 1-2 seconds
    if (game.status === 'playing' && game.getCurrentPlayer().id !== myPlayerId) {
        setTimeout(aiPlay, 1000 + Math.random() * 1000);
    }
}

function aiPlay() {
    if (game.status !== 'playing' || game.getCurrentPlayer().id === myPlayerId) return;

    const playableTiles = game.getPlayableTiles();

    if (playableTiles.length === 0) {
        game.passTurn();
        showToast('Rakip pas geçti', 'info');
    } else {
        const tile = playableTiles[Math.floor(Math.random() * playableTiles.length)];
        const positions = game.getPlayablePositions(tile);
        const side = positions[Math.floor(Math.random() * positions.length)].side;

        const result = game.placeTile(tile.id, side);

        if (result.gameOver) {
            handleGameOver({ winner: result.winner, isRanked: game.isRanked });
        }
    }

    renderGame();
}

function passTurn() {
    if (game.getCurrentPlayer().id !== myPlayerId) return;

    const result = game.passTurn();
    sendMessage('PASS_TURN', {});

    if (result.blocked) {
        handleGameOver({ winner: result.winner, isRanked: game.isRanked });
    }

    renderGame();

    // AI plays
    if (game.status === 'playing' && game.getCurrentPlayer().id !== myPlayerId) {
        setTimeout(aiPlay, 1000 + Math.random() * 1000);
    }
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    const isMyTurn = game.getCurrentPlayer().id === myPlayerId;

    indicator.textContent = isMyTurn ? 'Senin Sıran' : 'Rakibin Sırası';
    indicator.className = 'turn-indicator' + (isMyTurn ? '' : ' opponent');
}

function updateBoardEnds() {
    const leftEl = document.getElementById('left-end');
    const rightEl = document.getElementById('right-end');

    if (game.board.length === 0) {
        leftEl.textContent = 'Sol: -';
        rightEl.textContent = 'Sağ: -';
        leftEl.className = 'board-end';
        rightEl.className = 'board-end';
        return;
    }

    leftEl.textContent = `Sol: ${game.leftEnd}`;
    rightEl.textContent = `Sağ: ${game.rightEnd}`;

    // Highlight if selected tile can play there
    if (selectedTile) {
        const canPlayLeft = playablePositions.some(p => p.side === 'left');
        const canPlayRight = playablePositions.some(p => p.side === 'right');

        leftEl.className = 'board-end' + (canPlayLeft ? ' playable' : '');
        rightEl.className = 'board-end' + (canPlayRight ? ' playable' : '');
    } else {
        leftEl.className = 'board-end';
        rightEl.className = 'board-end';
    }
}

function handleGameOver(payload) {
    const isWinner = payload.winner.id === myPlayerId;
    const eloChange = game.calculateEloChange(isWinner, false, game.turnCount > 10);

    // Update stats
    if (game.isRanked) {
        userStats.elo += eloChange;
        if (isWinner) {
            userStats.wins++;
        } else {
            userStats.losses++;
        }
        userStats.level = eloSystem.getLevelFromElo(userStats.elo);
    }

    // Show result modal
    const modal = document.getElementById('result-modal');
    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const elo = document.getElementById('result-elo');

    if (isWinner) {
        icon.textContent = '🏆';
        title.textContent = 'KAZANDIN!';
        title.className = 'result-title win';
        if (game.isRanked) {
            elo.textContent = `+${eloChange} ELO`;
            elo.className = 'result-elo positive';
        } else {
            elo.textContent = '';
        }
    } else {
        icon.textContent = '😔';
        title.textContent = 'KAYBETTİN';
        title.className = 'result-title lose';
        if (game.isRanked) {
            elo.textContent = `${eloChange} ELO`;
            elo.className = 'result-elo negative';
        } else {
            elo.textContent = '';
        }
    }

    modal.classList.add('active');
}

function handlePlayerLeft(payload) {
    const halfwayPassed = game.turnCount > 10;
    const eloGain = game.isRanked ? (halfwayPassed ? 20 : 10) : 0;

    if (game.isRanked) {
        userStats.elo += eloGain;
        userStats.wins++;
        userStats.level = eloSystem.getLevelFromElo(userStats.elo);
    }

    showToast(`Rakip oyundan ayrıldı! ${eloGain > 0 ? `+${eloGain} ELO` : ''}`, 'success');

    const myPlayer = game.players.find(p => p.id === myPlayerId);
    handleGameOver({ winner: myPlayer, isRanked: game.isRanked });
}

function leaveGame() {
    sendMessage('LEAVE_GAME', {});
    backToLobby();
}

function backToLobby() {
    document.getElementById('result-modal').classList.remove('active');
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';

    currentScreen = 'lobby';
    roomCode = null;
    selectedTile = null;
    playablePositions = [];

    resetRankedButton();
    resetFriendButton();
    cancelJoin();
    updateUserStats();
}

// ============================================
// LEADERBOARD
// ============================================

function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    const body = document.getElementById('leaderboard-body');

    let html = '';

    leaderboard.forEach((entry, index) => {
        const levelClass = eloSystem.getLevelClass(entry.level);
        const topClass = index < 3 ? `top-${index + 1}` : '';

        html += `
            <div class="leaderboard-entry ${topClass}">
                <div class="entry-rank">#${entry.rank}</div>
                <div class="entry-info">
                    <div class="entry-name">${entry.name}</div>
                    <div class="entry-stats">${entry.wins}G / ${entry.losses}M</div>
                </div>
                <div class="level-icon entry-level ${levelClass}">${entry.level}</div>
                <div class="entry-elo">
                    <div class="entry-elo-value">${entry.elo}</div>
                    <div class="entry-elo-label">ELO</div>
                </div>
            </div>
        `;
    });

    // Add user's rank if not in top 10
    if (userStats.rank > 10) {
        const levelClass = eloSystem.getLevelClass(userStats.level);
        html += `
            <div class="my-rank">
                <div class="my-rank-label">Senin Sıralamanın:</div>
                <div class="leaderboard-entry">
                    <div class="entry-rank">#${userStats.rank}</div>
                    <div class="entry-info">
                        <div class="entry-name">${userStats.name}</div>
                        <div class="entry-stats">${userStats.wins}G / ${userStats.losses}M</div>
                    </div>
                    <div class="level-icon entry-level ${levelClass}">${userStats.level}</div>
                    <div class="entry-elo">
                        <div class="entry-elo-value">${userStats.elo}</div>
                        <div class="entry-elo-label">ELO</div>
                    </div>
                </div>
            </div>
        `;
    }

    body.innerHTML = html;
    modal.classList.add('active');
}

function closeLeaderboard() {
    document.getElementById('leaderboard-modal').classList.remove('active');
}

// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Connect to WebSocket
    connectWebSocket();

    // Update user stats display
    updateUserStats();

    // Lobby buttons
    document.getElementById('ranked-btn').onclick = startSearching;
    document.getElementById('friend-btn').onclick = createRoom;
    document.getElementById('join-btn').onclick = showJoinInput;
    document.getElementById('leaderboard-btn').onclick = openLeaderboard;

    // Game buttons
    document.getElementById('leave-btn').onclick = leaveGame;
    document.getElementById('pass-btn').onclick = passTurn;
    document.getElementById('play-left-btn').onclick = () => playTile('left');
    document.getElementById('play-right-btn').onclick = () => playTile('right');

    // Modal buttons
    document.getElementById('close-leaderboard').onclick = closeLeaderboard;
    document.getElementById('result-btn').onclick = backToLobby;

    // Close modals on overlay click
    document.getElementById('leaderboard-modal').onclick = (e) => {
        if (e.target.id === 'leaderboard-modal') closeLeaderboard();
    };
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (currentScreen === 'game') {
        if (e.key === 'Escape') {
            selectedTile = null;
            playablePositions = [];
            renderPlayerHand();
        }
    }
});
