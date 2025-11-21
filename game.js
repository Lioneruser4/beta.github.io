// --- Oyun Durumu ve UI Elementleri ---

// Socket.io bağlantısı
const socket = io('https://mario-io-1.onrender.com', {
    timeout: 20000,
    transports: ['websocket', 'polling']
});

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
    searchStartTime: null,
    mandatoryCaptures: [],
    mustContinueJump: false,
    jumpPosition: null
};

// Timer için değişkenler
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

// Sabitler
const BOARD_SIZE = 8;

// --- Socket.io Eventləri ---

socket.on('connect', () => {
    console.log('✅ Socket.io bağlantısı başarılı');
    connectionStatus.textContent = 'Serverə qoşuldu!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');
    showScreen('main');
});

socket.on('connected', (data) => {
    console.log('🎮 Sunucu mesajı:', data.message);
    showModal('✅ Sunucuya bağlandı!');
});

socket.on('disconnect', () => {
    connectionStatus.textContent = 'Serverlə əlaqə kəsildi';
    connectionStatus.classList.remove('text-green-500');
    connectionStatus.classList.add('text-red-500');
    showModal('Serverlə əlaqə kəsildi. Səhifəni yeniləyin.');
});

socket.on('matchFound', (data) => {
    console.log('🎉 Match found!', data);
    gameState.roomCode = data.roomCode;
    gameState.myColor = data.color;
    gameState.gameStarted = true;
    gameState.isSearching = false;
    gameState.board = createInitialBoard();
    
    showModal(`✅ Rəqib tapıldı! Siz ${gameState.myColor === 'red' ? 'Qırmızı' : 'Ağ'} rəngindəsiniz.`);
    showScreen('game');
    updateGameUI();
});

socket.on('roomCreated', (data) => {
    gameState.roomCode = data.roomCode;
    gameState.myColor = 'red';
    roomCodeOutput.textContent = data.roomCode;
    lobiStatusMessage.textContent = `Otaq kodu: ${data.roomCode}. Rəqib gözlənilir...`;
});

socket.on('opponentJoined', (data) => {
    gameState.gameStarted = true;
    gameState.isMyTurn = gameState.myColor === 'red';
    gameState.board = createInitialBoard();
    lobiStatusMessage.textContent = 'Rəqib qoşuldu! Oyun başlayır...';
    showScreen('game');
    updateGameUI();
});

socket.on('gameUpdate', (data) => {
    gameState.board = data.board;
    gameState.currentTurn = data.currentTurn;
    gameState.isMyTurn = gameState.currentTurn === gameState.myColor;
    gameState.mandatoryCaptures = data.mandatoryCaptures || [];
    gameState.mustContinueJump = data.mustContinueJump || false;
    gameState.jumpPosition = data.jumpPosition || null;
    
    // Son hamle animasyonu
    if (data.lastMove) {
        showLastMoveAnimation(data.lastMove);
    }
    
    updateGameUI();
});

socket.on('gameOver', (data) => {
    showModal(`Oyun bitdi! Qalib: ${data.winner === gameState.myColor ? 'Siz' : 'Rəqib'}`);
    setTimeout(() => leaveGame(), 3000);
});

socket.on('error', (message) => {
    showModal(message);
    gameState.isSearching = false;
    showScreen('main');
});

socket.on('searchStatus', (data) => {
    console.log('🔍 Search status:', data);
    if (data.status === 'searching' && data.inQueue) {
        rankedStatus.textContent = `🔍 Rəqib axtarılır... (${data.queueSize} nəfər kuyrukda)`;
    }
});

socket.on('searchCancelled', (data) => {
    showModal(data.message);
    clearInterval(searchTimer);
    searchTimer = null;
    showScreen('main');
});

socket.on('mandatoryCapture', (data) => {
    gameState.mandatoryCaptures = data.mandatoryJumps;
    showModal('⚠️ Məcburi yemə var! Başqa daş yeməlisiniz.');
    drawBoard();
});

