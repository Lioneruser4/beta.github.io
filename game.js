// --- DOMINO OYUNU DÜZELTİLMİŞ KOD ---

let socket;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Oyun durumu
let gameState = {
    board: [],
    currentTurn: 'red',
    currentPlayerId: null,
    selectedPiece: null,
    myColor: null,
    isMyTurn: false,
    roomCode: null,
    isSearching: false,
    gameStarted: false,
    isGuest: true,
    playerHand: [], // Oyuncunun elindeki taşlar
    opponentHandCount: 0, // Rakibin elindeki taş sayısı
    marketCount: 0, // Pazarda kalan taş sayısı
    playerStats: {
        elo: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        username: '',
        photoUrl: ''
    },
    opponentStats: {
        username: '',
        elo: 0,
        photoUrl: ''
    },
    gameEnded: false
};

// Timer
let searchTimer = null;
let searchTime = 0;

// UI elementleri
const loader = document.getElementById('loader');
const mainLobby = document.getElementById('main-lobby');
const rankedLobby = document.getElementById('ranked-lobby');
const friendLobby = document.getElementById('friend-lobby');
const gameScreen = document.getElementById('game-screen');
const matchFoundLobby = document.getElementById('match-found-lobby');
const postGameLobby = document.getElementById('post-game-lobby');
const connectionStatus = document.getElementById('connection-status');
const dereceliBtn = document.getElementById('dereceli-btn');
const friendBtn = document.getElementById('friend-btn');
const cancelRankedBtn = document.getElementById('cancel-ranked-btn');
const createRoomBtn = document.getElementById('create-room-btn');
const backToMainBtn = document.getElementById('back-to-main-btn');
const rankedStatus = document.getElementById('ranked-status');
const roomCodeOutput = document.getElementById('room-code-output');
const copyCodeBtn = document.getElementById('copy-code-btn');
const joinRoomInput = document.getElementById('join-room-input');
const joinRoomBtn = document.getElementById('join-room-btn');
const boardElement = document.getElementById('board');
const currentTurnDisplay = document.getElementById('current-turn-display');
const turnText = document.getElementById('turn-text');
const leaveGameBtn = document.getElementById('leave-game-btn');
const messageModal = document.getElementById('message-modal');
const modalMessage = document.getElementById('modal-message');
const modalCloseBtn = document.getElementById('modal-close-btn');

// Oyun alanı elementleri
const playerHandElement = document.getElementById('player-hand');
const opponentHandElement = document.getElementById('opponent-hand');
const marketCountElement = document.getElementById('market-count');
const drawTileBtn = document.getElementById('draw-tile-btn');
const passTurnBtn = document.getElementById('pass-turn-btn');

// Oyun sonu ekranı elementleri
const gameResultTitle = document.getElementById('game-result-title');
const gameResultMessage = document.getElementById('game-result-message');
const eloChangeDisplay = document.getElementById('elo-change');
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');

// Kilitlenen oyun puan detayları
const blockedGameDetails = document.getElementById('blocked-game-details');
const finalScorePlayerName = document.getElementById('final-score-player-name');
const finalScorePlayerPoints = document.getElementById('final-score-player-points');
const finalScoreOpponentName = document.getElementById('final-score-opponent-name');
const finalScoreOpponentPoints = document.getElementById('final-score-opponent-points');

// İstatistikler
const playerEloElement = document.getElementById('player-elo');
const playerWinsElement = document.getElementById('player-wins');
const playerLossesElement = document.getElementById('player-losses');

// Eşleşme ekranı
const matchPlayer1Photo = document.getElementById('match-player1-photo');
const matchPlayer1Name = document.getElementById('match-player1-name');
const matchPlayer1Elo = document.getElementById('match-player1-elo');
const matchPlayer2Photo = document.getElementById('match-player2-photo');
const matchPlayer2Name = document.getElementById('match-player2-name');
const matchPlayer2Elo = document.getElementById('match-player2-elo');

