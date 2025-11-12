// Dosya Adı: game.js
const SERVER_URL = window.location.origin; // Veya sunucunuzun tam adresi (örn: "https://my-render-app.onrender.com")

let socket;
let currentRoomCode = null;
let username = '';
let isHost = false;
let myTurn = false;
let hostId = null;
let guestId = null;

// DOM Elementleri
const statusEl = document.getElementById('connection-status');
const createBtn = document.getElementById('create-room-btn');
const joinBtn = document.getElementById('join-room-btn');
const roomCodeInput = document.getElementById('room-code-input');
const usernameInput = document.getElementById('username');
const lobbyEl = document.getElementById('lobby');
const gameAreaEl = document.getElementById('game-area');
const chatContainerEl = document.getElementById('chat-container');
const gameBoardEl = document.getElementById('game-board');
const gameInfoEl = document.getElementById('game-info');
const chatWindowEl = document.getElementById('chat-window');
const chatInputEl = document.getElementById('chat-input');
const sendMsgBtn = document.getElementById('send-message-btn');
const roomMsgEl = document.getElementById('room-message');
const resultEl = document.getElementById('game-result');
const nextLevelBtn = document.getElementById('next-level-btn');

function updateConnectionStatus(status) {
    statusEl.textContent = status.text;
    statusEl.className = status.class;
    
    const isConnected = status.class === 'status-connected';
    createBtn.disabled = !isConnected;
    joinBtn.disabled = !isConnected;
}

// **1. SOCKET BAĞLANTISINI ERKEN BAŞLAT**
function initializeSocket() {
    updateConnectionStatus({ text: 'Sunucuya Bağlanılıyor...', class: 'status-connecting' });
    
    // Sayfa yüklenir yüklenmez Socket.IO bağlantısını kur.
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log("Bağlantı Başarılı!");
        updateConnectionStatus({ text: '✅ Bağlandı', class: 'status-connected' });
        
        // Kullanıcı adı daha önce girildiyse hemen kontrolü aç
        if (usernameInput.value.trim()) {
             createBtn.disabled = false;
             joinBtn.disabled = false;
        }
    });

    socket.on('disconnect', () => {
        console.log("Bağlantı Kesildi!");
        updateConnectionStatus({ text: '❌ Bağlantı Kesildi', class: 'status-disconnected' });
        createBtn.disabled = true;
        joinBtn.disabled = true;
        // Eğer oyundaysak lobiyi göster
        if (currentRoomCode) {
            goToLobby('Sunucu bağlantısı kesildiği için lobiye dönüldü.');
        }
    });

    socket.on('connect_error', (err) => {
        console.error("Bağlantı Hatası:", err);
        updateConnectionStatus({ text: '❌ Bağlantı Hatası', class: 'status-disconnected' });
    });

    // SUNUCU DİNLEYİCİLERİ
    socket.on('roomCreated', (code) => {
        currentRoomCode = code;
        isHost = true;
        document.getElementById('display-room-code').textContent = code;
        lobbyEl.style.display = 'block';
        document.getElementById('waiting-area').style.display = 'block';
        roomMsgEl.textContent = 'Oda kuruldu. Rakip bekleniyor...';
        console.log(`Oda Kuruldu: ${code}`);
    });

    socket.on('roomJoined', (code) => {
        currentRoomCode = code;
        isHost = false;
        document.getElementById('display-room-code').textContent = code;
        roomMsgEl.textContent = '';
        console.log(`Odaya Katıldı: ${code}`);
    });

    socket.on('joinFailed', (message) => {
        roomMsgEl.textContent = message;
    });
    
    socket.on('opponentLeft', (message) => {
        alert(message);
        goToLobby('Rakip oyundan ayrıldı. Yeni oyuncu bekleyebilirsiniz.');
    });

    socket.on('gameStart', ({ players, roomCode }) => {
        const host = players.find(p => p.isHost);
        const guest = players.find(p => !p.isHost);
        
        hostId = host.id;
        guestId = guest.id;
        
        // Arayüzü güncelle
        lobbyEl.style.display = 'none';
        gameAreaEl.style.display = 'block';
        chatContainerEl.style.display = 'flex';
        roomMsgEl.textContent = '';
        
        // Host/Guest adlarını ayarla (Client tarafında kullanmak için)
        // Bu veriyi global tutmak gerekebilir, şimdilik sadece gösterelim.
        document.getElementById('level-display').textContent = `Level 1 - ${host.username} vs ${guest.username}`;
    });
    
    socket.on('gameReady', (gameState) => {
        // Yeni oyun veya seviye başladığında bombaları ve canları güncelleyip tahtayı hazırlar.
        drawGameBoard(gameState.hostBombs.length * 2); // Host ve Guest bombaları (Toplam 8 veya 12 kart)
        updateGameInfo(gameState);
        resultEl.style.display = 'none'; // Sonuç ekranını gizle
    });
    
    socket.on('newLevel', (gameState) => {
        document.getElementById('level-display').textContent = `Level ${gameState.level}`;
        updateGameInfo(gameState);
        // gameReady hemen arkasından geleceği için tahtayı orada çizeceğiz.
    });

    socket.on('gameData', (data) => {
        if (data.type === 'MOVE') {
            handleMove(data);
        } else if (data.type === 'END') {
            handleGameEnd(data);
        }
    });

    socket.on('chatMessage', (data) => {
        appendChatMessage(data.username, data.message);
    });
}