socket.on('mustContinueJump', (data) => {
    gameState.mustContinueJump = true;
    gameState.jumpPosition = data.position;
    showModal('🔄 Yeməyə davam et! Daha çox daş yeyə bilərsiniz.');
    drawBoard();
});

socket.on('returnToLobby', () => {
    leaveGame();
});

// --- Yardımçı Funksiyalar ---

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
        gameState.searchStartTime = Date.now();
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
        searchTime = Math.floor((Date.now() - gameState.searchStartTime) / 1000);
        const minutes = Math.floor(searchTime / 60);
        const seconds = searchTime % 60;
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        rankedStatus.textContent = `🔍 Rəqib axtarılır... (${timeString})`;
    }, 1000);
}


function createInitialBoard() {
    const board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        board[r] = new Array(BOARD_SIZE).fill(0);
        for (let c = 0; c < BOARD_SIZE; c++) {
            if ((r + c) % 2 !== 0) {
                if (r < 3) {
                    board[r][c] = 1; // Qırmızı daş
                } else if (r > 4) {
                    board[r][c] = 2; // Ağ daş
                }
            }
        }
    }
    return board;
}

function generateRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

// --- Dama Məntiqi ---

function isValidCell(r, c) { 
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE; 
}

function getPiecePlayer(pieceValue) {
    if (pieceValue === 1 || pieceValue === 3) return 'red';
    if (pieceValue === 2 || pieceValue === 4) return 'white';
    return null;
}

function isKing(r, player) {
    return (player === 'white' && r === 0) || (player === 'red' && r === BOARD_SIZE - 1);
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
    
    // Yemə hərəkətlərini yoxla
    const jumps = findJumps(board, r, c, player);
    if (jumps.length > 0) return jumps;
    
    // Adi hərəkətləri yoxla
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

// --- UI Funksiyaları ---

function drawBoard() {
    boardElement.innerHTML = '';
    
    // Zorunlu yeme olan daşları bul
    const mandatoryPieces = [];
    if (gameState.mandatoryCaptures && gameState.mandatoryCaptures.length > 0) {
        gameState.mandatoryCaptures.forEach(capture => {
            mandatoryPieces.push(capture.from);
        });
    }
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            const isDark = (r + c) % 2 !== 0;

            cell.className = `cell ${isDark ? 'cell-black' : 'cell-white'}`;
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.onclick = () => handleCellClick(r, c);

            const pieceValue = gameState.board[r] && gameState.board[r][c];
            if (pieceValue && pieceValue !== 0) {
                const pieceElement = document.createElement('div');
                const piecePlayer = getPiecePlayer(pieceValue);
                const isKingPiece = pieceValue === 3 || pieceValue === 4;

                pieceElement.className = `piece ${
                    piecePlayer === 'red' ? 'piece-black' : 'piece-white'
                } ${isKingPiece ? (piecePlayer === 'red' ? 'piece-king piece-king-black' : 'piece-king piece-king-white') : ''}`;

                pieceElement.innerHTML = isKingPiece ? '👑' : '●';

                // Seçilmiş daş
                if (gameState.selectedPiece && gameState.selectedPiece.r === r && gameState.selectedPiece.c === c) {
                    pieceElement.classList.add('selected');
                }

                // Cari növbədəki daşlar parlasın
                if (gameState.currentTurn === piecePlayer && gameState.isMyTurn) {
                    pieceElement.classList.add('current-turn-piece');
                }

                // Zorunlu yeme olan daşlar parlasın (kırmızı animasyon)
                if (mandatoryPieces.some(pos => pos.r === r && pos.c === c)) {
                    pieceElement.classList.add('mandatory-capture-piece');
                    pieceElement.title = '⚠️ Məcburi yemə!';
                }

                // Devam eden yeme pozisyonu
                if (gameState.mustContinueJump && gameState.jumpPosition && 
                    gameState.jumpPosition.r === r && gameState.jumpPosition.c === c) {
                    pieceElement.classList.add('continue-jump-piece');
                    pieceElement.title = '🔄 Yeməyə davam et!';
                }

                cell.appendChild(pieceElement);
            }

            // Mümkün hərəkətləri göstər
            if (gameState.selectedPiece && gameState.isMyTurn) {
                if (isValidMove(gameState.board, gameState.selectedPiece.r, gameState.selectedPiece.c, r, c, gameState.myColor)) {
                    cell.classList.add('valid-move');
                    // Yeme hamlesi mi?
                    if (Math.abs(gameState.selectedPiece.r - r) === 2) {
                        cell.classList.add('capture-move');
                        cell.title = '💥 Yeme!';
                    } else {
                        cell.title = '➡️ Hərəkət et';
                    }
                }
            }

            boardElement.appendChild(cell);
        }
    }
}

