// Socket.io baglantisi
const socket = io('https://beta-github-io-ndis.onrender.com', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000
});

// Yeniden baglanma durumu
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isWaitingForCancelConfirmation = false; // Yeni: İptal onayı bekleniyor mu?

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

// Oyuncu istatistik elementleri
const playerEloElement = document.getElementById('player-elo');
const playerWinsElement = document.getElementById('player-wins');
const playerLossesElement = document.getElementById('player-losses');
const opponentNameElement = document.getElementById('opponent-name');
const opponentEloElement = document.getElementById('opponent-elo');

const BOARD_SIZE = 8;

// --- Socket.io Eventleri ---

socket.on('connect', () => {
    console.log('✅ Servere baglandi');
    console.log('🔗 Socket ID:', socket.id);
    connectionStatus.textContent = 'Servere baglandi!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');

    // Oyun durumunu sıfırla
    resetGameState();
    showScreen('main');
});

socket.on('disconnect', (reason) => {
    console.log('Sunucu bağlantısı kesildi:', reason);
    connectionStatus.textContent = 'Bağlantı kesildi';
    connectionStatus.className = 'text-red-500';

    // Eğer oyundaysak, yeniden bağlanmayı dene
    if (gameState.roomCode && !isReconnecting) {
        isReconnecting = true;
        reconnectAttempts = 0;
        attemptReconnect();
    }
});

socket.on('reconnect', () => {
    console.log('Sunucuya yeniden bağlanıldı');
    isReconnecting = false;
    reconnectAttempts = 0;

    // Eğer oyundaysak, oyun durumunu senkronize et
    if (gameState.roomCode) {
        socket.emit('reconnectToGame', {
            roomCode: gameState.roomCode,
            playerId: gameState.playerId
        });
    }
});

socket.on('reconnectFailed', () => {
    console.error('Yeniden bağlanılamadı');
    showModal('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', 'error');
});

// Eşleşme bulunduğunda çağrılır
function handleMatchFound(data) {
    console.log('🔵 Eşleşme bulundu:', data);

    // Eğer zaten bir odadaysanız, bağlantıyı güncelle
    gameState.roomCode = data.roomCode;
    gameState.myColor = data.color;
    gameState.opponent = data.opponent;
    gameState.currentPlayerId = data.gameState.currentTurn; // Sunucudan gelen currentTurn artık telegramId
    gameState.isSearching = false;

    // Oyun ekranını göster
    showScreen('game');
    showStatus(`Rakip bulundu: ${data.opponent.username || 'Bilinmeyen'}`);

    // Oyun tahtasını başlat
    if (data.gameState) {
        // DİKKAT: Bu kısım, istemci (checkers) ve sunucu (dominoes) arasındaki uyumsuzluk nedeniyle sorun çıkaracaktır.
        // Sunucudan gelen domino tahtası verisi, istemcinin checkers tahtası çizim fonksiyonuyla uyumlu değildir.
        console.warn("Sunucudan gelen oyun durumu (dominoes) istemcinin (checkers) beklediği formatta değil. Tahta çizimi başarısız olabilir.");
        // Şimdilik sadece gerekli alanları güncelleyelim, tahta çizimi için uyumluluk sağlanmalı.
        gameState.board = data.gameState.board; // Bu domino taşlarını içerecek (örneğin [[1,2], [2,3]])
        gameState.currentTurn = data.gameState.currentTurn; // Bu güncel oyuncunun telegramId'si olacak
        gameState.isMyTurn = gameState.currentTurn === gameState.myColor; // Bu karşılaştırma yanlış olacak (telegramId vs 'red'/'white')
        updateGameUI(); // UI'ı güncellemeye çalış
    }
}

// Oda oluşturma başarılı olduğunda
socket.on('roomCreated', (data) => {
    console.log('✅ Oda başarıyla oluşturuldu:', data);
    gameState.roomCode = data.roomCode;
    gameState.isHost = true;
    gameState.isSearching = true;

    // Oda kodunu göster
    showStatus(`Oda Kodu: ${data.roomCode}\nRakip bekleniyor...`);

    // Oda kodunu ekranda göster
    if (roomCodeOutput) {
        roomCodeOutput.textContent = data.roomCode;
        roomCodeOutput.classList.remove('hidden');
    }
});

