/**
 * DOMINO ELITE PRO - FULL ENGINE (v4.3)
 * Automatic Telegram Sync - Reliable Socket - Clean UI
 */

const CONFIG = {
    SERVER: 'https://mario-io-1.onrender.com',
    TIER: 100 // Points per level
};

let socket, myId, myTurn = false, gameActive = false;
let myHand = [], board = { stones: [], left: null, right: null };
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999), name: 'Agent', photo: '', elo: 0, level: 1 };
let selectedIdx = -1;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    setupSocket();
    setupButtons();
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    tg.ready(); // CRITICAL: Tell Telegram we're ready
    tg.expand(); // Make it full height

    if (tg.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser.id = u.id.toString();
        currentUser.name = u.first_name + (u.last_name ? ' ' + u.last_name : '');
        currentUser.photo = u.photo_url || '';

        // Save to local for persistence
        localStorage.setItem('domino_elite_uid', currentUser.id);
        localStorage.setItem('domino_elite_name', currentUser.name);
        localStorage.setItem('domino_elite_photo', currentUser.photo);
    } else {
        // Fallback or use stored
        currentUser.id = localStorage.getItem('domino_elite_uid') || currentUser.id;
        currentUser.name = localStorage.getItem('domino_elite_name') || currentUser.name;
        currentUser.photo = localStorage.getItem('domino_elite_photo') || currentUser.photo;
    }

    updateHeaderUI();
}

function setupSocket() {
    socket = io(CONFIG.SERVER, {
        query: { id: currentUser.id, name: currentUser.name, photo: currentUser.photo },
        transports: ['websocket', 'polling'],
        reconnection: true
    });

    socket.on('connect', () => {
        document.getElementById('loading-overlay').style.display = 'none';
        socket.emit('check_rejoin');
        requestLeaderboard();
    });

    socket.on('profile_sync', data => {
        // Full profile from DB
        currentUser.elo = data.elo;
        currentUser.name = data.name || currentUser.name;
        currentUser.photo = data.photo || currentUser.photo;
        currentUser.level = Math.min(10, Math.floor(data.elo / CONFIG.TIER) + 1);
        updateHeaderUI();

        if (data.leaderboard) updateLeaderboard(data.leaderboard, data.myRank);
    });

    socket.on('mm_status', status => {
        document.getElementById('mm-modal').style.display = (status === 'searching' ? 'flex' : 'none');
    });

    socket.on('game_start', data => {
        gameActive = true;
        myHand = data.hand;
        board = { stones: [], left: null, right: null };
        showScreen('screen-game');
        document.getElementById('ui-opponent').style.display = 'block';
        document.getElementById('ui-opp-name').innerText = data.opponent.name;
        renderHand();
        renderBoard();
        showToast("MAÇ BAŞLADI");
    });

    socket.on('game_update', data => {
        board = data.board;
        myHand = data.hands[currentUser.id] || [];
        myTurn = (data.currentTurn === currentUser.id);

        renderHand();
        renderBoard();
        document.getElementById('ui-turn-bar').style.display = myTurn ? 'block' : 'none';
    });

    socket.on('game_over', data => {
        gameActive = false;
        alert(`OYUN BİTTİ!\nKazanan: ${data.winnerName}\nELO Değişimi: ${data.eloChange}`);
        showScreen('screen-lobby');
        document.getElementById('ui-opponent').style.display = 'none';
        requestLeaderboard();
    });

    socket.on('private_room_created', code => {
        document.getElementById('room-modal').style.display = 'flex';
        document.getElementById('ui-room-code').innerText = code;
    });

    socket.on('error_msg', msg => showToast(msg));
}

function setupButtons() {
    document.getElementById('btn-play-ranked').onclick = () => socket.emit('join_mm');
    document.getElementById('btn-cancel-mm').onclick = () => socket.emit('cancel_mm');
    document.getElementById('btn-create-friend').onclick = () => socket.emit('create_private');
    document.getElementById('btn-join-code').onclick = () => {
        const code = document.getElementById('input-join-code').value;
        if (code.length === 4) socket.emit('join_private', code);
    };
    document.getElementById('btn-copy-room').onclick = () => {
        const c = document.getElementById('ui-room-code').innerText;
        navigator.clipboard.writeText(c).then(() => showToast("KOD KOPYALANDI"));
    };
}

// --- LOGIC & RENDERING ---

