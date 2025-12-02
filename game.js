// Socket.io baglantisi
const socket = io('https://beta-github-io.onrender.com', {
    transports: ['websocket'] // Daha stabil bağlantı için
});

// Oyun durumu
let gameState = {
    myPlayerId: null,
    players: {},
    board: [],
    market: [],
    currentPlayer: null,
    selectedTile: null, // { index, tile }
    isMyTurn: false,
    roomCode: null,
    isSearching: false,
    gameStarted: false,
    opponent: null
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
const joinRoomBtn = document.getElementById('join-room-btn'); // Bu butonu HTML'de kontrol et
const boardElement = document.getElementById('board');
const playerHandElement = document.getElementById('player-hand');
const opponentInfoElement = document.getElementById('opponent-info');
const marketInfoElement = document.getElementById('market-info');
const turnInfoElement = document.getElementById('turn-info');
const leaveGameBtn = document.getElementById('leave-game-btn');
const drawFromMarketBtn = document.getElementById('draw-from-market-btn');
const messageModal = document.getElementById('message-modal');
const modalMessage = document.getElementById('modal-message');
const modalCloseBtn = document.getElementById('modal-close-btn');
const gameEndModal = document.getElementById('game-end-modal');
const gameEndMessage = document.getElementById('game-end-message');
const gameEndDetails = document.getElementById('game-end-details');
const gameEndCloseBtn = document.getElementById('game-end-close-btn');

let myProfile = {}; // Oyuncu bilgilerini saklamak için

// --- Socket.io Eventleri ---

socket.on('connect', () => {
    console.log('✅ Servere baglandi');
    console.log('🔗 Socket ID:', socket.id);
    connectionStatus.textContent = 'Servere baglandi!';
    connectionStatus.classList.remove('text-yellow-400');
    connectionStatus.classList.add('text-green-500');
});

socket.on('disconnect', () => {
    connectionStatus.textContent = 'Serverle elaqe kesildi';
    connectionStatus.classList.remove('text-green-500');
    connectionStatus.classList.add('text-red-500');
    showModal('Serverle elaqe kesildi. Səhifeni yenileyin.');
});

socket.on('gameStart', (data) => {
    console.log('🎉 Oyun başlayır!', data);
    updateGameState(data.gameState);
    showScreen('game');
    updateGameUI();
});

socket.on('gameUpdate', (data) => {
    console.log('🔄 Oyun yeniləndi', data);
    updateGameState(data.gameState);
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
    roomCodeOutput.textContent = data.roomCode;
    console.log('🏠 Oda yaradildi:', data.roomCode);
});

socket.on('gameEnd', (data) => {
    console.log('🏁 Oyun bitdi!', data);
    let message = '';
    if (data.winner === 'DRAW') {
        message = 'Oyun bərabərə bitdi!';
    } else if (data.winner === gameState.myPlayerId) {
        message = 'Təbriklər, siz qazandınız!';
    } else {
        message = `Məğlub oldunuz. Qazanan: ${data.winnerName}`;
    }

    let details = '';
    if (data.isRanked && data.eloChanges) {
        const myChange = data.winner === gameState.myPlayerId ? data.eloChanges.winner : data.eloChanges.loser;
        details = `ELO dəyişimi: <span class="${myChange >= 0 ? 'text-green-400' : 'text-red-400'}">${myChange > 0 ? '+' : ''}${myChange}</span>`;
    }

    showGameEndModal(message, details);
});

socket.on('playerDisconnected', () => {
    showModal('Rəqib oyundan ayrıldı. Oyun ləğv edildi.');
    setTimeout(leaveGame, 3000);
});

socket.on('error', (data) => {
    showModal(data.message);
    gameState.isSearching = false;
    clearInterval(searchTimer);
    searchTimer = null;
    if (rankedLobby.classList.contains('hidden')) {
        showScreen('main');
    }
});

// --- Yardimci Funksiyalar ---

function showModal(message) {
    modalMessage.textContent = message;
    messageModal.classList.remove('hidden', 'opacity-0');
    messageModal.classList.add('opacity-100');
}

function showGameEndModal(message, details) {
    gameEndMessage.textContent = message;
    gameEndDetails.innerHTML = details;
    gameEndModal.classList.remove('hidden', 'opacity-0');
    gameEndModal.classList.add('opacity-100');
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

function updateGameState(newGameState) {
    gameState.myPlayerId = newGameState.myPlayerId;
    gameState.players = newGameState.players;
    gameState.board = newGameState.board;
    gameState.market = newGameState.market;
    gameState.currentPlayer = newGameState.currentPlayer;
    gameState.isMyTurn = newGameState.currentPlayer === newGameState.myPlayerId;
    gameState.gameStarted = true;

    const opponentId = Object.keys(gameState.players).find(id => id !== gameState.myPlayerId);
    if (opponentId) {
        gameState.opponent = gameState.players[opponentId];
    }
}

function canPlayTile(tile, board) {
    if (board.length === 0) return { left: true, right: true };
    const leftEnd = board[0][0];
    const rightEnd = board[board.length - 1][1];
    const canPlayLeft = tile[0] === leftEnd || tile[1] === leftEnd;
    const canPlayRight = tile[0] === rightEnd || tile[1] === rightEnd;
    return { left: canPlayLeft, right: canPlayRight };
}

// --- UI Funksiyalari ---

function createTileElement(tile, isSelectable = false, index = -1) {
    const tileDiv = document.createElement('div');
    tileDiv.className = 'domino-tile';
    if (isSelectable) {
        tileDiv.classList.add('cursor-pointer', 'hover:bg-gray-600');
        tileDiv.onclick = () => handleTileClick(index, tile);
    }
    if (gameState.selectedTile && gameState.selectedTile.index === index) {
        tileDiv.classList.add('ring-2', 'ring-blue-400');
    }
    tileDiv.innerHTML = `<span class="tile-half">${tile[0]}</span><span class="tile-separator"></span><span class="tile-half">${tile[1]}</span>`;
    return tileDiv;
}

function drawBoard() {
    boardElement.innerHTML = '';
    gameState.board.forEach(tile => {
        boardElement.appendChild(createTileElement(tile));
    });

    // Oynanabilir pozisyonları göster
    if (gameState.selectedTile && gameState.isMyTurn) {
        const { left, right } = canPlayTile(gameState.selectedTile.tile, gameState.board);
        if (left) {
            const leftPlaceholder = document.createElement('div');
            leftPlaceholder.className = 'play-placeholder';
            leftPlaceholder.textContent = 'Bura oyna';
            leftPlaceholder.onclick = () => playSelectedTile('left');
            boardElement.prepend(leftPlaceholder);
        }
        if (right) {
            const rightPlaceholder = document.createElement('div');
            rightPlaceholder.className = 'play-placeholder';
            rightPlaceholder.textContent = 'Bura oyna';
            rightPlaceholder.onclick = () => playSelectedTile('right');
            boardElement.appendChild(rightPlaceholder);
        }
    }
}

function drawPlayerHand() {
    playerHandElement.innerHTML = '';
    const myHand = gameState.players[gameState.myPlayerId]?.hand || [];
    myHand.forEach((tile, index) => {
        playerHandElement.appendChild(createTileElement(tile, gameState.isMyTurn, index));
    });
}

function updateGameUI() {
    if (!gameState.gameStarted) return;

    // Sıra bilgisi
    turnInfoElement.textContent = gameState.isMyTurn ? 'Sizin sıranızdır!' : 'Rəqibin sırası gözlənilir...';
    turnInfoElement.className = 'text-lg font-bold ' + (gameState.isMyTurn ? 'text-green-400 animate-pulse' : 'text-yellow-400');

    // Rakip bilgisi
    if (gameState.opponent) {
        const opponentHandSize = gameState.opponent.hand.length;
        opponentInfoElement.innerHTML = `
            <span class="font-semibold">${gameState.opponent.name}</span>
            <span>- ${opponentHandSize} daş</span>
        `;
    }

    // Pazar bilgisi
    marketInfoElement.textContent = `Pazar: ${gameState.market.length} daş`;
    drawFromMarketBtn.style.display = gameState.isMyTurn ? 'block' : 'none';

    drawPlayerHand();
    drawBoard();
}

// --- Event Handlers ---

function handleTileClick(index, tile) {
    if (!gameState.isMyTurn) return;
    gameState.selectedTile = { index, tile };
    // UI'ı yeniden çizerek seçimi göster
    drawPlayerHand();
    drawBoard();
}

function playSelectedTile(position) {
    if (!gameState.selectedTile) return;

    socket.emit('playTile', {
        tileIndex: gameState.selectedTile.index,
        position: position
    });

    gameState.selectedTile = null;
}

// --- Button Eventleri ---

dereceliBtn.onclick = () => {
    console.log('🎮 Dereceli butona tiklandi');
    showScreen('ranked');
    // Telegram'dan gelen oyuncu bilgilerini gönder
    // Bu bilgiler `myProfile` objesinde saklanmalı
    socket.emit('findMatch', {
        playerName: myProfile.username || 'Guest',
        telegramId: myProfile.telegramId,
        photoUrl: myProfile.photoUrl,
        level: myProfile.level,
        elo: myProfile.elo
    });
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
    // Bu özellik sunucuda var ama client'da tam implemente edilmemiş.
    // Şimdilik sadece dereceli maça odaklanalım.
    // socket.emit('createRoom', { 
    //     playerName: myProfile.username || 'Guest' 
    // });
    showModal('Özəl otaq funksiyası hələ aktiv deyil.');
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
    // const roomCode = joinRoomInput.value.trim().toUpperCase();
    // if (roomCode) {
    //     socket.emit('joinRoom', { 
    //         roomCode,
    //         playerName: myProfile.username || 'Guest'
    //     });
    // }
    showModal('Özəl otaq funksiyası hələ aktiv deyil.');
};

drawFromMarketBtn.onclick = () => {
    if (gameState.isMyTurn) {
        socket.emit('drawFromMarket');
    }
};

leaveGameBtn.onclick = () => leaveGame();

function leaveGame() {
    socket.emit('leaveGame');
    
    gameState = {
        myPlayerId: null, // Bu objeyi tamamen yeniden oluşturuyoruz
        players: {},
        board: [],
        market: [],
        currentPlayer: null,
        selectedTile: null,
        isMyTurn: false,
        roomCode: null,
        isSearching: false,
        gameStarted: false,
        opponent: null
    };
    
    showScreen('main');
}

modalCloseBtn.onclick = () => {
    messageModal.classList.remove('opacity-100');
    messageModal.classList.add('hidden', 'opacity-0');
};

gameEndCloseBtn.onclick = () => {
    gameEndModal.classList.remove('opacity-100');
    gameEndModal.classList.add('hidden', 'opacity-0');
    leaveGame(); // Oyun bitiş modalı kapanınca lobiye dön
};

// Baslangic
document.addEventListener('DOMContentLoaded', () => {
    connectionStatus.textContent = 'Servere qosulur...';
    connectionStatus.classList.add('text-yellow-400');
    showScreen('main');
    // myProfile objesini burada doldurmalısın, örneğin Telegram'dan gelen veriyle
    // Örnek: myProfile = { telegramId: '12345', username: 'testuser', elo: 100, level: 1 };
});
