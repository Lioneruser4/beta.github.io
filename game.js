// Socket.io baglantisi
const socket = io('https://mario-io-1.onrender.com');

// Oyun durumu
let gameState = {
    board: [],
    currentTurn: 'red',
    selectedPiece: null,
    myColor: null,
    isMyTurn: false,
    roomCode: null, 
    telegramId: "user_" + Math.random().toString(16).slice(2), // Test için rastgele ID
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
const leaderboardBtn = document.getElementById('leaderboard-btn'); // Yeni buton
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
const leaderboardModal = document.getElementById('leaderboard-modal'); // Yeni modal
const leaderboardList = document.getElementById('leaderboard-list');
const leaderboardCloseBtn = document.getElementById('leaderboard-close-btn');

const BOARD_SIZE = 8;

// --- Socket.io Eventleri ---

socket.on('connect', () => {
    console.log('✅ Servere baglandi');
    console.log('🔗 Socket ID:', socket.id);
    connectionStatus.textContent = 'Servere baglandi!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');
    showScreen('main');
    // Sunucuya kimliğimizi kaydedelim
    socket.emit('register', { 
        telegramId: gameState.telegramId,
        username: gameState.telegramId // Veya bir input'tan alınan kullanıcı adı
    });
});

socket.on('disconnect', () => {
    connectionStatus.textContent = 'Serverle elaqe kesildi';
    connectionStatus.classList.remove('text-green-500');
    connectionStatus.classList.add('text-red-500');
    showModal('Serverle elaqe kesildi. Səhifeni yenileyin.');
});

socket.on('forceDisconnect', (message) => {
    showModal(message);
    socket.disconnect();
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
    let message = `Oyun bitdi! ${isWinner ? 'Siz qazandınız!' : 'Məğlub oldunuz.'}`;
    
    if (data.reason && data.reason !== 'Oyun bitti.') {
        message += `\nSəbəb: ${data.reason}`;
    }

    if (data.eloChange) {
        const eloText = data.eloChange > 0 ? `+${data.eloChange}` : data.eloChange;
        message += `\nELO Dəyişimi: ${eloText}`;
    }
    showModal(message);
    setTimeout(() => leaveGame(true), 4000); // Oyunu tamamen sıfırla
});

socket.on('error', (message) => {
    showModal(message);
    gameState.isSearching = false;
    clearInterval(searchTimer);
    searchTimer = null;
    if (!gameState.gameStarted) { // Sadece lobideyken ana ekrana dön
        showScreen('main');
    }
});

// --- Yardimci Funksiyalar ---

function showModal(message) {
    modalMessage.textContent = message;
    messageModal.classList.remove('hidden');
}