// --- WebSocket Bağlantı Fonksiyonu ---
function connectWebSocket() {
    const serverUrl = 'wss://mario-io-1.onrender.com';
    
    console.log('🌐 Sunucuya bağlanılıyor:', serverUrl);
    socket = new WebSocket(serverUrl);

    socket.onopen = onSocketOpen;
    socket.onmessage = onSocketMessage;
    socket.onclose = onSocketClose;
    socket.onerror = onSocketError;
}

// --- WebSocket Event Handlers ---
function onSocketOpen() {
    console.log('✅ Sunucuya WebSocket ile bağlandı');
    connectionStatus.textContent = 'Servere bağlandı!';
    connectionStatus.classList.remove('text-yellow-400', 'text-red-500');
    connectionStatus.classList.add('text-green-500');
    
    isReconnecting = false;
    reconnectAttempts = 0;

    if (gameState.gameStarted && gameState.roomCode && gameState.currentPlayerId) {
        console.log('🔄 Anlık kopma tespit edildi, oyuna tekrar bağlanılıyor...');
        sendSocketMessage('reconnectToGame', { 
            roomCode: gameState.roomCode, 
            playerId: gameState.currentPlayerId 
        });
    }
}

function onSocketClose(event) {
    console.log('❌ Sunucu bağlantısı kesildi:', event.reason || 'Bilinmeyen neden');
    connectionStatus.textContent = 'Bağlantı kesildi, tekrar bağlanılıyor...';
    connectionStatus.className = 'text-red-500 animate-pulse';
    
    if (!isReconnecting) {
        isReconnecting = true;
        setTimeout(attemptReconnect, 1000);
    }
}

function onSocketError(error) {
    console.error('⚠️ WebSocket Hatası:', error);
}

