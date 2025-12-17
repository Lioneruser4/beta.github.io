/**
 * DOMINO ELITE PRO - CLIENT ENGINE
 */

const CONFIG = {
    SERVER_URL: 'https://mario-io-1.onrender.com', // User requested specific server
    TIER_POINTS: 100 // Points per level
};

let socket;
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999), name: 'Guest', elo: 0, level: 1 };
let gameActive = false;
let myTurn = false;
let myHand = [];
let boardData = { left: null, right: null, stones: [] };
let selectedStone = null;

// Reconnect support
const storedUserId = localStorage.getItem('domino_uid');
if (storedUserId) currentUser.id = storedUserId;

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    setupSocket();
    setupUIListeners();
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    tg.expand();
    if (tg?.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser.id = u.id.toString();
        currentUser.name = u.first_name;
        currentUser.photo = u.photo_url;
        localStorage.setItem('domino_uid', currentUser.id);
    }
    updateProfileUI();
}

function setupSocket() {
    socket = io(CONFIG.SERVER_URL, {
        query: { id: currentUser.id, name: currentUser.name, photo: currentUser.photo || '' },
        reconnection: true,
        reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
        showToast("Sunucuya Bağlandı", 2000);
        socket.emit('check_rejoin');
    });

    socket.on('profile_sync', data => {
        currentUser.elo = data.elo;
        currentUser.level = Math.min(10, Math.floor(data.elo / CONFIG.TIER_POINTS) + 1);
        updateProfileUI();
        if (data.leaderboard) updateLeaderboard(data.leaderboard, data.myRank);
    });

    socket.on('mm_status', status => {
        if (status === 'searching') {
            document.getElementById('mm-overlay').style.display = 'flex';
        } else {
            document.getElementById('mm-overlay').style.display = 'none';
        }
    });

    socket.on('game_start', data => {
        gameActive = true;
        myHand = data.hand;
        boardData = { left: null, right: null, stones: [] };
        switchScreen('screen-game');
        document.getElementById('opp-info').style.display = 'block';
        document.getElementById('opp-name').innerText = data.opponent.name;
        renderHand();
        renderBoard([]);
    });

    socket.on('game_update', data => {
        myTurn = (data.currentTurn === currentUser.id);
        boardData = data.board;
        myHand = data.hands[currentUser.id] || [];
        renderBoard(data.board.stones);
        renderHand();
        updateTurnUI();
    });

    socket.on('game_over', data => {
        gameActive = false;
        alert(`Oyun Bitti! Kazanan: ${data.winnerName}\nELO Değişimi: ${data.eloChange}`);
        switchScreen('screen-lobby');
        document.getElementById('opp-info').style.display = 'none';
    });

    socket.on('error_msg', msg => alert(msg));
}

function setupUIListeners() {
    document.getElementById('btn-ranked').onclick = () => socket.emit('join_mm');
    document.getElementById('btn-cancel-mm').onclick = () => socket.emit('cancel_mm');

    document.getElementById('btn-friend').onclick = () => {
        socket.emit('create_private');
        document.getElementById('friend-overlay').style.display = 'flex';
    };

    socket.on('private_room_created', code => {
        document.getElementById('room-id-display').innerText = code;
    });

    document.getElementById('btn-join-code').onclick = () => {
        const code = document.getElementById('join-code').value;
        if (code.length === 4) socket.emit('join_private', code);
        else alert("Lütfen 4 haneli kodu girin.");
    };

    document.getElementById('btn-copy-code').onclick = () => {
        const code = document.getElementById('room-id-display').innerText;
        navigator.clipboard.writeText(code).then(() => showToast("Kod Kopyalandı", 1000));
    };
}

// --- RENDERING ---

function updateProfileUI() {
    document.getElementById('user-name').innerText = currentUser.name;
    document.getElementById('user-avatar').src = currentUser.photo || 'https://via.placeholder.com/50';
    document.getElementById('user-elo').innerText = `ELO: ${currentUser.elo}`;

    const lvlBtn = document.getElementById('user-level-icon');
    lvlBtn.innerText = currentUser.level;
    lvlBtn.className = 'level-badge';
    if (currentUser.level <= 3) lvlBtn.classList.add('lvl-1');
    else if (currentUser.level <= 6) lvlBtn.classList.add('lvl-4');
    else lvlBtn.classList.add('lvl-7');
}

function renderHand() {
    const container = document.getElementById('my-hand');
    container.innerHTML = '';
    myHand.forEach((s, idx) => {
        const stoneEl = createStoneElement(s[0], s[1], false);
        stoneEl.onclick = () => selectStone(s, idx, stoneEl);
        container.appendChild(stoneEl);
    });
}