function updateHeaderUI() {
    document.getElementById('ui-name').innerText = currentUser.name.toUpperCase();
    document.getElementById('ui-avatar').src = currentUser.photo || 'https://via.placeholder.com/50';
    document.getElementById('ui-elo').innerText = currentUser.elo + " PTS";

    // Level Badge
    const lvl = document.getElementById('ui-level');
    lvl.innerText = currentUser.level;
    lvl.className = 'level-tag ' + (currentUser.level >= 7 ? 'lvl-high' : currentUser.level >= 4 ? 'lvl-mid' : 'lvl-low');
}

function renderHand() {
    const cont = document.getElementById('ui-hand');
    cont.innerHTML = '';
    myHand.forEach((s, i) => {
        const el = createStoneElement(s[0], s[1], false);
        if (selectedIdx === i) el.classList.add('selected');
        el.onclick = () => {
            if (!myTurn) return;
            selectedIdx = (selectedIdx === i ? -1 : i);
            renderHand();
            showHints(selectedIdx === -1 ? null : s);
        };
        cont.appendChild(el);
    });
}

function showHints(stone) {
    const layer = document.getElementById('hint-layer');
    layer.innerHTML = '';
    if (!stone) return;

    // Center
    if (board.stones.length === 0) {
        addHint(layer, 600, 600, 'any', stone);
        return;
    }

    const cont = document.getElementById('board-container');

    // Left
    if (stone[0] === board.left || stone[1] === board.left) {
        const first = cont.firstChild;
        addHint(layer, first.offsetLeft - 60, first.offsetTop - 5, 'left', stone);
    }
    // Right
    if (stone[0] === board.right || stone[1] === board.right) {
        const last = cont.lastChild;
        const offset = last.classList.contains('horizontal') ? 100 : 50;
        addHint(layer, last.offsetLeft + offset, last.offsetTop - 5, 'right', stone);
    }
}

function addHint(layer, x, y, side, stone) {
    const h = document.createElement('div');
    h.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:50px; height:50px; border:2px dashed #00f2ff; border-radius:50%; cursor:pointer; pointer-events:auto;`;
    h.onclick = () => {
        socket.emit('play_move', { stone, side });
        selectedIdx = -1;
        layer.innerHTML = '';
    };
    layer.appendChild(h);
}

function renderBoard() {
    const cont = document.getElementById('board-container');
    cont.innerHTML = '';
    let x = 600, y = 600;

    board.stones.forEach(item => {
        const isD = item.v[0] === item.v[1];
        const el = createStoneElement(item.v[0], item.v[1], !isD);
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        cont.appendChild(el);
        x += (isD ? 50 : 100);
    });
}

function createStoneElement(v1, v2, horiz) {
    const s = document.createElement('div');
    s.className = `stone ${horiz ? 'horizontal' : ''}`;

    [v1, v2].forEach((v, i) => {
        const h = document.createElement('div');
        h.className = 'half';
        const dots = [
            [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]
        ][v - 1] || [];
        for (let j = 0; j < 9; j++) {
            const d = document.createElement('div');
            d.className = 'dot';
            if (dots.includes(j)) d.style.opacity = '1'; else d.style.opacity = '0';
            h.appendChild(d);
        }
        s.appendChild(h);
        if (i === 0) {
            const l = document.createElement('div');
            l.className = 'line';
            s.appendChild(l);
        }
    });
    return s;
}

function updateLeaderboard(list, myRank) {
    const cont = document.getElementById('lb-list');
    cont.innerHTML = '';
    list.forEach((u, i) => {
        const row = document.createElement('div');
        row.className = `lb-row ${u.telegramId === currentUser.id ? 'me' : ''}`;
        row.innerHTML = `
            <div class="lb-rank">${i + 1}</div>
            <img src="${u.photo || 'https://via.placeholder.com/30'}" class="lb-img">
            <div class="lb-name">${u.name}</div>
            <div class="lb-elo">${u.elo} PTS</div>
        `;
        cont.appendChild(row);
    });

    const footer = document.getElementById('lb-footer');
    if (myRank > 10) {
        footer.innerHTML = `<div class="lb-row me"><div class="lb-rank">${myRank}</div><div class="lb-name">YOU</div><div class="lb-elo">${currentUser.elo} PTS</div></div>`;
    } else footer.innerHTML = '';
}

function requestLeaderboard() { socket.emit('get_leaderboard'); }
function toggleLeaderboard() {
    const lb = document.getElementById('leaderboard');
    lb.style.display = (lb.style.display === 'flex' ? 'none' : 'flex');
}
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
}
