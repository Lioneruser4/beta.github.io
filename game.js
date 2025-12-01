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
        this.setupEventListeners();
        this.checkTelegramAuth();
    }

    connectSocket() {
        this.socket = io(this.serverUrl, {
            transports: ['websocket', 'polling']
        });

        this.socket.on('connect', () => {
            console.log('Sunucuya bağlandı');
            this.updateConnectionStatus('connected', 'Bağlandı');
            this.authenticateUser();
        });

        this.socket.on('disconnect', () => {
            console.log('Sunucu bağlantısı kesildi');
            this.updateConnectionStatus('disconnected', 'Bağlantı kesildi');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Bağlantı hatası:', error);
            this.updateConnectionStatus('error', 'Bağlantı hatası');
        });

        // Game events
        this.socket.on('user_authenticated', (data) => {
            this.currentUser = data.user;
            this.updateUserStats();
            this.showToast('Giriş başarılı!', 'success');
        });

        this.socket.on('match_found', (data) => {
            this.stopSearching();
            this.startGame(data.game, data.opponent);
        });

        this.socket.on('room_created', (data) => {
            this.showRoomCode(data.roomCode);
        });

        this.socket.on('room_joined', (data) => {
            this.startGame(data.game, data.opponent);
        });

        this.socket.on('game_update', (gameState) => {
            this.updateGameState(gameState);
        });

        this.socket.on('game_over', (result) => {
            this.showGameResult(result);
        });

        this.socket.on('opponent_disconnected', () => {
            this.showToast('Rakip oyundan ayrıldı', 'error');
            this.returnToLobby();
        });

        this.socket.on('leaderboard', (data) => {
            this.updateLeaderboard(data);
        });
    }

    setupEventListeners() {
        // Menu buttons
        document.getElementById('ranked-btn').addEventListener('click', () => {
            this.startRankedMatch();
        });

        document.getElementById('friend-btn').addEventListener('click', () => {
            this.createFriendRoom();
        });

        document.getElementById('join-btn').addEventListener('click', () => {
            this.showJoinRoom();
        });

        document.getElementById('leaderboard-btn').addEventListener('click', () => {
            this.showLeaderboard();
        });

        document.getElementById('close-leaderboard').addEventListener('click', () => {
            this.hideLeaderboard();
        });

        document.getElementById('leave-btn').addEventListener('click', () => {
            this.leaveGame();
        });

        document.getElementById('pass-btn').addEventListener('click', () => {
            this.passTurn();
        });

        // Play position buttons
        document.getElementById('play-left-btn').addEventListener('click', () => {
            this.playTile('left');
        });

        document.getElementById('play-right-btn').addEventListener('click', () => {
            this.playTile('right');
        });

        // Result modal
        document.getElementById('result-btn').addEventListener('click', () => {
            this.returnToLobby();
        });
    }

    checkTelegramAuth() {
        const urlParams = new URLSearchParams(window.location.search);
        const telegramId = urlParams.get('telegram_id');
        const firstName = urlParams.get('first_name');
        const username = urlParams.get('username');

        if (telegramId) {
            localStorage.setItem('telegram_id', telegramId);
            localStorage.setItem('first_name', firstName || 'Oyuncu');
            localStorage.setItem('username', username || `user_${telegramId}`);
            
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    authenticateUser() {
        const telegramId = localStorage.getItem('telegram_id');
        const firstName = localStorage.getItem('first_name');
        const username = localStorage.getItem('username');

        if (telegramId) {
            this.socket.emit('authenticate', {
                telegramId,
                firstName,
                username
            });
        } else {
            // Show telegram login prompt
            this.showTelegramLogin();
        }
    }

    showTelegramLogin() {
        const botUsername = 'your_bot_username'; // Değiştir
        const authUrl = `https://telegram.org/js/telegram-widget.js?bot=${botUsername}&origin=${window.location.origin}`;
        
        // Telegram login script'i yükle
        const script = document.createElement('script');
        script.src = authUrl;
        script.async = true;
        document.head.appendChild(script);

        // Login butonu oluştur
        const loginHtml = `
            <div style="text-align: center; padding: 40px;">
                <h3 style="color: var(--text-primary); margin-bottom: 20px;">Telegram ile Giriş Yap</h3>
                <div id="telegram-login-btn"></div>
            </div>
        `;
        
        document.getElementById('user-stats').innerHTML = loginHtml;
        
        // Telegram login callback
        window.onTelegramAuth = (user) => {
            localStorage.setItem('telegram_id', user.id.toString());
            localStorage.setItem('first_name', user.first_name);
            localStorage.setItem('username', user.username || `user_${user.id}`);
            this.authenticateUser();
        };
    }

    updateConnectionStatus(status, text) {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        statusDot.className = `status-dot ${status}`;
        statusText.textContent = text;
    }

    updateUserStats() {
        if (!this.currentUser) return;

        const level = this.calculateLevel(this.currentUser.elo);
        const levelIcon = document.getElementById('level-icon');
        const levelText = document.getElementById('level-text');
        const eloText = document.getElementById('elo-text');
        const userRank = document.getElementById('user-rank');
        const wins = document.getElementById('wins');
        const losses = document.getElementById('losses');

        levelIcon.textContent = level;
        levelText.textContent = `Seviye ${level}`;
        eloText.textContent = `${this.currentUser.elo} ELO`;
        
        // Update level icon style
        levelIcon.className = 'level-icon';
        if (level <= 3) {
            levelIcon.classList.add('level-low');
        } else if (level <= 6) {
            levelIcon.classList.add('level-mid');
        } else {
            levelIcon.classList.add('level-high');
        }

        if (this.currentUser.rank) {
            userRank.textContent = this.currentUser.rank;
        }
        
        wins.textContent = this.currentUser.wins || 0;
        losses.textContent = this.currentUser.losses || 0;
    }

    calculateLevel(elo) {
        return Math.min(10, Math.floor(elo / 100) + 1);
    }

    startRankedMatch() {
        if (!this.currentUser) {
            this.showToast('Önce Telegram ile giriş yapın', 'error');
            return;
        }

        this.showSearchingState();
        this.searchStartTime = Date.now();
        
        this.socket.emit('find_ranked_match');

        // Update search time
        this.searchTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.searchStartTime) / 1000);
            const searchTime = document.querySelector('.search-time');
            if (searchTime) {
                searchTime.textContent = `Aranıyor... ${elapsed}s`;
            }
        }, 1000);
    }

    showSearchingState() {
        const container = document.querySelector('.btn-group');
        container.innerHTML = `
            <div class="searching-state">
                <div class="spinner"></div>
                <div class="searching-text">Rakip Aranıyor...</div>
                <div class="search-time">Aranıyor... 0s</div>
                <button class="cancel-btn" id="cancel-search">İptal</button>
            </div>
        `;

        document.getElementById('cancel-search').addEventListener('click', () => {
            this.stopSearching();
        });
    }

    stopSearching() {
        if (this.searchTimer) {
            clearInterval(this.searchTimer);
            this.searchTimer = null;
        }
        
        this.socket.emit('cancel_search');
        this.returnToLobby();
    }

    createFriendRoom() {
        if (!this.currentUser) {
            this.showToast('Önce Telegram ile giriş yapın', 'error');
            return;
        }

        this.socket.emit('create_friend_room');
    }

    showRoomCode(roomCode) {
        const container = document.querySelector('.btn-group');
        container.innerHTML = `
            <div class="room-code-display">
                <div class="room-code-label">Oda Kodu:</div>
                <div class="room-code">${roomCode}</div>
                <button class="copy-btn" id="copy-code">Kopyala</button>
                <div class="room-code-hint">Arkadaşın bu kodla odaya katılacak</div>
                <button class="cancel-btn" id="cancel-room">İptal</button>
            </div>
        `;

        document.getElementById('copy-code').addEventListener('click', () => {
            navigator.clipboard.writeText(roomCode);
            this.showToast('Kod kopyalandı!', 'success');
        });

        document.getElementById('cancel-room').addEventListener('click', () => {
            this.socket.emit('leave_room');
            this.returnToLobby();
        });
    }

    showJoinRoom() {
        const container = document.querySelector('.btn-group');
        container.innerHTML = `
            <div class="join-room-panel">
                <input type="text" class="join-input" id="room-code-input" placeholder="ODA KODU" maxlength="4">
                <div class="join-btns">
                    <button class="join-cancel-btn" id="cancel-join">İptal</button>
                    <button class="join-confirm-btn" id="confirm-join">Katıl</button>
                </div>
            </div>
        `;

        document.getElementById('cancel-join').addEventListener('click', () => {
            this.returnToLobby();
        });

        document.getElementById('confirm-join').addEventListener('click', () => {
            const roomCode = document.getElementById('room-code-input').value.toUpperCase();
            if (roomCode.length === 4) {
                this.socket.emit('join_room', { roomCode });
            } else {
                this.showToast('Geçerli oda kodu girin', 'error');
            }
        });

        document.getElementById('room-code-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('confirm-join').click();
            }
        });
    }

    startGame(gameState, opponent) {
        this.gameState = gameState;
        this.isMyTurn = gameState.currentPlayer === this.socket.id;
        
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';

        // Update opponent info
        document.getElementById('opponent-name').textContent = opponent.firstName;
        const opponentLevel = this.calculateLevel(opponent.elo);
        const opponentLevelEl = document.getElementById('opponent-level');
        opponentLevelEl.textContent = opponentLevel;
        opponentLevelEl.className = 'level-icon';
        if (opponentLevel <= 3) {
            opponentLevelEl.classList.add('level-low');
        } else if (opponentLevel <= 6) {
            opponentLevelEl.classList.add('level-mid');
        } else {
            opponentLevelEl.classList.add('level-high');
        }

        // Update my level in game
        const myLevel = this.calculateLevel(this.currentUser.elo);
        const myLevelEl = document.getElementById('my-level');
        myLevelEl.textContent = myLevel;
        myLevelEl.className = 'level-icon';
        if (myLevel <= 3) {
            myLevelEl.classList.add('level-low');
        } else if (myLevel <= 6) {
            myLevelEl.classList.add('level-mid');
        } else {
            myLevelEl.classList.add('level-high');
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

        // Update board tiles
        const boardTiles = document.getElementById('board-tiles');
        boardTiles.innerHTML = '';
        
        this.gameState.board.forEach(tile => {
            boardTiles.appendChild(this.createDominoTile(tile, true));
        });

        // Update board ends
        const leftEnd = document.getElementById('left-end');
        const rightEnd = document.getElementById('right-end');
        
        if (this.gameState.leftEnd !== null) {
            leftEnd.textContent = `Sol: ${this.gameState.leftEnd}`;
            leftEnd.classList.add('playable');
        } else {
            leftEnd.textContent = 'Sol: -';
            leftEnd.classList.remove('playable');
        }

        if (this.gameState.rightEnd !== null) {
            rightEnd.textContent = `Sağ: ${this.gameState.rightEnd}`;
            rightEnd.classList.add('playable');
        } else {
            rightEnd.textContent = 'Sağ: -';
            rightEnd.classList.remove('playable');
        }

        // Update opponent tiles (hidden)
        const opponentTiles = document.getElementById('opponent-tiles');
        opponentTiles.innerHTML = '';
        
        for (let i = 0; i < this.gameState.opponentTileCount; i++) {
            const hiddenTile = document.createElement('div');
            hiddenTile.className = 'hidden-tile';
            opponentTiles.appendChild(hiddenTile);
        }

        // Update player hand
        this.updatePlayerHand();
    }

    updatePlayerHand() {
        if (!this.gameState) return;

        const handTiles = document.getElementById('hand-tiles');
        handTiles.innerHTML = '';
        
        this.gameState.hand.forEach((tile, index) => {
            const tileEl = this.createDominoTile(tile, false);
            tileEl.dataset.index = index;
            
            // Check if tile is playable
            const canPlay = this.canPlayTile(tile);
            if (!canPlay && this.isMyTurn) {
                tileEl.classList.add('not-playable');
            } else if (this.isMyTurn) {
                tileEl.classList.add('playable');
            }
            
            tileEl.addEventListener('click', () => {
                if (this.isMyTurn && canPlay) {
                    this.selectTile(tileEl, tile, index);
                }
            });
            
            handTiles.appendChild(tileEl);
        });

        // Update pass button
        const passBtn = document.getElementById('pass-btn');
        passBtn.disabled = !this.isMyTurn || this.hasPlayableTile();
    }

    canPlayTile(tile) {
        if (!this.gameState || this.gameState.board.length === 0) {
            return true; // First move
        }

        return tile.left === this.gameState.leftEnd || 
               tile.right === this.gameState.leftEnd ||
               tile.left === this.gameState.rightEnd || 
               tile.right === this.gameState.rightEnd;
    }

    hasPlayableTile() {
        if (!this.gameState) return false;
        
        return this.gameState.hand.some(tile => this.canPlayTile(tile));
    }

    selectTile(tileEl, tile, index) {
        // Remove previous selection
        document.querySelectorAll('.domino-tile.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // Select new tile
        tileEl.classList.add('selected');
        this.selectedTile = { tile, index };

        // Show play position buttons
        const playPositions = document.getElementById('play-positions');
        playPositions.classList.remove('hidden');

        // Check which positions are valid
        const leftBtn = document.getElementById('play-left-btn');
        const rightBtn = document.getElementById('play-right-btn');

        leftBtn.disabled = !this.canPlayAtPosition(tile, 'left');
        rightBtn.disabled = !this.canPlayAtPosition(tile, 'right');
    }

    canPlayAtPosition(tile, position) {
        if (!this.gameState || this.gameState.board.length === 0) {
            return true; // First move, any position
        }

        const endValue = position === 'left' ? this.gameState.leftEnd : this.gameState.rightEnd;
        
        return tile.left === endValue || tile.right === endValue;
    }

    playTile(position) {
        if (!this.selectedTile || !this.isMyTurn) return;

        this.socket.emit('play_tile', {
            tileIndex: this.selectedTile.index,
            position: position
        });

        // Clear selection
        this.selectedTile = null;
        document.querySelectorAll('.domino-tile.selected').forEach(el => {
            el.classList.remove('selected');
        });
        document.getElementById('play-positions').classList.add('hidden');
    }

    passTurn() {
        if (!this.isMyTurn) return;
        
        this.socket.emit('pass_turn');
    }

    updateTurnIndicator() {
        const indicator = document.getElementById('turn-indicator');
        
        if (this.isMyTurn) {
            indicator.textContent = 'Senin Sıran';
            indicator.className = 'turn-indicator';
        } else {
            indicator.textContent = 'Rakip Sırası';
            indicator.className = 'turn-indicator opponent';
        }
    }

    createDominoTile(tile, isOnBoard) {
        const tileEl = document.createElement('div');
        tileEl.className = 'domino-tile';
        
        if (isOnBoard && this.gameState.board.length > 1) {
            // Check if tile should be horizontal on board
            tileEl.classList.add('horizontal');
        }

        // Create halves
        const leftHalf = document.createElement('div');
        leftHalf.className = 'tile-half';
        this.addPips(leftHalf, tile.left);

        const rightHalf = document.createElement('div');
        rightHalf.className = 'tile-half';
        this.addPips(rightHalf, tile.right);

        tileEl.appendChild(leftHalf);
        tileEl.appendChild(rightHalf);

        return tileEl;
    }

    addPips(half, value) {
        const pipPositions = this.getPipPositions(value);
        
        pipPositions.forEach(position => {
            const pip = document.createElement('div');
            pip.className = `pip ${position}`;
            half.appendChild(pip);
        });
    }

    getPipPositions(value) {
        const positions = {
            0: [],
            1: ['pip-1'],
            2: ['pip-2-tl', 'pip-2-br'],
            3: ['pip-3-tl', 'pip-3-c', 'pip-3-br'],
            4: ['pip-4-tl', 'pip-4-tr', 'pip-4-bl', 'pip-4-br'],
            5: ['pip-5-tl', 'pip-5-tr', 'pip-5-c', 'pip-5-bl', 'pip-5-br'],
            6: ['pip-6-tl', 'pip-6-tr', 'pip-6-ml', 'pip-6-mr', 'pip-6-bl', 'pip-6-br']
        };
        
        return positions[value] || [];
    }

    leaveGame() {
        this.socket.emit('leave_game');
        this.returnToLobby();
    }

    showGameResult(result) {
        const modal = document.getElementById('result-modal');
        const icon = document.getElementById('result-icon');
        const title = document.getElementById('result-title');
        const elo = document.getElementById('result-elo');

        if (result.winner === this.socket.id) {
            icon.textContent = '🏆';
            title.textContent = 'KAZANDIN!';
            title.className = 'result-title win';
            elo.textContent = `+${result.eloChange} ELO`;
            elo.className = 'result-elo positive';
        } else {
            icon.textContent = '😔';
            title.textContent = 'KAYBETTİN!';
            title.className = 'result-title lose';
            elo.textContent = `${result.eloChange} ELO`;
            elo.className = 'result-elo negative';
        }

        modal.classList.add('active');
        
        // Update user stats
        this.currentUser.elo += result.eloChange;
        if (result.winner === this.socket.id) {
            this.currentUser.wins = (this.currentUser.wins || 0) + 1;
        } else {
            this.currentUser.losses = (this.currentUser.losses || 0) + 1;
        }
        this.updateUserStats();
    }

    returnToLobby() {
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('lobby-screen').style.display = 'flex';
        document.getElementById('result-modal').classList.remove('active');
        
        this.gameState = null;
        this.selectedTile = null;
        this.isMyTurn = false;
        
        // Restore menu buttons
        this.restoreMenuButtons();
    }

    restoreMenuButtons() {
        const container = document.querySelector('.btn-group');
        container.innerHTML = `
            <div id="ranked-container">
                <button class="game-btn ranked" id="ranked-btn">
                    <div class="btn-icon">⚔️</div>
                    <div class="btn-content">
                        <div class="btn-title">DERECELİ</div>
                        <div class="btn-desc">Çevrimiçi rakip bul ve ELO kazan</div>
                    </div>
                </button>
            </div>

            <div id="friend-container">
                <button class="game-btn friend" id="friend-btn">
                    <div class="btn-icon">👥</div>
                    <div class="btn-content">
                        <div class="btn-title">ARKADAŞLA OYNA</div>
                        <div class="btn-desc">Özel oda oluştur ve arkadaşını davet et</div>
                    </div>
                </button>
            </div>

            <div id="join-container">
                <button class="game-btn join" id="join-btn">
                    <div class="btn-icon">🔑</div>
                    <div class="btn-content">
                        <div class="btn-title">ODAYA KATIL</div>
                        <div class="btn-desc">Oda kodu ile arkadaşına katıl</div>
                    </div>
                </button>
            </div>
        `;

        // Re-attach event listeners
        document.getElementById('ranked-btn').addEventListener('click', () => {
            this.startRankedMatch();
        });

        document.getElementById('friend-btn').addEventListener('click', () => {
            this.createFriendRoom();
        });

        document.getElementById('join-btn').addEventListener('click', () => {
            this.showJoinRoom();
        });
    }

    showLeaderboard() {
        this.socket.emit('get_leaderboard');
        document.getElementById('leaderboard-modal').classList.add('active');
    }

    hideLeaderboard() {
        document.getElementById('leaderboard-modal').classList.remove('active');
    }

    updateLeaderboard(data) {
        const body = document.getElementById('leaderboard-body');
        body.innerHTML = '';

        // Top 10 players
        data.top10.forEach((player, index) => {
            const entry = document.createElement('div');
            entry.className = 'leaderboard-entry';
            
            if (index === 0) entry.classList.add('top-1');
            else if (index === 1) entry.classList.add('top-2');
            else if (index === 2) entry.classList.add('top-3');

            const level = this.calculateLevel(player.elo);
            
            entry.innerHTML = `
                <div class="entry-rank">${index + 1}</div>
                <div class="entry-info">
                    <div class="entry-name">${player.firstName}</div>
                    <div class="entry-stats">${player.wins}G / ${player.losses}M</div>
                </div>
                <div class="entry-level level-icon ${level <= 3 ? 'level-low' : level <= 6 ? 'level-mid' : 'level-high'}">${level}</div>
                <div class="entry-elo">
                    <div class="entry-elo-value">${player.elo}</div>
                    <div class="entry-elo-label">ELO</div>
                </div>
            `;
            
            body.appendChild(entry);
        });

        // My rank section
        if (data.myRank && data.myRank > 10) {
            const mySection = document.createElement('div');
            mySection.className = 'my-rank';
            mySection.innerHTML = `
                <div class="my-rank-label">Sıralaman:</div>
                <div class="leaderboard-entry">
                    <div class="entry-rank">${data.myRank}</div>
                    <div class="entry-info">
                        <div class="entry-name">${this.currentUser.firstName}</div>
                        <div class="entry-stats">${this.currentUser.wins}G / ${this.currentUser.losses}M</div>
                    </div>
                    <div class="entry-level level-icon ${this.calculateLevel(this.currentUser.elo) <= 3 ? 'level-low' : this.calculateLevel(this.currentUser.elo) <= 6 ? 'level-mid' : 'level-high'}">${this.calculateLevel(this.currentUser.elo)}</div>
                    <div class="entry-elo">
                        <div class="entry-elo-value">${this.currentUser.elo}</div>
                        <div class="entry-elo-label">ELO</div>
                    </div>
                </div>
            `;
            body.appendChild(mySection);
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.game = new DominoGame();
});
