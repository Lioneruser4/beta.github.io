// Global değişkenler
let ws = null;
let currentUser = null;
let gameState = null;
let selectedTile = null;
let validMoves = [];

// Sunucu URL'si
const SERVER_URL = 'wss://mario-io-1.onrender.com';

// Sayfa yüklendiğinde sunucuya bağlan
window.addEventListener('load', () => {
    connectToServer();
});

// Sunucuya bağlanma
function connectToServer() {
    try {
        ws = new WebSocket(SERVER_URL);
        
        ws.onopen = () => {
            console.log('Sunucuya bağlandı');
            updateConnectionStatus(true);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };

        ws.onclose = () => {
            console.log('Sunucu bağlantısı koptu');
            updateConnectionStatus(false);
            // 3 saniye sonra tekrar bağlan
            setTimeout(connectToServer, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket hatası:', error);
            updateConnectionStatus(false);
        };
    } catch (error) {
        console.error('Bağlantı hatası:', error);
        updateConnectionStatus(false);
        setTimeout(connectToServer, 3000);
    }
}

// Bağlantı durumunu güncelle
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (connected) {
        statusEl.className = 'connection-status status-connected';
        statusEl.innerHTML = '<div class="status-dot"></div><span>Sunucuya Bağlı</span>';
    } else {
        statusEl.className = 'connection-status status-disconnected';
        statusEl.innerHTML = '<div class="status-dot"></div><span>Bağlantı Kuruluyor...</span>';
    }
}

// Sunucudan gelen mesajları işle
function handleServerMessage(data) {
    console.log('Sunucudan mesaj:', data);
    
    switch(data.type) {
        case 'registered':
            currentUser = data.user;
            break;
            
        case 'matchFound':
            document.getElementById('searchingContent').classList.add('hidden');
            document.getElementById('rankedContent').classList.remove('hidden');
            startGame(data.gameState);
            break;
            
        case 'roomCreated':
            showRoomCreated(data.roomCode);
            break;
            
        case 'gameStart':
            startGame(data.gameState);
            break;
            
        case 'gameUpdate':
            updateGame(data.gameState);
            break;
            
        case 'gameEnd':
            handleGameEnd(data);
            break;
            
        case 'leaderboard':
            displayLeaderboard(data.top10, data.myRank);
            break;
            
        case 'userUpdate':
            updateUserInfo(data.user);
            break;
            
        case 'error':
            alert(data.message);
            break;
    }
}

// Telegram girişi simülasyonu
function handleTelegramLogin() {
    const mockUser = {
        id: 'user_' + Math.floor(Math.random() * 1000000),
        firstName: 'Oyuncu' + Math.floor(Math.random() * 1000),
        username: 'oyuncu' + Math.floor(Math.random() * 1000),
        level: 1,
        elo: 0,
        wins: 0,
        losses: 0
    };
    
    currentUser = mockUser;
    
    // Sunucuya kayıt gönder
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'register',
            user: mockUser
        }));
    }
    
    // Kullanıcı bilgilerini göster
    updateUserInfo(mockUser);
    
    // Lobby'ye geç
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('lobbyScreen').classList.add('active');
}

// Kullanıcı bilgilerini güncelle
function updateUserInfo(user) {
    currentUser = user;
    document.getElementById('userName').textContent = user.firstName;
    document.getElementById('userLevel').textContent = user.level;
    document.getElementById('userElo').textContent = user.elo;
    
    // Level badge güncelle
    const badge = document.getElementById('userLevelBadge');
    const { icon, className } = getLevelBadge(user.level);
    badge.textContent = icon;
    badge.className = 'level-badge ' + className;
}

// Level badge'ini al
function getLevelBadge(level) {
    if (level >= 7) {
        return { icon: '👑', className: 'level-7-10' };
    } else if (level >= 4) {
        return { icon: '⭐', className: 'level-4-6' };
    } else {
        return { icon: '⚡', className: 'level-1-3' };
    }
}

// Dereceli maç arama
function startRankedSearch() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'searchRanked' }));
        document.getElementById('rankedContent').classList.add('hidden');
        document.getElementById('searchingContent').classList.remove('hidden');
    }
}

// Aramayı iptal et
function cancelSearch() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'cancelSearch' }));
    }
    document.getElementById('searchingContent').classList.add('hidden');
    document.getElementById('rankedContent').classList.remove('hidden');
}

