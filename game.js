// Oyun durumu
const gameState = {
    roomId: null,
    playerId: null,
    playerNumber: null,
    isGameStarted: false,
    isSearching: false,
    socket: null,
    opponent: null,
    roomCode: null
};

// HTML elementleri
const elements = {
    loadingMessage: document.getElementById('loadingMessage'),
    loadingText: document.getElementById('loadingText'),
    status: document.getElementById('status'),
    gameScreen: document.getElementById('gameScreen'),
    mainMenu: document.getElementById('mainMenu'),
    createGameBtn: document.getElementById('createGameBtn'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    joinButton: document.getElementById('joinButton'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    roomInfo: document.getElementById('roomInfo'),
    opponentInfo: document.getElementById('opponentInfo'),
    playerInfo: document.getElementById('playerInfo')
};

// Socket.IO bağlantısı
function initializeSocket() {
    console.log('Socket bağlantısı başlatılıyor...');
    
    // Eğer zaten bir socket bağlantısı varsa kapat
    if (gameState.socket) {
        console.log('Mevcut socket bağlantısı kapatılıyor...');
        gameState.socket.disconnect();
    }
    
    // Sunucu URL'sini belirle
    const serverUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:3000' 
        : window.location.origin;
    
    console.log('Sunucuya bağlanılıyor:', serverUrl);
    
    // Yeni bir socket bağlantısı oluştur
    gameState.socket = io(serverUrl, {
        path: 'https://mario-io-1.onrender.com',
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        autoConnect: true,
        transports: ['websocket', 'polling'],
        upgrade: true,
        forceNew: true,
        withCredentials: false,
        extraHeaders: {
            'Access-Control-Allow-Origin': '*'
        }
    });
    
    // Hata ayıklama için olay dinleyicileri ekle
    gameState.socket.on('connect', () => {
        console.log('Sunucuya başarıyla bağlandı. Socket ID:', gameState.socket.id);
        updateStatus('Sunucuya bağlandı');
    });
    
    gameState.socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        updateStatus('Bağlantı hatası: ' + error.message, true);
    });
    
    gameState.socket.on('disconnect', (reason) => {
        console.log('Bağlantı kesildi. Sebep:', reason);
        updateStatus('Sunucu bağlantısı kesildi. Tekrar bağlanılıyor...', true);
    });
    
    gameState.socket.on('reconnect_attempt', () => {
        console.log('Yeniden bağlanılmaya çalışılıyor...');
        updateStatus('Sunucuya yeniden bağlanılıyor...');
    });
    
    gameState.socket.on('reconnect_failed', () => {
        console.error('Yeniden bağlantı başarısız oldu');
        updateStatus('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', true);
    });
    
    // Socket olaylarını dinle
    setupSocketListeners();
    
    return gameState.socket;
}

