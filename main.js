// ============================================
// YARDIMCI SINIFLAR (DominoGame ve EloSystem yer tutucuları)
// BU KISIM GERÇEK UYGULAMANIZDA AYRI BİR DOSYADA OLMALIDIR!
// ============================================

/**
 * Bu, gerçek DominoGame mantığınızı temsil eden bir yer tutucudur.
 * Kodun çalışması için bu sınıfın tamamen implemente edilmiş olması gerekir.
 */
class DominoGame {
    constructor() {
        this.board = [];
        this.players = [];
        this.status = 'lobby'; // playing, game_over
        this.currentPlayerId = null;
        this.leftEnd = null;
        this.rightEnd = null;
        this.isRanked = false;
        this.turnCount = 0;
        this.scores = { me: 0, opponent: 0 }; // Skor takibi
    }

    initializeGame(playerNames, isRanked) {
        this.board = [];
        this.players = playerNames.map((name, index) => ({
            id: `player-${index}`,
            name: name,
            tiles: [{ id: index + 1, left: index, right: 6 - index }], // Demo tiles
            elo: 100 // Demo elo
        }));
        this.currentPlayerId = 'player-0';
        this.status = 'playing';
        this.isRanked = isRanked;
        this.turnCount = 0;
        this.leftEnd = null;
        this.rightEnd = null;
        this.scores = { me: 0, opponent: 0 };
    }

    getCurrentPlayer() {
        return this.players.find(p => p.id === this.currentPlayerId);
    }

    getPlayableTiles() {
        const player = this.getCurrentPlayer();
        if (!player) return [];

        if (this.board.length === 0) return player.tiles; // İlk taş

        return player.tiles.filter(tile =>
            tile.left === this.leftEnd || tile.right === this.leftEnd ||
            tile.left === this.rightEnd || tile.right === this.rightEnd
        );
    }

    getPlayablePositions(tile) {
        if (this.board.length === 0) return [{ side: 'left' }];

        const positions = [];
        // Sol uç
        if (tile.left === this.leftEnd || tile.right === this.leftEnd) {
            positions.push({ side: 'left', requiredValue: this.leftEnd });
        }
        // Sağ uç
        if (tile.left === this.rightEnd || tile.right === this.rightEnd) {
            positions.push({ side: 'right', requiredValue: this.rightEnd });
        }
        return positions;
    }

    placeTile(tileId, side) {
        const player = this.getCurrentPlayer();
        const tileIndex = player.tiles.findIndex(t => t.id === tileId);
        if (tileIndex === -1) return { success: false };

        const tile = player.tiles[tileIndex];
        const positions = this.getPlayablePositions(tile);
        const position = positions.find(p => p.side === side);

        if (!position) return { success: false };

        // Taşı çevir (flip) mantığı
        let flipped = false;
        if (this.board.length > 0) {
            if (side === 'left') {
                if (tile.right === this.leftEnd) {
                    // Bağlantı zaten doğru, çevirme yok
                } else if (tile.left === this.leftEnd) {
                    flipped = true; // Taşı çevir
                } else {
                    return { success: false }; // Hata
                }
            } else if (side === 'right') {
                if (tile.left === this.rightEnd) {
                    // Bağlantı zaten doğru, çevirme yok
                } else if (tile.right === this.rightEnd) {
                    flipped = true; // Taşı çevir
                } else {
                    return { success: false }; // Hata
                }
            }
        }

        // Taşı elden kaldır
        player.tiles.splice(tileIndex, 1);

        // Tahtaya ekle
        this.board[side === 'left' ? 'unshift' : 'push']({ ...tile, flipped });

        // Uçları güncelle
        const newEndValue = (flipped ? tile.left : tile.right);

        if (this.board.length === 1) {
            this.leftEnd = tile.left;
            this.rightEnd = tile.right;
        } else if (side === 'left') {
            this.leftEnd = flipped ? tile.right : tile.left;
        } else if (side === 'right') {
            this.rightEnd = flipped ? tile.left : tile.right;
        }

        this.passTurn(true); // Hamleyi yapınca tur geçer

        const gameOver = player.tiles.length === 0;
        return { success: true, gameOver, winner: gameOver ? player : null };
    }

