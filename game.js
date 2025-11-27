// Socket.io bağlantısı
const socket = io('https://mario-io-1.onrender.com', {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
});

// Bağlantı durumu
let isConnected = false;
let isReconnecting = false;
let lastGameState = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Oyun durumu
let gameState = {
    board: [],
    currentTurn: 'red',
    selectedPiece: null,
    myColor: null,
    isMyTurn: false,
    roomCode: null,
    isSearching: false,
    gameStarted: false
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

const BOARD_SIZE = 8;

// --- Socket.io Eventleri ---

// Bağlantı durumu takibi
socket.on('connect', () => {
    console.log('✅ Sunucuya bağlandı');
    isConnected = true;
    isReconnecting = false;
    reconnectAttempts = 0;
    updateConnectionStatus(true);
    
    // Eğer önceki bir oyun durumu varsa, sunucudan güncel durumu iste
    if (gameState.roomCode) {
        console.log('Önceki oyun durumu kurtarılıyor...');
        socket.emit('rejoinGame', { roomCode: gameState.roomCode });
    }
});

socket.on('disconnect', (reason) => {
    console.log('❌ Sunucu bağlantısı kesildi:', reason);
    isConnected = false;
    updateConnectionStatus(false);
    
    if (gameState.gameStarted && !isReconnecting && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        isReconnecting = true;
        showMessage('Sunucuya bağlanılıyor...', false);
        attemptReconnect();
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log(`✅ Tekrar bağlanıldı (${attemptNumber}. deneme)`);
    isConnected = true;
    isReconnecting = false;
    updateConnectionStatus(true);
    hideMessage();
    
    // Oyun durumunu senkronize et
    if (gameState.roomCode) {
        socket.emit('rejoinGame', { roomCode: gameState.roomCode });
    }
});

socket.on('reconnect_failed', () => {
    console.error('❌ Tekrar bağlanma başarısız oldu');
    isReconnecting = false;
    updateConnectionStatus(false);
    showMessage('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', true);
});

// Oyun durumunu senkronize etme
socket.on('gameState', (state) => {
    console.log('Oyun durumu güncellendi:', state);
    gameState = { ...gameState, ...state };
    updateGameUI();
});

// Oyun durumunu güncelle
function updateGameUI() {
    if (gameState.gameStarted) {
        renderBoard();
        updateTurnDisplay();
    }
}

// Bağlantı durumunu güncelle
function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatus.textContent = 'Çevrimiçi';
        connectionStatus.className = 'text-green-500';
    } else {
        connectionStatus.textContent = 'Çevrimdışı';
        connectionStatus.className = 'text-red-500';
    }
}