// Socket olaylarını ayarla
function setupSocketListeners() {
    const socket = gameState.socket;
    
    // Bağlantı başarılı olduğunda
    socket.on('connect', () => {
        console.log('Sunucuya bağlandı');
        updateStatus('Sunucuya bağlandı');
    });
    
    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        updateStatus('Sunucu bağlantısı koptu. Tekrar bağlanılıyor...', true);
    });
    
    // Bağlantı hatası olduğunda
    socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        updateStatus('Bağlantı hatası: ' + error.message, true);
    });
    
    // Oyun başlatıldığında
    socket.on('gameStart', (data) => {
        gameState.roomId = data.roomCode;
        gameState.playerNumber = data.playerColor;
        gameState.opponent = {
            name: data.opponentName,
            color: data.playerColor === 'black' ? 'white' : 'black'
        };
        gameState.isGameStarted = true;
        
        // Oyun ekranını göster
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'block';
        
        // Oyun tahtasını güncelle
        updateGameBoard(data.board);
        updatePlayerInfo();
        
        updateStatus(`Oyun başladı! Sıra: ${data.turn === gameState.playerNumber ? 'Sizde' : 'Rakibinizde'}`);
    });
    
    // Hamle yapıldığında
    socket.on('moveMade', (data) => {
        updateGameBoard(data.board);
        updateStatus(`Sıra ${data.turn === gameState.playerNumber ? 'Sizde' : 'Rakibinizde'}`);
    });
    
    // Oyun bittiğinde
    socket.on('gameOver', (data) => {
        let message = '';
        if (data.winner === 'draw') {
            message = 'Oyun berabere bitti!';
        } else if (data.winner === gameState.playerNumber) {
            message = 'Tebrikler, kazandınız!';
        } else {
            message = 'Maalesef kaybettiniz.';
        }
        
        updateStatus(message);
        alert(message);
        
        // Ana menüye dön butonu göster
        const backButton = document.createElement('button');
        backButton.textContent = 'Ana Menü';
        backButton.className = 'btn btn-primary mt-4';
        backButton.onclick = () => {
            document.getElementById('gameScreen').style.display = 'none';
            document.getElementById('mainMenu').style.display = 'flex';
            resetGame();
        };
        
        const gameStatus = document.getElementById('gameStatus');
        gameStatus.innerHTML = '';
        gameStatus.appendChild(backButton);
    });
    
    // Hata mesajları
    socket.on('error', (error) => {
        updateStatus('Hata: ' + error, true);
        elements.createGameBtn.disabled = false;
        elements.joinButton.disabled = false;
    });
    
    // Eşleşme durumu
    socket.on('matchmaking', (data) => {
        if (data.status === 'searching') {
            gameState.isSearching = true;
            updateStatus('Rakip aranıyor...');
        }
    });
    
    // Oda oluşturuldu
    socket.on('roomCreated', (data) => {
        gameState.roomId = data.roomId;
        gameState.roomCode = data.code;
        gameState.playerNumber = 1;
        updateStatus(`Oda kodu: ${data.code}\nRakibinizin bu kodu girmesini bekleyin...`);
        showRoomCode(data.code);
    });
    
    // Oyuncu odaya katıldı
    socket.on('playerJoined', (data) => {
        gameState.opponent = {
            id: data.playerId,
            name: data.playerName
        };
        updateStatus(`Rakip katıldı: ${data.playerName}`);
        startGame();
    });
    
    // Oyun başlatıldı
    socket.on('gameStart', (data) => {
        gameState.roomId = data.roomId;
        gameState.playerNumber = data.players.find(p => p.id === gameState.playerId)?.number || null;
        gameState.opponent = data.players.find(p => p.id !== gameState.playerId) || null;
        
        if (gameState.playerNumber) {
            updateStatus(`Oyun başlıyor! Sen Oyuncu ${gameState.playerNumber}`);
            startGame();
        }
    });
    
    // Rakip ayrıldı
    socket.on('playerLeft', (data) => {
        updateStatus('Rakip oyundan ayrıldı. Ana menüye yönlendiriliyorsunuz...');
        setTimeout(resetGame, 3000);
    });
    
    // Oyun bitti
    socket.on('gameEnded', (data) => {
        updateStatus(data.winner === gameState.playerId ? 'Tebrikler, kazandınız!' : 'Mağlup oldunuz!');
        setTimeout(resetGame, 5000);
    });
}

// Durum mesajını güncelleme fonksiyonu
function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
    }
    console.log('Durum:', message);
}

// Odaya katılma fonksiyonu
function joinRoom(roomId) {
    console.log('Odaya katılıyor:', roomId);
    if (gameState.socket && gameState.socket.connected) {
        gameState.socket.emit('joinRoom', roomId);
    } else {
        console.error('Socket bağlantısı yok! Tekrar bağlanılıyor...');
        initializeSocket();
        // 1 saniye sonra tekrar dene
        setTimeout(() => joinRoom(roomId), 1000);
    }
}

function startGame() {
    if (gameState.isGameStarted) return;
    
    console.log('Oyun başlatılıyor...');
    gameState.isGameStarted = true;
    showLoading(false);
    
    // Oyun alanını göster
    if (elements.gameScreen) {
        elements.gameScreen.classList.add('active');
    }
    
    // Oyun tahtasını başlat
    initializeBoard();
}

// Oyun tahtasını başlat
function initializeBoard() {
    // Burada oyun tahtası ve oyun mantığı başlatılacak
    console.log('Oyun tahtası başlatılıyor...');
    updateStatus('Oyun başladı!');
}

// Oda kodunu göster
function showRoomCode(code) {
    if (elements.roomCodeDisplay) {
        elements.roomCodeDisplay.textContent = `Oda Kodu: ${code}`;
        elements.roomCodeDisplay.style.display = 'block';
    }
}