    passTurn(played = false) {
        if (!played && this.getPlayableTiles().length > 0) {
            return { blocked: false }; // Pas geçme hakkı yok
        }

        const currentIndex = this.players.findIndex(p => p.id === this.currentPlayerId);
        const nextIndex = (currentIndex + 1) % this.players.length;
        this.currentPlayerId = this.players[nextIndex].id;
        this.turnCount++;

        // Oyun bloke oldu mu kontrol et (Sunucuda daha iyi kontrol edilir)
        if (this.turnCount > this.players.length * 2 && this.getPlayableTiles().length === 0) {
            // Basit bloke kuralı
            const winner = this.players.reduce((minPlayer, current) => {
                const minScore = minPlayer.tiles.reduce((sum, t) => sum + t.left + t.right, 0);
                const currentScore = current.tiles.reduce((sum, t) => sum + t.left + t.right, 0);
                return currentScore < minScore ? current : minPlayer;
            }, this.players[0]);

            return { blocked: true, gameOver: true, winner };
        }

        return { blocked: false };
    }

    // ELO hesaplaması, DominoGame veya EloSystem'de olabilir
    calculateEloChange(isWinner, isDraw, halfwayPassed) {
        // Basit demo ELO hesaplaması
        if (isDraw) return 0;
        return isWinner ? (halfwayPassed ? 25 : 15) : (halfwayPassed ? -25 : -15);
    }
}

/**
 * Bu, gerçek EloSystem mantığınızı temsil eden bir yer tutucudur.
 * Kodun çalışması için bu sınıfın tamamen implemente edilmiş olması gerekir.
 */
class EloSystem {
    getLevelFromElo(elo) {
        if (elo < 200) return 1;
        if (elo < 400) return 2;
        if (elo < 600) return 3;
        if (elo < 800) return 4;
        if (elo < 1000) return 5;
        if (elo < 1200) return 6;
        return 7;
    }

    getLevelClass(level) {
        if (level >= 6) return 'master';
        if (level >= 4) return 'pro';
        return 'rookie';
    }
}


// ============================================
// YAPILANDIRMA
// ============================================

// Render URL'in doğru olduğundan emin olun. Sonunda slash (/) olmamalı.
const SERVER_URL = 'https://beta-github-io-1.onrender.com';

// State (Durum)
let ws = null;
let connectionStatus = 'disconnected'; // disconnected, connecting, connected, error
let reconnectInterval = null;
let heartbeatInterval = null;
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
let turnTimerInterval = null; // Timer interval

// Kullanıcı istatistikleri (demo verisi - sunucudan gelmeli)
let userStats = {
    name: 'Oyuncu',
    level: 1,
    elo: 100,
    wins: 0,
    losses: 0,
    rank: 100
};

// Demo liderlik tablosu (UI testi için)
let leaderboard = [
    { rank: 1, name: 'ProGamer', level: 10, elo: 1250, wins: 150, losses: 30 },
    { rank: 2, name: 'DominoKing', level: 9, elo: 980, wins: 120, losses: 45 },
    { rank: 3, name: 'MasterPlay', level: 8, elo: 850, wins: 100, losses: 50 },
    { rank: 10, name: 'NewHero', level: 3, elo: 280, wins: 30, losses: 25 }
];

// ============================================
// WEBSOCKET BAĞLANTISI
// ============================================