function handleGameEnd(data) {
    gameAreaEl.style.pointerEvents = 'none'; // Tahtayı kilitle
    resultEl.style.display = 'block';
    
    const winnerName = (data.winner === 'host' ? getPlayerUsername(hostId) : getPlayerUsername(guestId)) || 'Bilinmeyen Oyuncu';

    document.getElementById('result-text').textContent = `🎉 Kazanan: ${winnerName} 🎉`;
    document.getElementById('result-host-score').textContent = data.hostScore;
    document.getElementById('result-guest-score').textContent = data.guestScore;
    
    // nextLevelButonuna oyunu bitirilen level+1 bilgisini ekle
    nextLevelBtn.dataset.nextLevel = (parseInt(document.getElementById('level-display').textContent.split(' ')[1]) || 1) + 1;
}

function handleMove(data) {
    const card = document.querySelector(`.card[data-index="${data.cardIndex}"]`);
    if (!card) return;

    card.textContent = data.emoji;
    card.classList.add('card-opened');
    if (data.isBomb) {
        card.classList.add('card-bomb');
    }
    
    // Canları güncelle
    const gameState = {
        hostLives: data.newHostLives,
        guestLives: data.newGuestLives,
        turn: data.newTurn
    };
    updateGameInfo(gameState);
    
    // Sıra kontrolü
    myTurn = (data.newTurn === 0 && socket.id === hostId) || (data.newTurn === 1 && socket.id === guestId);
    gameAreaEl.style.pointerEvents = myTurn ? 'auto' : 'none'; // Sıra bizdeyse tahtayı aç
}

function updateGameInfo(gameState) {
    gameInfoEl.innerHTML = `
        <div id="host-status" class="player-status ${gameState.turn === 0 ? 'turn-indicator' : ''}">
            🔵 ${getPlayerUsername(hostId)}: Can <span id="host-lives">${gameState.hostLives}</span>
        </div>
        <div id="guest-status" class="player-status ${gameState.turn === 1 ? 'turn-indicator' : ''}">
            🔴 ${getPlayerUsername(guestId)}: Can <span id="guest-lives">${gameState.guestLives}</span>
        </div>
    `;
    
    // Skorları göster (Eğer varsa)
    if (gameState.scores) {
         gameInfoEl.innerHTML += `
             <div class="player-status">Skor: ${gameState.scores.host} - ${gameState.scores.guest}</div>
         `;
    }
    
    // Sıra kontrolü
    myTurn = (gameState.turn === 0 && socket.id === hostId) || (gameState.turn === 1 && socket.id === guestId);
    gameAreaEl.style.pointerEvents = myTurn ? 'auto' : 'none';
}