function updateGameUI() {
    if (!gameState.gameStarted) return;
    
    turnText.textContent = gameState.isMyTurn ? 'Sizdədir! 🎯' : 'Rəqibdədir ⏳';
    currentTurnDisplay.className = `w-full max-w-md mb-4 p-4 rounded-xl shadow-xl text-center ${
        gameState.isMyTurn ? 'bg-green-700' : 'bg-yellow-700'
    }`;
    
    drawBoard();
}

function showLastMoveAnimation(lastMove) {
    const fromCell = document.querySelector(`[data-r="${lastMove.from.r}"][data-c="${lastMove.from.c}"]`);
    const toCell = document.querySelector(`[data-r="${lastMove.to.r}"][data-c="${lastMove.to.c}"]`);
    
    if (fromCell && toCell) {
        // Hareket animasyonu
        fromCell.classList.add('last-move-from');
        toCell.classList.add('last-move-to');
        
        // 1 saniye sonra animasyonları kaldır
        setTimeout(() => {
            fromCell.classList.remove('last-move-from');
            toCell.classList.remove('last-move-to');
        }, 1000);
    }
}

// --- Event Handlers ---

function handleCellClick(r, c) {
    if (!gameState.isMyTurn || !gameState.gameStarted) return;

    const pieceValue = gameState.board[r] && gameState.board[r][c];
    const piecePlayer = getPiecePlayer(pieceValue);

    if (piecePlayer === gameState.myColor) {
        // Daş seç
        gameState.selectedPiece = { r, c };
        drawBoard();
    } else if (gameState.selectedPiece && !pieceValue) {
        // Hərəkət et
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

// --- Button Eventləri ---

dereceliBtn.onclick = () => {
    console.log('🎮 Dereceli butona tıklandı');
    showScreen('ranked');
    console.log('📡 findMatch gönderiliyor...');
    socket.emit('findMatch');
};

friendBtn.onclick = () => {
    showScreen('friend');
};

cancelRankedBtn.onclick = () => {
    gameState.isSearching = false;
    socket.emit('cancelSearch');
    showScreen('main');
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
            showModal(`Otaq kodu (${code}) kopyalandı! 📋`);
        }).catch(() => {
            showModal("Kopyalama xətası: Kodu əl ilə kopyalayın.");
        });
    }
};

joinRoomBtn.onclick = () => {
    const roomCode = joinRoomInput.value.trim();
    if (roomCode.length !== 4) {
        showModal("Xahiş edirik, 4 rəqəmli otaq kodunu daxil edin.");
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
        gameStarted: false,
        searchStartTime: null,
        mandatoryCaptures: [],
        mustContinueJump: false,
        jumpPosition: null
    };
    
    showScreen('main');
}

modalCloseBtn.onclick = () => {
    messageModal.classList.add('hidden');
};

// Başlanğıc
document.addEventListener('DOMContentLoaded', () => {
    connectionStatus.textContent = 'Serverə qoşulur...';
    connectionStatus.classList.add('text-yellow-400', 'animate-pulse');
});