function connectWebSocket() {
    // Eğer zaten bağlıysak veya bağlanıyorsak tekrar deneme
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('Zaten bağlantı açık veya bağlanılıyor.');
        return;
    }

    // Önceki denemeyi durdur
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }

    updateConnectionStatus('connecting');
    console.log(`Sunucuya bağlanılıyor: ${SERVER_URL}`);

    try {
        ws = new WebSocket(SERVER_URL);

        ws.onopen = () => {
            console.log('WebSocket bağlantısı başarılı!');
            updateConnectionStatus('connected');
            showToast('Sunucuya bağlandı!', 'success');
            startHeartbeat();
        };

        ws.onclose = (event) => {
            console.log(`Bağlantı kesildi. Kod: ${event.code}, Sebep: ${event.reason}`);

            if (event.code !== 1000) {
                updateConnectionStatus('disconnected');
                stopHeartbeat();

                if (!reconnectInterval) {
                    showToast('Bağlantı kesildi. Yeniden deneniyor...', 'error');
                    reconnectInterval = setInterval(() => {
                        console.log('Yeniden bağlanmaya çalışılıyor...');
                        connectWebSocket();
                    }, 5000);
                }
            } else {
                updateConnectionStatus('disconnected');
                stopHeartbeat();
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket hatası:', error);
            updateConnectionStatus('error');
            showToast('Bağlantı sırasında kritik hata oluştu.', 'error');
        };

        ws.onmessage = (event) => {
            try {
                if (event.data === 'pong') return;

                const message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (e) {
                console.error('Mesaj parse hatası:', e);
            }
        };

    } catch (e) {
        console.error('Bağlantı başlatma hatası:', e);
        updateConnectionStatus('error');
        showToast('Bağlantı başlatılamadı. Protokol/URL hatası olabilir.', 'error');
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({ type: 'PING' }));
            } catch (e) {
                console.log("Ping gönderilemedi, bağlantı koptu.");
            }
        }
    }, 30000);
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    } else {
        console.warn('Mesaj gönderilemedi, bağlantı yok:', type);
        showToast('Bağlantı yok, tekrar bağlanılıyor...', 'error');
        connectWebSocket();
    }
}

function handleServerMessage(message) {
    console.log('Server message:', message.type);

    switch (message.type) {
        case 'CONNECTION_SUCCESS':
            showToast('Sunucuya başarıyla bağlandı!', 'success');
            break;
        case 'matchFound': // Server sends camelCase
            stopSearching();
            startGame(message);
            break;
        case 'ROOM_CREATED':
            roomCode = message.payload.code;
            showRoomCode();
            break;
        case 'JOIN_SUCCESS':
            showToast('Odaya başarıyla katıldınız!', 'success');
            break;
        case 'JOIN_FAILED':
            showToast(`Odaya katılamadı: ${message.payload.reason}`, 'error');
            cancelJoin();
            break;
        case 'gameUpdate': // Server sends gameUpdate
            updateGameState(message.gameState);
            break;
        case 'PLAYER_JOINED':
            showToast(`${message.payload.name} odaya katıldı!`, 'info');
            break;
        case 'PLAYER_LEFT':
            handlePlayerLeft(message.payload);
            break;
        case 'roundEnd': // Round bittiğinde
            handleRoundEnd(message);
            break;
        case 'gameEnd': // Maç bittiğinde (3 win)
            handleGameOver(message);
            break;
        case 'PONG':
            break;
        default:
            console.warn('Bilinmeyen sunucu mesajı tipi:', message.type);
    }
}

// ============================================
// UI GÜNCELLEMELERİ
// ============================================

function updateConnectionStatus(status) {
    connectionStatus = status;
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (dot) dot.className = 'status-dot ' + status;

    const statusTexts = {
        disconnected: 'Bağlantı kesildi (Tekrar deneniyor...)',
        connecting: 'Sunucuya Bağlanıyor... (Render uyanması sürebilir)',
        connected: 'Çevrimiçi',
        error: 'Bağlantı Hatası'
    };

    if (text) text.textContent = statusTexts[status];
}

