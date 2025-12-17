/**
 * DOMINO ELITE - FINAL CLIENT (v4.6)
 * Profesyonel Mobil Deneyimi - Garantili Bağlantı
 */

const CONFIG = {
    SERVER: 'https://mario-io-1.onrender.com',
    TIER: 100
};

let socket, myId, myTurn = false, gameActive = false;
let myHand = [], board = { stones: [], left: null, right: null };
let currentUser = { id: 'guest_' + Math.floor(Math.random() * 9999), name: 'Oyuncu', photo: '', elo: 0, level: 1 };
let selectedIdx = -1;

// --- BAŞLATMA ---
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    setupSocket();
    initUIEvents();
});

function initTelegram() {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    if (tg.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        currentUser.id = u.id.toString();
        currentUser.name = u.first_name;
        currentUser.photo = u.photo_url || '';
        localStorage.setItem('domino_elite_uid', currentUser.id);
    } else {
        currentUser.id = localStorage.getItem('domino_elite_uid') || currentUser.id;
    }
}

function setupSocket() {
    updateStatusOverlay(true, "SUNUCUYA BAĞLANILIYOR...");

    // Socket.io initialization with robust settings
    socket = io(CONFIG.SERVER, {
        query: { id: currentUser.id, name: currentUser.name, photo: currentUser.photo },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        timeout: 10000
    });

    socket.on('connect', () => {
        updateStatusOverlay(false);
        showToast("BAĞLANILDI");
        socket.emit('check_rejoin');
        socket.emit('get_leaderboard');
    });

    socket.on('connect_error', (err) => {
        updateStatusOverlay(true, "BAĞLANTI HATASI! YENİDEN DENENİYOR...");
        console.error("Socket error:", err);
    });

    socket.on('profile_sync', data => {
        currentUser.elo = data.elo || 0;
        currentUser.level = Math.min(10, Math.floor(currentUser.elo / CONFIG.TIER) + 1);
        if (data.name) currentUser.name = data.name;
        if (data.photo) currentUser.photo = data.photo;

        syncProfileToUI();
        if (data.leaderboard) renderLeaderboard(data.leaderboard);
    });

    socket.on('mm_status', status => {
        if (status === 'searching') {
            updateStatusOverlay(true, "EŞLEŞME ARANIYOR...", true);
        } else {
            updateStatusOverlay(false);
        }
    });

    socket.on('game_start', data => {
        gameActive = true;
        myHand = data.hand;
        board = { stones: [], left: null, right: null };
        updateStatusOverlay(false);
        changeScreen('screen-game');
        document.getElementById('ui-opp').innerText = data.opponent.name;
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
        document.getElementById('ui-turn').style.display = myTurn ? 'block' : 'none';
    });

    socket.on('game_over', data => {
        gameActive = false;
        showResultModal(data);
    });

    socket.on('private_room_created', code => {
        updateStatusOverlay(false);
        document.getElementById('ov-code').style.display = 'flex';
        document.getElementById('ui-code').innerText = code;
    });

    socket.on('error_msg', msg => {
        updateStatusOverlay(false);
        showToast(msg);
    });
}

function initUIEvents() {
    document.getElementById('btn-ranked').onclick = () => socket.emit('join_mm');
    document.getElementById('btn-create').onclick = () => socket.emit('create_private');
    document.getElementById('btn-join').onclick = () => {
        const code = document.getElementById('input-code').value;
        if (code.length === 4) socket.emit('join_private', code);
        else showToast("GEÇERSİZ KOD");
    };
    document.getElementById('btn-abort').onclick = () => socket.emit('cancel_mm');
    document.getElementById('btn-exit').onclick = () => {
        if (confirm("Maçı terk etmek üzeresin. ELO kaybedeceksin!")) {
            socket.emit('quit_game');
        }
    };
}

// --- GÖRSEL VE OYUN MANTIĞI ---

function syncProfileToUI() {
    document.getElementById('ui-name').innerText = currentUser.name.toUpperCase();
    document.getElementById('ui-elo').innerText = currentUser.elo + " PTS";
    document.getElementById('ui-lvl').innerText = "Lv " + currentUser.level;
    document.getElementById('ui-avatar').src = currentUser.photo || 'https://via.placeholder.com/100';
}

