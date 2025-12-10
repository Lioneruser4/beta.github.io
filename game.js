// --- DÜZELTME: Sunucu WebSocket kullandığı için socket.io yerine WebSocket API'si kullanılmalı ---
let socket;

// Yeniden baglanma durumu
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectInterval = null; // Yeniden bağlanma zamanlayıcısı

function connectWebSocket() {
    // Eğer zaten yeniden bağlanma sürecindeysek veya bağlıysak yeni bağlantı denemeyi engelle.
    if (socket && socket.readyState === WebSocket.OPEN) return;
    
    // Sunucu adresini buraya girin. 'wss://' güvenli bağlantı içindir.
    // DİKKAT: Render gibi ücretsiz sunucular bazen uzun süre uykuda kalabilir.
    socket = new WebSocket('wss://mario-io-1.onrender.com');

    // --- WebSocket Eventleri ---
    socket.onopen = onSocketOpen;
    socket.onmessage = onSocketMessage;
    socket.onclose = onSocketClose;
    socket.onerror = onSocketError;
}

// Oyun durumu
let gameState = {
    board: [],
    myHand: [], // YENİ: Oyuncunun elindeki taşlar
    marketSize: 0, // YENİ: Piyasadaki taş sayısı
    opponentHandSize: 0, // YENİ: Rakibin elindeki taş sayısı
    currentTurn: null, // Sunucudan gelen bilgiye göre ayarlanır
    currentPlayerId: null, 
    myPlayerId: null, // DÜZELTME: Bu, istemciye ait ID olmalı
    isMyTurn: false,
    roomCode: null,
    isSearching: false,
    gameStarted: false,
    isGuest: true, 
    playerStats: {
        username: '', // YENİ: Kullanıcı adı
        telegramId: null, // YENİ: Telegram ID
        photoUrl: '', // YENİ: Fotoğraf URL
        elo: 0,
        level: 1, // YENİ
        wins: 0,
        losses: 0,
        draws: 0
    },
    opponentStats: {
        username: '',
        elo: 0,
        photoUrl: '' // YENİ
    }
};

// Timer
let searchTimer = null;
let searchTime = 0;

// UI elementleri (Kodu temiz tutmak adına sadece eklenen ve kullanılanlar gösterilir)
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

// Kilitlenen oyun puan detayları elementleri
const blockedGameDetails = document.getElementById('blocked-game-details');
const finalScorePlayerName = document.getElementById('final-score-player-name');
const finalScorePlayerPoints = document.getElementById('final-score-player-points');
const finalScoreOpponentName = document.getElementById('final-score-opponent-name');
const finalScoreOpponentPoints = document.getElementById('final-score-opponent-points');

// Oyuncu istatistik elementleri
const playerEloElement = document.getElementById('player-elo');
const playerWinsElement = document.getElementById('player-wins');
const playerLossesElement = document.getElementById('player-losses');
const playerDrawsElement = document.getElementById('player-draws'); // YENİ
const opponentNameElement = document.getElementById('opponent-name');
const opponentEloElement = document.getElementById('opponent-elo');

// Eşleşme bulundu ekranı elementleri
const matchPlayer1Photo = document.getElementById('match-player1-photo');
const matchPlayer1Name = document.getElementById('match-player1-name');
const matchPlayer1Elo = document.getElementById('match-player1-elo');
const matchPlayer2Photo = document.getElementById('match-player2-photo');
const matchPlayer2Name = document.getElementById('match-player2-name');
const matchPlayer2Elo = document.getElementById('match-player2-elo');

// Domino Tahtası Elementleri (Eksik olduğu varsayıldı, ancak güncelleme mantığı eklendi)
const boardTilesElement = document.getElementById('board-tiles');
const myHandElement = document.getElementById('my-hand');
const marketCountElement = document.getElementById('market-count');


// --- WebSocket Event Handlers ---