function updateUserStats() {
    const level = eloSystem.getLevelFromElo(userStats.elo);
    const levelClass = eloSystem.getLevelClass(level);

    const levelIcon = document.getElementById('level-icon');
    if (levelIcon) {
        levelIcon.className = 'level-icon ' + levelClass;
        levelIcon.textContent = level;
    }

    const levelText = document.getElementById('level-text');
    if (levelText) levelText.textContent = `Seviye ${level}`;

    const eloText = document.getElementById('elo-text');
    if (eloText) eloText.textContent = `${userStats.elo} ELO`;

    const userRank = document.getElementById('user-rank');
    if (userRank) userRank.textContent = userStats.rank;

    const wins = document.getElementById('wins');
    if (wins) wins.textContent = userStats.wins;

    const losses = document.getElementById('losses');
    if (losses) losses.textContent = userStats.losses;

    const myLevel = document.getElementById('my-level');
    if (myLevel) {
        myLevel.textContent = level;
        myLevel.className = 'level-icon ' + levelClass;
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

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
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Sunucu bağlantısı bekleniyor...', 'error');
        connectWebSocket();
        return;
    }

    isSearching = true;
    searchTime = 0;

    const container = document.getElementById('ranked-container');
    if (!container) return;

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
        const timeEl = document.getElementById('search-time');
        if (timeEl) timeEl.textContent = `${mins}:${secs}`;
    }, 1000);

    sendMessage('START_RANKED_SEARCH', { userId: userStats.name, elo: userStats.elo });
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
    if (!container) return;
    container.innerHTML = `
        <button class="game-btn ranked" id="ranked-btn">
            <div class="btn-icon">⚔️</div>
            <div class="btn-content">
                <div class="btn-title">DERECELİ</div>
                <div class="btn-desc">Çevrimiçi rakip bul ve ELO kazan</div>
            </div>
        </button>
    `;
    document.getElementById('ranked-btn').onclick = startSearching;
}

function createRoom() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Sunucu bağlantısı yok!', 'error');
        return;
    }
    sendMessage('CREATE_ROOM', {});
    showToast('Özel oda oluşturuluyor...', 'info');
}

function showRoomCode() {
    const container = document.getElementById('friend-container');
    if (!container) return;
    container.innerHTML = `
        <div class="room-code-display">
            <div class="room-code-label">Oda Kodu:</div>
            <div class="room-code">${roomCode}</div>
            <button class="copy-btn" id="copy-btn">📋 Kopyala</button>
            <div class="room-code-hint">Arkadaşınla bu kodu paylaş</div>
            <button class="cancel-btn" id="cancel-room-btn" style="margin-top: 15px">İptal</button>
        </div>
    `;
    document.getElementById('cancel-room-btn').onclick = cancelRoom;
    document.getElementById('copy-btn').onclick = copyRoomCode;
}

function copyRoomCode() {
    navigator.clipboard.writeText(roomCode);
    showToast('Oda kodu kopyalandı!', 'success');
}

function cancelRoom() {
    const codeToLeave = roomCode; // Bağlantı kesilmeden önce kodu kaydet
    roomCode = null;
    resetFriendButton();
    sendMessage('LEAVE_ROOM', { code: codeToLeave });
    showToast('Oda iptal edildi.', 'info');
}

function resetFriendButton() {
    const container = document.getElementById('friend-container');
    if (!container) return;
    container.innerHTML = `
        <button class="game-btn friend" id="friend-btn">
            <div class="btn-icon">👥</div>
            <div class="btn-content">
                <div class="btn-title">ARKADAŞLA OYNA</div>
                <div class="btn-desc">Özel oda oluştur ve arkadaşını davet et</div>
            </div>
        </button>
    `;
    document.getElementById('friend-btn').onclick = createRoom;
}

function showJoinInput() {
    const container = document.getElementById('join-container');
    if (!container) return;
    container.innerHTML = `
        <div class="join-room-panel">
            <input type="text" class="join-input" id="join-code-input" 
                   placeholder="XXXX" maxlength="4" 
                   oninput="this.value = this.value.toUpperCase()">
            <div class="join-btns">
                <button class="join-cancel-btn" id="join-cancel-btn">İptal</button>
                <button class="join-confirm-btn" id="join-confirm-btn">Bağlan</button>
            </div>
        </div>
    `;
    document.getElementById('join-cancel-btn').onclick = cancelJoin;
    document.getElementById('join-confirm-btn').onclick = joinRoom;

    const input = document.getElementById('join-code-input');
    if (input) input.focus();
}