function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        connectionStatus.textContent = 'Bağlantı kurulamadı. Sayfayı yenileyin.';
        showModal('Sunucuya erişilemiyor. Lütfen internet bağlantınızı kontrol edip sayfayı yenileyin.', 'error');
        return;
    }
    
    reconnectAttempts++;
    console.log(`⏳ Yeniden bağlanma denemesi ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
    connectWebSocket();
}

function sendSocketMessage(type, payload = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type, ...payload });
        socket.send(message);
    } else {
        console.error('🚫 Socket açık değil, mesaj gönderilemedi:', type);
        showModal('Sunucu bağlantısı yok. Lütfen bekleyin...', 'warning');
    }
}

function onSocketMessage(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('⬅️ Sunucudan mesaj:', data.type, data);
    
        switch (data.type) {
            case 'connected':
                if (data.isReconnect === false) { 
                    const storedRoomCode = localStorage.getItem('domino_roomCode');
                    const storedPlayerId = localStorage.getItem('domino_playerId');
                    if (storedRoomCode && storedPlayerId) {
                        console.log('📂 Kayıtlı oyun bulundu, yeniden bağlanılıyor...');
                        sendSocketMessage('reconnectToGame', { roomCode: storedRoomCode, playerId: storedPlayerId });
                    }
                }
                break;
            case 'searchStatus':
                rankedStatus.textContent = data.message;
                break;
            case 'searchCancelled':
                gameState.isSearching = false;
                gameState.roomCode = null;
                showModal(data.message);
                stopSearchTimer();
                showScreen('main');
                break;
            case 'matchFound':
                handleMatchFound(data);
                break;
            case 'gameStart':
                handleGameStart(data);
                break;
            case 'gameUpdate':
                handleGameUpdate(data);
                break;
            case 'gameEnd':
                handleGameEnd(data);
                break;
            case 'error':
                handleError(data);
                break;
            case 'opponentDisconnected':
                showModal(data.message || 'Rakip bağlantısı koptu, bekleniyor...', 'warning');
                break;
            case 'opponentReconnected':
                showModal(data.message || 'Rakip tekrar bağlandı!', 'info');
                setTimeout(() => messageModal.classList.add('hidden'), 2000);
                break;
            case 'info':
                showModal(data.message, 'info');
                break;
        }
    } catch (e) {
        console.error("Mesaj işleme hatası:", e);
    }
}

// --- Oyun Mantığı Handlers ---
function handleMatchFound(data) {
    gameState.roomCode = data.roomCode;
    gameState.opponentStats = {
        username: data.opponent.name,
        elo: data.opponent.elo,
        photoUrl: data.opponent.photoUrl
    };
    gameState.isSearching = false;
    stopSearchTimer();
    
    if(matchPlayer1Name) matchPlayer1Name.textContent = gameState.playerStats.username || 'Siz';
    if(matchPlayer1Elo) matchPlayer1Elo.textContent = `(${gameState.playerStats.elo || 0})`;
    if(matchPlayer2Name) matchPlayer2Name.textContent = data.opponent.name || 'Rakip';
    if(matchPlayer2Elo) matchPlayer2Elo.textContent = `(${data.opponent.elo || 0})`;

    showScreen('match-found');
}

function handleGameStart(data) {
    console.log('🎮 Oyun başladı!');
    gameState.gameStarted = true;
    gameState.currentPlayerId = data.gameState.playerId;
    gameState.gameEnded = false;
    
    localStorage.setItem('domino_roomCode', gameState.roomCode);
    localStorage.setItem('domino_playerId', gameState.currentPlayerId);
    
    showScreen('game');
    updateGameUI(data.gameState);
}

function handleGameUpdate(data) {
    console.log('🔄 Oyun durumu güncelleniyor...', data);
    
    if (!gameState.gameStarted) {
         gameState.gameStarted = true;
         showScreen('game');
    }

    gameState.board = data.board || [];
    gameState.currentTurn = data.currentTurn;
    
    if (data.currentPlayerId) gameState.currentPlayerId = data.currentPlayerId;
    
    // Oyuncunun elindeki taşları güncelle
    if (data.players && data.players[gameState.currentPlayerId]) {
        gameState.playerHand = data.players[gameState.currentPlayerId].hand || [];
    }
    
    // Pazardaki taş sayısını güncelle
    gameState.marketCount = data.market ? data.market.length : 0;
    
    // Rakibin elindeki taş sayısını güncelle
    const opponentId = Object.keys(data.players || {}).find(id => id !== gameState.currentPlayerId);
    if (opponentId && data.players[opponentId]) {
        gameState.opponentHandCount = data.players[opponentId].hand ? data.players[opponentId].hand.length : 0;
    }
    
    // Sıra kontrolü
    gameState.isMyTurn = (data.currentTurn === gameState.currentPlayerId);
    
    updateGameUI(gameState);
}

function updateGameUI(state) {
    // 1. Sıra bilgisini güncelle
    if (state.isMyTurn && !state.gameEnded) {
        turnText.textContent = 'Sıra Sizde!';
        currentTurnDisplay.classList.remove('bg-yellow-700');
        currentTurnDisplay.classList.add('bg-green-700');
    } else if (!state.gameEnded) {
        turnText.textContent = 'Rakip Oynuyor...';
        currentTurnDisplay.classList.remove('bg-green-700');
        currentTurnDisplay.classList.add('bg-yellow-700');
    }

    // 2. Pazardaki taş sayısını göster
    if (marketCountElement) {
        marketCountElement.textContent = `Pazar: ${state.marketCount} taş`;
    }

    // 3. Rakibin elindeki taş sayısını göster
    if (opponentHandElement) {
        opponentHandElement.textContent = `Rakip: ${state.opponentHandCount} taş`;
    }

    // 4. Oyuncunun elindeki taşları göster
    renderPlayerHand();

    // 5. Tahtayı çiz
    renderBoard();

    // 6. Buton durumlarını güncelle
    updateButtonStates();
}

function renderPlayerHand() {
    if (!playerHandElement) return;
    
    playerHandElement.innerHTML = '';
    
    gameState.playerHand.forEach((tile, index) => {
        const tileElement = document.createElement('div');
        tileElement.className = 'domino-tile cursor-pointer hover:scale-105 transition-transform';
        tileElement.innerHTML = `
            <div class="domino-tile-inner">
                <div class="domino-left">${tile[0]}</div>
                <div class="domino-divider"></div>
                <div class="domino-right">${tile[1]}</div>
            </div>
        `;
        
        tileElement.onclick = () => selectTileForPlay(index);
        playerHandElement.appendChild(tileElement);
    });
}

function renderBoard() {
    if (!boardElement) return;
    
    boardElement.innerHTML = '';
    
    if (gameState.board.length === 0) {
        boardElement.innerHTML = '<div class="text-gray-500 text-center py-8">Oyun henüz başlamadı</div>';
        return;
    }
    
    gameState.board.forEach((tile, index) => {
        const tileElement = document.createElement('div');
        tileElement.className = 'domino-tile bg-white';
        tileElement.innerHTML = `
            <div class="domino-tile-inner">
                <div class="domino-left">${tile[0]}</div>
                <div class="domino-divider"></div>
                <div class="domino-right">${tile[1]}</div>
            </div>
        `;
        boardElement.appendChild(tileElement);
    });
}

function updateButtonStates() {
    // Pazardan çekme butonunu güncelle
    if (drawTileBtn) {
        drawTileBtn.disabled = !gameState.isMyTurn || gameState.gameEnded || gameState.marketCount === 0;
        
        if (gameState.marketCount === 0) {
            drawTileBtn.title = "Pazarda taş kalmadı";
        } else if (!gameState.isMyTurn) {
            drawTileBtn.title = "Sıranızı bekleyin";
        } else {
            drawTileBtn.title = "Pazardan taş çek";
        }
    }
    
    // Pas butonunu güncelle
    if (passTurnBtn) {
        // DOMINO KURALI: Sadece oynayabileceği taş yoksa ve pazarda taş yoksa pas geçebilir
        const canPlayAnyTile = canPlayAnyTileFromHand();
        passTurnBtn.disabled = !gameState.isMyTurn || gameState.gameEnded || canPlayAnyTile || gameState.marketCount > 0;
        
        if (!gameState.isMyTurn) {
            passTurnBtn.title = "Sıranızı bekleyin";
        } else if (canPlayAnyTile) {
            passTurnBtn.title = "Oynanabilir taşınız var";
        } else if (gameState.marketCount > 0) {
            passTurnBtn.title = "Önce pazardan taş çekmelisiniz";
        } else {
            passTurnBtn.title = "Pas geç (oynanabilir taşınız yok)";
        }
    }
}

function canPlayAnyTileFromHand() {
    if (gameState.board.length === 0) {
        return gameState.playerHand.length > 0;
    }
    
    const leftEnd = gameState.board[0][0];
    const rightEnd = gameState.board[gameState.board.length - 1][1];
    
    return gameState.playerHand.some(tile => 
        tile[0] === leftEnd || tile[1] === leftEnd ||
        tile[0] === rightEnd || tile[1] === rightEnd
    );
}

function selectTileForPlay(tileIndex) {
    if (!gameState.isMyTurn || gameState.gameEnded) {
        showModal("Sıra sizde değil!", "warning");
        return;
    }
    
    const tile = gameState.playerHand[tileIndex];
    if (!tile) return;
    
    // Taşın oynanıp oynanamayacağını kontrol et
    if (gameState.board.length === 0) {
        // İlk taş - sadece çift taşlar oynanabilir (klasik domino kuralı)
        if (tile[0] !== tile[1]) {
            showModal("İlk taş çift olmalıdır (0-0, 1-1, ...)", "warning");
            return;
        }
        sendSocketMessage('playTile', { tileIndex, position: 'both' });
    } else {
        // Normal hamle - nereye oynayabileceğini kontrol et
        const leftEnd = gameState.board[0][0];
        const rightEnd = gameState.board[gameState.board.length - 1][1];
        
        let position = null;
        if (tile[0] === leftEnd || tile[1] === leftEnd) {
            position = 'left';
        } else if (tile[0] === rightEnd || tile[1] === rightEnd) {
            position = 'right';
        }
        
        if (position) {
            sendSocketMessage('playTile', { tileIndex, position });
        } else {
            showModal("Bu taş oynanamaz! Uygun uç bulunamadı.", "error");
        }
    }
}

function handleGameEnd(data) {
    const isWinner = data.winner === gameState.currentPlayerId;
    const isDraw = data.winner === 'DRAW';
    
    gameState.gameEnded = true;
    
    let title = isDraw ? '⚖️ BERABERE' : (isWinner ? '🎉 KAZANDINIZ!' : '😔 KAYBETTİNİZ');
    let message = isDraw ? 'Oyun berabere bitti.' : (isWinner ? 'Tebrikler!' : 'Bir dahaki sefere...');

    gameResultTitle.textContent = title;
    gameResultMessage.textContent = message;

    if (data.reason === 'blocked' && data.finalScores) {
        blockedGameDetails.classList.remove('hidden');
        // Skorları yazdır...
    } else {
        blockedGameDetails.classList.add('hidden');
    }

    if (data.isRanked && data.eloChanges) {
        const change = isWinner ? data.eloChanges.winner : data.eloChanges.loser;
        eloChangeDisplay.textContent = `${change > 0 ? '+' : ''}${change} Puan`;
        eloChangeDisplay.className = `text-2xl font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
    } else {
        eloChangeDisplay.textContent = '';
    }

    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');
    gameState.gameStarted = false;
    gameState.roomCode = null;

    showScreen('post-game');
}