function renderHand() {
    const cont = document.getElementById('ui-hand');
    cont.innerHTML = '';
    myHand.forEach((s, i) => {
        const el = makeStoneEl(s[0], s[1], false);
        if (selectedIdx === i) el.classList.add('selected');
        el.onclick = () => {
            if (!myTurn) return;
            selectedIdx = (selectedIdx === i ? -1 : i);
            renderHand();
            drawHints(selectedIdx === -1 ? null : s);
        };
        cont.appendChild(el);
    });
}

function drawHints(stone) {
    const layer = document.getElementById('hint-cont');
    layer.innerHTML = '';
    if (!stone) return;

    if (board.stones.length === 0) {
        placeHint(layer, 750, 750, 'any', stone);
        return;
    }

    const cont = document.getElementById('board-cont');
    if (stone[0] === board.left || stone[1] === board.left) {
        const f = cont.firstChild;
        placeHint(layer, f.offsetLeft - 70, f.offsetTop, 'left', stone);
    }
    if (stone[0] === board.right || stone[1] === board.right) {
        const l = cont.lastChild;
        const off = l.classList.contains('horiz') ? 100 : 50;
        placeHint(layer, l.offsetLeft + off, l.offsetTop, 'right', stone);
    }
}

function placeHint(layer, x, y, side, stone) {
    const h = document.createElement('div');
    h.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:50px; height:50px; border:3px dashed var(--secondary); border-radius:50%; z-index:200; pointer-events:auto; box-shadow:0 0 15px var(--secondary);`;
    h.onclick = () => {
        socket.emit('play_move', { stone, side });
        selectedIdx = -1;
        layer.innerHTML = '';
    };
    layer.appendChild(h);
}

function renderBoard() {
    const cont = document.getElementById('board-cont');
    cont.innerHTML = '';
    let currX = 750, currY = 700;

    board.stones.forEach(item => {
        const isD = item.v[0] === item.v[1];
        const el = makeStoneEl(item.v[0], item.v[1], !isD);
        el.style.left = currX + 'px';
        el.style.top = currY + 'px';
        cont.appendChild(el);
        currX += (isD ? 50 : 100);
    });
}

function makeStoneEl(v1, v2, horiz) {
    const s = document.createElement('div');
    s.className = `stone ${horiz ? 'horiz' : ''}`;
    [v1, v2].forEach((v, i) => {
        const h = document.createElement('div');
        h.className = 'half';
        const dots = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]][v - 1] || [];
        for (let j = 0; j < 9; j++) {
            const d = document.createElement('div');
            d.className = 'dot';
            if (dots.includes(j)) d.style.visibility = 'visible';
            h.appendChild(d);
        }
        s.appendChild(h);
        if (i === 0) { const l = document.createElement('div'); l.className = 'dv'; s.appendChild(l); }
    });
    return s;
}

function renderLeaderboard(list) {
    const cont = document.getElementById('lb-list');
    cont.innerHTML = '';
    list.forEach((u, i) => {
        const row = document.createElement('div');
        row.className = 'lb-row';
        row.innerHTML = `<span class="lb-rank">#${i + 1}</span> <span class="lb-name">${u.name}</span> <span class="lb-elo">${u.elo}</span>`;
        if (u.id === currentUser.id) row.style.color = 'var(--secondary)';
        cont.appendChild(row);
    });
}

function showResultModal(data) {
    const ov = document.getElementById('ov-res');
    const isWin = data.winnerId === currentUser.id;
    document.getElementById('res-msg').innerText = isWin ? "GALİBİYET" : "MAĞLUBİYET";
    document.getElementById('res-msg').style.color = isWin ? "var(--secondary)" : "var(--primary)";
    document.getElementById('res-pts').innerText = (isWin ? "+" : "-") + data.eloChange + " ELO";
    ov.style.display = 'flex';
    setTimeout(() => {
        ov.style.display = 'none';
        changeScreen('screen-lobby');
        socket.emit('get_leaderboard');
    }, 4500);
}

// --- YARDIMCI ---

function updateStatusOverlay(show, text = "", abortable = false) {
    document.getElementById('ov-txt').innerText = text;
    document.getElementById('btn-abort').style.display = abortable ? 'block' : 'none';
    document.getElementById('ov-status').style.display = show ? 'flex' : 'none';
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
}

function changeScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
