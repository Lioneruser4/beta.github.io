// Dosya Adı: ui.js - DAMA OYUNU İÇİN YENİ ARAYÜZ MANTIKLARI
let currentHostName = '';
let currentGuestName = '';
let selectedTile = null;

// Sabitler (game.js'den kopyalandı)
const BOARD_SIZE = 8;
const PIECE_NONE = 0;
const PIECE_RED = 1; 
const PIECE_WHITE = 2; 
const PIECE_RED_KING = 3;
const PIECE_WHITE_KING = 4;

const UIElements = {
    // --- Yardımcı Fonksiyonlar ---
    getHostName: () => currentHostName,
    getGuestName: () => currentGuestName,

    showGlobalMessage: (message, isError = false, duration = 3000) => {
        const messageBox = document.getElementById('globalMessage');
        if (!messageBox) return;

        messageBox.textContent = message;
        messageBox.className = 'show'; 
        messageBox.classList.add(isError ? 'bg-red-500' : 'bg-green-500');

        setTimeout(() => {
            messageBox.classList.remove('show');
            messageBox.classList.remove(isError ? 'bg-red-500' : 'bg-green-500');
        }, duration);
    },

    showScreen: (screenId) => {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
        
        const emojiChat = document.getElementById('emojiChat');
        if (emojiChat) {
            emojiChat.style.display = screenId === 'gameScreen' ? 'block' : 'none';
        }
    },
    
    // --- Dama Oyunu Arayüzü ---

    initializeBoard: (size, clickHandler) => {
        const boardContainer = document.getElementById('boardContainer');
        boardContainer.innerHTML = ''; 
        boardContainer.className = 'grid gap-0 w-full aspect-square max-w-lg mx-auto bg-gray-900 border-4 border-gray-700 shadow-2xl';
        boardContainer.style.gridTemplateColumns = `repeat(${size}, 1fr)`;

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const isLight = (r + c) % 2 === 0;
                const tile = document.createElement('div');
                tile.id = `tile-${r}-${c}`;
                tile.className = `w-full h-full flex items-center justify-center relative cursor-pointer transition-all duration-100 ease-in-out`;
                tile.style.backgroundColor = isLight ? '#cbd5e0' : '#4a5568'; // Açık / Koyu
                tile.dataset.r = r;
                tile.dataset.c = c;
                tile.onclick = () => clickHandler(r, c);
                boardContainer.appendChild(tile);
            }
        }
    },
    
    updateBoard: (board, isHost) => {
        const boardContainer = document.getElementById('boardContainer');
        // Tahtayı oyuncunun bakış açısına göre döndür
        boardContainer.style.transform = isHost ? 'rotate(0deg)' : 'rotate(180deg)';

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const tile = document.getElementById(`tile-${r}-${c}`);
                if (!tile) continue;
                
                tile.innerHTML = ''; // Taşı ve vurguyu temizle
                tile.classList.remove('selected', 'valid-move', 'has-piece');
                
                const pieceType = board[r][c];
                
                if (pieceType !== PIECE_NONE) {
                    const isKing = pieceType > 2;
                    const isRed = pieceType === PIECE_RED || pieceType === PIECE_RED_KING;
                    
                    const piece = document.createElement('div');
                    piece.className = `piece w-10/12 h-10/12 rounded-full flex items-center justify-center shadow-lg transition-transform duration-300 transform ${isRed ? 'bg-red-600 border-red-800' : 'bg-white border-gray-400'}`;
                    piece.style.borderWidth = '4px';
                    // Taşın dik durmasını sağla (Tahta döndüyse ters rotasyon uygula)
                    piece.style.transform = isHost ? 'rotate(0deg)' : 'rotate(-180deg)'; 

                    if (isKing) {
                        piece.classList.add('king-piece', 'text-yellow-300', 'text-xl');
                        piece.innerHTML = '<i class="fas fa-crown"></i>';
                    }
                    tile.appendChild(piece);
                    tile.classList.add('has-piece');
                }
            }
        }
    },

    highlightMoves: (r, c, moves) => {
        UIElements.clearSelection();
        
        const selectedTileElement = document.getElementById(`tile-${r}-${c}`);
        if (selectedTileElement) {
            selectedTileElement.classList.add('selected', 'ring-4', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-gray-900');
            selectedTile = selectedTileElement;
        }

        moves.forEach(move => {
            const moveTile = document.getElementById(`tile-${move.r}-${move.c}`);
            if (moveTile) {
                moveTile.classList.add('valid-move', 'ring-2', 'ring-green-400');
                // Vurgu noktası
                moveTile.innerHTML = '<div class="absolute w-3 h-3 rounded-full bg-green-500 opacity-75"></div>';
            }
        });
    },

    clearSelection: () => {
        if (selectedTile) {
            selectedTile.classList.remove('selected', 'ring-4', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-gray-900');
            selectedTile = null;
        }
        document.querySelectorAll('.valid-move').forEach(tile => {
            tile.classList.remove('valid-move', 'ring-2', 'ring-green-400');
            // Sadece vurgu noktasını temizle
            if (!tile.classList.contains('has-piece')) {
                tile.innerHTML = ''; 
            }
        });
    },
    
    updateUI: (turn, host, opponentName, myName, scores = { host: 0, guest: 0 }) => {
        currentHostName = host ? myName : opponentName;
        currentGuestName = host ? opponentName : myName;

        const turnText = document.getElementById('turnStatus');
        const hostScore = document.getElementById('hostScore');
        const guestScore = document.getElementById('guestScore');
        const hostNameEl = document.getElementById('hostName');
        const guestNameEl = document.getElementById('guestName');
        
        hostScore.textContent = `${scores.host}`;
        guestScore.textContent = `${scores.guest}`;
        hostNameEl.textContent = currentHostName + (host ? ' (Siz)' : '');
        guestNameEl.textContent = currentGuestName + (!host ? ' (Siz)' : '');

        const currentTurnName = turn === PIECE_RED ? currentHostName : currentGuestName;
        const currentColorClass = turn === PIECE_RED ? 'text-red-400' : 'text-blue-400';

        turnText.className = 'text-xl font-bold transition-colors duration-500 ' + currentColorClass;
        turnText.innerHTML = `Sıra: <span class="font-bold">${currentTurnName}</span>`;

        // Skor renklerini de güncelle
        document.getElementById('hostScore').classList.remove('text-red-400', 'text-blue-400');
        document.getElementById('guestScore').classList.remove('text-red-400', 'text-blue-400');
        document.getElementById('hostScore').classList.add('text-red-400');
        document.getElementById('guestScore').classList.add('text-blue-400');
    },

    showGameResult: (winnerName) => {
        const gameStatus = document.getElementById('gameStatus');
        gameStatus.innerHTML = `
            <div class="bg-yellow-800 text-white p-4 rounded-xl shadow-xl mt-4">
                <h2 class="text-2xl font-bold mb-2">Oyun Bitdi!</h2>
                <p class="text-xl">🎉 Qazanan: <span class="text-yellow-300">${winnerName}</span> 🎉</p>
                <button id="restartBtn" class="mt-4 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">
                    Yenidən Başla
                </button>
            </div>
        `;
        
        document.getElementById('restartBtn').addEventListener('click', () => {
             // window.socket ve window.roomCode index.html'den set edilmiştir
             if (window.socket && window.roomCode) {
                window.socket.emit('resetGame', { roomCode: window.roomCode });
                gameStatus.innerHTML = '<p id="turnStatus" class="text-xl font-bold text-yellow-400 transition-colors duration-500">Gözləyirik...</p>';
            }
        });
    },
    
    resetGame: () => {
        // Tamamen lobiye dön
        UIElements.showScreen('lobby');
        UIElements.clearSelection();
        const gameStatus = document.getElementById('gameStatus');
        if(gameStatus) gameStatus.innerHTML = '';
        if(window.socket) window.socket.disconnect();
    },

    showEmoji: (emoji, isMe) => {
        const boardContainer = document.getElementById('boardContainer');
        if (!boardContainer) return;
        
        const emojiDisplay = document.createElement('div');
        emojiDisplay.textContent = emoji;
        emojiDisplay.className = `fixed text-5xl z-50 animate-bounce transition-opacity duration-1000`;
        
        // Konum: Host ise altta, Guest ise üstte
        if (isMe) {
            emojiDisplay.style.bottom = '15%';
            emojiDisplay.style.left = '10%';
        } else {
            emojiDisplay.style.top = '15%';
            emojiDisplay.style.right = '10%';
        }

        document.body.appendChild(emojiDisplay);

        // Bir süre sonra kaybol
        setTimeout(() => {
            emojiDisplay.style.opacity = '0';
        }, 1500);

        setTimeout(() => {
            emojiDisplay.remove();
        }, 2000);
    }
};

window.showScreen = UIElements.showScreen;
window.UIElements = UIElements;

export { UIElements, showScreen };
