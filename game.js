// --- DOMINO OYUNU DÜZELTİLMİŞ KOD (WebSocket Reconnection Fix) ---

let socket;
// Bu değişkenleri fonksiyon dışına taşıdık (Global Scope) ki sıfırlanmasınlar
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let isWaitingForCancelConfirmation = false;

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
    }
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

const BOARD_SIZE = 8;

// --- WebSocket Bağlantı Fonksiyonu ---
function connectWebSocket() {
    // Render URL'niz
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

    // 1. Durum: Sayfa yenilenmeden kopma olduysa (gameState hafızada duruyorsa)
    if (gameState.gameStarted && gameState.roomCode && gameState.currentPlayerId) {
        console.log('🔄 Anlık kopma tespit edildi, oyuna tekrar bağlanılıyor...');
        sendSocketMessage('reconnectToGame', { 
            roomCode: gameState.roomCode, 
            playerId: gameState.currentPlayerId 
        });
    }
    // 2. Durum: Sayfa yenilendiyse (localStorage kontrolü connected mesajında yapılır)
}

function onSocketClose(event) {
    console.log('❌ Sunucu bağlantısı kesildi:', event.reason || 'Bilinmeyen neden');
    connectionStatus.textContent = 'Bağlantı kesildi, tekrar bağlanılıyor...';
    connectionStatus.className = 'text-red-500 animate-pulse';
    
    // Otomatik yeniden bağlanma
    if (!isReconnecting) {
        isReconnecting = true;
        setTimeout(attemptReconnect, 1000);
    }
}

function onSocketError(error) {
    console.error('⚠️ WebSocket Hatası:', error);
    // Hata durumunda close tetikleneceği için burada reconnect çağırmıyoruz
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

// --- YENİ EKLENEN FONKSİYON: Mesaj Gönderme ---
// Taş atılamama sorunu genelde socket'in hazır olmamasından kaynaklanır.
function sendSocketMessage(type, payload = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type, ...payload });
        socket.send(message);
        // console.log(`📤 Gönderildi: ${type}`, payload); // Log kirliliği yapmaması için kapalı
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
                // Sayfa yenilendiğinde LocalStorage kontrolü
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
                // Kısa süre sonra modalı kapat
                setTimeout(() => messageModal.classList.add('hidden'), 2000);
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
    
    // Eşleşme ekranını doldur
    if(matchPlayer1Name) matchPlayer1Name.textContent = gameState.playerStats.username || 'Siz';
    if(matchPlayer1Elo) matchPlayer1Elo.textContent = `(${gameState.playerStats.elo || 0})`;
    if(matchPlayer2Name) matchPlayer2Name.textContent = data.opponent.name || 'Rakip';
    if(matchPlayer2Elo) matchPlayer2Elo.textContent = `(${data.opponent.elo || 0})`;

    showScreen('match-found');
}

function handleGameStart(data) {
    console.log('🎮 Oyun başladı!');
    gameState.gameStarted = true;
    gameState.currentPlayerId = data.gameState.playerId; // Sunucunun atadığı ID
    
    // LocalStorage kaydı (Reconnection için)
    localStorage.setItem('domino_roomCode', gameState.roomCode);
    localStorage.setItem('domino_playerId', gameState.currentPlayerId);
    
    showScreen('game');
    updateGameUI(data.gameState); // İlk durumu çiz
}

function handleGameUpdate(data) {
    console.log('🔄 Oyun durumu güncelleniyor...', data);
    
    // Eğer bağlantı koptuysa ve tekrar geldiyse, bu veriyle oyunu senkronize et
    if (!gameState.gameStarted) {
         gameState.gameStarted = true;
         showScreen('game');
    }

    // Kritik verileri güncelle
    gameState.board = data.board || [];
    gameState.currentTurn = data.currentTurn; // 'red' veya 'white' vb.
    
    // Eğer sunucu playerId göndermiyorsa mevcut olanı koru
    if (data.currentPlayerId) gameState.currentPlayerId = data.currentPlayerId;
    
    // Sıra kontrolü (Sunucudan gelen currentTurn, benim ID'me veya Rengime eşit mi?)
    // NOT: Sunucu mantığınıza göre burayı kontrol edin. Genelde 'turn' player ID'sidir.
    gameState.isMyTurn = (data.currentTurn === gameState.currentPlayerId);
    
    // UI Güncelle
    updateGameUI(gameState);
}

function updateGameUI(state) {
    // 1. Sıra bilgisini güncelle
    if (state.currentTurn === gameState.currentPlayerId) {
        turnText.textContent = 'Sıra Sizde!';
        currentTurnDisplay.classList.remove('bg-yellow-700');
        currentTurnDisplay.classList.add('bg-green-700');
    } else {
        turnText.textContent = 'Rakip Oynuyor...';
        currentTurnDisplay.classList.remove('bg-green-700');
        currentTurnDisplay.classList.add('bg-yellow-700');
    }

    // 2. Tahtayı çiz (Burada sizin özel domino çizim kodunuz olmalı)
    // Örnek basit çizim:
    boardElement.innerHTML = ''; // Temizle
    
    // Eğer 'board' verisi varsa
    if (state.board && Array.isArray(state.board)) {
        state.board.forEach(piece => {
            const pieceDiv = document.createElement('div');
            // Taşları temsil eden basit stil
            pieceDiv.className = 'domino-piece bg-white text-black p-2 m-1 rounded border border-gray-400';
            pieceDiv.innerText = `${piece.left} | ${piece.right}`;
            boardElement.appendChild(pieceDiv);
        });
    }

    // NOT: Kendi elinizdeki taşları da çizmeniz lazım. 
    // Sunucu 'hand' (el) bilgisini 'gameUpdate' içinde gönderiyorsa onu kullanın.
}

function handleGameEnd(data) {
    const isWinner = data.winner === gameState.currentPlayerId;
    const isDraw = data.winner === 'DRAW';
    
    let title = isDraw ? '⚖️ BERABERE' : (isWinner ? '🎉 KAZANDINIZ!' : '😔 KAYBETTİNİZ');
    let message = isDraw ? 'Oyun berabere bitti.' : (isWinner ? 'Tebrikler!' : 'Bir dahaki sefere...');

    gameResultTitle.textContent = title;
    gameResultMessage.textContent = message;

    // Kilitlenen oyun detayları
    if (data.reason === 'blocked' && data.finalScores) {
        blockedGameDetails.classList.remove('hidden');
        // Skorları yazdır...
    } else {
        blockedGameDetails.classList.add('hidden');
    }

    // ELO Değişimi
    if (data.isRanked && data.eloChanges) {
        const change = isWinner ? data.eloChanges.winner : data.eloChanges.loser;
        eloChangeDisplay.textContent = `${change > 0 ? '+' : ''}${change} Puan`;
        eloChangeDisplay.className = `text-2xl font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
    } else {
        eloChangeDisplay.textContent = '';
    }

    // Temizlik
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
    // Tüm ekranları gizle
    [mainLobby, rankedLobby, friendLobby, gameScreen, matchFoundLobby, postGameLobby, loader].forEach(el => {
        if(el) el.classList.add('hidden');
    });

    // İstenen ekranı aç
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

// --- Buton Eventleri ---

if(dereceliBtn) dereceliBtn.onclick = () => {
    if (gameState.isSearching) return;
    gameState.isSearching = true;
    gameState.gameType = 'ranked';
    
    sendSocketMessage('findMatch', { 
        isGuest: false,
        gameType: 'ranked',
        telegramId: 'user_' + Math.floor(Math.random()*1000) // Test ID
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
