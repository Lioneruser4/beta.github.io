// Domino Online Game Client
class DominoGame {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.gameState = null;
        this.selectedTile = null;
        this.isMyTurn = false;
        this.searchStartTime = null;
        this.searchTimer = null;

        this.serverUrl = 'https://mario-io-1.onrender.com';

        this.init();
    }

    init() {
        this.connectSocket();
        this.setupStaticLobbyButtons();
        this.checkTelegramAuth();
    }

    connectSocket() {
        // global io Socket.io CDN'den geliyor
        this.socket = io(this.serverUrl, {
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            this.updateConnectionStatus('connected', 'Bağlandı');
            this.authenticateUser();
        });

        this.socket.on('disconnect', () => {
            this.updateConnectionStatus('disconnected', 'Bağlantı kesildi');
        });

        this.socket.on('connect_error', () => {
            this.updateConnectionStatus('error', 'Bağlantı hatası');
        });

        // Auth
        this.socket.on('user_authenticated', (data) => {
            this.currentUser = data.user;
            this.updateUserStats();
            this.showToast('Giriş başarılı', 'success');
        });

        // Matchmaking & rooms
        this.socket.on('match_found', (data) => {
            this.stopSearching(false); // oyunu başlatırken lobiye dönme
            this.startGame(data.game, data.opponent, true);
        });

        this.socket.on('room_created', (data) => {
            this.showRoomCode(data.roomCode);
        });

        this.socket.on('room_joined', (data) => {
            this.startGame(data.game, data.opponent, false);
        });

        // Game
        this.socket.on('game_update', (gameState) => {
            this.updateGameState(gameState);
        });

        this.socket.on('game_over', (result) => {
            this.showGameResult(result);
        });

        this.socket.on('game_error', (err) => {
            this.showToast(err.message || 'Oyun hatası', 'error');
        });

        this.socket.on('opponent_disconnected', () => {
            this.showToast('Rakip oyundan ayrıldı', 'error');
            this.returnToLobby();
        });

        // Leaderboard
        this.socket.on('leaderboard', (data) => {
            this.updateLeaderboard(data);
        });
    }

    setupStaticLobbyButtons() {
        const rankedBtn = document.getElementById('ranked-btn');
        const friendBtn = document.getElementById('friend-btn');
        const joinBtn = document.getElementById('join-btn');
        const leaderboardBtn = document.getElementById('leaderboard-btn');
        const inviteConnectBtn = document.getElementById('invite-connect-btn');

        if (rankedBtn) rankedBtn.addEventListener('click', () => this.startRankedMatch());
        if (friendBtn) friendBtn.addEventListener('click', () => this.createFriendRoom());
        if (joinBtn) joinBtn.addEventListener('click', () => this.showJoinRoom());
        if (leaderboardBtn) leaderboardBtn.addEventListener('click', () => this.showLeaderboard());
        if (inviteConnectBtn) inviteConnectBtn.addEventListener('click', () => {
            const code = (document.getElementById('invite-code')?.value || '').trim().toUpperCase();
            if (!code) {
                this.showToast('Mesaj kodu gir', 'error');
                return;
            }
            this.socket.emit('join_room', { roomCode: code });
        });

        const closeLeaderboard = document.getElementById('close-leaderboard');
        if (closeLeaderboard) closeLeaderboard.addEventListener('click', () => this.hideLeaderboard());

        // Oyun içi butonlar
        const leaveBtn = document.getElementById('leave-btn');
        const passBtn = document.getElementById('pass-btn');
        const playLeftBtn = document.getElementById('play-left-btn');
        const playRightBtn = document.getElementById('play-right-btn');
        const resultBtn = document.getElementById('result-btn');

        if (leaveBtn) leaveBtn.addEventListener('click', () => this.leaveGame());
        if (passBtn) passBtn.addEventListener('click', () => this.passTurn());
        if (playLeftBtn) playLeftBtn.addEventListener('click', () => this.playTile('left'));
        if (playRightBtn) playRightBtn.addEventListener('click', () => this.playTile('right'));
        if (resultBtn) resultBtn.addEventListener('click', () => this.returnToLobby());
    }

    // TELEGRAM AUTH
    checkTelegramAuth() {
        // Telegram WebApp içinden açıldıysa otomatik kullanıcı bilgisi
        try {
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
                const u = window.Telegram.WebApp.initDataUnsafe.user;
                if (u && u.id) {
                    localStorage.setItem('telegram_id', u.id.toString());
                    localStorage.setItem('first_name', u.first_name || 'Oyuncu');
                    localStorage.setItem('username', u.username || `user_${u.id}`);
                    if (u.photo_url) {
                        localStorage.setItem('photo_url', u.photo_url);
                    }
                    return;
                }
            }
        } catch (e) {
            // sessiz geç
        }

        // URL parametre fallback
        const urlParams = new URLSearchParams(window.location.search);
        const telegramId = urlParams.get('telegram_id');
        const firstName = urlParams.get('first_name');
        const username = urlParams.get('username');
        const photoUrl = urlParams.get('photo_url');

        if (telegramId) {
            localStorage.setItem('telegram_id', telegramId);
            localStorage.setItem('first_name', firstName || 'Oyuncu');
            localStorage.setItem('username', username || `user_${telegramId}`);
            if (photoUrl) localStorage.setItem('photo_url', photoUrl);

            // querystring temizle
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    authenticateUser() {
        const telegramId = localStorage.getItem('telegram_id');
        const firstName = localStorage.getItem('first_name');
        const username = localStorage.getItem('username');
        const photoUrl = localStorage.getItem('photo_url');

        if (telegramId) {
            this.socket.emit('authenticate', {
                telegramId,
                firstName,
                username,
                photoUrl,
                isGuest: false
            });
        } else {
            // Telegram yoksa sunucuya guest auth gönder
            this.socket.emit('authenticate', {
                telegramId: null,
                firstName: 'Guest',
                username: 'guest',
                photoUrl: '',
                isGuest: true
            });
        }
    }

    showTelegramLogin() {
        // Buraya kendi bot kullanıcı adını gir
        const botUsername = 'your_bot_username';
        const container = document.getElementById('user-stats');
        if (!container) return;

        container.innerHTML = `
            <div style="text-align:center; padding:20px;">
                <h3 style="margin-bottom:12px;">Telegram ile giriş yap</h3>
                <a href="https://t.me/${botUsername}" target="_blank" style="color:#24ff99; text-decoration:none;">
                    Telegram Botunu Aç
                </a>
                <p style="margin-top:8px; font-size:12px; opacity:0.8;">
                    Bot üzerinden giriş yaptıktan sonra tekrar bu sayfaya yönlendirilirsin.
                </p>
            </div>
        `;
    }

    // UI HELPERS
    updateConnectionStatus(status, text) {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        if (!statusDot || !statusText) return;

        statusDot.className = `status-dot ${status}`;
        statusText.textContent = text;
    }

    updateUserStats() {
        if (!this.currentUser) return;

        const level = this.calculateLevel(this.currentUser.elo || 0);
        const levelIcon = document.getElementById('level-icon');
        const levelText = document.getElementById('level-text');
        const eloText = document.getElementById('elo-text');
        const userRank = document.getElementById('user-rank');
        const wins = document.getElementById('wins');
        const losses = document.getElementById('losses');

        if (levelIcon) {
            levelIcon.textContent = level;
            levelIcon.className = 'level-icon';
            if (level <= 3) levelIcon.classList.add('level-low');
            else if (level <= 6) levelIcon.classList.add('level-mid');
            else if (level <= 10) levelIcon.classList.add('level-high');
            if (level >= 7) levelIcon.classList.add('level-premium');
        }
        if (levelText) levelText.textContent = `Seviye ${level}`;
        if (eloText) eloText.textContent = `${this.currentUser.elo || 0} ELO`;
        if (userRank && this.currentUser.rank) userRank.textContent = this.currentUser.rank;
        if (wins) wins.textContent = this.currentUser.wins || 0;
        if (losses) losses.textContent = this.currentUser.losses || 0;
    }

    calculateLevel(elo) {
        // 100 puanda 1 level; max 10
        return Math.min(10, Math.floor((elo || 0) / 100) + 1);
    }

    // MATCHMAKING & ROOMS
    startRankedMatch() {
        if (!this.currentUser || this.currentUser.isGuest) {
            this.showToast('Dereceli oynamak için Telegram ile giriş yap', 'error');
            return;
        }

        this.showSearchingState();
        this.searchStartTime = Date.now();
        this.socket.emit('find_ranked_match');

        this.searchTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.searchStartTime) / 1000);
            const searchTimeEl = document.querySelector('.search-time');
            if (searchTimeEl) searchTimeEl.textContent = `Aranıyor... ${elapsed}s`;
        }, 1000);
    }

    showSearchingState() {
        const container = document.querySelector('.btn-group');
        if (!container) return;

        container.innerHTML = `
            <div class="searching-state">
                <div class="spinner"></div>
                <div class="searching-text">Dereceli rakip aranıyor...</div>
                <div class="search-time">Aranıyor... 0s</div>
                <button class="cancel-btn" id="cancel-search">Eşleşmeyi iptal et</button>
            </div>
        `;

        document.getElementById('cancel-search')
            ?.addEventListener('click', () => this.stopSearching(true));
    }

    stopSearching(backToLobby) {
        if (this.searchTimer) {
            clearInterval(this.searchTimer);
            this.searchTimer = null;
        }
        this.socket.emit('cancel_search');
        if (backToLobby) this.restoreLobbyButtons();
    }

    createFriendRoom() {
        if (!this.currentUser) {
            this.showToast('Önce Telegram ile giriş yap', 'error');
            return;
        }
        this.socket.emit('create_friend_room');
    }

    showRoomCode(roomCode) {
        const container = document.querySelector('.btn-group');
        if (!container) return;

        container.innerHTML = `
            <div class="room-code-display">
                <div>Oda kodun:</div>
                <div class="room-code">${roomCode}</div>
                <button class="copy-btn" id="copy-code">Kopyala</button>
                <div class="room-code-hint">Bu kodu Telegram üzerinden arkadaşına gönder.</div>
                <button class="cancel-btn" id="cancel-room">İptal</button>
            </div>
        `;

        document.getElementById('copy-code')?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(roomCode);
                this.showToast('Kod kopyalandı', 'success');
            } catch {
                this.showToast('Kopyalama başarısız', 'error');
            }
        });

        document.getElementById('cancel-room')?.addEventListener('click', () => {
            this.socket.emit('leave_room');
            this.restoreLobbyButtons();
        });
    }

    showJoinRoom() {
        const container = document.querySelector('.btn-group');
        if (!container) return;

        container.innerHTML = `
            <div class="join-room-panel">
                <input type="text" class="join-input" id="room-code-input" placeholder="ODA" maxlength="4" />
                <div class="join-btns">
                    <button class="join-cancel-btn" id="cancel-join">İptal</button>
                    <button class="join-confirm-btn" id="confirm-join">Katıl</button>
                </div>
            </div>
        `;

        document.getElementById('cancel-join')
            ?.addEventListener('click', () => this.restoreLobbyButtons());

        document.getElementById('confirm-join')
            ?.addEventListener('click', () => {
                const code = document.getElementById('room-code-input').value.trim().toUpperCase();
                if (code.length !== 4) {
                    this.showToast('4 haneli geçerli kod gir', 'error');
                    return;
                }
                this.socket.emit('join_room', { roomCode: code });
            });
    }

    restoreLobbyButtons() {
        const container = document.querySelector('.btn-group');
        if (!container) return;

        container.innerHTML = `
            <div id="ranked-container">
                <button class="game-btn ranked" id="ranked-btn">
                    <div class="btn-icon">⚔️</div>
                    <div class="btn-content">
                        <div class="btn-title">DERECELİ</div>
                        <div class="btn-desc">Çevrim içi rakip bul, ELO kazan</div>
                    </div>
                </button>
            </div>
            <div id="friend-container">
                <button class="game-btn friend" id="friend-btn">
                    <div class="btn-icon">👥</div>
                    <div class="btn-content">
                        <div class="btn-title">ARKADAŞLA OYNA</div>
                        <div class="btn-desc">Özel oda kur, kodu arkadaşına gönder</div>
                    </div>
                </button>
            </div>
            <div id="join-container">
                <button class="game-btn join" id="join-btn">
                    <div class="btn-icon">🔑</div>
                    <div class="btn-content">
                        <div class="btn-title">ODAYA KATIL</div>
                        <div class="btn-desc">Oda kodu ile özel lobiye gir</div>
                    </div>
                </button>
            </div>
        `;

        // butonlara yeniden event bağla
        this.setupStaticLobbyButtons();
    }

    // GAME FLOW
    startGame(gameState, opponent, isRanked) {
        this.gameState = gameState;
        this.isMyTurn = gameState.currentPlayer === this.socket.id;

        const lobby = document.getElementById('lobby-screen');
        const game = document.getElementById('game-screen');
        if (lobby) lobby.style.display = 'none';
        if (game) game.style.display = 'block';

        // rakip bilgisi
        if (opponent) {
            const oppName = document.getElementById('opponent-name');
            const oppLevelEl = document.getElementById('opponent-level');
            const oppEloEl = document.getElementById('opponent-elo');
            const oppAvatarEl = document.getElementById('opponent-avatar');
            const oppLevel = this.calculateLevel(opponent.elo || 0);

            if (oppName) oppName.textContent = opponent.firstName || opponent.username || 'Rakip';
            if (oppLevelEl) {
                oppLevelEl.textContent = oppLevel;
                oppLevelEl.className = 'level-icon';
                if (oppLevel <= 3) oppLevelEl.classList.add('level-low');
                else if (oppLevel <= 6) oppLevelEl.classList.add('level-mid');
                else oppLevelEl.classList.add('level-high');
                if (oppLevel >= 7) oppLevelEl.classList.add('level-premium');
            }
            if (oppEloEl) oppEloEl.textContent = `${opponent.elo || 0} ELO`;
            if (oppAvatarEl && opponent.photoUrl) {
                oppAvatarEl.style.backgroundImage = `url(${opponent.photoUrl})`;
            }
        }

        // kendi level/elo oyun ekranı
        if (this.currentUser) {
            const myLevel = this.calculateLevel(this.currentUser.elo || 0);
            const myLevelEl = document.getElementById('my-level');
            const myEloEl = document.getElementById('player-elo');
            const myAvatarEl = document.getElementById('my-avatar');
            if (myLevelEl) {
                myLevelEl.textContent = myLevel;
                myLevelEl.className = 'level-icon';
                if (myLevel <= 3) myLevelEl.classList.add('level-low');
                else if (myLevel <= 6) myLevelEl.classList.add('level-mid');
                else myLevelEl.classList.add('level-high');
                if (myLevel >= 7) myLevelEl.classList.add('level-premium');
            }
            if (myEloEl) myEloEl.textContent = `${this.currentUser.elo || 0} ELO`;
            if (myAvatarEl && this.currentUser.photoUrl) {
                myAvatarEl.style.backgroundImage = `url(${this.currentUser.photoUrl})`;
            }
        }

        this.updateGameBoard();
        this.updateTurnIndicator();
    }

    updateGameState(gameState) {
        this.gameState = gameState;
        this.isMyTurn = gameState.currentPlayer === this.socket.id;
        this.updateGameBoard();
        this.updateTurnIndicator();
    }

    updateGameBoard() {
        if (!this.gameState) return;

        // board taşları
        const boardTiles = document.getElementById('board-tiles');
        if (boardTiles) {
            boardTiles.innerHTML = '';
            this.gameState.board.forEach(tile => {
                boardTiles.appendChild(this.createDominoTile(tile, true));
            });
        }

        // uçlar
        const leftEnd = document.getElementById('left-end');
        const rightEnd = document.getElementById('right-end');
        if (leftEnd) {
            if (this.gameState.leftEnd !== null && this.gameState.leftEnd !== undefined) {
                leftEnd.textContent = `Sol: ${this.gameState.leftEnd}`;
                leftEnd.classList.add('playable');
            } else {
                leftEnd.textContent = 'Sol: -';
                leftEnd.classList.remove('playable');
            }
        }
        if (rightEnd) {
            if (this.gameState.rightEnd !== null && this.gameState.rightEnd !== undefined) {
                rightEnd.textContent = `Sağ: ${this.gameState.rightEnd}`;
                rightEnd.classList.add('playable');
            } else {
                rightEnd.textContent = 'Sağ: -';
                rightEnd.classList.remove('playable');
            }
        }

        // rakip taş sayısı (gizli)
        const opponentTiles = document.getElementById('opponent-tiles');
        if (opponentTiles) {
            opponentTiles.innerHTML = '';
            for (let i = 0; i < (this.gameState.opponentTileCount || 0); i++) {
                const hidden = document.createElement('div');
                hidden.className = 'hidden-tile';
                opponentTiles.appendChild(hidden);
            }
        }

        this.updatePlayerHand();
    }

    updatePlayerHand() {
        if (!this.gameState) return;
        const handContainer = document.getElementById('hand-tiles');
        if (!handContainer) return;

        handContainer.innerHTML = '';

        this.gameState.hand.forEach((tile, index) => {
            const el = this.createDominoTile(tile, false);
            const canPlay = this.canPlayTile(tile);

            if (this.isMyTurn) {
                if (canPlay) el.classList.add('playable');
                else el.classList.add('not-playable');
            }

            el.addEventListener('click', () => {
                if (!this.isMyTurn || !canPlay) return;
                this.selectTile(el, tile, index);
            });

            handContainer.appendChild(el);
        });

        const passBtn = document.getElementById('pass-btn');
        if (passBtn) {
            passBtn.disabled = !this.isMyTurn || this.hasPlayableTile();
        }
    }

    canPlayTile(tile) {
        if (!this.gameState || this.gameState.board.length === 0) return true;
        const { leftEnd, rightEnd } = this.gameState;
        return (
            tile.left === leftEnd ||
            tile.right === leftEnd ||
            tile.left === rightEnd ||
            tile.right === rightEnd
        );
    }

    hasPlayableTile() {
        if (!this.gameState) return false;
        return this.gameState.hand.some(t => this.canPlayTile(t));
    }

    selectTile(tileEl, tile, index) {
        document.querySelectorAll('.domino-tile.selected')
            .forEach(el => el.classList.remove('selected'));

        tileEl.classList.add('selected');
        this.selectedTile = { tile, index };

        const playPos = document.getElementById('play-positions');
        if (playPos) playPos.classList.remove('hidden');

        const leftBtn = document.getElementById('play-left-btn');
        const rightBtn = document.getElementById('play-right-btn');
        const canLeft = this.canPlayAtPosition(tile, 'left');
        const canRight = this.canPlayAtPosition(tile, 'right');
        if (leftBtn) leftBtn.disabled = !canLeft;
        if (rightBtn) rightBtn.disabled = !canRight;
    }

    canPlayAtPosition(tile, position) {
        if (!this.gameState || this.gameState.board.length === 0) return true;
        const endValue = position === 'left' ? this.gameState.leftEnd : this.gameState.rightEnd;
        return tile.left === endValue || tile.right === endValue;
    }

    playTile(position) {
        if (!this.selectedTile || !this.isMyTurn) return;
        this.socket.emit('play_tile', {
            tileIndex: this.selectedTile.index,
            position
        });

        this.selectedTile = null;
        document.querySelectorAll('.domino-tile.selected')
            .forEach(el => el.classList.remove('selected'));
        const playPos = document.getElementById('play-positions');
        if (playPos) playPos.classList.add('hidden');
    }

    passTurn() {
        if (!this.isMyTurn) return;
        this.socket.emit('pass_turn');
    }

    leaveGame() {
        this.socket.emit('leave_game');
        this.returnToLobby();
    }

    updateTurnIndicator() {
        const el = document.getElementById('turn-indicator');
        if (!el) return;
        if (this.isMyTurn) {
            el.textContent = 'Senin sıran';
            el.className = '';
        } else {
            el.textContent = 'Rakip sırası';
            el.className = 'opponent';
        }
    }

    createDominoTile(tile, isOnBoard) {
        const el = document.createElement('div');
        el.className = 'domino-tile';

        if (isOnBoard && this.gameState && this.gameState.board.length > 1) {
            el.classList.add('horizontal');
        }

        const left = document.createElement('div');
        left.className = 'tile-half';
        this.addPips(left, tile.left);

        const right = document.createElement('div');
        right.className = 'tile-half';
        this.addPips(right, tile.right);

        el.appendChild(left);
        el.appendChild(right);
        return el;
    }

    addPips(half, value) {
        const positions = this.getPipPositions(value);
        positions.forEach(() => {
            const pip = document.createElement('div');
            pip.className = 'pip';
            half.appendChild(pip);
        });
    }

    getPipPositions(value) {
        const map = {
            0: [],
            1: [0],
            2: [0, 1],
            3: [0, 1, 2],
            4: [0, 1, 2, 3],
            5: [0, 1, 2, 3, 4],
            6: [0, 1, 2, 3, 4, 5]
        };
        return map[value] || [];
    }

    showGameResult(result) {
        const modal = document.getElementById('result-modal');
        const icon = document.getElementById('result-icon');
        const title = document.getElementById('result-title');
        const eloEl = document.getElementById('result-elo');

        const iWon = result.winner === this.socket.id;
        if (icon) icon.textContent = iWon ? '🏆' : '😔';
        if (title) title.textContent = iWon ? 'KAZANDIN!' : 'KAYBETTİN';
        if (eloEl) {
            eloEl.textContent = `${result.eloChange > 0 ? '+' : ''}${result.eloChange} ELO`;
        }

        if (modal) modal.classList.add('active');

        // local user objesini güncelle (sunucudaki asıl kayıt yine de doğrudur)
        if (this.currentUser) {
            this.currentUser.elo = (this.currentUser.elo || 0) + result.eloChange;
            if (iWon) this.currentUser.wins = (this.currentUser.wins || 0) + 1;
            else this.currentUser.losses = (this.currentUser.losses || 0) + 1;
            this.updateUserStats();
        }
    }

    returnToLobby() {
        const game = document.getElementById('game-screen');
        const lobby = document.getElementById('lobby-screen');
        const resultModal = document.getElementById('result-modal');
        if (game) game.style.display = 'none';
        if (lobby) lobby.style.display = 'flex';
        if (resultModal) resultModal.classList.remove('active');

        this.gameState = null;
        this.selectedTile = null;
        this.isMyTurn = false;

        this.restoreLobbyButtons();
    }

    // LEADERBOARD
    showLeaderboard() {
        this.socket.emit('get_leaderboard');
        const modal = document.getElementById('leaderboard-modal');
        if (modal) modal.classList.add('active');
    }

    hideLeaderboard() {
        const modal = document.getElementById('leaderboard-modal');
        if (modal) modal.classList.remove('active');
    }

    updateLeaderboard(data) {
        const body = document.getElementById('leaderboard-body');
        if (!body) return;
        body.innerHTML = '';

        if (!data || !Array.isArray(data.top10)) return;

        data.top10.forEach((player, index) => {
            const entry = document.createElement('div');
            entry.className = 'leaderboard-entry';
            if (index === 0) entry.classList.add('top-1');
            else if (index === 1) entry.classList.add('top-2');
            else if (index === 2) entry.classList.add('top-3');

            const lvl = this.calculateLevel(player.elo || 0);

            entry.innerHTML = `
                <div class="entry-rank">${index + 1}</div>
                <div class="entry-avatar-small" style="${player.photoUrl ? `background-image:url(${player.photoUrl})` : ''}"></div>
                <div>
                    <div class="entry-name">${player.firstName || player.username}</div>
                    <div class="entry-stats">${player.wins || 0}G / ${player.losses || 0}M</div>
                </div>
                <div class="entry-level level-icon ${lvl <= 3 ? 'level-low' : lvl <= 6 ? 'level-mid' : 'level-high'}">${lvl}</div>
                <div class="entry-elo">
                    <div class="entry-elo-value">${player.elo || 0}</div>
                    <div class="entry-elo-label">ELO</div>
                </div>
            `;

            body.appendChild(entry);
        });

        if (data.myRank && data.myRank > 10 && this.currentUser) {
            const lvl = this.calculateLevel(this.currentUser.elo || 0);
            const my = document.createElement('div');
            my.className = 'my-rank';
            my.innerHTML = `
                <div class="my-rank-label">Senin sıralaman:</div>
                <div class="leaderboard-entry">
                    <div class="entry-rank">${data.myRank}</div>
                    <div class="entry-avatar-small" style="${this.currentUser.photoUrl ? `background-image:url(${this.currentUser.photoUrl})` : ''}"></div>
                    <div>
                        <div class="entry-name">${this.currentUser.firstName}</div>
                        <div class="entry-stats">${this.currentUser.wins || 0}G / ${this.currentUser.losses || 0}M</div>
                    </div>
                    <div class="entry-level level-icon ${lvl <= 3 ? 'level-low' : lvl <= 6 ? 'level-mid' : 'level-high'}">${lvl}</div>
                    <div class="entry-elo">
                        <div class="entry-elo-value">${this.currentUser.elo || 0}</div>
                        <div class="entry-elo-label">ELO</div>
                    </div>
                </div>
            `;
            body.appendChild(my);
        }
    }

    // TOAST
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.game = new DominoGame();
});

