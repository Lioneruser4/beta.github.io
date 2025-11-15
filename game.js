// Dosya Adı: game.js - Dama Oyunu
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';
let myColor = ''; // 'white' veya 'black'
let currentTurn = 'white'; // Sıra kimde?
let selectedPiece = null; // Seçili taş
let board = []; // Dama tahtası durumu

// --- DOM Referansları ---
const screens = { 
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'),
    game: document.getElementById('gameScreen')
};

const gameBoardEl = document.getElementById('gameBoard');
const turnStatusEl = document.getElementById('turnStatus');

// Dama tahtasını oluştur
function createBoard() {
    // 8x8'lik boş bir tahta oluştur
    board = Array(8).fill().map(() => Array(8).fill(null));
    
    // Başlangıç taşlarını yerleştir
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            // Sadece siyah karelere taş yerleştir
            if ((row + col) % 2 !== 0) {
                if (row < 3) {
                    board[row][col] = { type: 'black', isKing: false };
                } else if (row > 4) {
                    board[row][col] = { type: 'white', isKing: false };
                }
            }
        }
    }
    
    drawBoard();
}

// Taş seçildiğinde çalışacak fonksiyon
function handlePieceClick(row, col) {
    if (currentTurn !== myColor || !board[row][col] || board[row][col].type !== myColor) {
        return;
    }
    
    clearHighlights();
    selectedPiece = { row, col };
    
    const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
        cell.classList.add('highlight');
    }
    
    const validMoves = getValidMoves(row, col);
    validMoves.forEach(move => {
        const targetCell = document.querySelector(`.cell[data-row="${move.toRow}"][data-col="${move.toCol}"]`);
        if (targetCell) {
            targetCell.classList.add('highlight');
            targetCell.style.cursor = 'pointer';
            targetCell.addEventListener('click', () => handleCellClick(move.toRow, move.toCol));
        }
    });
}

// Hücre tıklandığında çalışacak fonksiyon
function handleCellClick(row, col) {
    if (!selectedPiece || currentTurn !== myColor) return;
    
    const validMoves = getValidMoves(selectedPiece.row, selectedPiece.col);
    const move = validMoves.find(m => m.toRow === row && m.toCol === col);
    
    if (!move) return;
    
    makeMove(selectedPiece.row, selectedPiece.col, row, col);
    selectedPiece = null;
    clearHighlights();
}

// Hamle yapma fonksiyonu
function makeMove(fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    board[toRow][toCol] = { ...piece };
    board[fromRow][fromCol] = null;
    
    // Eğer son sıraya ulaştıysa kral yap
    if ((piece.type === 'white' && toRow === 0) || (piece.type === 'black' && toRow === 7)) {
        board[toRow][toCol].isKing = true;
    }
    
    // Eğer taş yeme hamlesiyse, yenilen taşı kaldır
    if (Math.abs(toRow - fromRow) === 2) {
        const eatenRow = (fromRow + toRow) / 2;
        const eatenCol = (fromCol + toCol) / 2;
        board[eatenRow][eatenCol] = null;
    }
    
    // Sırayı değiştir
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    
    // Tahtayı güncelle
    drawBoard();
    
    // Hamleyi diğer oyuncuya gönder
    if (window.socket) {
        window.socket.emit('makeMove', {
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol }
        });
    }
    
    // Oyun durumunu kontrol et
    checkGameStatus();
}

// Geçerli hamleleri bulma fonksiyonu
function getValidMoves(row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    
    const moves = [];
    const directions = [];
    
    // Normal taşlar için yönler
    if (piece.isKing || piece.type === 'white') {
        directions.push([-1, -1], [-1, 1]); // Beyaz taşlar yukarı gider
    }
    if (piece.isKing || piece.type === 'black') {
        directions.push([1, -1], [1, 1]); // Siyah taşlar aşağı gider
    }
    
    for (const [dr, dc] of directions) {
        const newRow = row + dr;
        const newCol = col + dc;
        
        if (isValidPosition(newRow, newCol)) {
            if (!board[newRow][newCol]) {
                // Boş hücreye hamle
                moves.push({ toRow: newRow, toCol: newCol });
            } else if (board[newRow][newCol].type !== piece.type) {
                // Rakip taşın üzerinden atlama
                const jumpRow = newRow + dr;
                const jumpCol = newCol + dc;
                
                if (isValidPosition(jumpRow, jumpCol) && !board[jumpRow][jumpCol]) {
                    moves.push({ toRow: jumpRow, toCol: jumpCol, isJump: true });
                }
            }
        }
    }
    
    return moves;
}

