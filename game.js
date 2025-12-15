const socket = io('https://mario-io-1.onrender.com', { // Ensure this matches user request URL if deploying there, otherwise relative for local
    autoConnect: true
    // UPDATE: The user asked to connect to https://mario-io-1.onrender.com.
    // IF we are hosting ON that server, we can use relative path.
    // BUT since I am writing the code for the project described, and the user prompt says:
    // "The game must feature a robust online multiplayer system connecting to the backend server at: https://mario-io-1.onrender.com."
    // I should probably set this URL explicitly if the frontend is separate from backend.
    // However, the prompt says "designed to be hosted on Github Pages and deployed via Render".
    // If hosted on GH Pages, it needs the full URL.
});
// Note: If running locally with the server.js I made, this should point to localhost or relative. 
// But the user specific prompt URL suggests use that. 
// CHECK: If I am "Creating" the game, I am creating the Server AND Client.
// The user prompt implies I am building the WHOLE thing.
// So if I build the server, I should point the client to where the server WILL be.
// For now, I'll make it dynamic or use the requested URL.
// Actually, I'll stick to relative '/' because usually `server.js` serves `index.html`.
// Wait, user says "hosted on Github Pages". GH Pages is static.
// So the client MUST point to the Render URL.
// I will use the Render URL provided in the prompt.

// CORRECTION: The user provided https://mario-io-1.onrender.com as the backend.
// So the client socket connect string should be that.

// DOM Elements
const screens = {
    login: document.getElementById('login-screen'),
    lobby: document.getElementById('lobby-screen'),
    leaderboard: document.getElementById('leaderboard-screen'),
    game: document.getElementById('game-screen')
};

const ui = {
    statusBar: {
        text: document.getElementById('connection-status-text'),
        dot: document.getElementById('connection-dot')
    },
    loginBtn: document.getElementById('telegram-login-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    cancelSearchBtn: document.getElementById('cancel-search-btn'),
    user: {
        avatar: document.getElementById('user-avatar'),
        name: document.getElementById('user-name'),
        elo: document.getElementById('user-elo'),
        levelIcon: document.getElementById('user-level-icon')
    },
    opponent: {
        avatar: document.getElementById('opp-avatar'),
        name: document.getElementById('opp-name'),
        levelIcon: document.getElementById('opp-level-icon')
    },
    leaderboardList: document.getElementById('leaderboard-list'),
    userRankDisplay: document.getElementById('user-rank-display')
};

// State
let currentUser = null;
let currentRoomId = null;
let gameBoard = [];
let myHand = [];
let isMyTurn = false;
let selectedTile = null; // Index in myHand

// --- Socket Events ---
socket.on('connect', () => {
    ui.statusBar.text.textContent = "Connected";
    ui.statusBar.dot.classList.add('connected');
});

socket.on('disconnect', () => {
    ui.statusBar.text.textContent = "Disconnected";
    ui.statusBar.dot.classList.remove('connected');
});

socket.on('login_success', (user) => {
    currentUser = user;
    updateUserProfile(user);
    showScreen('lobby');
});

socket.on('matchmaking_status', (data) => {
    if (data.status === 'searching') {
        ui.loadingOverlay.style.display = 'flex';
        ui.loadingText.textContent = "Searching for Opponent...";
        ui.cancelSearchBtn.onclick = () => socket.emit('cancel_matchmaking');
    } else if (data.status === 'cancelled') {
        ui.loadingOverlay.style.display = 'none';
        ui.loadingText.textContent = "";
    }
});

socket.on('room_created', (data) => {
    alert(`Room Created! Code: ${data.roomId}`);
    ui.loadingOverlay.style.display = 'flex';
    ui.loadingText.textContent = `Waiting for friend... Room: ${data.roomId}`;
    ui.cancelSearchBtn.textContent = "Cancel Room";
    ui.cancelSearchBtn.onclick = () => {
        // Implement leave room logic if needed
        ui.loadingOverlay.style.display = 'none';
    };
});

socket.on('game_start', (data) => {
    ui.loadingOverlay.style.display = 'none';
    currentRoomId = data.roomId;
    showScreen('game');
    // Identify opponent
    const opponent = data.players.find(p => p.telegramId !== currentUser.telegramId);
    if (opponent) {
        ui.opponent.name.textContent = opponent.username;
        ui.opponent.avatar.src = opponent.photoUrl || 'https://via.placeholder.com/50';
        ui.opponent.levelIcon.textContent = getLevelIcon(opponent.level);
    }
    gameBoard = [];
    renderBoard();
});

socket.on('game_init', (data) => {
    // Override with specific data if using secured event
    myHand = data.hand;
    isMyTurn = data.isTurn;
    renderHand();
    updateTurnIndicator();
});

socket.on('game_update', (data) => {
    gameBoard = data.board;
    renderBoard();

    isMyTurn = data.turn === currentUser.telegramId;
    updateTurnIndicator();

    // Ideally update hand based on what we played, but easier if server sends hand.
    // For now, if we played, we remove it locally.
    // If opponent played, we just see board update.
});

socket.on('game_over', (data) => {
    let result = "Draw";
    if (data.winner.telegramId === currentUser.telegramId) result = "You Win! +" + data.eloChange;
    else result = "You Lost. -" + data.eloChange;

    alert(result);
    showScreen('lobby');
    // Refresh user data?
    // socket.emit('login', ...); // or just update elo locally if server sends updated user object
});

socket.on('leaderboard_data', (data) => {
    renderLeaderboard(data.topPlayers, data.userRank);
});

socket.on('error', (err) => {
    alert(err.message);
    ui.loadingOverlay.style.display = 'none';
});

// --- UI Logic ---
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

function updateUserProfile(user) {
    ui.user.name.textContent = user.username;
    ui.user.elo.textContent = user.elo;
    ui.user.avatar.src = user.photoUrl || 'https://via.placeholder.com/50';
    ui.user.levelIcon.textContent = getLevelIcon(user.level);
}

function getLevelIcon(level) {
    if (level <= 3) return "🟡";
    if (level <= 6) return "🔵";
    return "🟣";
}

// Event Listeners
ui.loginBtn.addEventListener('click', () => {
    // Mock Login for now (or Telegram WebApp init)
    const mockUser = {
        telegramId: "user_" + Math.floor(Math.random() * 10000),
        username: "Player" + Math.floor(Math.random() * 100),
        photoUrl: "https://via.placeholder.com/50"
    };

    // Check if Telegram WebApp is available
    if (window.Telegram && window.Telegram.WebApp) {
        const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
        if (tgUser) {
            mockUser.telegramId = tgUser.id.toString();
            mockUser.username = tgUser.first_name;
            mockUser.photoUrl = tgUser.photo_url;
        }
    }

    socket.emit('login', mockUser);
});

document.getElementById('ranked-btn').addEventListener('click', () => {
    socket.emit('join_ranked');
});

document.getElementById('friend-btn').addEventListener('click', () => {
    socket.emit('create_private_room');
});

document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value;
    if (code) socket.emit('join_private_room', code);
});

