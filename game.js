// Socket.io baglantisi
const socket = io('https://mario-io-1.onrender.com', {
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

// Oyun durumu
let gameState = {
    board: [],
    currentTurn: 'red',
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

socket.on('matchFound', (data) => {
    console.log('Eşleşme bulundu:', data);
    handleMatchFound(data);
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

// --- Button Eventleri ---

function startMatchmaking(isGuest = false) {
    if (gameState.isSearching) {
        showModal('Zaten eşleşme arıyorsunuz!');
        return;
    }
    
    gameState.isSearching = true;
    gameState.isGuest = isGuest;
    gameState.gameType = isGuest ? 'friendly' : 'ranked';
    
    socket.emit('findMatch', { 
        telegramId: isGuest ? `guest_${Date.now()}` : 'user123', // Gerçek uygulamada bu kullanıcı kimliği olacak
        isGuest,
        gameType: gameState.gameType
    });
    
    showScreen('searching');
    showStatus('Eşleşme aranıyor...');
    startSearchTimer();
}

dereceliBtn.onclick = () => {
    if (gameState.isSearching) return;
    
    gameState.isSearching = true;
    gameState.gameType = 'ranked';
    gameState.isGuest = false;
    
    // Önceki bağlantıları temizle
    socket.emit('cancelSearch');
    
    // Eşleşme isteği gönder (sadece Telegram kullanıcıları için)
    socket.emit('findMatch', { 
        telegramId: 'user123', // Gerçek uygulamada bu kullanıcı ID'si olacak
        isGuest: false,
        gameType: 'ranked',
        playerData: gameState.playerStats
    });
    
    // Eşleşme ekranını göster
    showScreen('searching');
    showStatus('Eşleşme aranıyor...');
};

friendBtn.onclick = () => startMatchmaking(true);

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

// Oyun durumunu sıfırla
function resetGameState() {
    gameState = {
        board: [],
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