function cancelJoin() {
    const container = document.getElementById('join-container');
    if (!container) return;
    container.innerHTML = `
        <button class="game-btn join" id="join-btn">
            <div class="btn-icon">🔑</div>
            <div class="btn-content">
                <div class="btn-title">ODAYA KATIL</div>
                <div class="btn-desc">Oda kodu ile arkadaşına katıl</div>
            </div>
        </button>
    `;
    document.getElementById('join-btn').onclick = showJoinInput;
}

function joinRoom() {
    const codeInput = document.getElementById('join-code-input');
    const code = codeInput ? codeInput.value : '';

    if (code.length !== 4) {
        showToast('Lütfen 4 haneli oda kodunu girin!', 'error');
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Sunucu bağlantısı bekleniyor...', 'error');
        connectWebSocket();
        return;
    }

    sendMessage('JOIN_ROOM', { code: code });
    showToast('Odaya bağlanılıyor...', 'info');
}

function openLeaderboard() {
    const modal = document.getElementById('leaderboard-modal');
    const body = document.getElementById('leaderboard-body');
    if (!modal || !body) return;

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
    const modal = document.getElementById('leaderboard-modal');
    if (modal) modal.classList.remove('active');
}

// ============================================
// GAME FUNCTIONS
// ============================================

function startGame(message) {
    const opponent = message.opponent || { name: 'Rakip' };
    const playerNames = [userStats.name, opponent.name];

    game.initializeGame(playerNames, message.gameType === 'ranked');
    // myPlayerId sunucudan session mesajı ile veya gameUpdate ile gelir, burada varsayalım:
    // Not: Server 'session' mesajı atıyor, onu handle etmeliyiz ama şimdilik gameUpdate halledecek.
    currentScreen = 'game';

    const lobbyScreen = document.getElementById('lobby-screen');
    const gameScreen = document.getElementById('game-screen');
    if (lobbyScreen) lobbyScreen.style.display = 'none';
    if (gameScreen) gameScreen.style.display = 'flex';

    renderGame();
    showToast('Maç başladı!', 'success');
}

function updateGameState(serverState) {
    // console.log("Sunucudan oyun güncellemesi geldi", serverState);

    if (serverState.playerId) {
        myPlayerId = serverState.playerId;
    }

    // Board mapping: Server sends [[1,2], [2,3]]. Client needs objects.
    if (serverState.board) {
        game.board = serverState.board.map(t => ({ left: t[0], right: t[1], flipped: false })); // Basit mapping
        // Uçları güncelle
        if (game.board.length > 0) {
            game.leftEnd = game.board[0].left;
            game.rightEnd = game.board[game.board.length - 1].right;
        } else {
            game.leftEnd = null;
            game.rightEnd = null;
        }
    }

    // Players mapping
    if (serverState.players) {
        // Server sends object { id: { hand: [], name: ... } }
        // Client expects array. We need to map this carefully.
        const playerIds = Object.keys(serverState.players);
        game.players = playerIds.map(pid => {
            const pData = serverState.players[pid];
            return {
                id: pid,
                name: pData.name,
                tiles: pData.hand.map((t, i) => ({ id: `${pid}-${i}`, left: t[0], right: t[1] })),
                elo: pData.elo
            };
        });
    }

    if (serverState.currentPlayer) game.currentPlayerId = serverState.currentPlayer;

    // Skor güncelleme
    if (serverState.score) {
        const myScore = serverState.score[myPlayerId] || 0;
        const opponentId = Object.keys(serverState.score).find(id => id !== myPlayerId);
        const opponentScore = opponentId ? (serverState.score[opponentId] || 0) : 0;
        game.scores = { me: myScore, opponent: opponentScore };
        updateScoreboard();
    }

    // Timer güncelleme
    if (serverState.turnStartTime) {
        startTurnTimer(serverState.turnStartTime);
    }

    renderGame();

    if (game.getCurrentPlayer().id === myPlayerId) {
        showToast('Sıra sende!', 'info');
    }
}

