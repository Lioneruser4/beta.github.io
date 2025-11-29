// --- PROFESSIONAL DOMINO 101 GAME CLIENT ---

// API ve WebSocket ayarları
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:10000' : 'https://beta-github-io.onrender.com';
let ws = null;

// Game State
let gameState = {
    board: [],
    market: [],
    players: {},
    currentPlayer: null,
    myPlayerId: null,
    isMyTurn: false,
    roomCode: null,
    status: 'waiting'
};

// UI State
let selectedTileIndex = null;
let validMoves = [];
let isSearching = false;

// DOM Elements
const boardContainer = document.getElementById('board-container');
const handContainer = document.getElementById('hand-container');
const turnIndicator = document.getElementById('turn-indicator');
const marketSizeDisplay = document.getElementById('market-size');
const opponentHandSize = document.getElementById('opponent-hand-size');
const drawButton = document.getElementById('draw-button');
const passButton = document.getElementById('pass-button');
const leaveButton = document.getElementById('leave-game-button');
const opponentInfoContainer = document.getElementById('opponent-info');


// --- 1. BAĞLANTI ve MESAJ YÖNETİMİ ---

function connectToServer(playerData) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
    }

    let wsUrl = API_URL.replace('http', 'ws').replace('https', 'wss');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('✅ Connected to server');
        showNotification('Sunucuya bağlandı', 'success');
        // Bağlantı kurulduğunda Telegram/Oyuncu bilgisini gönder
        if (playerData) {
            ws.send(JSON.stringify({
                type: 'initialAuth',
                ...playerData
            }));
            gameState.myPlayerId = playerData.telegramId || playerData.username;
        }
        updateConnectionStatus(true);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };

    ws.onclose = () => {
        console.log('❌ Disconnected from server. Reconnecting...');
        showNotification('Bağlantı kesildi, tekrar deneniyor...', 'error');
        updateConnectionStatus(false);
        setTimeout(() => connectToServer(playerData), 3000); // Otomatik yeniden bağlanma
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Bağlantı hatası', 'error');
    };
}

function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
    }
    showNotification('Sunucu bağlantısı yok!', 'error');
    return false;
}

function handleServerMessage(data) {
    console.log('Received:', data);
    
    switch(data.type) {
        case 'gameStart':
            gameState = data.gameState;
            // Sunucudan gelen player state'inde kendi ID'mizi alıyoruz.
            const playerId = Object.keys(data.gameState.players).find(id => data.gameState.players[id].isMe);
            gameState.myPlayerId = playerId || gameState.myPlayerId;
            gameState.roomCode = data.gameState.roomCode;

            isSearching = false;
            updateUI();
            showGameScreen();
            showNotification('🎮 Oyun Başladı!', 'success');
            break;
            
        case 'gameUpdate':
            const oldMarketSize = gameState.market.length;
            gameState = { ...gameState, ...data.gameState }; // Mevcut state'i koru ve güncel veriyi ekle
            updateUI();
            
            // Eğer yeni taş çekildiyse eli kaydır
            if (gameState.market.length < oldMarketSize) {
                setTimeout(scrollToHandEnd, 300);
            }
            break;
            
        case 'gameEnd':
            handleGameEnd(data);
            break;
            
        case 'error':
            showNotification(data.message, 'error');
            break;
            
        case 'matchFound':
            showNotification(`Rakip bulundu: ${data.opponentName}`, 'info');
            break;

        case 'roomCreated':
            gameState.roomCode = data.roomCode;
            showNotification(`Oda kuruldu! Kod: ${data.roomCode}`, 'info');
            break;

        case 'searchCancelled':
            isSearching = false;
            showLobbyScreen();
            showNotification('Arama iptal edildi', 'info');
            break;
            
        default:
            console.log('Unknown message type:', data.type);
    }
}

// --- 2. OYUN MANTIĞI ---

// Bu fonksiyon, bir taşın tahtadaki uçlarla eşleşip eşleşmediğini kontrol eder.
function canPlayTile(tile) {
    if (gameState.board.length === 0) return true;
    
    const leftEnd = gameState.board[0][0];
    const rightEnd = gameState.board[gameState.board.length - 1][1];
    
    // Taşın iki tarafının da uçlarla eşleşip eşleşmediğini kontrol et
    return tile[0] === leftEnd || tile[1] === leftEnd ||
           tile[0] === rightEnd || tile[1] === rightEnd;
}