// Odaya katılma başarılı olduğunda
socket.on('joinedRoom', (data) => {
    console.log('✅ Odaya katıldınız:', data);
    gameState.roomCode = data.roomCode;
    gameState.myColor = data.color || 'white';
    gameState.opponent = data.opponent;
    gameState.isSearching = false;

    // Oyun ekranına geç
    showScreen('game');
    showStatus(`Oyun başladı! Sıra ${gameState.isMyTurn ? 'sizde' : 'rakibinizde'}`);
});

// Oda bulunamadı hatası
socket.on('roomNotFound', (data) => {
    console.error('❌ Oda bulunamadı:', data);
    showModal('Oda bulunamadı. Lütfen geçerli bir oda kodu giriniz.', 'error');
    showScreen('main');
});

// Oda dolu hatası
socket.on('roomFull', (data) => {
    console.error('❌ Oda dolu:', data);
    showModal('Bu oda dolu. Lütfen başka bir oda seçiniz.', 'error');
    showScreen('main');
});

// Socket event listeners
socket.on('matchFound', (data) => {
    console.log('🔵 Sunucudan eşleşme bildirimi:', data);
    try {
        handleMatchFound(data);
    } catch (error) {
        console.error('Eşleşme işlenirken hata:', error);
        showModal('Eşleşme işlenirken bir hata oluştu', 'error');
    }
});

// Kuyruk güncelleme bildirimi
socket.on('queueUpdate', (data) => {
    console.log('📊 Kuyruk güncellendi:', data);
    if (gameState.isSearching) {
        showStatus(data.message || `Sırada bekleniyor... (${data.position || 1}. sıradasınız)`);
    }
});

// Arama iptal edildi bildirimi
socket.on('searchCancelled', (data) => {
    console.log('❌ Arama iptal edildi:', data);
    gameState.isSearching = false;
    showModal(data.message || 'Arama iptal edildi', 'info');
    showScreen('main');
});

socket.on('opponentLeft', (data) => {
    console.log('Rakip ayrıldı:', data);
    showModal('Rakibiniz oyundan ayrıldı', 'info');

    // Eğer oda temizlendiyse, oyuncuyu ana menüye gönder
    if (data.roomCleared) {
        setTimeout(() => {
            resetGameState();
            showScreen('main');
        }, 3000);
    }
});

socket.on('searchStatus', (data) => {
    console.log('🔍 Axtaris statusu:', data);
    rankedStatus.textContent = data.message;
});

socket.on('searchCancelled', (data) => {
    gameState.isSearching = false;
    gameState.roomCode = null;
    showModal(data.message);
    clearInterval(searchTimer);
    searchTimer = null;
    showScreen('main');
});

socket.on('roomCreated', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.myColor = 'red';
    roomCodeOutput.textContent = data.roomCode;
    console.log('🏠 Oda yaradildi:', data.roomCode);
});

socket.on('opponentJoined', (data) => {
    gameState.gameStarted = true;
    gameState.isMyTurn = gameState.myColor === 'red';
    gameState.board = createInitialBoard();
    console.log('👥 Raqib qosuldu! Oyun baslayir...');
    showScreen('game');
    updateGameUI();
});

socket.on('gameUpdate', (data) => {
    // DİKKAT: Sunucudan gelen domino oyun durumu istemcinin checkers oyun durumuyla uyumsuz.
    // Bu kısım, istemcinin domino oyununa göre güncellenmesi gerektiği anlamına gelir.
    gameState.board = data.gameState.board; // Domino taşları
    gameState.currentTurn = data.gameState.currentTurn; // Güncel oyuncunun telegramId'si
    gameState.isMyTurn = gameState.currentTurn === gameState.myColor; // Bu hala yanlış, myColor 'red'/'white' iken currentTurn telegramId
    updateGameUI();
});