document.getElementById('open-leaderboard').addEventListener('click', () => {
    socket.emit('get_leaderboard');
    showScreen('leaderboard');
});

// --- Game Rendering ---
function renderBoard() {
    const container = document.getElementById('board-container');
    container.innerHTML = '';

    gameBoard.forEach((tile, index) => {
        const el = document.createElement('div');
        el.className = 'domino-tile horizontal'; // Simplification: all horizontal in row
        // Check if double?
        // Render dots/numbers
        el.innerHTML = `<div class="domino-half">${tile[0]}</div><div class="domino-half">${tile[1]}</div>`;
        container.appendChild(el);
    });
}

function renderHand() {
    const container = document.getElementById('hand-area');
    container.innerHTML = '';

    myHand.forEach((tile, index) => {
        const el = document.createElement('div');
        el.className = 'domino-tile';
        el.innerHTML = `<div class="domino-half">${tile[0]}</div><div class="domino-half">${tile[1]}</div>`;

        el.onclick = () => selectTile(index, el);

        container.appendChild(el);
    });
}

function selectTile(index, element) {
    if (!isMyTurn) return;

    // Clear previous highlights
    document.querySelectorAll('.domino-tile').forEach(t => t.style.border = 'none');
    element.style.border = '2px solid yellow';
    selectedTile = index;

    // Show Valid Move Indicators on Board
    highlightDropZones();
}

function highlightDropZones() {
    // Remove existing zones
    document.querySelectorAll('.highlight-zone').forEach(z => z.remove());

    if (gameBoard.length === 0) {
        // Can play anywhere (center)
        const zone = createZone('center');
        document.getElementById('board-area').appendChild(zone);
    } else {
        const leftVal = gameBoard[0][0];
        const rightVal = gameBoard[gameBoard.length - 1][1];
        const tile = myHand[selectedTile];

        // Check Left
        if (tile[0] === leftVal || tile[1] === leftVal) {
            const zone = createZone('left');
            // Position relative to board container logic required visually
            // For simple row:
            document.getElementById('board-container').prepend(zone);
        }

        // Check Right
        if (tile[0] === rightVal || tile[1] === rightVal) {
            const zone = createZone('right');
            document.getElementById('board-container').appendChild(zone);
        }
    }
}

function createZone(side) {
    const el = document.createElement('div');
    el.className = 'highlight-zone';
    el.onclick = () => {
        playTile(side);
        el.remove();
        // Remove selection highlight
        if (document.querySelectorAll('.domino-tile')[selectedTile])
            document.querySelectorAll('.domino-tile')[selectedTile].style.border = 'none';
        selectedTile = null;
    };
    return el;
}

function playTile(side) {
    if (selectedTile === null) return;
    const tile = myHand[selectedTile];

    socket.emit('play_tile', {
        roomId: currentRoomId,
        tile: tile,
        side: side
    });

    // Optimistic Update
    myHand.splice(selectedTile, 1);
    renderHand();
    document.querySelectorAll('.highlight-zone').forEach(z => z.remove());
    isMyTurn = false;
    updateTurnIndicator();
}

function updateTurnIndicator() {
    if (isMyTurn) {
        document.getElementById('my-info').classList.add('turn-active');
        document.getElementById('opponent-info').classList.remove('turn-active');
        document.getElementById('game-screen').style.boxShadow = "inset 0 0 20px #0ff";
    } else {
        document.getElementById('my-info').classList.remove('turn-active');
        document.getElementById('opponent-info').classList.add('turn-active');
        document.getElementById('game-screen').style.boxShadow = "none";
    }
}

function renderLeaderboard(players, myRank) {
    const list = ui.leaderboardList;
    list.innerHTML = '';

    players.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'lb-item';

        let rankClass = '';
        if (i === 0) rankClass = 'lb-rank-1';
        if (i === 1) rankClass = 'lb-rank-2';
        if (i === 2) rankClass = 'lb-rank-3';

        row.innerHTML = `
            <span class="${rankClass}">#${i + 1}</span>
            <span>${p.username} ${getLevelIcon(p.level)}</span>
            <span>${p.elo} pts</span>
        `;
        list.appendChild(row);
    });

    if (myRank !== -1) {
        ui.userRankDisplay.textContent = `Your Rank: #${myRank} (${currentUser.username})`;
    }
}
