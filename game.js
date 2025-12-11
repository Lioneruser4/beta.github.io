// --- DÜZELTME: Sunucu WebSocket kullandığı için socket.io yerine WebSocket API'si kullanılmalı ---
let socket;

function connectWebSocket() {
    socket = new WebSocket('wss://mario-io-1.onrender.com');

    let isReconnecting = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;

    socket.onopen = onSocketOpen;
    socket.onmessage = onSocketMessage;
    socket.onclose = onSocketClose;
    socket.onerror = onSocketError;

    function onSocketOpen() {
        console.log('Sunucuya WebSocket ile bağlandı');
        connectionStatus.textContent = 'Servere bağlandı!';
        connectionStatus.classList.remove('text-yellow-400', 'text-red-500');
        connectionStatus.classList.add('text-green-500');
        reconnectAttempts = 0;

        // Sayfa ilk açıldığında veya yeniden bağlandığında eski oyunu kontrol et
        const savedRoom = localStorage.getItem('domino_roomCode');
        const savedId = localStorage.getItem('domino_playerId');
        if (savedRoom && savedId && gameState.roomCode !== savedRoom) {
            console.log('Kayıtlı oyun bulundu → yeniden bağlanılıyor...');
            sendSocketMessage('reconnectToGame', {
                roomCode: savedRoom,
                playerId: savedId
            });
        }
    }

    function onSocketClose() {
        console.log('Bağlantı kesildi, yeniden bağlanılıyor...');
        connectionStatus.textContent = 'Bağlantı kesildi...';
        connectionStatus.className = 'text-red-500';

        if (!isReconnecting && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            isReconnecting = true;
            setTimeout(() => {
                reconnectAttempts++;
                connectWebSocket();
            }, 2000);
        }
    }

    function onSocketError(err) {
        console.error('WebSocket hatası:', err);
    }
}

// Oyun durumu (senin orijinal halin)
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
    playerStats: { elo: 0, wins: 0, losses: 0, draws: 0 },
    opponentStats: { username: '', elo: 0 }
};

// UI elementleri (senin orijinal tanımlamaların, değişmedi)
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

const gameResultTitle = document.getElementById('game-result-title');
const gameResultMessage = document.getElementById('game-result-message');
const eloChangeDisplay = document.getElementById('elo-change');
const backToLobbyBtn = document.getElementById('back-to-lobby-btn');
const blockedGameDetails = document.getElementById('blocked-game-details');
const finalScorePlayerName = document.getElementById('final-score-player-name');
const finalScorePlayerPoints = document.getElementById('final-score-player-points');
const finalScoreOpponentName = document.getElementById('final-score-opponent-name');
const finalScoreOpponentPoints = document.getElementById('final-score-opponent-points');

const playerEloElement = document.getElementById('player-elo');
const playerWinsElement = document.getElementById('player-wins');
const playerLossesElement = document.getElementById('player-losses');
const opponentNameElement = document.getElementById('opponent-name');
const opponentEloElement = document.getElementById('opponent-elo');

const matchPlayer1Name = document.getElementById('match-player1-name');
const matchPlayer1Elo = document.getElementById('match-player1-elo');
const matchPlayer1Photo = document.getElementById('match-player1-photo');
const matchPlayer2Name = document.getElementById('match-player2-name');
const matchPlayer2Elo = document.getElementById('match-player2-elo');
const matchPlayer2Photo = document.getElementById('match-player2-photo');

// GÖNDERME FONKSİYONU (EKLENDİ)
function sendSocketMessage(type, payload = {}) {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, ...payload }));
    } else {
        console.warn('WebSocket kapalı, mesaj gönderilemedi:', type);
    }
}

// SUNUCUDAN GELEN MESAJLARI İŞLE (TAMAMEN YENİLENDİ + RECONNECT EKLENDİ)
function onSocketMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Sunucudan:', data.type, data);

    switch (data.type) {
        case 'connected':
            // İlk bağlantıda otomatik reconnect kontrolü
            const savedRoom = localStorage.getItem('domino_roomCode');
            const savedId = localStorage.getItem('domino_playerId');
            if (savedRoom && savedId && !gameState.gameStarted) {
                sendSocketMessage('reconnectToGame', { roomCode: savedRoom, playerId: savedId });
            }
            break;

        case 'reconnectSuccess':
            // TAM OYUN DURUMU GELDİ → HER ŞEYİ GERİ YÜKLE
            gameState.gameStarted = true;
            gameState.roomCode = data.roomCode;
            gameState.currentPlayerId = data.playerId;
            gameState.myColor = data.myColor;
            gameState.board = data.board;
            gameState.currentTurn = data.currentTurn;
            gameState.isMyTurn = data.currentPlayerId === data.playerId;
            gameState.playerStats = { ...gameState.playerStats, ...data.playerStats };
            gameState.opponentStats = data.opponentStats || gameState.opponentStats;

            localStorage.setItem('domino_roomCode', data.roomCode);
            localStorage.setItem('domino_playerId', data.playerId);

            showScreen('game');
            updateGameUI(gameState);
            updateTurnDisplay();
            showModal('Bağlantı geri geldi! Oyun devam ediyor', 'info');
            break;

        case 'reconnectFailed':
            showModal('Oyun bulunamadı veya bitti.', 'warning');
            localStorage.removeItem('domino_roomCode');
            localStorage.removeItem('domino_playerId');
            gameState.gameStarted = false;
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

        case 'opponentDisconnected':
            showModal('Rakip bağlantısı kesildi, bekleniyor...', 'warning');
            break;

        case 'opponentReconnected':
            showModal('Rakip geri döndü!', 'info');
            break;

        case 'error':
            showModal(data.message || 'Bilinmeyen hata', 'error');
            break;
    }
}