function drawGameBoard(boardSize) {
    gameBoardEl.innerHTML = '';
    // Oyun tahtası 20 karttan oluşur (server.js'teki boardSize: 20)
    for (let i = 0; i < 20; i++) {
        const card = document.createElement('div');
        card.className = 'card';
        card.textContent = '?';
        card.dataset.index = i;
        card.addEventListener('click', () => makeMove(i));
        gameBoardEl.appendChild(card);
    }
    
    // Yeni seviye başlarken tahtanın kilitli olmadığından emin ol
    gameAreaEl.style.pointerEvents = myTurn ? 'auto' : 'none';
}

function makeMove(cardIndex) {
    if (!myTurn || !currentRoomCode) return;
    
    socket.emit('gameData', {
        type: 'MOVE',
        roomCode: currentRoomCode,
        cardIndex: cardIndex
    });
}

function appendChatMessage(sender, message) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<span class="chat-sender">${sender}:</span> ${message}`;
    chatWindowEl.appendChild(msgEl);
    // En alta kaydır
    chatWindowEl.scrollTop = chatWindowEl.scrollHeight;
}

function getPlayerUsername(id) {
    if (id === hostId) return isHost ? username : document.getElementById('level-display').textContent.split(' - ')[1].split(' vs ')[0];
    if (id === guestId) return !isHost ? username : document.getElementById('level-display').textContent.split(' - ')[1].split(' vs ')[1];
    return 'Bilinmiyor';
}

function goToLobby(message = '') {
    currentRoomCode = null;
    isHost = false;
    hostId = null;
    guestId = null;
    roomMsgEl.textContent = message;
    
    lobbyEl.style.display = 'block';
    gameAreaEl.style.display = 'none';
    chatContainerEl.style.display = 'none';
    document.getElementById('waiting-area').style.display = 'none';
    gameAreaEl.style.pointerEvents = 'auto'; 
    resultEl.style.display = 'none';
}

// **OLAY DİNLEYİCİLERİ**
usernameInput.addEventListener('input', () => {
    username = usernameInput.value.trim();
    const isConnected = statusEl.classList.contains('status-connected');
    createBtn.disabled = !isConnected || username.length < 2;
    joinBtn.disabled = !isConnected || username.length < 2;
});

createBtn.addEventListener('click', () => {
    if (username.length >= 2 && socket && socket.connected) {
        socket.emit('createRoom', { username: username });
        createBtn.disabled = true;
        joinBtn.disabled = true;
    } else if (!socket || !socket.connected) {
         roomMsgEl.textContent = 'Sunucuya bağlı değilsiniz.';
    }
});

joinBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (username.length >= 2 && code.length === 4 && socket && socket.connected) {
        socket.emit('joinRoom', { username: username, roomCode: code });
    } else if (!socket || !socket.connected) {
         roomMsgEl.textContent = 'Sunucuya bağlı değilsiniz.';
    } else {
         roomMsgEl.textContent = 'Lütfen geçerli bir kullanıcı adı ve 4 haneli oda kodu girin.';
    }
});

sendMsgBtn.addEventListener('click', () => {
    const message = chatInputEl.value.trim();
    if (message && currentRoomCode) {
        socket.emit('chatMessage', { roomCode: currentRoomCode, message: message });
        chatInputEl.value = '';
    }
});

chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendMsgBtn.click();
    }
});

nextLevelBtn.addEventListener('click', () => {
    const nextLevel = parseInt(nextLevelBtn.dataset.nextLevel) || 2; // Varsayılan olarak Level 2
    if (currentRoomCode && socket.connected) {
        socket.emit('levelComplete', { roomCode: currentRoomCode, nextLevel: nextLevel });
    }
});

// Sayfa yüklendiğinde bağlantıyı başlat
document.addEventListener('DOMContentLoaded', initializeSocket);