function handleError(data) {
    showModal(data.message || 'Bir hata oluştu', 'error');
    if (!gameState.gameStarted) {
        showScreen('main');
    }
}

// --- UI Yardımcı Fonksiyonları ---
function showScreen(screenName) {
    [mainLobby, rankedLobby, friendLobby, gameScreen, matchFoundLobby, postGameLobby, loader].forEach(el => {
        if(el) el.classList.add('hidden');
    });

    if (screenName === 'main') mainLobby.classList.remove('hidden');
    else if (screenName === 'ranked') rankedLobby.classList.remove('hidden');
    else if (screenName === 'friend') friendLobby.classList.remove('hidden');
    else if (screenName === 'game') gameScreen.classList.remove('hidden');
    else if (screenName === 'match-found') matchFoundLobby.classList.remove('hidden');
    else if (screenName === 'post-game') postGameLobby.classList.remove('hidden');
    else loader.classList.remove('hidden');
}

function showModal(msg, type = 'info') {
    if(modalMessage) modalMessage.textContent = msg;
    if(messageModal) messageModal.classList.remove('hidden');
    
    // Error mesajları daha uzun göster
    if (type === 'error') {
        setTimeout(() => messageModal.classList.add('hidden'), 5000);
    } else {
        setTimeout(() => messageModal.classList.add('hidden'), 3000);
    }
}