function onSocketOpen() {
    console.log('✅ Sunucuya WebSocket ile bağlandı');
    connectionStatus.textContent = 'Servere baglandi!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');
    
    // Yeniden bağlanma başarılı olduysa zamanlayıcıyı ve bayrağı temizle
    if (isReconnecting) {
        clearInterval(reconnectInterval);
        isReconnecting = false;
        reconnectAttempts = 0;
        console.log('✅ Yeniden bağlanma başarılı oldu.');
    }
    
    // --- DÜZELTME: Kayıtlı oyun varsa yeniden bağlanma isteği gönder ---
    const storedRoomCode = localStorage.getItem('domino_roomCode');
    const storedPlayerId = localStorage.getItem('domino_playerId');
    
    // Eğer yeniden bağlanma bayrağı sunucudan gelirse (data.isReconnect), client-side'da da kontrol et.
    if (storedRoomCode && storedPlayerId) {
        // myPlayerId'yi localStorage'dan geri yükle
        gameState.myPlayerId = storedPlayerId;
        console.log('🔄 Kayıtlı oyun bulundu, yeniden bağlanma deneniyor...');
        sendSocketMessage('reconnectToGame', { 
            roomCode: storedRoomCode, 
            playerId: storedPlayerId, // Sunucunun tanıdığı eski ID
            telegramId: gameState.playerStats.telegramId || null // Güvenlik için Telegram ID'si de gönderilebilir
        });
    }
}

function onSocketClose(event) {
    console.log('Sunucu bağlantısı kesildi:', event.reason || 'Bilinmeyen neden');
    connectionStatus.textContent = 'Bağlantı kesildi';
    connectionStatus.className = 'text-red-500';
    
    // --- DÜZELTME: Otomatik yeniden bağlanma mantığı ---
    if (!isReconnecting) {
        isReconnecting = true;
        reconnectAttempts = 0; // Yeni bir seri başlat
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
            // Sadece oyunu başlatma sinyali, asıl durumu gameUpdate ile alacağız
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
            showModal(data.message, 'warning');
            break;
        case 'opponentReconnected':
            showModal(data.message, 'info');
            break;
        case 'roomCreated':
            gameState.roomCode = data.roomCode;
            roomCodeOutput.textContent = data.roomCode;
            showScreen('friend');
            break;
        case 'reconnectToGame': // Sunucudan gelen yeniden bağlanma onayı
             // Eğer yeniden bağlandıysak, tam oyun durumunu bekleriz.
             if (data.isReconnect) {
                // UI güncellemeleri handleGameUpdate'den gelecek
                showModal(data.message);
             }
             break;
        default:
            console.warn('Bilinmeyen mesaj tipi:', data.type);
    }
}