// Tekrar bağlanmayı dene
function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showMessage('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.', true);
        return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff
    
    console.log(`Tekrar bağlanılıyor... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(() => {
        if (!isConnected) {
            socket.connect();
            attemptReconnect();
        }
    }, delay);
}

// Mesaj göster
function showMessage(message, isError = false) {
    modalMessage.textContent = message;
    modalMessage.className = isError ? 'text-red-500' : 'text-white';
    messageModal.classList.remove('hidden');
}

// Mesajı gizle
function hideMessage() {
    messageModal.classList.add('hidden');
}

// Oyun tahtasını çiz
function renderBoard() {
    // Mevcut tahtayı temizle
    boardElement.innerHTML = '';
    
    // Tahtayı çiz
    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const cell = document.createElement('div');
            cell.className = 'w-12 h-12 border border-gray-700 flex items-center justify-center';
            
            // Hücrenin durumuna göre stil ekle
            const piece = gameState.board[row]?.[col];
            if (piece) {
                cell.innerHTML = `<div class="w-10 h-10 rounded-full ${piece === 'red' ? 'bg-red-500' : 'bg-blue-500'}"></div>`;
            }
            
            // Tıklama olayı ekle
            cell.addEventListener('click', () => handleCellClick(row, col));
            
            boardElement.appendChild(cell);
        }
    }
}

// Sıra göstergesini güncelle
function updateTurnDisplay() {
    if (gameState.isMyTurn) {
        turnText.textContent = 'Sıra Sizde';
        turnText.className = 'text-green-400';
    } else {
        turnText.textContent = 'Rakibin Sırası';
        turnText.className = 'text-red-400';
    }
}

// Hücre tıklama işleyicisi
function handleCellClick(row, col) {
    if (!gameState.isMyTurn || !gameState.gameStarted) return;
    
    // Hamle yap
    socket.emit('makeMove', {
        row,
        col,
        roomCode: gameState.roomCode
    });
}

// Oyun sonu işleyicisi
socket.on('gameOver', (data) => {
    gameState.gameStarted = false;
    showMessage(`Oyun bitti! Kazanan: ${data.winner}`, false);
});

// Hata işleyicisi
socket.on('error', (error) => {
    console.error('Hata:', error);
    showMessage(`Hata: ${error.message}`, true);
});

socket.on('connect', () => {
    console.log('✅ Servere baglandi');
    console.log('🔗 Socket ID:', socket.id);
    connectionStatus.textContent = 'Servere baglandi!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');
    showScreen('main');
});

socket.on('disconnect', () => {
    connectionStatus.textContent = 'Serverle elaqe kesildi';
    connectionStatus.classList.remove('text-green-500');
    connectionStatus.classList.add('text-red-500');
    showModal('Serverle elaqe kesildi. Səhifeni yenileyin.');
});

socket.on('matchFound', (data) => {
    console.log('🎉 Raqib tapildi!', data);
    gameState.roomCode = data.roomCode;
    gameState.myColor = data.color;
    gameState.gameStarted = true;
    gameState.isSearching = false;
    gameState.board = createInitialBoard();
    
    clearInterval(searchTimer);
    searchTimer = null;
    
    showModal('Raqib tapildi! Siz ' + (gameState.myColor === 'red' ? 'Qirmizi' : 'Ag') + ' rengindesiniz.');
    showScreen('game');
    updateGameUI();
});

socket.on('searchStatus', (data) => {
    console.log('🔍 Axtaris statusu:', data);
    rankedStatus.textContent = data.message;
});

socket.on('searchCancelled', (data) => {
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
    gameState.board = data.board;
    gameState.currentTurn = data.currentTurn;
    gameState.isMyTurn = gameState.currentTurn === gameState.myColor;
    updateGameUI();
});

socket.on('gameOver', (data) => {
    const isWinner = data.winner === gameState.myColor;
    showModal('Oyun bitdi! ' + (isWinner ? 'Siz qazandiniz!' : 'Raqib qazandi!'));
    setTimeout(() => leaveGame(), 3000);
});

socket.on('error', (message) => {
    showModal(message);
    gameState.isSearching = false;
    clearInterval(searchTimer);
    searchTimer = null;
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
    if (!gameState.isMyTurn || !gameState.gameStarted) return;

    const pieceValue = gameState.board[r] && gameState.board[r][c];
    const piecePlayer = getPiecePlayer(pieceValue);

    if (piecePlayer === gameState.myColor) {
        gameState.selectedPiece = { r, c };
        drawBoard();
    } else if (gameState.selectedPiece && !pieceValue) {
        const fromR = gameState.selectedPiece.r;
        const fromC = gameState.selectedPiece.c;

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

// Oyundan çıkış işlemi
function handleLeaveGame() {
    if (confirm('Oyundan çıkmak istediğinize emin misiniz? Bu işlem geri alınamaz.')) {
        // Sunucuya oyundan çıkış isteği gönder
        if (socket && socket.connected) {
            socket.emit('leaveGame');
            
            // Kullanıcıya geri bildirim göster
            showMessage('Oyundan çıkılıyor...', false);
            
            // 1 saniye sonra ana menüye dön
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        } else {
            // Eğer bağlantı yoksa doğrudan yönlendir
            window.location.href = '/';
        }
    }
}

// Sunucudan gelen oyundan atılma/çıkış mesajlarını dinle
socket.on('playerLeft', (data) => {
    if (data.playerId !== socket.id) { // Kendi çıkışımız değilse
        showMessage('Rakibiniz oyundan ayrıldı. Ana menüye yönlendiriliyorsunuz...', false);
        setTimeout(() => {
            window.location.href = '/';
        }, 3000);
    }
});

// Oyun sonu mesajı
socket.on('gameEnd', (data) => {
    // Eğer kazanan yoksa (beraberlik veya oyun iptali)
    if (!data.winner) {
        showMessage(data.winnerName || 'Oyun sona erdi', false);
    } else {
        const winnerName = data.winnerName || (data.winner === socket.id ? 'Siz' : 'Rakibiniz');
        showMessage(`Oyun bitti! Kazanan: ${winnerName}`, false);
    }
    
    // 3 saniye sonra ana menüye dön
    setTimeout(() => {
        window.location.href = '/';
    }, 3000);
});

// --- Button Eventleri ---

dereceliBtn.onclick = () => {
    console.log('🎮 Dereceli butona tiklandi');
    showScreen('ranked');
    console.log('📡 findMatch gonderiliyor...');
    socket.emit('findMatch');
    console.log('✅ findMatch gonderildi!');
};

friendBtn.onclick = () => {
    showScreen('friend');
};

cancelRankedBtn.onclick = () => {
    gameState.isSearching = false;
    socket.emit('cancelSearch');
};

createRoomBtn.onclick = () => {
    const roomCode = generateRoomCode();
    gameState.roomCode = roomCode;
    gameState.myColor = 'red';
    socket.emit('createRoom', { roomCode });
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

leaveGameBtn.onclick = () => leaveGame();

function leaveGame() {
    if (gameState.roomCode) {
        socket.emit('leaveGame', { roomCode: gameState.roomCode });
    }
    
    gameState = {
        board: [],
        currentTurn: 'red',
        selectedPiece: null,
        myColor: null,
        isMyTurn: false,
        roomCode: null,
        isSearching: false,
        gameStarted: false
    };
    
    showScreen('main');
}

modalCloseBtn.onclick = () => {
    messageModal.classList.add('hidden');
};

// Çıkış butonuna event listener ekle
document.addEventListener('DOMContentLoaded', () => {
    const leaveGameBtn = document.getElementById('leave-game-btn');
    if (leaveGameBtn) {
        leaveGameBtn.addEventListener('click', handleLeaveGame);
    }
    connectionStatus.textContent = 'Servere qosulur...';
    connectionStatus.classList.add('text-yellow-400', 'animate-pulse');
});