function createStoneElement(v1, v2, horizontal) {
    const el = document.createElement('div');
    el.className = `stone ${horizontal ? 'horizontal' : ''}`;

    // Half 1
    const p1 = document.createElement('div');
    p1.className = 'p';
    getDots(v1).forEach(() => { const d = document.createElement('div'); d.className = 'dot'; p1.appendChild(d); });

    const line = document.createElement('div');
    line.className = 'line';

    // Half 2
    const p2 = document.createElement('div');
    p2.className = 'p';
    getDots(v2).forEach(() => { const d = document.createElement('div'); d.className = 'dot'; p2.appendChild(d); });

    el.appendChild(p1);
    el.appendChild(line);
    el.appendChild(p2);
    return el;
}

function getDots(val) { return Array(val).fill(0); }

function selectStone(stone, idx, el) {
    if (!myTurn) return;

    // Deselect if already selected
    if (selectedStone && selectedStone.idx === idx) {
        selectedStone = null;
        document.querySelectorAll('.hand .stone').forEach(s => s.classList.remove('selected'));
        clearHints();
        return;
    }

    selectedStone = { val: stone, idx: idx };
    document.querySelectorAll('.hand .stone').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');

    showHints(stone);
}

function showHints(stone) {
    clearHints();
    const layer = document.getElementById('hint-layer');
    const board = document.getElementById('tiles-layer');

    // If board is empty, any side is fine (center)
    if (boardData.stones.length === 0) {
        addHint(layer, 500, 500, 'any');
        return;
    }

    // Check Left end
    if (stone[0] === boardData.left || stone[1] === boardData.left) {
        const first = board.firstChild;
        const rect = first.getBoundingClientRect();
        const bRect = board.getBoundingClientRect();
        addHint(layer, first.offsetLeft - 80, first.offsetTop - 10, 'left');
    }

    // Check Right end
    if (stone[0] === boardData.right || stone[1] === boardData.right) {
        const last = board.lastChild;
        const rect = last.getBoundingClientRect();
        addHint(layer, last.offsetLeft + (last.classList.contains('horizontal') ? 120 : 70), last.offsetTop - 10, 'right');
    }
}

function addHint(layer, x, y, side) {
    const hint = document.createElement('div');
    hint.className = 'hint-spot';
    hint.style.left = x + 'px';
    hint.style.top = y + 'px';
    hint.onclick = () => {
        socket.emit('play_move', { stone: selectedStone.val, side: side });
        selectedStone = null;
        clearHints();
    };
    layer.appendChild(hint);
}

function clearHints() { document.getElementById('hint-layer').innerHTML = ''; }

function renderBoard(stones) {
    const layer = document.getElementById('tiles-layer');
    layer.innerHTML = '';

    let currentX = 500;
    let currentY = 500;

    stones.forEach((item, i) => {
        // item: {v: [v1,v2], side: 'left'|'right'}
        const s = item.v;
        const isDouble = s[0] === s[1];
        const el = createStoneElement(s[0], s[1], !isDouble);

        // Very basic linear positioning for now
        el.style.left = currentX + 'px';
        el.style.top = currentY + 'px';

        layer.appendChild(el);
        currentX += (isDouble ? 60 : 110);
    });
}

function updateTurnUI() {
    const board = document.getElementById('game-board');
    if (myTurn) board.classList.add('turn-active');
    else board.classList.remove('turn-active');
}

// --- UTILS ---

function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function toggleLeaderboard() {
    const lb = document.getElementById('leaderboard-modal');
    if (lb.style.display === 'block') lb.style.display = 'none';
    else {
        lb.style.display = 'block';
        socket.emit('get_leaderboard');
    }
}

function updateLeaderboard(list, myRank) {
    const cont = document.getElementById('lb-content');
    cont.innerHTML = '';
    list.forEach((u, i) => {
        const item = document.createElement('div');
        item.className = `lb-item ${i < 3 ? 'top-' + (i + 1) : ''}`;
        item.innerHTML = `
            <div class="lb-rank">${i + 1}</div>
            <img src="${u.photo || ''}" style="width:30px; height:30px; border-radius:50%;">
            <div class="lb-name">${u.name} <span style="font-size:0.7rem; opacity:0.6;">(Lv.${Math.floor(u.elo / 100) + 1})</span></div>
            <div class="lb-points">${u.elo} pts</div>
        `;
        cont.appendChild(item);
    });

    if (myRank > 10) {
        document.getElementById('lb-my-rank').innerHTML = `
            <div class="lb-item" style="opacity:0.8; margin-top:10px;">
                <div class="lb-rank">${myRank}</div>
                <div class="lb-name">Siz: ${currentUser.name}</div>
                <div class="lb-points">${currentUser.elo} pts</div>
            </div>
        `;
    } else {
        document.getElementById('lb-my-rank').innerHTML = '';
    }
}

function showToast(msg, duration) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', duration);
}

function showScreen(id) { switchScreen(id); }