function startSearchTimer() {
    stopSearchTimer();
    searchTimer = setInterval(() => {
        searchTime++;
        const m = Math.floor(searchTime / 60);
        const s = searchTime % 60;
        if(rankedStatus) rankedStatus.textContent = `Rakip aranıyor... (${m}:${s.toString().padStart(2, '0')})`;
    }, 1000);
}

function stopSearchTimer() {
    if (searchTimer) clearInterval(searchTimer);
    searchTimer = null;
    searchTime = 0;
}

// --- Oyun Buton Eventleri ---
if (drawTileBtn) {
    drawTileBtn.onclick = () => {
        if (!gameState.isMyTurn || gameState.gameEnded) {
            showModal("Sıra sizde değil!", "warning");
            return;
        }
        
        if (gameState.marketCount === 0) {
            showModal("Pazarda taş kalmadı!", "warning");
            return;
        }
        
        sendSocketMessage('drawFromMarket');
    };
}

if (passTurnBtn) {
    passTurnBtn.onclick = () => {
        if (!gameState.isMyTurn || gameState.gameEnded) {
            showModal("Sıra sizde değil!", "warning");
            return;
        }
        
        // DOMINO KURALI KONTROLLERİ
        const canPlay = canPlayAnyTileFromHand();
        
        if (canPlay) {
            showModal("Oynayabileceğiniz taş var! Pas geçemezsiniz.", "error");
            return;
        }
        
        if (gameState.marketCount > 0) {
            showModal("Önce pazardan taş çekmelisiniz!", "warning");
            return;
        }
        
        sendSocketMessage('pass');
    };
}