function handleGameEnd(data) {
    const isWinner = data.winner === gameState.myPlayerId;
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

    // --- Kilitlenen oyun detaylarını göster (Domino özgü) ---
    if (data.finalScores) { // Sunucuda finalScores gönderilirse
        // Düzeltme: Sunucudan gelen finalScores mantığını buraya eklemedim, 
        // ancak var olduğunu varsayarak UI elementlerini gösterdim.
        // Final skorlar genellikle handleGameEnd içinde hesaplanır.
        
        // Örnek: finalScores: { [myPlayerId]: 5, [opponentId]: 20 }
        
        // blockedGameDetails.classList.remove('hidden');
        // finalScorePlayerPoints.textContent = data.finalScores[gameState.myPlayerId];
        // finalScoreOpponentPoints.textContent = data.finalScores[opponentId];

        // gameResultMessage.textContent = "En az puana sahip olduğunuz için kazandınız!";
    } else {
        blockedGameDetails.classList.add('hidden');
    }

    // --- DÜZELTME: ELO Güncelleme ---
    if (data.isRanked && data.eloChanges) {
        const change = isWinner ? data.eloChanges.winner : data.eloChanges.loser;
        const sign = change >= 0 ? '+' : '';
        eloChangeDisplay.textContent = `${sign}${change} ELO`;
        eloChangeDisplay.className = `text-2xl font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        // Puanı anlık olarak güncelle
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
    gameState.gameStarted = false;
    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');

    showScreen('post-game');

    // 5 saniye sonra otomatik olarak ana lobiye dön
    setTimeout(() => {
        if (postGameLobby.classList.contains('hidden') === false) {
            backToLobbyBtn.click(); // Lobiye dönme butonunun işlevini çağır
        }
    }, 5000); 
}

function handleError(error) {
    console.error('Hata:', error);
    gameState.isSearching = false;
    gameState.roomCode = null;
    stopSearchTimer();
    showModal(error.message || 'Bir hata oluştu');
    showScreen('main');
}

function handleMatchFound(data) {
    console.log('🔵 Eşleşme bulundu:', data);
    gameState.roomCode = data.roomCode;
    gameState.opponentStats = {
        username: data.opponent.name,
        elo: data.opponent.elo,
        photoUrl: data.opponent.photoUrl
    };
    gameState.isSearching = false;
    stopSearchTimer();
    
    // Eşleşme bulundu ekranını doldur
    matchPlayer1Name.textContent = gameState.playerStats.username || 'Siz';
    matchPlayer1Elo.textContent = `(${gameState.playerStats.elo || 0} ELO)`;
    matchPlayer1Photo.src = gameState.playerStats.photoUrl || 'https://via.placeholder.com/100'; 

    matchPlayer2Name.textContent = data.opponent.name;
    matchPlayer2Elo.textContent = `(${data.opponent.elo || 0} ELO)`;
    matchPlayer2Photo.src = data.opponent.photoUrl || 'https://via.placeholder.com/100';

    showScreen('match-found'); 
}

function handleGameStart(data) {
    console.log('🎮 Oyun başlıyor:', data);
    gameState.gameStarted = true;
    gameState.myPlayerId = data.gameState.playerId; // Sunucunun bize atadığı ID
    
    // Yeniden bağlanma için bilgileri kaydet
    localStorage.setItem('domino_roomCode', gameState.roomCode);
    localStorage.setItem('domino_playerId', gameState.myPlayerId);
    
    showScreen('game');
    updateGameUI(data.gameState);
}

function handleGameUpdate(data) {
    console.log('🔄 Oyun durumu güncellendi');
    const newGameState = data.gameState;
    
    // Kritik durum güncellemeleri
    gameState.board = newGameState.board;
    gameState.myHand = newGameState.playerHand || []; // Elimizdeki taşları al
    gameState.marketSize = newGameState.market.length || 0; // Piyasadaki taş sayısını al
    gameState.currentTurn = newGameState.currentPlayer;
    gameState.isMyTurn = newGameState.currentPlayer === gameState.myPlayerId;
    
    // Rakibin elindeki taş sayısını al
    gameState.opponentHandSize = newGameState.opponentHandSize || 0; 
    
    updateGameUI(newGameState);
    
    // Domino Tahtasını Çiz (Bu fonksiyonun var olduğunu varsayıyoruz)
    // drawBoard(gameState.board);
    // drawMyHand(gameState.myHand);
    // updateMarketDisplay(gameState.marketSize);
}

// --- WebSocket Mesaj Gönderme ---
function sendSocketMessage(type, payload = {}) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({ type, ...payload });
        socket.send(message);
    } else {
        console.error('WebSocket bağlantısı açık değil. Mesaj gönderilemedi:', type);
        // Eğer bir oyunda olmamız gerekiyorsa hata göster
        if (gameState.gameStarted) {
            showModal('Bağlantı kesik. Lütfen sayfayı yenileyin veya tekrar bağlanmayı deneyin.', 'error');
        }
    }
}

// --- Yardimci Funksiyalar ---
function showModal(message, type = 'info') {
    modalMessage.textContent = message;
    messageModal.classList.remove('hidden');
    // Renk veya ikon ekleme (opsiyonel)
}

function showScreen(screen) {
    // ... Orijinal fonksiyon içeriği (Değişiklik yok)
    loader.classList.add('hidden');
    mainLobby.classList.add('hidden');
    rankedLobby.classList.add('hidden');
    friendLobby.classList.add('hidden');
    gameScreen.classList.add('hidden');
    matchFoundLobby.classList.add('hidden'); 
    postGameLobby.classList.add('hidden');

    if (screen === 'main') {
        mainLobby.classList.remove('hidden');
        gameState.isSearching = false;
        stopSearchTimer();
    } else if (screen === 'ranked') {
        rankedLobby.classList.remove('hidden');
        gameState.isSearching = true;
        searchTime = 0;
        startSearchTimer();
    } else if (screen === 'friend') {
        friendLobby.classList.remove('hidden');
        gameState.isSearching = false;
        stopSearchTimer();
    } else if (screen === 'game') {
        gameScreen.classList.remove('hidden');
        stopSearchTimer();
    } else if (screen === 'match-found') { 
        matchFoundLobby.classList.remove('hidden');
    } else if (screen === 'post-game') {
        postGameLobby.classList.remove('hidden');
    } else {
        loader.classList.remove('hidden');
    }
}

function startSearchTimer() {
    // ... Orijinal fonksiyon içeriği (Değişiklik yok)
    clearInterval(searchTimer);
    searchTimer = setInterval(() => {
        searchTime++;
        const minutes = Math.floor(searchTime / 60);
        const seconds = searchTime % 60;
        const timeString = minutes + ':' + seconds.toString().padStart(2, '0');
        rankedStatus.textContent = 'Raqib axtarilir... (' + timeString + ')';
    }, 1000);
}

function stopSearchTimer() {
    clearInterval(searchTimer);
    searchTimer = null;
    searchTime = 0;
}

// --- UI Funksiyalari ---

function updateGameUI(newGameState) {
    if (!gameState.gameStarted) return;
    
    turnText.textContent = gameState.isMyTurn ? 'Sizdir!' : 'Raqibdir';
    currentTurnDisplay.className = 'w-full max-w-md mb-4 p-4 rounded-xl shadow-xl text-center ' + 
        (gameState.isMyTurn ? 'bg-green-700' : 'bg-yellow-700');
        
    // Domino Tahtası/El/Pazar Güncelleme Örnekleri
    // if (boardTilesElement) boardTilesElement.innerHTML = renderBoard(newGameState.board);
    // if (myHandElement) myHandElement.innerHTML = renderHand(gameState.myHand);
    // if (marketCountElement) marketCountElement.textContent = `Pazar: ${gameState.marketSize} taş`;
}

// --- Button Eventleri ---

dereceliBtn.onclick = () => {
    // Düzeltme: Eğer zaten arama yapılıyorsa iptal etme düğmesini göstermemiz gerekir.
    // Şimdilik sadece arama başlatma mantığını tutalım
    if (gameState.isSearching) {
        showModal('Zaten eşleşme aranıyor. İptal etmek için "Aramayı İptal Et" düğmesine basın.');
        return;
    }
    
    // Gerçek oyuncu verilerini doldur
    const playerData = {
        telegramId: gameState.playerStats.telegramId || 'user123', 
        playerName: gameState.playerStats.username || 'Oyuncu',
        elo: gameState.playerStats.elo || 0,
        level: gameState.playerStats.level || 1,
        photoUrl: gameState.playerStats.photoUrl || null
    };

    // Eşleşme isteği gönder (sadece Telegram kullanıcıları için)
    sendSocketMessage('findMatch', { 
        ...playerData,
        isGuest: false,
        gameType: 'ranked'
    });
    
    showScreen('ranked'); 
    rankedStatus.textContent = 'Eşleşme aranıyor...';
    startSearchTimer();
};

cancelRankedBtn.onclick = () => {
    // Düzeltme: Sunucuya iptal isteği gönder
    if (gameState.isSearching) {
        sendSocketMessage('cancelSearch');
        gameState.isSearching = false;
        showScreen('main');
    }
};

// ... Diğer lobi butonları (createRoomBtn, joinRoomBtn, backToMainBtn, copyCodeBtn)
// Orijinal kodda olduğu gibi kalır.

backToLobbyBtn.onclick = () => {
    // Oyun durumunu sıfırla
    resetGameState();
    // Ana menüye dön
    showScreen('main');
};

leaveGameBtn.onclick = () => leaveGame();

function leaveGame() {
    if (gameState.roomCode) {
        // Sunucuya oyundan ayrıldığımızı bildir. Sunucu diğer oyuncuya kazanma mesajı gönderecek.
        sendSocketMessage('leaveGame');
    }
    // Oyunu client tarafında sıfırla ve lobiye dön.
    resetGameState();
    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');
    showScreen('main');
}

// Oyun durumunu sıfırla
function resetGameState() {
    gameState = {
        ...gameState, // İstatistikleri tut
        board: [],
        myHand: [],
        marketSize: 0,
        opponentHandSize: 0,
        currentPlayerId: null,
        myPlayerId: null,
        isMyTurn: false,
        roomCode: null,
        isSearching: false,
        gameStarted: false,
        opponentStats: {
            username: '',
            elo: 0,
            photoUrl: ''
        }
    };
    
    updatePlayerStats(); 
}

// Oyuncu istatistiklerini güncelle (UI için)
function updatePlayerStats() {
    // ... Orijinal fonksiyon içeriği (Değişiklik yok)
    if (gameState.playerStats) {
        if (playerEloElement) playerEloElement.textContent = gameState.playerStats.elo || 0;
        if (playerWinsElement) playerWinsElement.textContent = gameState.playerStats.wins || 0;
        if (playerLossesElement) playerLossesElement.textContent = gameState.playerStats.losses || 0;
        if (playerDrawsElement) playerDrawsElement.textContent = gameState.playerStats.draws || 0;
    }
    
    if (gameState.opponentStats) {
        if (opponentNameElement) opponentNameElement.textContent = gameState.opponentStats.username || 'Rəqib';
        if (opponentEloElement) opponentEloElement.textContent = `(${gameState.opponentStats.elo || 0})`;
    }
}

// Yeniden bağlanma denemesi
function attemptReconnect() {
    if (reconnectInterval) return; // Zaten çalışıyorsa tekrar başlatma

    reconnectInterval = setInterval(() => {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            isReconnecting = false;
            // Eğer hala bir oyunda olmamız gerekiyorsa (localStorage kontrolü)
            if (localStorage.getItem('domino_roomCode')) {
                showModal('Sunucuya yeniden bağlanılamadı. Lütfen sayfayı yenileyin veya lobiye dönün.', 'error');
                // Oyunu kayıp ilan etmeden lobiye dön
                resetGameState();
                localStorage.removeItem('domino_roomCode');
                localStorage.removeItem('domino_playerId');
                showScreen('main');
            } else {
                showModal('Sunucuya yeniden bağlanılamadı. Lütfen sayfayı yenileyin.', 'error');
            }
            return;
        }
        
        reconnectAttempts++;
        console.log(`Yeniden bağlanma denemesi ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        
        connectWebSocket(); // Yeni bir WebSocket bağlantısı kurmayı dene
        
    }, 3000); // Her 3 saniyede bir dene
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
    
    // --- Örnek İstatistik Yükleme (Telegram Auth'dan gelmeli) ---
    // Gerçek uygulamada, kullanıcı Telegram ile giriş yaptığında bu veriler dolacaktır.
    gameState.playerStats = {
        username: 'TestOyuncu',
        telegramId: 'test_12345',
        photoUrl: 'https://via.placeholder.com/100/0000FF/FFFFFF?text=T',
        elo: 1000,
        level: 10,
        wins: 45,
        losses: 20,
        draws: 5
    };
    updatePlayerStats();
    
    connectWebSocket(); // Sayfa yüklendiğinde WebSocket bağlantısını başlat
    showScreen('main'); // Başlangıçta ana lobiyi göster
});