socket.on('gameOver', (data) => {
    // data objesi: { winner: 'red'/'white', reason: 'win'/'leave', eloChange: 15 }
    const isWinner = data.winner === gameState.myColor;
    let title = '';
    let message = '';

    if (data.reason === 'leave') {
        title = 'Raqib Oyundan Cixdi!';
        message = 'Siz qazandiniz!';
    } else {
        title = isWinner ? '🎉 QAZANDINIZ! 🎉' : '😔 MEGLUB OLDUNUZ 😔';
        message = isWinner ? 'Tebrikler! Gozel oyun idi.' : 'Novbeti sefer ugurlar!';
    }

    gameResultTitle.textContent = title;
    gameResultMessage.textContent = message;

    if (data.eloChange !== undefined && data.eloChange !== null) {
        const sign = data.eloChange >= 0 ? '+' : '';
        eloChangeDisplay.textContent = `${sign}${data.eloChange} Puan`;
        eloChangeDisplay.className = `text-2xl font-bold ${data.eloChange >= 0 ? 'text-green-400' : 'text-red-400'}`;
    }
    showScreen('post-game');
});

socket.on('error', (error) => {
    console.error('Hata:', error);
    gameState.isSearching = false;
    gameState.roomCode = null;
    clearInterval(searchTimer);
    searchTimer = null;
    showModal(error.message || 'Bir hata oluştu');
    showScreen('main');
});

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

function createInitialBoard() {
    const board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        board[r] = new Array(BOARD_SIZE).fill(0);
        for (let c = 0; c < BOARD_SIZE; c++) {
            if ((r + c) % 2 !== 0) {
                if (r < 3) {
                    board[r][c] = 1; // Kirmizi
                } else if (r > 4) {
                    board[r][c] = 2; // Ag
                }
            }
        }
    }
    return board;
}

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function getPiecePlayer(pieceValue) {
    if (pieceValue === 1 || pieceValue === 3) return 'red';
    if (pieceValue === 2 || pieceValue === 4) return 'white';
    return null;
}

function isValidCell(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function findJumps(board, r, c, player) {
    const piece = board[r][c];
    const isKingPiece = piece === 3 || piece === 4;
    const jumps = [];
    const directions = isKingPiece ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
        player === 'red' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];

    for (const [dr, dc] of directions) {
        const capturedR = r + dr;
        const capturedC = c + dc;
        const landR = r + 2 * dr;
        const landC = c + 2 * dc;

        if (isValidCell(landR, landC) && board[landR][landC] === 0) {
            const capturedPieceValue = board[capturedR][capturedC];
            const capturedPlayer = getPiecePlayer(capturedPieceValue);

            if (capturedPlayer && capturedPlayer !== player) {
                jumps.push({ from: { r, c }, to: { r: landR, c: landC }, captured: { r: capturedR, c: capturedC } });
            }
        }
    }
    return jumps;
}

function findValidMoves(board, r, c, player) {
    const moves = [];
    const piece = board[r][c];
    const isKingPiece = piece === 3 || piece === 4;

    const jumps = findJumps(board, r, c, player);
    if (jumps.length > 0) return jumps;

    const directions = isKingPiece ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
        player === 'red' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];

    for (const [dr, dc] of directions) {
        const newR = r + dr;
        const newC = c + dc;

        if (isValidCell(newR, newC) && board[newR][newC] === 0) {
            moves.push({ from: { r, c }, to: { r: newR, c: newC } });
        }
    }
    return moves;
}

function isValidMove(board, fromR, fromC, toR, toC, player) {
    const moves = findValidMoves(board, fromR, fromC, player);
    return moves.some(move => move.to.r === toR && move.to.c === toC);
}

// --- UI Funksiyalari ---