// Geçerli bir konum mu kontrolü
function isValidPosition(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

// Vurguları temizle
function clearHighlights() {
    document.querySelectorAll('.highlight').forEach(el => {
        el.classList.remove('highlight');
        el.style.cursor = '';
    });
}

// Oyun durumunu kontrol et
function checkGameStatus() {
    // Bu fonksiyonu ihtiyacınıza göre doldurabilirsiniz
    // Örneğin, kazananı belirlemek için kullanılabilir
}

// Tahtayı çiz
function drawBoard() {
    if (!gameBoardEl) return;
    
    gameBoardEl.innerHTML = '';
    gameBoardEl.className = 'checkers-board';
    
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cell = document.createElement('div');
            cell.className = `cell ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            // Taş varsa ekle
            const piece = board[row][col];
            if (piece) {
                const pieceEl = document.createElement('div');
                pieceEl.className = `piece ${piece.type} ${piece.isKing ? 'king' : ''}`;
                pieceEl.dataset.row = row;
                pieceEl.dataset.col = col;
                
                // Sadece kendi rengindeki taşlara tıklanabilir
                if (piece.type === myColor) {
                    pieceEl.classList.add('selectable');
                    pieceEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        handlePieceClick(row, col);
                    });
                }
                
                cell.appendChild(pieceEl);
            } else if ((row + col) % 2 !== 0) {
                // Boş kareye tıklanabilirlik ekle
                cell.addEventListener('click', handleCellClick);
            }
            
            gameBoardEl.appendChild(cell);
        }
    }
    
    updateStatus();
}

// Taş seçildiğinde
function handlePieceClick(e) {
    if (myColor !== currentTurn) return;
    
    const pieceEl = e.target.closest('.piece');
    if (!pieceEl) return;
    
    const row = parseInt(pieceEl.dataset.row);
    const col = parseInt(pieceEl.dataset.col);
    
    // Eğer zaten seçili taşa tıklandıysa seçimi kaldır
    if (selectedPiece && selectedPiece.row === row && selectedPiece.col === col) {
        selectedPiece = null;
        clearHighlights();
        return;
    }
    
    // Yeni taş seç
    selectedPiece = { row, col };
    highlightMoves(row, col);
}

// Geçerli hamleleri vurgula
function highlightMoves(row, col) {
    clearHighlights();
    
    // Basit bir şekilde bitişik çapraz kareleri vurgula
    // Gerçek bir dama oyunu için daha karmaşık kurallar gerekir
    const directions = [
        { dr: -1, dc: -1 }, // Sol üst
        { dr: -1, dc: 1 },  // Sağ üst
        { dr: 1, dc: -1 },  // Sol alt
        { dr: 1, dc: 1 }    // Sağ alt
    ];
    
    directions.forEach(({dr, dc}) => {
        const newRow = row + dr;
        const newCol = col + dc;
        
        if (isValidPosition(newRow, newCol) && !board[newRow][newCol]) {
            const cell = document.querySelector(`.cell[data-row="${newRow}"][data-col="${newCol}"]`);
            if (cell) {
                cell.classList.add('highlight');
            }
        }
    });
}

// Hücreye tıklandığında
function handleCellClick(e) {
    if (!selectedPiece || myColor !== currentTurn) return;
    
    const cell = e.target.closest('.cell');
    if (!cell) return;
    
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    
    // Hamleyi yap
    makeMove(selectedPiece.row, selectedPiece.col, row, col);
}

// Hamle yap
function makeMove(fromRow, fromCol, toRow, toCol) {
    // Basit bir hamle doğrulama
    if (!isValidMove(fromRow, fromCol, toRow, toCol)) {
        return false;
    }
    
    // Taşı hareket ettir
    board[toRow][toCol] = { ...board[fromRow][fromCol] };
    board[fromRow][fromCol] = null;
    
    // Eğer son sıraya ulaştıysa kral yap
    if ((myColor === 'white' && toRow === 0) || (myColor === 'black' && toRow === 7)) {
        board[toRow][toCol].isKing = true;
    }
    
    // Sırayı değiştir
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    
    // Tahtayı güncelle
    drawBoard();
    
    // Sunucuya hamleyi bildir
    if (socket) {
        socket.emit('makeMove', {
            room: currentRoomCode,
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol }
        });
    }
    
    return true;
}

// Geçerli bir pozisyon mu?
function isValidPosition(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
}

// Geçerli bir hamle mi?
function isValidMove(fromRow, fromCol, toRow, toCol) {
    // Basit bir hamle doğrulama
    const piece = board[fromRow][fromCol];
    if (!piece) return false;
    
    // Sıra sende mi?
    if ((piece.type === 'white' && currentTurn !== 'white') || 
        (piece.type === 'black' && currentTurn !== 'black')) {
        return false;
    }
    
    // Hedef boş mu?
    if (board[toRow][toCol]) return false;
    
    // Çapraz hareket mi?
    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);
    
    if (rowDiff !== colDiff) return false;
    
    // Normal taşlar sadece ileri gidebilir (kral değilse)
    if (!piece.isKing) {
        if (piece.type === 'white' && toRow > fromRow) return false;
        if (piece.type === 'black' && toRow < fromRow) return false;
    }
    
    // En fazla 2 kare gidebilir (atlayarak yeme durumu için)
    if (rowDiff > 2) return false;
    
    // 2 kare gidiyorsa aradaki taşı yemesi gerekir
    if (rowDiff === 2) {
        const midRow = (fromRow + toRow) / 2;
        const midCol = (fromCol + toCol) / 2;
        const midPiece = board[midRow][midCol];
        
        if (!midPiece || midPiece.type === piece.type) {
            return false;
        }
    }
    
    return true;
}

// Vurgulamaları temizle
function clearHighlights() {
    document.querySelectorAll('.highlight').forEach(el => {
        el.classList.remove('highlight');
    });
}

// Durum güncellemesi
function updateStatus() {
    if (!turnStatusEl) return;
    
    if (currentTurn === myColor) {
        turnStatusEl.textContent = 'Sıra sizde';
        turnStatusEl.className = 'status your-turn';
    } else {
        turnStatusEl.textContent = 'Rakibin sırası';
        turnStatusEl.className = 'status opponent-turn';
    }
}

// --- TEMEL UI FONKSİYONLARI ---

export function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        if (screen) screen.classList.remove('active');
    });
    if (screens[screenId]) {
        screens[screenId].classList.add('active');
    }
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    if (!globalMessage) return;
    
    const globalMessageText = document.getElementById('globalMessageText') || document.createElement('div');
    globalMessageText.textContent = message;
    globalMessage.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg text-white font-medium z-50 transition-all duration-300 ' + 
                             (isError ? 'bg-red-600' : 'bg-green-600');
    
    if (!globalMessageText.id) {
        globalMessageText.id = 'globalMessageText';
        globalMessage.appendChild(globalMessageText);
    }
    
    globalMessage.classList.remove('hidden');
    
    setTimeout(() => {
        globalMessage.classList.add('hidden');
    }, 3000);
}

// Yükleme mesajını göster/gizle fonksiyonları
function showLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        loadingMessage.style.display = 'flex';
        loadingMessage.style.visibility = 'visible';
    }
}

function hideLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
        loadingMessage.style.visibility = 'hidden';
    }
}

// Sayfa yüklendiğinde yükleme mesajını göster
document.addEventListener('DOMContentLoaded', () => {
    showLoadingMessage();
});

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!', { roomCode, isHost: host, opponent: opponentNameFromIndex });
    
    // Show loading message when setting up socket handlers
    console.log('📡 Yükleme mesajı gösteriliyor...');
    showLoadingMessage();
    
    socket = s;
    currentRoomCode = roomCode || '';
    isHost = host || false;
    opponentName = opponentNameFromIndex || 'Rakip';
    myColor = isHost ? 'white' : 'black';
    
    // Oyun tahtasını oluştur
    createBoard();
    
    // Socket bağlantı olayları
    socket.on('connect', () => {
        console.log('Sunucuya bağlandı');
        hideLoadingMessage();
        
        // Oda oluşturulduğunda
        socket.on('roomCreated', (data) => {
            currentRoomCode = data.room;
            const roomCodeDisplay = document.getElementById('roomCodeDisplay');
            if (roomCodeDisplay) {
                roomCodeDisplay.textContent = `Oda Kodu: ${currentRoomCode}`;
            }
            showScreen('wait');
        });

        // Oyuncu odaya katıldığında
        socket.on('playerJoined', (data) => {
            opponentName = data.username;
            const playerCount = document.getElementById('playerCount');
            if (playerCount) {
                playerCount.textContent = '2/2';
            }
            
            // Oyun başlıyor
            showGlobalMessage('Eşleşme tamamlandı! Oyun başlıyor...', false);
            showScreen('game');
            
            // Oyun tahtasını oluştur
            createBoard();
        });
        
        // Hamle yapıldığında
        socket.on('moveMade', (data) => {
            const { from, to } = data;
            const piece = board[from.row][from.col];
            if (!piece) return;
            
            // Taşı hareket ettir
            board[to.row][to.col] = { ...piece };
            board[from.row][from.col] = null;
            
            // Eğer son sıraya ulaştıysa kral yap
            if ((piece.type === 'white' && to.row === 0) || (piece.type === 'black' && to.row === 7)) {
                board[to.row][to.col].isKing = true;
            }
            
            // Sırayı değiştir
            currentTurn = currentTurn === 'white' ? 'black' : 'white';
            
            // Tahtayı güncelle
            drawBoard();
        });

        // Hata durumunda
        socket.on('error', (error) => {
            showGlobalMessage(error, true);
        });

        // Bağlantı koptuğunda
        socket.on('disconnect', () => {
            showGlobalMessage('Sunucu bağlantısı kesildi', true);
            showScreen('lobby');
        });
    });

    // Hata durumunda
    socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        showGlobalMessage('Sunucuya bağlanılamadı', true);
        hideLoadingMessage();
        // Ekstra güvenlik için 2 saniye sonra tekrar kontrol et
        setTimeout(() => {
            const loadingMessage = document.getElementById('loadingMessage');
            if (loadingMessage && !loadingMessage.classList.contains('hidden')) {
                console.log('🔄 Yükleme mesajı hala görünür, tekrar kaldırılıyor...');
                loadingMessage.classList.add('hidden');
                loadingMessage.style.display = 'none';
            }
        }, 2000);
        console.log('🚀 gameReady EVENT ALINDI!', gameState);
        
        // Oyun durumunu güncelle
        gameData.hostBombs = gameState.hostBombs || [];
        gameData.guestBombs = gameState.guestBombs || [];
        // Server'dan gelen can değerlerini kullan
        gameData.hostLives = gameState.hostLives || (level === 1 ? 3 : 4);
        gameData.guestLives = gameState.guestLives || (level === 1 ? 3 : 4);
        gameData.turn = gameState.turn || 0;
        
        // Skor bilgilerini güncelle
        if (gameState.scores) {
            gameData.scores = gameState.scores;
        }
        if (gameState.hostName) {
            gameData.hostName = gameState.hostName;
        }
        if (gameState.guestName) {
            gameData.guestName = gameState.guestName;
        }
        
        gameStage = 'PLAY';
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Level ${level} Başladı! ${gameData.hostLives} bomba ile oynanıyor.`, false);
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Digər Levelə Geçilir:', data);
        
        // Seviye bilgisini güncelle
        level = parseInt(data.level) || 1;
        
        // Oyun durumunu sıfırla ve yeni canları ayarla
        gameData = {
            board: [],
            turn: 0, // Host başlar
            hostLives: data.hostLives,
            guestLives: data.guestLives,
            cardsLeft: data.boardSize, // Server'dan gelen kart sayısını kullan
            hostBombs: [], 
            guestBombs: [],
            isGameOver: false
        };
        
        gameStage = 'PLAY';
        
        // Skor ve isim bilgilerini güncelle
        if (data.scores) {
            gameData.scores = data.scores;
        }
        if (data.hostName) {
            gameData.hostName = data.hostName;
        }
        if (data.guestName) {
            gameData.guestName = data.guestName;
        }
        
        // Yeni oyun tahtasını oluştur
        initializeGame(data.boardSize);
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        showGlobalMessage(`🎮 Seviye ${level} başladı! ${data.hostLives} can ile oynanıyor.`, false);
    });

    // gameData Olayı (Hamle Geldi - Kendi veya Rakip)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            // Server tarafından onaylanmış hamleyi uygula (emoji ve bomba bilgisi ile)
            applyMove(data.cardIndex, data.emoji, data.isBomb); 
        }
    });

    // Hata mesajları için dinleyici
    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rəqibiniz Oyundan Çıxdı. Lobiye gedilir.', true);
        resetGame();
    });
}

export function resetGame() {
    // Tüm oyun ayarlarını sıfırlar ve lobiye döner (En güvenli yol: Sayfayı yenilemek)
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz (index.html'in kullanması için)
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