// Taşı nereye oynayabileceğini hesaplar
function getValidMoves(tile) {
    if (gameState.board.length === 0) return ['start']; // İlk hamle
    
    const moves = [];
    const leftEnd = gameState.board[0][0];
    const rightEnd = gameState.board[gameState.board.length - 1][1];
    
    // Taşın herhangi bir tarafı uçlarla eşleşiyorsa hamle ekle
    if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
    if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
    
    return moves;
}

// Seçili taşı tahtaya oynamayı dener
function playTile(position) {
    if (!gameState.isMyTurn || selectedTileIndex === null) return;
    
    // Oynama mesajını sunucuya gönder
    sendMessage({
        type: 'playTile',
        tileIndex: selectedTileIndex,
        position: position
    });
    
    // Optimistik UI temizleme (Sunucu cevabıyla güncellenecek)
    selectedTileIndex = null;
    validMoves = [];
    updateHandDisplay();
    updateBoardDisplay(); // Valid move indikatörlerini kaldırır
}

// Pazardan taş çekmeyi dener (Kural kontrolü ile)
function drawFromMarket() {
    if (!gameState.isMyTurn) {
        showNotification('Sıra sizde değil!', 'warning');
        return;
    }
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    const hasPlayableTile = myHand.some(tile => canPlayTile(tile));
    
    // KURAL 1: Elinde oynayabileceği taş varsa pazardan ÇEKEMEZ.
    if (hasPlayableTile) {
        showNotification('Elinde oynayabileceğin taş var. Oynamak zorundasın!', 'warning');
        return;
    }
    
    if (gameState.market.length === 0) {
        showNotification('Pazarda taş kalmadı. Pas geçmelisin!', 'error');
        return;
    }
    
    sendMessage({ type: 'drawFromMarket' });
    showNotification('🎲 Pazardan taş çekildi.', 'info');
}

// Pas geçmeyi dener (Kural kontrolü ile)
function passTurn() {
    if (!gameState.isMyTurn) {
        showNotification('Sıra sizde değil!', 'warning');
        return;
    }
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    const hasPlayableTile = myHand.some(tile => canPlayTile(tile));

    // KURAL 2: Oynanabilir taş varsa veya pazarda taş varsa PAS GEÇEMEZ.
    if (hasPlayableTile) {
        showNotification('Oynayabileceğin taş varken pas geçemezsin!', 'warning');
        return;
    }

    if (gameState.market.length > 0) {
        showNotification('Pazarda taş varken pas geçemezsin, çekmek zorundasın!', 'warning');
        return;
    }
    
    sendMessage({ type: 'pass' });
    showNotification('✅ Pas geçildi.', 'info');
}

// Oyundan çıkış (Çalışmayan kısım düzeltildi)
function leaveGame() {
    if (!gameState.roomCode && gameState.status !== 'inGame') {
        showNotification('Zaten bir oyunda değilsiniz.', 'info');
        showLobbyScreen();
        return;
    }
    
    if (confirm('Oyundan çıkmak istediğinize emin misiniz? Rakibiniz kazanır.')) {
        // Sunucuya oyundan çıkış bildirimi gönder
        sendMessage({
            type: 'leaveGame',
            roomCode: gameState.roomCode
        });
        
        // UI'yı hemen lobiye döndür
        gameState = { ...gameState, status: 'waiting', roomCode: null };
        showLobbyScreen();
        showNotification('Oyundan başarıyla çıktınız.', 'info');
    }
}


// --- 3. UI GÜNCELLEMELERİ ---

function updateUI() {
    gameState.isMyTurn = gameState.currentPlayer === gameState.myPlayerId;
    
    updateBoardDisplay();
    updateHandDisplay();
    updateTurnIndicator();
    updateGameInfo();
    updateControls();
    updateOpponentInfo();
}