// --- Ana Buton Eventleri ---
if(dereceliBtn) dereceliBtn.onclick = () => {
    if (gameState.isSearching) return;
    gameState.isSearching = true;
    gameState.gameType = 'ranked';
    
    sendSocketMessage('findMatch', { 
        isGuest: false,
        gameType: 'ranked',
        telegramId: 'user_' + Math.floor(Math.random()*1000)
    });
    
    showScreen('ranked');
    startSearchTimer();
};

if(friendBtn) friendBtn.onclick = () => {
    showScreen('friend');
};

if(cancelRankedBtn) cancelRankedBtn.onclick = () => {
    gameState.isSearching = false;
    sendSocketMessage('cancelSearch');
    stopSearchTimer();
    showScreen('main');
};

if(createRoomBtn) createRoomBtn.onclick = () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    gameState.roomCode = code;
    gameState.isHost = true;
    if(roomCodeOutput) roomCodeOutput.textContent = code;
    
    sendSocketMessage('createRoom', { roomCode: code, playerName: 'Oyuncu' });
    showModal(`Oda oluşturuldu! Kod: ${code}`);
};

if(joinRoomBtn) joinRoomBtn.onclick = () => {
    const code = joinRoomInput.value.trim();
    if (code.length < 4) {
        showModal('Lütfen geçerli bir oda kodu girin.');
        return;
    }
    gameState.roomCode = code;
    sendSocketMessage('joinRoom', { roomCode: code, playerName: 'Oyuncu 2' });
};

if(backToMainBtn) backToMainBtn.onclick = () => showScreen('main');
if(backToLobbyBtn) backToLobbyBtn.onclick = () => showScreen('main');
if(modalCloseBtn) modalCloseBtn.onclick = () => messageModal.classList.add('hidden');

if(leaveGameBtn) leaveGameBtn.onclick = () => {
    if (confirm("Oyundan çıkmak istediğinize emin misiniz?")) {
        sendSocketMessage('leaveGame');
        localStorage.removeItem('domino_roomCode');
        localStorage.removeItem('domino_playerId');
        gameState.gameStarted = false;
        showScreen('main');
    }
};

// --- Başlat ---
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
});

// CSS için domino taşları stili (HTML head kısmına ekleyin veya CSS dosyanıza)
const style = document.createElement('style');
style.textContent = `
.domino-tile {
    display: inline-block;
    width: 60px;
    height: 120px;
    background: #fff;
    border: 2px solid #333;
    border-radius: 8px;
    margin: 5px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.domino-tile-inner {
    display: flex;
    height: 100%;
}

.domino-left, .domino-right {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: bold;
    color: #333;
}

.domino-divider {
    width: 2px;
    background: #333;
    margin: 10px 0;
}

.domino-tile:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    cursor: pointer;
}

#board {
    min-height: 150px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    padding: 20px;
    background: #f5f5f5;
    border-radius: 10px;
    margin: 20px 0;
}
`;
document.head.appendChild(style);
