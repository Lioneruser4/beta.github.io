// --- DÜZELTME: Sunucu WebSocket kullandığı için socket.io yerine WebSocket API'si kullanılmalı ---
let socket;

function connectWebSocket() {
    // Sunucu adresini buraya girin. 'wss://' güvenli bağlantı içindir.
    // Yerelde çalışıyorsanız: 'ws://localhost:10000'
    // Render gibi bir serviste ise: 'wss://projenizin-adi.onrender.com'
    socket = new WebSocket('wss://mario-io-1.onrender.com');

// Yeniden baglanma durumu
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isWaitingForCancelConfirmation = false; // Yeni: İptal onayı bekleniyor mu?

    // --- WebSocket Eventleri ---
    socket.onopen = onSocketOpen;
    socket.onmessage = onSocketMessage;
    socket.onclose = onSocketClose;
    socket.onerror = onSocketError;
}
// Oyun durumu
let gameState = {
    board: [],
    currentTurn: 'red',
    currentPlayerId: null, // Sunucudan gelen güncel oyuncu ID'sini tutmak için
    selectedPiece: null,
    myColor: null,
    isMyTurn: false,
    roomCode: null,
    isSearching: false,
    gameStarted: false,
    isGuest: true, // Varsayılan olarak misafir
    playerStats: {
        elo: 0,
        wins: 0,
        losses: 0,
        draws: 0
    },
    opponentStats: {
        username: '',
        elo: 0
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
const matchFoundLobby = document.getElementById('match-found-lobby'); // YENİ: Eşleşme bulundu ekranı
const postGameLobby = document.getElementById('post-game-lobby'); // Yeni ekran
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

// YENİ: Kilitlenen oyun puan detayları elementleri
const blockedGameDetails = document.getElementById('blocked-game-details');
const finalScorePlayerName = document.getElementById('final-score-player-name');
const finalScorePlayerPoints = document.getElementById('final-score-player-points');
const finalScoreOpponentName = document.getElementById('final-score-opponent-name');
const finalScoreOpponentPoints = document.getElementById('final-score-opponent-points');

// Oyuncu istatistik elementleri
const playerEloElement = document.getElementById('player-elo');
const playerWinsElement = document.getElementById('player-wins');
const playerLossesElement = document.getElementById('player-losses');
const opponentNameElement = document.getElementById('opponent-name');
const opponentEloElement = document.getElementById('opponent-elo');

// YENİ: Eşleşme bulundu ekranı elementleri
const matchPlayer1Photo = document.getElementById('match-player1-photo');
const matchPlayer1Name = document.getElementById('match-player1-name');
const matchPlayer1Elo = document.getElementById('match-player1-elo');
const matchPlayer2Photo = document.getElementById('match-player2-photo');
const matchPlayer2Name = document.getElementById('match-player2-name');
const matchPlayer2Elo = document.getElementById('match-player2-elo');

const BOARD_SIZE = 8;

// --- WebSocket Event Handlers ---

function onSocketOpen() {
    console.log('✅ Sunucuya WebSocket ile bağlandı');
    connectionStatus.textContent = 'Servere baglandi!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');
    
}

function onSocketClose(event) {
    console.log('Sunucu bağlantısı kesildi:', event.reason || 'Bilinmeyen neden');
    connectionStatus.textContent = 'Bağlantı kesildi';
    connectionStatus.className = 'text-red-500';
    // Otomatik yeniden bağlanma mantığı
    if (!isReconnecting) {
        isReconnecting = true;
        attemptReconnect();
    }
}

function onSocketError(error) {
    console.error('WebSocket Hatası:', error);
    connectionStatus.textContent = 'Bağlantı hatası';
    connectionStatus.className = 'text-red-500';
}

function onSocketMessage(event) {
    const data = JSON.parse(event.data);
    console.log('⬅️ Sunucudan mesaj:', data);

    switch (data.type) {
        case 'connected':
            console.log('Sunucu onayı:', data.message);
            // --- YENİ: Yeniden bağlanma kontrolü ---
            if (data.isReconnect === false) { // Sadece ilk bağlantıda sıfırla
                const storedRoomCode = localStorage.getItem('domino_roomCode');
                const storedPlayerId = localStorage.getItem('domino_playerId');
                if (storedRoomCode && storedPlayerId) {
                    console.log('🔄 Kayıtlı oyun bulundu, yeniden bağlanma deneniyor...');
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
            clearInterval(searchTimer);
            searchTimer = null;
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
        // --- YENİ: Rakip bağlantı durumları ---
        case 'opponentDisconnected':
            showModal(data.message, 'warning');
            break;
        case 'opponentReconnected':
            showModal(data.message, 'info');
            break;
        // Diğer sunucu mesaj tipleri buraya eklenebilir
    }
}

function handleGameEnd(data) {
    // data: { winner, winnerName, isRanked, eloChanges, reason, finalScores }
    const isWinner = data.winner === gameState.currentPlayerId;
    const isDraw = data.winner === 'DRAW';
    let title = '';
    let message = '';

    if (isDraw) {
        title = '⚖️ BERABERE ⚖️';
        message = 'Oyun berabere bitti.';
    } else if (isWinner) {
        title = '🎉 QAZANDINIZ! 🎉';
        message = 'Tebrikler! Gozel oyun idi.';
    } else {
        title = '😔 MEGLUB OLDUNUZ 😔';
        message = 'Novbeti sefer ugurlar!';
    }

    gameResultTitle.textContent = title;
    gameResultMessage.textContent = message;

    // --- YENİ: Kilitlenen oyun detaylarını göster ---
    if (data.reason === 'blocked' && data.finalScores) {
        blockedGameDetails.classList.remove('hidden');
        const opponentId = Object.keys(data.finalScores).find(id => id !== gameState.currentPlayerId);

        finalScorePlayerName.textContent = gameState.playerStats.username || 'Siz';
        finalScorePlayerPoints.textContent = data.finalScores[gameState.currentPlayerId];

        finalScoreOpponentName.textContent = gameState.opponentStats.username || 'Rakip';
        finalScoreOpponentPoints.textContent = data.finalScores[opponentId];

        gameResultMessage.textContent = "En az puana sahip olduğunuz için kazandınız!";
    } else {
        blockedGameDetails.classList.add('hidden');
    }

    if (data.isRanked && data.eloChanges) {
        const change = isWinner ? data.eloChanges.winner : data.eloChanges.loser;
        const sign = change >= 0 ? '+' : '';
        eloChangeDisplay.textContent = `${sign}${change} Puan`;
        eloChangeDisplay.className = `text-2xl font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        // --- DÜZELTME: Puanı anlık olarak güncelle ---
        if (!isDraw) {
            gameState.playerStats.elo += change;
            if (isWinner) gameState.playerStats.wins++;
            else gameState.playerStats.losses++;
        } else {
            gameState.playerStats.draws++;
        }
        updatePlayerStats(); // Lobiye dönmeden önce UI'ı güncelle
    } else {
        eloChangeDisplay.textContent = 'Derecesiz Maç';
        eloChangeDisplay.className = 'text-2xl font-bold text-gray-400';
    }
    
    // Oyun durumunu temizle
    gameState.roomCode = null;
    gameState.gameStarted = false;
    gameState.isSearching = false;
    // --- DÜZELTME: Oyun bitince localStorage'ı temizle ---
    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');

    showScreen('post-game');

    // --- DÜZELTME: 3 saniye sonra otomatik olarak ana lobiye dön ---
    setTimeout(() => {
        // Eğer hala oyun sonu ekranındaysak (kullanıcı butona basmadıysa)
        if (postGameLobby.classList.contains('hidden') === false) {
            backToLobbyBtn.onclick(); // Lobiye dönme butonunun işlevini çağır
        }
    }, 5000); // 5 saniye bekle
}

function handleError(error) {
    console.error('Hata:', error);
    gameState.isSearching = false;
    gameState.roomCode = null;
    clearInterval(searchTimer);
    searchTimer = null;
    showModal(error.message || 'Bir hata oluştu');
    showScreen('main');
}

function handleMatchFound(data) {
    console.log('🔵 Eşleşme bulundu:', data);
    // Gerekli oyun durumlarını ayarla
    gameState.roomCode = data.roomCode;
    gameState.opponentStats = {
        username: data.opponent.name,
        elo: data.opponent.elo,
        photoUrl: data.opponent.photoUrl
    };
    gameState.isSearching = false;
    clearInterval(searchTimer);
    searchTimer = null;
    
    // --- YENİ: Eşleşme bulundu ekranını doldur ---
    matchPlayer1Name.textContent = gameState.playerStats.username || 'Siz';
    matchPlayer1Elo.textContent = `(${gameState.playerStats.elo || 0} ELO)`;
    matchPlayer1Photo.src = gameState.playerStats.photoUrl || 'https://via.placeholder.com/100'; // Kendi fotoğrafınız varsa

    matchPlayer2Name.textContent = data.opponent.name;
    matchPlayer2Elo.textContent = `(${data.opponent.elo || 0} ELO)`;
    matchPlayer2Photo.src = data.opponent.photoUrl || 'https://via.placeholder.com/100';

    showScreen('match-found'); // Yeni ekranı göster
}

function handleGameStart(data) {
    console.log('🎮 Oyun başlıyor:', data);
    gameState.gameStarted = true;
    gameState.currentPlayerId = data.gameState.playerId; // Sunucunun bize atadığı ID
    
    // --- YENİ: Yeniden bağlanma için bilgileri kaydet ---
    localStorage.setItem('domino_roomCode', gameState.roomCode);
    localStorage.setItem('domino_playerId', gameState.currentPlayerId);
    
    // Oyun ekranını göster
    showScreen('game');
    updateGameUI(data.gameState);
}

function handleGameUpdate(data) {
    console.log('🔄 Oyun durumu güncellendi');
    updateGameUI(data.gameState);
}

// --- WebSocket Mesaj Gönderme ---
function sendSocketMessage(type, payload = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type, ...payload });
        socket.send(message);
    } else {
        console.error('WebSocket bağlantısı açık değil. Mesaj gönderilemedi:', type);
    }
}

// --- Yardimci Funksiyalar ---
function showModal(message) {
    modalMessage.textContent = message;
    messageModal.classList.remove('hidden');
}

function showScreen(screen) {
    loader.classList.add('hidden');
    mainLobby.classList.add('hidden');
    rankedLobby.classList.add('hidden');
    friendLobby.classList.add('hidden');
    gameScreen.classList.add('hidden');
    matchFoundLobby.classList.add('hidden'); // Yeni ekranı gizle
    postGameLobby.classList.add('hidden');

    if (screen === 'main') {
        mainLobby.classList.remove('hidden');
        gameState.isSearching = false;
        clearInterval(searchTimer);
        searchTimer = null;
    } else if (screen === 'ranked') {
        rankedLobby.classList.remove('hidden');
        gameState.isSearching = true;
        searchTime = 0;
        startSearchTimer();
    } else if (screen === 'friend') {
        friendLobby.classList.remove('hidden');
        gameState.isSearching = false;
        clearInterval(searchTimer);
        searchTimer = null;
    } else if (screen === 'game') {
        gameScreen.classList.remove('hidden');
        clearInterval(searchTimer);
        searchTimer = null;
    } else if (screen === 'match-found') { // Yeni ekranı göster
        matchFoundLobby.classList.remove('hidden');
    } else if (screen === 'post-game') {
        postGameLobby.classList.remove('hidden');
    } else {
        loader.classList.remove('hidden');
    }
}

function startSearchTimer() {
    clearInterval(searchTimer);
    searchTimer = setInterval(() => {
        searchTime++;
        const minutes = Math.floor(searchTime / 60);
        const seconds = searchTime % 60;
        const timeString = minutes + ':' + seconds.toString().padStart(2, '0');
        rankedStatus.textContent = 'Raqib axtarilir... (' + timeString + ')';
    }, 1000);
}

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// --- UI Funksiyalari ---

function updateGameUI(newGameState) {
    if (!gameState.gameStarted) return;
    
    turnText.textContent = gameState.isMyTurn ? 'Sizdir!' : 'Raqibdir';
    currentTurnDisplay.className = 'w-full max-w-md mb-4 p-4 rounded-xl bg-gray-800 shadow-xl text-center ' + 
        (gameState.isMyTurn ? 'bg-green-700' : 'bg-yellow-700');
    
    // Domino oyununun UI güncelleme mantığı buraya gelecek.
    // Örneğin, oyuncunun elindeki taşları, masadaki taşları vb. gösterme.
    // Şimdilik sadece sıra bilgisini güncelliyoruz.
    gameState.board = newGameState.board;
    gameState.isMyTurn = newGameState.currentPlayer === gameState.currentPlayerId;
}

// --- Button Eventleri ---

function startMatchmaking(isGuest = false) {
    if (gameState.isSearching || isWaitingForCancelConfirmation) {
        console.log('⚠️ Zaten eşleşme aranıyor veya iptal onayı bekleniyor. Yeni arama başlatılamaz.');
        showModal('Zaten eşleşme aranıyor veya önceki aramanın iptali bekleniyor.', 'info');
        return;
    }
    if (isGuest && !gameState.isGuest) { // If trying to start guest match but not guest
        // This might be a redundant check depending on UI flow
        // For now, assume it's okay to proceed
    }
    
    console.log(`🔄 Eşleşme başlatılıyor: ${isGuest ? 'Misafir Modu' : 'Sıralı Maç'}`);
    
    gameState.isSearching = true;
    gameState.isGuest = isGuest;
    gameState.gameType = isGuest ? 'friendly' : 'ranked';
    
    const playerData = {
        telegramId: isGuest ? `guest_${Date.now()}` : 'user123', // TODO: Gerçek uygulamada bu kullanıcı kimliği olacak
        isGuest,
        gameType: gameState.gameType,
        timestamp: Date.now()
    };
    
    console.log('📤 Sunucuya eşleşme isteği gönderiliyor:', playerData);
    
    sendSocketMessage('findMatch', playerData);
    
    showScreen('ranked'); // 'searching' ekranı yerine 'ranked' lobisini göster
    rankedStatus.textContent = 'Eşleşme aranıyor...';
    startSearchTimer();
}

// Arama iptal etme fonksiyonu
function cancelSearch() {
    if (gameState.isSearching) {
        console.log('🔍 Eşleşme araması iptal ediliyor...');
        sendSocketMessage('cancelSearch');
        gameState.isSearching = false;
        stopSearchTimer();
        showScreen('main');
    }
}

// İptal butonunu ayarla
const cancelSearchBtn = document.getElementById('cancelSearchBtn');
if (cancelSearchBtn) {
    cancelSearchBtn.onclick = () => {
        cancelSearch();
    };
}

dereceliBtn.onclick = () => {
    if (gameState.isSearching) {
        cancelSearch();
        return;
    }
    // Eğer zaten arama yapılmıyorsa veya iptal onayı beklenmiyorsa yeni bir arama başlat
    if (!gameState.isSearching && !isWaitingForCancelConfirmation) {
        gameState.isSearching = true;
        gameState.gameType = 'ranked';
        gameState.isGuest = false;
        
        // Eşleşme isteği gönder (sadece Telegram kullanıcıları için)
        sendSocketMessage('findMatch', { 
            telegramId: 'user123', // TODO: Gerçek uygulamada bu kullanıcı ID'si olacak
            isGuest: false,
            gameType: 'ranked',
            playerData: gameState.playerStats
        });
        
        // Eşleşme ekranını göster
        showScreen('ranked'); // 'searching' ekranı yerine 'ranked' lobisini göster
        showStatus('Eşleşme aranıyor...');
        startSearchTimer();
    } else {
        console.log('⚠️ Zaten eşleşme aranıyor veya iptal onayı bekleniyor. Yeni arama başlatılamaz.');
        showModal('Zaten eşleşme aranıyor veya önceki aramanın iptali bekleniyor.', 'info');
    }
};

friendBtn.onclick = () => startMatchmaking(true);

cancelRankedBtn.onclick = () => {
    gameState.isSearching = false;
    sendSocketMessage('cancelSearch');
};

createRoomBtn.onclick = () => {
    // Önce arama yapılıyorsa iptal et
    if (gameState.isSearching) {
        cancelSearch();
    }
    
    // Oda kodu oluştur
    const roomCode = generateRoomCode(); // Bu fonksiyon client tarafında, server tarafında da var. Tutarlılık önemli.
    console.log(`🔄 Oda oluşturuluyor: ${roomCode}`);
    
    // Oyun durumunu güncelle
    gameState.roomCode = roomCode;
    gameState.myColor = 'red';
    gameState.isHost = true;
    gameState.isSearching = true;
    
    // Kullanıcıya bilgi göster
    showStatus('Oda oluşturuluyor...');
    showScreen('friend'); // 'searching' ekranı yerine 'friend' lobisini göster
    
    // Sunucuya oda oluşturma isteği gönder
    sendSocketMessage('createRoom', { 
        roomCode,
        playerName: gameState.playerName || 'Oyuncu',
        isGuest: gameState.isGuest || false
    });
};

backToMainBtn.onclick = () => {
    showScreen('main');
};

copyCodeBtn.onclick = () => {
    const code = roomCodeOutput.textContent;
    if (code && code !== '...') {
        navigator.clipboard.writeText(code).then(() => {
            showModal('Otaq kodu (' + code + ') kopyalandi!');
        }).catch(() => {
            showModal("Kopyalama xetasi: Kodu el ile kopyalayin.");
        });
    }
};

joinRoomBtn.onclick = () => {
    const roomCode = joinRoomInput.value.trim();
    if (roomCode.length !== 4) {
        showModal("Xahis edirik, 4 reqemli otaq kodunu daxil edin.");
        return;
    }
    
    gameState.roomCode = roomCode;
    gameState.myColor = 'white';
    sendSocketMessage('joinRoom', { roomCode });
};

backToLobbyBtn.onclick = () => {
    // Oyun durumunu sıfırla
    resetGameState();
    
    // Ana menüye dön
    showScreen('main');
};

leaveGameBtn.onclick = () => leaveGame();

// --- DÜZELTME: Oyundan çıkarken direkt lobiye dön ve durumu sıfırla ---
function leaveGame() {
    if (gameState.roomCode) {
        // Sunucuya oyundan ayrıldığımızı bildir. Sunucu diğer oyuncuya haber verecek.
        sendSocketMessage('leaveGame');
    }
    // Beklemeden direkt lobiye dön ve oyun durumunu sıfırla.
    // Oyun durumunu sıfırla
    resetGameState();
    // --- DÜZELTME: Oyundan çıkınca localStorage'ı temizle ---
    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');
    
    showScreen('main');
}

// Odaya katılma fonksiyonu
function joinRoom(roomCode) {
    if (!roomCode || roomCode.length !== 6) {
        showModal('Lütfen geçerli bir oda kodu giriniz (6 karakter)', 'error');
        return;
    }
    
    console.log(`🔄 Odaya katılmaya çalışılıyor: ${roomCode}`);
    showStatus('Odaya katılıyor...');
    showScreen('friend'); // 'searching' ekranı yerine 'friend' lobisini göster
    
    gameState.roomCode = roomCode;
    gameState.isHost = false;
    gameState.isSearching = true;
    
    sendSocketMessage('joinRoom', {
        roomCode,
        playerName: gameState.playerName || 'Oyuncu',
        isGuest: gameState.isGuest || false
    });
}

// Oyun durumunu sıfırla
function resetGameState() {
    gameState = {
        board: [],
        currentPlayerId: null,
        currentTurn: 'red',
        selectedPiece: null,
        myColor: null,
        isMyTurn: false,
        roomCode: null,
        isSearching: false,
        gameStarted: false,
        isGuest: false,
        playerStats: {
            elo: 0,
            wins: 0,
            losses: 0,
            draws: 0
        },
        opponentStats: {
            username: '',
            elo: 0
        }
    };
    
    // Arayüzü güncelle
    updatePlayerStats(); // Sıfırlanmış verilerle UI'ı temizle
}

// Oyuncu istatistiklerini güncelle
function updatePlayerStats() {
    if (gameState.playerStats) {
        const playerElo = document.getElementById('player-elo');
        const playerWins = document.getElementById('player-wins');
        const playerLosses = document.getElementById('player-losses');
        const playerDraws = document.getElementById('player-draws');
        
        if (playerElo) playerElo.textContent = gameState.playerStats.elo || 0;
        if (playerWins) playerWins.textContent = gameState.playerStats.wins || 0;
        if (playerLosses) playerLosses.textContent = gameState.playerStats.losses || 0;
        if (playerDraws) playerDraws.textContent = gameState.playerStats.draws || 0;
    }
    
    if (gameState.opponentStats) {
        const opponentName = document.getElementById('opponent-name');
        const opponentElo = document.getElementById('opponent-elo');
        
        if (opponentName) opponentName.textContent = gameState.opponentStats.username || 'Rəqib';
        if (opponentElo) opponentElo.textContent = `(${gameState.opponentStats.elo || 0})`;
    }
}

// Yeniden bağlanma denemesi
function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showModal('Sunucuya yeniden bağlanılamadı. Lütfen sayfayı yenileyin.', 'error');
        return;
    }
    
    reconnectAttempts++;
    console.log(`Yeniden bağlanma denemesi ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
    
    // 2 saniye sonra yeni bir WebSocket bağlantısı kurmayı dene
    setTimeout(() => {
        connectWebSocket();
    }, 2000);
}

// Durum mesajını göster
function showStatus(message) {
    const statusElement = document.getElementById('status-message');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

modalCloseBtn.onclick = () => {
    messageModal.classList.add('hidden');
}

// Baslangic
document.addEventListener('DOMContentLoaded', () => {
    connectionStatus.textContent = 'Servere qosulur...';
    connectionStatus.classList.add('text-yellow-400', 'animate-pulse');
    connectWebSocket(); // Sayfa yüklendiğinde WebSocket bağlantısını başlat
});
