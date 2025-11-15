const socket = io(SERVER_URL);

const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const statusDiv = document.getElementById('status');
const boardDiv = document.getElementById('board');
const turnIndicator = document.getElementById('turnIndicator');
const roomIdInput = document.getElementById('roomIdInput');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');

let currentRoomId = null;
let playerRole = null; // 'player1' (Siyah) veya 'player2' (Beyaz)
let currentBoard = null;
let currentTurn = null;

// --- Socket Bağlantıları ---

socket.on('connect', () => {
    statusDiv.textContent = '✅ Sunucuya bağlandı.';
    createBtn.disabled = false;
    joinBtn.disabled = false;
});

socket.on('disconnect', () => {
    statusDiv.textContent = '❌ Sunucu bağlantısı kesildi.';
    createBtn.disabled = true;
    joinBtn.disabled = true;
});

socket.on('gameStart', (data) => {
    lobbyDiv.style.display = 'none';
    gameDiv.style.display = 'block';
    console.log("Oyun Başladı!", data);
    updateBoard(data.board);
    updateTurn(data.turn);
    roomCodeDisplay.textContent = `Oda Kodunuz: ${currentRoomId}. Siz: ${playerRole === 'player1' ? 'Siyah (İlk Hamle)' : 'Beyaz'}`;
});

socket.on('boardUpdate', (data) => {
    updateBoard(data.board);
    updateTurn(data.turn);
});

socket.on('opponentDisconnected', (message) => {
    alert(message);
    resetGame();
});

// --- Lobi Butonları ---

createBtn.addEventListener('click', () => {
    socket.emit('createGame', (response) => {
        if (response.success) {
            currentRoomId = response.roomId;
            playerRole = response.role;
            roomCodeDisplay.textContent = `Oda Kodunuz: ${currentRoomId}. Rakip bekleniyor...`;
            statusDiv.textContent = 'Oda başarıyla oluşturuldu.';
        } else {
            alert('Oda oluşturulamadı.');
        }
    });
});

joinBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (roomId) {
        socket.emit('joinGame', roomId, (response) => {
            if (response.success) {
                currentRoomId = response.roomId;
                playerRole = response.role;
                statusDiv.textContent = 'Odaya başarıyla katıldınız.';
            } else {
                alert(response.message);
            }
        });
    } else {
        alert('Lütfen bir oda kodu girin.');
    }
});

leaveBtn.addEventListener('click', () => {
    // Sunucuya ayrılma isteği gönderebilirsiniz, ancak Socket.IO disconnect olayı bunu zaten halleder.
    socket.disconnect();
    socket.connect();
    resetGame();
});

// --- Oyun Arayüzü Mantığı ---

function updateBoard(board) {
    currentBoard = board;
    boardDiv.innerHTML = '';
    
    // Tahtanın görselini ve taşları board dizisine göre oluştur
    // Tahta, kareler ve taşlar için animasyonlu CSS sınıflarını kullanın
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = document.createElement('div');
            square.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
            square.dataset.row = r;
            square.dataset.col = c;
            
            const pieceType = board[r][c];
            if (pieceType !== 0) {
                const piece = document.createElement('div');
                piece.className = `piece ${pieceType === 1 ? 'black' : 'white'}`;
                // Kral (king) taşlar için farklı bir sınıf ekleyin
                piece.addEventListener('click', handlePieceClick);
                square.appendChild(piece);
            }

            boardDiv.appendChild(square);
        }
    }
}

function updateTurn(turn) {
    currentTurn = turn;
    const isMyTurn = (playerRole === 'player1' && turn === 'player1') || (playerRole === 'player2' && turn === 'player2');
    
    turnIndicator.textContent = isMyTurn ? 'SIRA SİZDE!' : 'Rakibinizin sırası...';
    turnIndicator.className = isMyTurn ? 'turn-mine' : 'turn-opponent';
}

function handlePieceClick(event) {
    const piece = event.target;
    const square = piece.parentElement;
    const from = {
        row: parseInt(square.dataset.row),
        col: parseInt(square.dataset.col)
    };
    
    // Sadece kendi sıranızsa ve kendi taşınızsa hamle yapma mantığını çalıştırın.
    if (currentTurn === playerRole) {
        // ... (Seçilen taşı, olası hareketleri vurgulama mantığı) ...
        
        // Örnek bir hamle gönderme (Hareket kuralları istemcide de görsel amaçlı kontrol edilmeli)
        // socket.emit('move', { roomId: currentRoomId, from: from, to: {r: 3, c: 4} }); 
    }
}

function resetGame() {
    currentRoomId = null;
    playerRole = null;
    currentBoard = null;
    currentTurn = null;
    
    lobbyDiv.style.display = 'block';
    gameDiv.style.display = 'none';
    roomCodeDisplay.textContent = '';
    boardDiv.innerHTML = '';
    turnIndicator.textContent = 'Sıra: Bekleniyor...';
}

// Tahtayı ilk başta yükle
updateBoard([
    [0, 0, 0, 0, 0, 0, 0, 0], 
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
]); // Boş bir tahta