function renderGame() {
    renderOpponentArea();
    renderBoard();
    renderPlayerHand();
    updateTurnIndicator();
    updateBoardEnds();

    // Timer ve Skorboard elementlerini ekle (eğer yoksa)
    let timerEl = document.getElementById('turn-timer');
    if (!timerEl) {
        const container = document.getElementById('game-screen');
        timerEl = document.createElement('div');
        timerEl.id = 'turn-timer';
        timerEl.style.cssText = "position: absolute; top: 80px; left: 50%; transform: translateX(-50%); font-size: 24px; font-weight: bold; color: white; background: rgba(0,0,0,0.5); padding: 5px 15px; border-radius: 10px;";
        container.appendChild(timerEl);
    }

    let scoreEl = document.getElementById('game-scoreboard');
    if (!scoreEl) {
        const container = document.getElementById('game-screen');
        scoreEl = document.createElement('div');
        scoreEl.id = 'game-scoreboard';
        scoreEl.style.cssText = "position: absolute; top: 20px; left: 50%; transform: translateX(-50%); font-size: 20px; font-weight: bold; color: #ffd700; background: rgba(0,0,0,0.7); padding: 8px 20px; border-radius: 15px; border: 1px solid #ffd700; z-index: 100;";
        container.appendChild(scoreEl);
        updateScoreboard();
    }
}

function updateScoreboard() {
    const scoreEl = document.getElementById('game-scoreboard');
    if (scoreEl) {
        // Skorları göster (Ben - Rakip)
        // Eğer oyun 3'te bitiyorsa
        scoreEl.innerHTML = `
            <span style="color: #4CAF50">Siz: ${game.scores.me}</span> - <span style="color: #FF5252">Rakip: ${game.scores.opponent}</span>
        `;
    }
}

function renderOpponentArea() {
    const opponent = game.players.find(p => p.id !== myPlayerId);
    if (!opponent) return;

    const nameEl = document.getElementById('opponent-name');
    if (nameEl) nameEl.textContent = opponent.name;

    const container = document.getElementById('opponent-tiles');
    if (!container) return;
    container.innerHTML = '';

    // Rakibin elindeki taş sayısı kadar kapalı taş göster
    const tileCount = opponent.tiles.length || 7; // Varsayım: Başlangıçta 7 taş
    for (let i = 0; i < tileCount; i++) {
        const tile = document.createElement('div');
        tile.className = 'hidden-tile';
        container.appendChild(tile);
    }

    const level = eloSystem.getLevelFromElo(opponent.elo || 100);
    const levelEl = document.getElementById('opponent-level');
    if (levelEl) {
        levelEl.textContent = level;
        levelEl.className = 'level-icon ' + eloSystem.getLevelClass(level);
    }
}