// Oda oluştur
function createRoom() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'createRoom' }));
    }
}

// Oda oluşturuldu göster
function showRoomCreated(code) {
    document.getElementById('roomCode').textContent = code;
    document.getElementById('createRoomContent').classList.add('hidden');
    document.getElementById('roomCreatedContent').classList.remove('hidden');
}

// Oda kodunu kopyala
function copyRoomCode() {
    const code = document.getElementById('roomCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        alert('Oda kodu kopyalandı: ' + code);
    });
}

// Odaya katıl input kontrolü
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('joinRoomInput');
    if (input) {
        input.addEventListener('input', () => {
            const btn = document.getElementById('joinBtn');
            btn.disabled = input.value.length !== 4;
        });
    }
});

// Odaya katıl
function joinRoom() {
    const code = document.getElementById('joinRoomInput').value;
    if (code.length === 4 && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'joinRoom',
            code: code
        }));
    }
}

// Oyunu başlat
function startGame(state) {
    gameState = state;
    selectedTile = null;
    validMoves = [];
    
    // Ekranları değiştir
    document.getElementById('lobbyScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.add('active');
    
    // Oyunu render et
    renderGame();
}

// Oyunu güncelle
function updateGame(state) {
    gameState = state;
    renderGame();
    
    // Oyun bittiyse
    if (state.finished) {
        setTimeout(() => {
            handleGameEnd({
                winner: state.winner,
                eloChanges: state.eloChanges
            });
        }, 2000);
    }
}

// Oyunu render et
function renderGame() {
    if (!gameState) return;
    
    // Oyuncuları render et
    renderPlayers();
    
    // Tahtayı render et
    renderBoard();
    
    // Oyuncu taşlarını render et
    if (gameState.currentPlayer === currentUser.id && gameState.myTiles) {
        document.getElementById('playerTilesSection').style.display = 'block';
        renderPlayerTiles();
    } else {
        document.getElementById('playerTilesSection').style.display = 'none';
    }
}

// Oyuncuları render et
function renderPlayers() {
    const container = document.getElementById('playersInfo');
    container.innerHTML = '';
    
    gameState.players.forEach(player => {
        const isActive = player.id === gameState.currentPlayer;
        const { icon, className } = getLevelBadge(player.level);
        
        const card = document.createElement('div');
        card.className = 'player-card' + (isActive ? ' active' : '');
        card.innerHTML = `
            <div class="player-info-content">
                <div class="player-level ${className}">${icon}</div>
                <div class="player-details">
                    <div class="player-name">${player.username}</div>
                    <div class="player-level-text">Level ${player.level}</div>
                </div>
                <div class="tiles-count">${player.tilesLeft}</div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Tahtayı render et
function renderBoard() {
    const container = document.getElementById('boardContent');
    container.innerHTML = '';
    
    const board = gameState.board;
    
    if (board.length === 0) {
        container.innerHTML = '<span class="empty-board">İlk taşı oyna</span>';
        return;
    }
    
    // Sol hamle butonu
    if (validMoves.includes('left')) {
        const leftBtn = document.createElement('button');
        leftBtn.className = 'move-button';
        leftBtn.textContent = '←';
        leftBtn.onclick = () => playTile('left');
        container.appendChild(leftBtn);
    }
    
    // Tahtadaki taşlar
    board.forEach(tile => {
        const tileEl = createTileElement(tile, false);
        container.appendChild(tileEl);
    });
    
    // Sağ hamle butonu
    if (validMoves.includes('right')) {
        const rightBtn = document.createElement('button');
        rightBtn.className = 'move-button';
        rightBtn.textContent = '→';
        rightBtn.onclick = () => playTile('right');
        container.appendChild(rightBtn);
    }
}

// Oyuncu taşlarını render et
function renderPlayerTiles() {
    const container = document.getElementById('playerTiles');
    container.innerHTML = '';
    
    gameState.myTiles.forEach((tile, index) => {
        const tileEl = createTileElement(tile, true);
        tileEl.classList.add('player-tile');
        
        if (selectedTile && selectedTile.index === index) {
            tileEl.classList.add('selected');
        }
        
        tileEl.onclick = () => selectTile(tile, index);
        container.appendChild(tileEl);
    });
}

// Taş elementi oluştur
function createTileElement(tile, isPlayerTile) {
    const div = document.createElement('div');
    div.className = 'domino-tile';
    div.innerHTML = `
        <div>${tile[0]}</div>
        <div class="tile-divider"></div>
        <div>${tile[1]}</div>
    `;
    return div;
}

// Taş seç
function selectTile(tile, index) {
    if (gameState.currentPlayer !== currentUser.id) return;
    
    selectedTile = { tile, index };
    calculateValidMoves(tile);
    renderPlayerTiles();
}

// Geçerli hamleleri hesapla
function calculateValidMoves(tile) {
    validMoves = [];
    const board = gameState.board;
    
    if (board.length === 0) {
        validMoves.push('any');
        validMoves.push('left');
        validMoves.push('right');
    } else {
        const leftEnd = board[0][0];
        const rightEnd = board[board.length - 1][1];
        
        if (tile[0] === leftEnd || tile[1] === leftEnd) {
            validMoves.push('left');
        }
        if (tile[0] === rightEnd || tile[1] === rightEnd) {
            validMoves.push('right');
        }
    }
    
    renderBoard();
}

// Taşı oyna
function playTile(position) {
    if (!selectedTile || !validMoves.includes(position)) return;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'playTile',
            tile: selectedTile.tile,
            position: position
        }));
    }
    
    selectedTile = null;
    validMoves = [];
}

// Oyun sonu
function handleGameEnd(data) {
    const isWinner = data.winner === currentUser.id;
    const eloChange = data.eloChanges[currentUser.id] || 0;
    
    let message = isWinner ? '🎉 Tebrikler! Kazandınız!' : '😔 Kaybettiniz!';
    message += '\n\nELO Değişimi: ' + (eloChange > 0 ? '+' : '') + eloChange;
    
    alert(message);
    
    // Lobby'ye dön
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('lobbyScreen').classList.add('active');
    
    // İçerikleri sıfırla
    document.getElementById('searchingContent').classList.add('hidden');
    document.getElementById('rankedContent').classList.remove('hidden');
    document.getElementById('roomCreatedContent').classList.add('hidden');
    document.getElementById('createRoomContent').classList.remove('hidden');
    document.getElementById('joinRoomInput').value = '';
}

// Liderlik tablosunu göster
function showLeaderboard() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getLeaderboard' }));
    }
    document.getElementById('leaderboardModal').classList.add('active');
}

// Liderlik tablosunu kapat
function closeLeaderboard() {
    document.getElementById('leaderboardModal').classList.remove('active');
}

// Liderlik tablosunu göster
function displayLeaderboard(top10, myRank) {
    const container = document.getElementById('leaderboardList');
    container.innerHTML = '';
    
    // Top 10
    top10.forEach((player, index) => {
        const item = createLeaderItem(player, index + 1, index < 3);
        container.appendChild(item);
    });
    
    // Kendi sıralaması (10'dan büyükse)
    if (myRank && myRank.rank > 10) {
        const mySection = document.createElement('div');
        mySection.className = 'my-rank-section';
        const myItem = createLeaderItem(myRank.user, myRank.rank, false);
        myItem.classList.add('my-rank-item');
        mySection.appendChild(myItem);
        container.appendChild(mySection);
    }
}

// Lider satırı oluştur
function createLeaderItem(player, rank, isTop3) {
    const { icon, className } = getLevelBadge(player.level);
    
    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank + '.';
    const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
    
    const div = document.createElement('div');
    div.className = 'leader-item' + (isTop3 ? ' top3' : '');
    div.innerHTML = `
        <div class="leader-rank ${rankClass}">${rankEmoji}</div>
        <div class="leader-level ${className}">${icon}</div>
        <div class="leader-info">
            <div class="leader-name">${player.username}</div>
            <div class="leader-level-text">Level ${player.level}</div>
        </div>
        <div class="leader-elo">
            <div class="elo-value">${player.elo}</div>
            <div class="elo-label">ELO</div>
        </div>
    `;
    return div;
}

// Çıkış yap
function logout() {
    if (confirm('Çıkış yapmak istediğinize emin misiniz?')) {
        currentUser = null;
        gameState = null;
        selectedTile = null;
        validMoves = [];
        
        document.getElementById('lobbyScreen').classList.remove('active');
        document.getElementById('gameScreen').classList.remove('active');
        document.getElementById('loginScreen').style.display = 'flex';
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'logout' }));
        }
    }
}