function drawBoard() {
    boardElement.innerHTML = '';

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            const isDark = (r + c) % 2 !== 0;

            cell.className = 'cell ' + (isDark ? 'cell-black' : 'cell-white');
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.onclick = () => handleCellClick(r, c);

            const pieceValue = gameState.board[r] && gameState.board[r][c];
            if (pieceValue && pieceValue !== 0) {
                const pieceElement = document.createElement('div');
                const piecePlayer = getPiecePlayer(pieceValue);
                const isKingPiece = pieceValue === 3 || pieceValue === 4;

                pieceElement.className = 'piece ' +
                    (piecePlayer === 'red' ? 'piece-black' : 'piece-white') +
                    (isKingPiece ? ' piece-king ' + (piecePlayer === 'red' ? 'piece-king-black' : 'piece-king-white') : '');

                pieceElement.innerHTML = isKingPiece ? '👑' : '●';

                if (gameState.selectedPiece && gameState.selectedPiece.r === r && gameState.selectedPiece.c === c) {
                    pieceElement.classList.add('selected');
                }

                if (gameState.currentTurn === piecePlayer && gameState.isMyTurn) {
                    pieceElement.classList.add('current-turn-piece');
                }

                cell.appendChild(pieceElement);
            }

            if (gameState.selectedPiece && gameState.isMyTurn) {
                if (isValidMove(gameState.board, gameState.selectedPiece.r, gameState.selectedPiece.c, r, c, gameState.myColor)) {
                    cell.classList.add('valid-move');
                }
            }

            boardElement.appendChild(cell);
        }
    }
}

function updateGameUI() {
    if (!gameState.gameStarted) return;

    turnText.textContent = gameState.isMyTurn ? 'Sizdir!' : 'Raqibdir';
    currentTurnDisplay.className = 'w-full max-w-md mb-4 p-4 rounded-xl bg-gray-800 shadow-xl text-center ' +
        (gameState.isMyTurn ? 'bg-green-700' : 'bg-yellow-700');

    drawBoard();
}

// --- Event Handlers ---

function handleCellClick(r, c) {
    // DİKKAT: Bu fonksiyon checkers oyununa özeldir. Domino oyununda hücre tıklaması farklı çalışır.
    // Bu fonksiyonun domino oyununa göre yeniden yazılması gerekmektedir.
    // Şimdilik, eğer sunucu domino oyunu ise bu fonksiyon çalışmayacaktır.
    console.warn("handleCellClick fonksiyonu checkers oyununa özeldir ve domino oyunu için uyumlu değildir.");
    // Aşağıdaki kod checkers için geçerlidir, domino için değil.
    if (!gameState.isMyTurn || !gameState.gameStarted) {
        console.log("Sıra sizde değil veya oyun başlamadı.");
        return;
    }
    // ... (checkers logic)

    if (isValidMove(gameState.board, fromR, fromC, r, c, gameState.myColor)) {
        socket.emit('makeMove', {
            roomCode: gameState.roomCode,
            from: { r: fromR, c: fromC },
            to: { r, c }
        });
        gameState.selectedPiece = null;
    }
}
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

    socket.emit('findMatch', playerData, (response) => {
        if (response && response.error) {
            console.error('❌ Eşleşme hatası:', response.error);
            showModal(`Eşleşme hatası: ${response.error}`, 'error');
            gameState.isSearching = false;
            showScreen('main');
            return;
        }
        console.log('✅ Eşleşme isteği alındı');
    });

    showScreen('searching');
    showStatus('Eşleşme aranıyor...');
    startSearchTimer();
}

// Arama iptal etme fonksiyonu
function cancelSearch() {
    if (gameState.isSearching) {
        console.log('🔍 Eşleşme araması iptal ediliyor...');
        socket.emit('cancelSearch');
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
        socket.emit('findMatch', {
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
    socket.emit('cancelSearch');
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
    socket.emit('createRoom', {
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
    socket.emit('joinRoom', { roomCode });
};

backToLobbyBtn.onclick = () => {
    // Oyun durumunu sıfırla
    resetGameState();

    // Sunucuya oyundan ayrıldığımızı bildir
    socket.emit('leaveGame');

    // Ana menüye dön
    showScreen('main');
};

leaveGameBtn.onclick = () => leaveGame();

function leaveGame() {
    if (gameState.roomCode) {
        socket.emit('leaveGame', { roomCode: gameState.roomCode });
    }
    // Oyun durumunu sıfırla
    resetGameState();
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

    socket.emit('joinRoom', {
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
    updatePlayerStats();
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
        showModal('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', 'error');
        return;
    }

    reconnectAttempts++;
    console.log(`Yeniden bağlanma denemesi ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // 2 saniye sonra tekrar dene
    setTimeout(() => {
        socket.connect();
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
});