function renderBoard() {
    const container = document.getElementById('board-tiles');
    if (!container) return;
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
    if (!container) return;
    container.innerHTML = '';

    const isMyTurn = game.getCurrentPlayer().id === myPlayerId;
    const playableTiles = isMyTurn ? game.getPlayableTiles() : [];

    player.tiles.forEach(tile => {
        const isPlayable = playableTiles.some(t => t.id === tile.id);
        const isSelected = selectedTile && selectedTile.id === tile.id;
        const tileEl = createTileElement(tile, false, isPlayable, isSelected);

        if (isMyTurn) {
            tileEl.onclick = () => selectTile(tile);
        }

        container.appendChild(tileEl);
    });

    const passBtn = document.getElementById('pass-btn');
    if (passBtn) passBtn.disabled = !isMyTurn || playableTiles.length > 0;

    const positionsEl = document.getElementById('play-positions');
    if (positionsEl) {
        if (selectedTile && playablePositions.length > 0) {
            positionsEl.classList.remove('hidden');

            const leftBtn = document.getElementById('play-left-btn');
            const rightBtn = document.getElementById('play-right-btn');
            const canPlayLeft = playablePositions.some(p => p.side === 'left');
            const canPlayRight = playablePositions.some(p => p.side === 'right');

            if (leftBtn) leftBtn.style.display = canPlayLeft ? 'block' : 'none';
            if (rightBtn) rightBtn.style.display = canPlayRight ? 'block' : 'none';
        } else {
            positionsEl.classList.add('hidden');
        }
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

    // Aynı taşı tekrar seçerse iptal et
    if (selectedTile && selectedTile.id === tile.id) {
        selectedTile = null;
        playablePositions = [];
        renderPlayerHand();
        updateBoardEnds(); // Uç işaretlemesini kaldır
        return;
    }

    const positions = game.getPlayablePositions(tile);
    if (positions.length === 0) return;

    selectedTile = tile;
    playablePositions = positions;

    // Tek pozisyon varsa hemen oyna (veya tahta boşsa)
    if (positions.length === 1 || game.board.length === 0) {
        playTile(positions[0].side);
        return;
    }

    renderPlayerHand();
    updateBoardEnds(); // Uç işaretlemesini güncelle
}

function playTile(side) {
    if (!selectedTile) return;
    if (game.getCurrentPlayer().id !== myPlayerId) return;

    // İyimser UI için yerel hamle yap
    const result = game.placeTile(selectedTile.id, side);

    if (result.success) {
        // Sunucuya hamleyi bildir
        sendMessage('PLACE_TILE', {
            tileId: selectedTile.id,
            side: side,
            flipped: result.flipped // Sunucu için gerekli olabilir
        });

        if (result.gameOver) {
            handleGameOver({ winner: result.winner, isRanked: game.isRanked });
        }
    } else {
        showToast('Geçersiz hamle!', 'error');
    }

    selectedTile = null;
    playablePositions = [];
    renderGame();
}

function passTurn() {
    if (game.getCurrentPlayer().id !== myPlayerId) return;
    if (game.getPlayableTiles().length > 0) {
        showToast('Elinde oynanabilir taş var. Pas geçemezsin!', 'error');
        return;
    }

    // İyimser UI için yerel pas geç
    const result = game.passTurn();
    sendMessage('PASS_TURN', {});

    if (result.blocked) {
        handleGameOver({ winner: result.winner, isRanked: game.isRanked });
    }

    renderGame();
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    if (!indicator) return;
    const isMyTurn = game.getCurrentPlayer().id === myPlayerId;

    indicator.textContent = isMyTurn ? 'Senin Sıran' : 'Rakibin Sırası';
    indicator.className = 'turn-indicator' + (isMyTurn ? ' my-turn' : ' opponent');
}

function updateBoardEnds() {
    const leftEl = document.getElementById('left-end');
    const rightEl = document.getElementById('right-end');
    if (!leftEl || !rightEl) return;

    if (game.board.length === 0) {
        leftEl.textContent = 'Sol: -';
        rightEl.textContent = 'Sağ: -';
        leftEl.className = 'board-end';
        rightEl.className = 'board-end';
        return;
    }

    leftEl.textContent = `Sol: ${game.leftEnd}`;
    rightEl.textContent = `Sağ: ${game.rightEnd}`;

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

function startTurnTimer(startTime) {
    if (turnTimerInterval) clearInterval(turnTimerInterval);

    const timerEl = document.getElementById('turn-timer');
    if (!timerEl) return;

    const updateTimer = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 30000 - elapsed); // 30 saniye süre
        const secs = Math.ceil(remaining / 1000);

        timerEl.textContent = secs;
        timerEl.style.color = secs <= 10 ? '#ff4444' : 'white';

        if (remaining <= 0) clearInterval(turnTimerInterval);
    };

    updateTimer();
    turnTimerInterval = setInterval(updateTimer, 1000);
}