// Oyuncu elindeki taşa tıklandığında
function handleTileClick(index) {
    if (!gameState.isMyTurn) return;
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    const tile = myHand[index];
    
    const moves = getValidMoves(tile);
    
    // Eğer taş oynanabilir değilse uyarı ver
    if (moves.length === 0) {
        showNotification('Bu taş tahtaya uygun değil.', 'warning');
        return;
    }
    
    if (selectedTileIndex === index) {
        // Seçimi kaldır
        selectedTileIndex = null;
        validMoves = [];
    } else {
        // Yeni seçimi ayarla
        selectedTileIndex = index;
        validMoves = moves;
    }
    
    updateHandDisplay(); // Seçim görselini güncelle
    updateBoardDisplay(); // Valid move indikatörlerini ekle/kaldır
}

// Board (Tahta) görselini güncelleme
function updateBoardDisplay() {
    if (!boardContainer) return;
    
    boardContainer.innerHTML = '';
    
    // Valid move indikatörlerini Board'dan ayırarak eklemek daha temiz olur.
    let boardElements = [];

    // Tahtadaki Taşlar
    if (gameState.board.length === 0) {
        boardContainer.innerHTML = selectedTileIndex !== null ? 
            '<div class="text-white/50 text-center p-8 border-4 border-dashed border-yellow-500/50 rounded-lg">İlk Taşı Oynamak İçin Tıklayın</div>' :
            '<div class="text-white/50 text-center p-8">Tahta boş - Taş seçin</div>';
    } else {
        gameState.board.forEach((tile) => {
            boardElements.push(createTileElement(tile, false, false, false));
        });
    }

    // Tahta boşsa ve taş seçiliyse, ortaya oynama göstergesi
    if (validMoves.includes('start') && selectedTileIndex !== null) {
        const startIndicator = createMoveIndicator('start', '🎯 Başla');
        boardContainer.innerHTML = ''; // Tahtayı temizle
        boardContainer.appendChild(startIndicator);
    } 
    // Tahtada taş varsa ve hamleler geçerliyse
    else if (gameState.board.length > 0 && selectedTileIndex !== null) {
        const tempContainer = document.createElement('div');
        tempContainer.className = 'flex items-center gap-0.5 mx-auto min-w-max';

        if (validMoves.includes('left')) {
            tempContainer.appendChild(createMoveIndicator('left', '◀'));
        }
        
        boardElements.forEach(el => tempContainer.appendChild(el));
        
        if (validMoves.includes('right')) {
            tempContainer.appendChild(createMoveIndicator('right', '▶'));
        }

        boardContainer.appendChild(tempContainer);
    } else {
        // Tahtayı yine de taşlarla doldur
        const tempContainer = document.createElement('div');
        tempContainer.className = 'flex items-center gap-0.5 mx-auto min-w-max';
        boardElements.forEach(el => tempContainer.appendChild(el));
        boardContainer.appendChild(tempContainer);
    }

    // Tahtayı ortalama kaydırma
    scrollToBoardCenter();
}

function createMoveIndicator(position, text) {
    const indicator = document.createElement('div');
    indicator.className = `valid-move-indicator ${position} cursor-pointer animate-glow-pulse`;
    indicator.innerHTML = text;
    indicator.addEventListener('click', () => playTile(position));
    return indicator;
}

// Oyuncu Elini güncelleme
function updateHandDisplay() {
    if (!handContainer) return;
    
    handContainer.innerHTML = '';
    
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    
    myHand.forEach((tile, index) => {
        const isSelected = selectedTileIndex === index;
        const canPlay = canPlayTile(tile); // Oynanabilir mi kontrolü
        
        // Oynanabilir taşı vurgulamak için ek bir sınıf eklenebilir
        const tileElement = createTileElement(tile, true, isSelected, canPlay);
        
        tileElement.addEventListener('click', () => handleTileClick(index));
        handContainer.appendChild(tileElement);
    });
}

// Sıra göstergesini güncelleme
function updateTurnIndicator() {
    if (!turnIndicator) return;
    
    if (gameState.isMyTurn) {
        turnIndicator.innerHTML = '<div class="bg-yellow-500 text-black px-4 py-1 rounded-full font-bold animate-pulse shadow-md">⚡ SENİN SIRAN ⚡</div>';
    } else {
        turnIndicator.innerHTML = '<div class="bg-gray-700 text-white px-4 py-1 rounded-full shadow-md">⏳ Rakip oynuyor...</div>';
    }
}