async function showLeaderboard() {
    try {
        // Sunucu adresini buraya yazın
        const response = await fetch('https://mario-io-1.onrender.com/leaderboard');
        const data = await response.json();

        if (data.success) {
            leaderboardList.innerHTML = ''; // Listeyi temizle
            data.leaderboard.forEach((player, index) => {
                const li = document.createElement('li');
                li.className = 'flex justify-between items-center p-3 bg-gray-700 rounded-lg mb-2';
                li.innerHTML = `
                    <span class="font-bold text-lg">${index + 1}. ${player.username}</span>
                    <span class="text-yellow-400">🏆 ${player.elo} ELO (Lv. ${player.level})</span>
                `;
                leaderboardList.appendChild(li);
            });
            leaderboardModal.classList.remove('hidden');
        } else {
            showModal('Liderlər cədvəlini yükləmək mümkün olmadı.');
        }
    } catch (error) {
        showModal('Liderlər cədvəlinə qoşulma xətası.');
        console.error('Leaderboard fetch error:', error);
    }
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

function hasAnyCaptureMoves(board, player) {
    // Tüm taşları kontrol et, herhangi birinin zıplama hamlesi var mı?
    return board.flat().some((piece, index) => getPiecePlayer(piece) === player && findJumps(board, Math.floor(index / BOARD_SIZE), index % BOARD_SIZE, player).length > 0);
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
                const fromR = gameState.selectedPiece.r;
                const fromC = gameState.selectedPiece.c;
                const mustCapture = hasAnyCaptureMoves(gameState.board, gameState.myColor);
                const validMoves = findValidMoves(gameState.board, fromR, fromC, gameState.myColor);
                const isThisMoveValid = validMoves.some(move => move.to.r === r && move.to.c === c);

                // Eğer taş yeme zorunluluğu varsa ve bu hamle bir yeme hamlesi değilse, gösterme.
                // Eğer taş yeme zorunluluğu yoksa, tüm geçerli hamleleri göster.
                const isCaptureMove = Math.abs(fromR - r) === 2;
                const shouldShow = isThisMoveValid && (!mustCapture || isCaptureMove);

                if (shouldShow) {
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
        // Taş yeme zorunluluğu var mı diye kontrol et.
        const mustCapture = hasAnyCaptureMoves(gameState.board, gameState.myColor);
        if (mustCapture) {
            const jumpsForThisPiece = findJumps(gameState.board, r, c, gameState.myColor);
            if (jumpsForThisPiece.length === 0) {
                return showModal("Taş yemek zorunludur! Başka bir taşınızı seçin.");
            }
        }
        gameState.selectedPiece = { r, c };
        drawBoard();
    } else if (gameState.selectedPiece && !pieceValue) {
        const fromR = gameState.selectedPiece.r;
        const fromC = gameState.selectedPiece.c;

        // Hamlenin geçerliliğini tekrar kontrol et, bu sefer zorunlu yeme kuralıyla birlikte.
        const mustCapture = hasAnyCaptureMoves(gameState.board, gameState.myColor);
        const validMoves = findValidMoves(gameState.board, fromR, fromC, gameState.myColor);
        const move = validMoves.find(m => m.to.r === r && m.to.c === c);

        if (move) {
            const isCaptureMove = Math.abs(fromR - r) === 2;
            if (mustCapture && !isCaptureMove) {
                showModal("Taş yemek zorunludur!");
                return;
            }
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

dereceliBtn.onclick = () => {
    console.log('🎮 Dereceli butona tiklandi');
    showScreen('ranked');
    console.log('📡 findMatch gonderiliyor...');
    socket.emit('findMatch');
    console.log('✅ findMatch gonderildi!');
};

leaderboardBtn.onclick = () => {
    showLeaderboard();
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

leaveGameBtn.onclick = () => {
    // Oyuncuya oyundan çıkmak isteyip istemediğini sor
    if (confirm("Oyundan çıxmaq istədiyinizə əminsiniz? Bu, məğlubiyyət sayılacaq.")) {
        leaveGame();
    }
};

function leaveGame(isGameOver = false) {
    // Eğer oyun bitmediyse ve oyuncu manuel ayrılıyorsa sunucuya haber ver
    if (gameState.roomCode && !isGameOver) {
        socket.emit('leaveGame', { roomCode: gameState.roomCode });
    }

    const preservedTelegramId = gameState.telegramId;

    // Oyun durumunu tamamen sıfırla
    gameState = {
        board: [],
        currentTurn: 'red',
        selectedPiece: null,
        myColor: null,
        isMyTurn: false,
        telegramId: preservedTelegramId, // Kimliği koru
        roomCode: null,
        isSearching: false,
        gameStarted: false
    };
    
    showScreen('main');
}

modalCloseBtn.onclick = () => {
    messageModal.classList.add('hidden');
};

leaderboardCloseBtn.onclick = () => {
    leaderboardModal.classList.add('hidden');
};

// Baslangic
document.addEventListener('DOMContentLoaded', () => {
    connectionStatus.textContent = 'Servere qosulur...';
    connectionStatus.classList.add('text-yellow-400', 'animate-pulse');
});