function handleGameOver(payload) {
    const winnerId = payload.winner;
    const isWinner = winnerId === myPlayerId;
    // const eloChange = ... (Sunucudan gelmeli, payload.eloChanges)

    // İstatistikleri güncelle (Sunucuya bu sonucu bildirmelisiniz)
    if (game.isRanked) {
        userStats.elo += eloChange;
        if (isWinner) {
            userStats.wins++;
        } else {
            userStats.losses++;
        }
        userStats.level = eloSystem.getLevelFromElo(userStats.elo);
    }
    updateUserStats(); // Lobi istatistiklerini güncelle

    // Sonuç modalını göster
    const modal = document.getElementById('result-modal');
    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const elo = document.getElementById('result-elo');
    if (!modal || !icon || !title || !elo) return;

    if (isWinner) {
        icon.textContent = '🏆';
        title.textContent = 'KAZANDIN!';
        title.className = 'result-title win';
        if (payload.eloChanges) {
            elo.textContent = `+${payload.eloChanges.winner} ELO`;
            elo.className = 'result-elo positive';
        } else {
            elo.textContent = '';
        }
    } else {
        icon.textContent = '😔';
        title.textContent = 'KAYBETTİN';
        title.className = 'result-title lose';
        if (payload.eloChanges) {
            elo.textContent = `${payload.eloChanges.loser} ELO`;
            elo.className = 'result-elo negative';
        } else {
            elo.textContent = '';
        }
    }

    modal.classList.add('active');
}

function handleRoundEnd(payload) {
    const winnerId = payload.winnerId;
    const isWinner = winnerId === myPlayerId;
    const msg = isWinner ? "Bu eli KAZANDINIZ!" : "Bu eli KAYBETTİNİZ!";
    showToast(`${msg} Yeni el başlıyor...`, isWinner ? 'success' : 'info');
    // Skor zaten updateGameState ile güncellenecek
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
    const modal = document.getElementById('result-modal');
    if (modal) modal.classList.remove('active');

    const gameScreen = document.getElementById('game-screen');
    const lobbyScreen = document.getElementById('lobby-screen');

    if (gameScreen) gameScreen.style.display = 'none';
    if (lobbyScreen) lobbyScreen.style.display = 'flex';

    currentScreen = 'lobby';
    roomCode = null;
    selectedTile = null;
    playablePositions = [];

    resetRankedButton();
    resetFriendButton();
    cancelJoin();
    updateUserStats();

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
    }
}

// ============================================
// BAŞLANGIÇ VE EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // WebSocket'e bağlan
    connectWebSocket();

    // İstatistik ekranını güncelle
    updateUserStats();

    // Lobi düğmelerini bağla
    const rankedBtn = document.getElementById('ranked-btn');
    if (rankedBtn) rankedBtn.onclick = startSearching;

    const friendBtn = document.getElementById('friend-btn');
    if (friendBtn) friendBtn.onclick = createRoom;

    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) joinBtn.onclick = showJoinInput;

    const leaderboardBtn = document.getElementById('leaderboard-btn');
    if (leaderboardBtn) leaderboardBtn.onclick = openLeaderboard;

    // Oyun düğmeleri
    const leaveBtn = document.getElementById('leave-btn');
    if (leaveBtn) leaveBtn.onclick = leaveGame;

    const passBtn = document.getElementById('pass-btn');
    if (passBtn) passBtn.onclick = passTurn;

    const playLeftBtn = document.getElementById('play-left-btn');
    if (playLeftBtn) playLeftBtn.onclick = () => playTile('left');

    const playRightBtn = document.getElementById('play-right-btn');
    if (playRightBtn) playRightBtn.onclick = () => playTile('right');

    // Modal düğmeleri
    const closeLeaderboard = document.getElementById('close-leaderboard');
    if (closeLeaderboard) closeLeaderboard.onclick = closeLeaderboard;

    const resultBtn = document.getElementById('result-btn');
    if (resultBtn) resultBtn.onclick = backToLobby;

    // Modalleri kapatma
    const leaderboardModal = document.getElementById('leaderboard-modal');
    if (leaderboardModal) leaderboardModal.onclick = (e) => {
        if (e.target.id === 'leaderboard-modal') closeLeaderboard();
    };

    // Klavye kısayolları
    document.addEventListener('keydown', (e) => {
        if (currentScreen === 'game' && e.key === 'Escape') {
            selectedTile = null;
            playablePositions = [];
            renderPlayerHand();
        }
    });
});