// Kontrol butonlarının durumunu güncelleme
function updateControls() {
    if (drawButton) {
        drawButton.disabled = !gameState.isMyTurn || gameState.market.length === 0;
    }
    if (passButton) {
        // Pas butonu sadece elinde oynanacak taş yoksa ve pazarda taş kalmamışsa aktif olmalı.
        const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
        const hasPlayableTile = myHand.some(tile => canPlayTile(tile));
        
        passButton.disabled = !gameState.isMyTurn || hasPlayableTile || gameState.market.length > 0;
    }
    if (leaveButton) {
        leaveButton.onclick = leaveGame; // Event listener'ı ekle
    }
}

// Rakip bilgilerini güncelleme
function updateOpponentInfo() {
    if (!opponentInfoContainer) return;

    const opponentId = Object.keys(gameState.players).find(id => id !== gameState.myPlayerId);
    const opponent = gameState.players[opponentId];

    if (opponent) {
        const pieces = opponent.hand?.length || 0;
        const name = opponent.username || 'Rakip';
        const elo = opponent.elo || 0;
        const photoUrl = opponent.photoUrl || 'default_avatar.png'; // Varsayılan resim ekleyin

        opponentInfoContainer.innerHTML = `
            <div class="flex items-center space-x-3">
                <img src="${photoUrl}" class="w-10 h-10 rounded-full border-2 border-slate-400" alt="Rakip">
                <div>
                    <div class="text-white font-bold text-sm">${name}</div>
                    <div class="text-xs text-gray-400">ELO: ${elo}</div>
                </div>
            </div>
            <div class="text-sm text-yellow-400 font-bold">🎲 ${pieces} Taş</div>
        `;
    } else {
        opponentInfoContainer.innerHTML = '<div class="text-white/50 text-sm">Rakip bekleniyor...</div>';
    }
    
    if (marketSizeDisplay) {
        marketSizeDisplay.textContent = `Pazar: ${gameState.market.length}`;
    }
}

// Domino taşının HTML elementi
function createTileElement(tile, isClickable = false, isSelected = false, isPlayable = false) {
    const tileDiv = document.createElement('div');
    tileDiv.className = `domino-tile 
        ${isClickable ? 'clickable' : ''} 
        ${isSelected ? 'selected' : ''} 
        ${isPlayable ? 'playable-highlight' : ''}`; // Yeni highlight sınıfı
    
    // Taşın değerlerini görselleştir
    const topHalf = document.createElement('div');
    topHalf.className = 'tile-half border-b border-gray-400';
    topHalf.appendChild(createPips(tile[0]));
    
    const bottomHalf = document.createElement('div');
    bottomHalf.className = 'tile-half';
    bottomHalf.appendChild(createPips(tile[1]));
    
    // Ortadaki metal parça
    const separator = document.createElement('div');
    separator.className = 'tile-separator';

    tileDiv.appendChild(topHalf);
    tileDiv.appendChild(separator);
    tileDiv.appendChild(bottomHalf);
    
    return tileDiv;
}

// Noktaları (Pips) oluşturma
function createPips(number) {
    const pipsContainer = document.createElement('div');
    pipsContainer.className = 'pips-container';
    
    const pipPositions = {
        0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8],
        4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
    };
    
    const positions = pipPositions[number] || [];
    
    for (let i = 0; i < 9; i++) {
        const pip = document.createElement('div');
        pip.className = 'pip';
        if (positions.includes(i)) {
            pip.classList.add('active');
        }
        pipsContainer.appendChild(pip);
    }
    
    return pipsContainer;
}

// Board'u ortalamak için kaydırma fonksiyonu
function scrollToBoardCenter() {
    if (boardContainer) {
        const scrollWidth = boardContainer.scrollWidth;
        const clientWidth = boardContainer.clientWidth;
        // Kaydırma işlemi için zaman tanımak üzere setTimeout
        setTimeout(() => {
            boardContainer.scrollLeft = (scrollWidth - clientWidth) / 2;
        }, 100);
    }
}