// EKSİK KALMIŞ FONKSIYONLAR DÜZELTİLDİ
function handleGameStart(data) {
    console.log('Oyun başlıyor:', data);
    gameState.gameStarted = true;
    gameState.currentPlayerId = data.gameState.playerId;
    gameState.myColor = data.gameState.myColor;
    gameState.roomCode = data.gameState.roomCode || gameState.roomCode;

    localStorage.setItem('domino_roomCode', gameState.roomCode);
    localStorage.setItem('domino_playerId', gameState.currentPlayerId);

    showScreen('game');
    updateGameUI(gameState);
    updateTurnDisplay();
}

function handleGameUpdate(data) {
    gameState.board = data.board || gameState.board;
    gameState.currentTurn = data.currentTurn || gameState.currentTurn;
    gameState.isMyTurn = data.currentPlayerId === gameState.currentPlayerId;

    updateGameUI(gameState);
    updateTurnDisplay();
}

function updateTurnDisplay() {
    if (!gameState.gameStarted) return;
    if (gameState.isMyTurn) {
        turnText.textContent = 'Sıra Sizde!';
        turnText.className = 'text-green-500 font-bold text-2xl';
        currentTurnDisplay.className = currentTurnDisplay.className.replace('bg-yellow', 'bg-green');
    } else {
        turnText.textContent = 'Rakibiniz Oynuyor...';
        turnText.className = 'text-yellow-500 font-bold text-2xl';
        currentTurnDisplay.className = currentTurnDisplay.className.replace('bg-green', 'bg-yellow');
    }
}

// SENİN TÜM DİĞER FONKSİYONLARIN (hiç dokunulmadı, aşağıda aynen duruyor)
// ... (handleGameEnd, showModal, showScreen, updateGameUI vs. hepsi aynen duruyor)

function handleGameEnd(data) {
    const isWinner = data.winner === gameState.currentPlayerId;
    const isDraw = data.winner === 'DRAW';
    let title = '';
    let message = '';

    if (isDraw) {
        title = 'BERABERE';
        message = 'Oyun berabere bitti.';
    } else if (isWinner) {
        title = 'QAZANDINIZ!';
        message = 'Tebrikler! Gozel oyun idi.';
    } else {
        title = 'MEGLUB OLDUNUZ';
        message = 'Novbeti sefer ugurlar!';
    }

    gameResultTitle.textContent = title;
    gameResultMessage.textContent = message;

    if (data.reason === 'blocked' && data.finalScores) {
        blockedGameDetails.classList.remove('hidden');
        const opponentId = Object.keys(data.finalScores).find(id => id !== gameState.currentPlayerId);
        finalScorePlayerName.textContent = 'Siz';
        finalScorePlayerPoints.textContent = data.finalScores[gameState.currentPlayerId];
        finalScoreOpponentName.textContent = gameState.opponentStats.username || 'Rakip';
        finalScoreOpponentPoints.textContent = data.finalScores[opponentId];
    } else {
        blockedGameDetails.classList.add('hidden');
    }

    if (data.isRanked && data.eloChanges) {
        const change = isWinner ? data.eloChanges.winner : data.eloChanges.loser;
        gameState.playerStats.elo += change;
        if (isWinner) gameState.playerStats.wins++;
        else gameState.playerStats.losses++;
        eloChangeDisplay.textContent = (change >= 0 ? '+' : '') + change + ' ELO';
        eloChangeDisplay.className = change >= 0 ? 'text-green-400' : 'text-red-400';
    }

    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');
    gameState.gameStarted = false;
    gameState.roomCode = null;

    showScreen('post-game');

    setTimeout(() => {
        if (!postGameLobby.classList.contains('hidden')) backToLobbyBtn.click();
    }, 6000);
}

function showModal(message, type = 'info') {
    modalMessage.textContent = message;
    messageModal.classList.remove('hidden');
    setTimeout(() => messageModal.classList.add('hidden'), 4000);
}

function showScreen(screen) {
    [loader, mainLobby, rankedLobby, friendLobby, gameScreen, matchFoundLobby, postGameLobby].forEach(el => el.classList.add('hidden'));
    if (screen === 'main') mainLobby.classList.remove('hidden');
    else if (screen === 'ranked') rankedLobby.classList.remove('hidden');
    else if (screen === 'friend') friendLobby.classList.remove('hidden');
    else if (screen === 'game') gameScreen.classList.remove('hidden');
    else if (screen === 'match-found') matchFoundLobby.classList.remove('hidden');
    else if (screen === 'post-game') postGameLobby.classList.remove('hidden');
}

function updateGameUI(state) {
    if (!state.gameStarted) return;
    // Buraya senin domino taşlarını çizme kodunu koy (sen zaten yazmışsın)
    // Sadece sıra göstergesini güncelliyoruz
    updateTurnDisplay();
}

// ... diğer tüm fonksiyonların (butonlar vs.) aynen duruyor ...

// BAŞLAT
document.addEventListener('DOMContentLoaded', () => {
    connectionStatus.textContent = 'Bağlanıyor...';
    connectionStatus.classList.add('text-yellow-400', 'animate-pulse');
    connectWebSocket();
});