// Yükleme ekranını göster/gizle
function showLoading(show, message = '') {
    if (elements.loadingMessage && elements.loadingText) {
        if (show) {
            elements.loadingMessage.style.display = 'flex';
            elements.loadingText.textContent = message || 'Yükleniyor...';
        } else {
            elements.loadingMessage.style.display = 'none';
        }
    }
}

// Durum mesajını güncelle
function updateStatus(message) {
    if (elements.status) {
        elements.status.textContent = message;
    }
    console.log('Durum:', message);
}

// Oyunu sıfırla
function resetGame() {
    gameState.roomId = null;
    gameState.playerNumber = null;
    gameState.isGameStarted = false;
    gameState.isSearching = false;
    gameState.opponent = null;
    gameState.roomCode = null;
    
    if (elements.gameScreen) {
        elements.gameScreen.classList.remove('active');
    }
    
    if (elements.roomCodeDisplay) {
        elements.roomCodeDisplay.style.display = 'none';
    }
    
    updateStatus('Ana menüye dönülüyor...');
    setTimeout(() => {
        updateStatus('Dereceli maç veya özel oda seçin');
    }, 1000);
}

// Oyunu başlat
function initGame() {
    // Socket bağlantısını başlat
    initializeSocket();
    
    // Oyun durumunu sıfırla
    resetGame();
    
    // Buton olaylarını ayarla
    setupEventListeners();
    
    // Ana menüyü göster
    showMainMenu();
}

// Ana menüyü göster
function showMainMenu() {
    elements.gameScreen.style.display = 'none';
    elements.loadingMessage.style.display = 'none';
    elements.mainMenu.style.display = 'flex';
    elements.roomInfo.classList.add('hidden');
    updateStatus('Oyuna hoş geldiniz!');
}

// Buton olaylarını ayarla
function setupEventListeners() {
    // Yeni oyun butonu
    if (elements.createGameBtn) {
        elements.createGameBtn.addEventListener('click', createPrivateRoom);
    }
    
    // Odaya katıl butonu
    if (elements.joinButton) {
        elements.joinButton.addEventListener('click', joinPrivateRoom);
    }
    
    // Oda kodu input'unda enter tuşu desteği
    if (elements.roomCodeInput) {
        elements.roomCodeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                joinPrivateRoom();
            }
        });
    }
}

// Dereceli maç başlat
function startRankedMatch() {
    if (!gameState.socket || !gameState.socket.connected) {
        updateStatus('Sunucuya bağlı değil!');
        return;
    }
    
    gameState.isSearching = true;
    updateStatus('Rakip aranıyor...');
    gameState.socket.emit('startRankedMatch');
    showLoading(true, 'Rakip aranıyor...');
}

// Özel oda oluştur
function createPrivateRoom() {
    if (!gameState.socket) {
        updateStatus('Sunucuya bağlanılamadı!', true);
        return;
    }
    
    updateStatus('Oda oluşturuluyor...');
    elements.createGameBtn.disabled = true;
    
    // Rastgele bir oyuncu adı oluştur
    const playerName = 'Oyuncu_' + Math.floor(1000 + Math.random() * 9000);
    
    gameState.socket.emit('createPrivateRoom', { username: playerName }, (response) => {
        if (response.error) {
            updateStatus('Oda oluşturulamadı: ' + response.error, true);
            elements.createGameBtn.disabled = false;
        }
    });
}

// Özel odaya katıl
function joinPrivateRoom() {
    const roomCode = elements.roomCodeInput.value.trim();
    
    if (!roomCode) {
        updateStatus('Lütfen bir oda kodu girin!', true);
        return;
    }
    
    if (!gameState.socket) {
        updateStatus('Sunucuya bağlanılamadı!', true);
        return;
    }
    
    updateStatus('Odaya katılıyor...');
    elements.joinButton.disabled = true;
    
    // Rastgele bir oyuncu adı oluştur
    const playerName = 'Oyuncu_' + Math.floor(1000 + Math.random() * 9000);
    
    gameState.socket.emit('joinPrivateRoom', { 
        roomCode,
        username: playerName
    }, (response) => {
        if (response.error) {
            updateStatus('Odaya katılamadı: ' + response.error, true);
            elements.joinButton.disabled = false;
        }
    });
}

// Global olarak erişilebilir yap
window.gameModule = {
    init: initGame,
    start: startGame,
    joinRoom: joinRoom,
    state: gameState
};

// Oyunu başlat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
} else {
    initGame();
}