// Eli sonuna kaydırma (Taş çekilince)
function scrollToHandEnd() {
    if (handContainer) {
        handContainer.scrollLeft = handContainer.scrollWidth;
    }
}


// --- 4. EKRAN YÖNETİMİ ve İLKLENDİRME ---

function showLobbyScreen() {
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('searching-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
}

function showSearchingScreen() {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('searching-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';
    // Timer ve animasyon yönetimi burada olmalı
}

function showGameScreen() {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('searching-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'flex';
    gameState.status = 'inGame';
    // Oyundan çıkış butonunu burada bağlayın
    if (leaveButton) {
        leaveButton.onclick = leaveGame;
    }
}

function handleGameEnd(data) {
    const isWinner = data.winner === gameState.myPlayerId;
    const message = isWinner ? `🎉 Kazandın! Skor: ${data.score}` : `😔 Kaybettin! Kazanan: ${data.winnerName}`;
    
    showNotification(message, isWinner ? 'success' : 'error');
    
    gameState.status = 'ended';
    gameState.roomCode = null; // Oda kodunu temizle

    // ELO/Puanlama güncellemesi varsa burada gösterilmeli
    if (data.eloChanges) {
        showNotification(`ELO: ${data.eloChanges.myChange > 0 ? '+' : ''}${data.eloChanges.myChange}`, 'info');
    }

    // Lobiye dön
    setTimeout(() => {
        showLobbyScreen();
        gameState = { // State'i sıfırla
            board: [], market: [], players: {}, currentPlayer: null,
            myPlayerId: gameState.myPlayerId, // ID'yi koru
            isMyTurn: false, roomCode: null, status: 'waiting'
        };
    }, 4000);
}

// Bağlantı durumunu göstergeye yansıtma
function updateConnectionStatus(isConnected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
        statusElement.className = isConnected ? 'bg-green-500' : 'bg-red-500';
        statusElement.title = isConnected ? 'Bağlı' : 'Bağlantı Kesik';
    }
}

// Notification (Bildirim) Fonksiyonu
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type} animate-slide-up`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.remove('animate-slide-up');
        notification.classList.add('animate-slide-down');
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

// Oyunu Başlatma (HTML'deki başlatma butonu buradan çağırılmalı)
function initializeGame(playerData) {
    console.log('Oyun Başlatılıyor...');
    
    // Bağlantıyı kur ve kimlik bilgilerini gönder
    connectToServer(playerData);

    // Düğmeleri bağla (ID'lerin HTML'de doğru olduğundan emin olun)
    if (drawButton) drawButton.onclick = drawFromMarket;
    if (passButton) passButton.onclick = passTurn;
    if (leaveButton) leaveButton.onclick = leaveGame;
    
    showLobbyScreen(); // Lobi ile başla
}

// Global'e sadece gerekli fonksiyonları aç
window.gameClient = {
    initializeGame,
    findMatch: (pData) => {
        if (!sendMessage({ type: 'findMatch', ...pData, playerName: pData.username })) return;
        isSearching = true;
        showSearchingScreen();
        // Arama zamanlayıcısı başlatılmalı
    },
    cancelSearch: () => {
        if (!sendMessage({ type: 'cancelSearch' })) return;
        isSearching = false;
        showLobbyScreen();
    },
    createRoom: (pData) => sendMessage({ type: 'createRoom', ...pData, playerName: pData.username }),
    joinRoom: (code, pData) => sendMessage({ type: 'joinRoom', roomCode: code, ...pData, playerName: pData.username }),
};


// DİKKAT: Bu `DOMContentLoaded` bloğu yerine, HTML dosyasındaki 
// `<script type="text/babel">` bloğunda `initializeGame` çağrılmalıdır.
/*
document.addEventListener('DOMContentLoaded', () => {
    // Örnek bir Guest oyuncu verisi:
    const guestPlayer = { 
        telegramId: 'guest_' + Math.floor(Math.random() * 99999), 
        username: 'Guest' + Math.floor(Math.random() * 999), 
        elo: 0 
    };
    // initializeGame(guestPlayer);
});
*/
