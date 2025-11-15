// Dosya Adı: ui.js - DAMA OYUNU İÇİN YENİ ARAYÜZ MANTIKLARI
let currentHostName = '';
let currentGuestName = '';
let selectedTile = null;

const UIElements = {
    // --- Yardımcı Fonksiyonlar ---
    getHostName: () => currentHostName,
    getGuestName: () => currentGuestName,

    showGlobalMessage: (message, isError = false, duration = 3000) => {
        const messageBox = document.getElementById('globalMessage');
        if (!messageBox) return;

        messageBox.textContent = message;
        messageBox.className = 'show'; // CSS animasyonunu başlat
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
        
        // Emoji Butonu Kontrolü
        const emojiChat = document.getElementById('emojiChat');
        if (emojiChat) {
            emojiChat.style.display = screenId === 'gameScreen' ? 'block' : 'none';
        }
    },
    
    // --- Dama Oyunu Arayüzü ---

    initializeBoard: (size, clickHandler) => {
        const boardContainer = document.getElementById('boardContainer');
        boardContainer.innerHTML = ''; // Tahtayı temizle
        boardContainer.className = 'grid gap-0 max-w-lg mx-auto bg-gray-900 border-4 border-gray-700 shadow-2xl';
        boardContainer.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        boardContainer.style.aspectRatio = '1 / 1';

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const isLight = (r + c) % 2 === 0;
                const tile = document.createElement('div');
                tile.id = `tile-${r}-${c}`;
                tile.className = `w-full h-full flex items-center justify-center relative cursor-pointer transition-all duration-100 ease-in-out`;
                tile.style.backgroundColor = isLight ? '#cbd5e0' : '#4a5568'; // Açık Gri / Koyu Mavi-Gri
                tile.dataset.r = r;
                tile.dataset.c = c;
                tile.onclick = () => clickHandler(r, c);
                boardContainer.appendChild(tile);
            }
        }
    },
    
    updateBoard: (board, isHost) => {
        // Tahtanın dönmesini sağla
        const boardContainer = document.getElementById('boardContainer');
        boardContainer.style.transform = isHost ? 'rotate(0deg)' : 'rotate(180deg)';

        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const tile = document.getElementById(`tile-${r}-${c}`);
                if (!tile) continue;
                
                // Önceki içeriği temizle (vurgulamalar hariç)
                tile.innerHTML = '';
                tile.classList.remove('selected', 'valid-move', 'king-tile');
                
                const pieceType = board[r][c];
                
                if (pieceType !== PIECE_NONE) {
                    const isKing = pieceType > 2;
                    const isRed = pieceType === PIECE_RED || pieceType === PIECE_RED_KING;
                    
                    const piece = document.createElement('div');
                    piece.className = `piece w-10/12 h-10/12 rounded-full flex items-center justify-center shadow-lg transition-transform duration-300 transform ${isRed ? 'bg-red-600 border-red-800' : 'bg-white border-gray-400'}`;
                    piece.style.borderWidth = '4px';
                    piece.style.transform = isHost ? 'rotate(0deg)' : 'rotate(-180deg)'; // Taşın dik durmasını sağla

                    if (isKing) {
                        piece.classList.add('king-piece', 'text-yellow-300', 'text-xl');
                        piece.innerHTML = '<i class="fas fa-crown"></i>';
                    }

                    tile.appendChild(piece);
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
                // Vurguyu göstermek için ufak bir daire
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
            if (tile.children.length === 1 && tile.children[0].classList.contains('absolute')) {
                tile.innerHTML = ''; // Sadece vurgu noktasını temizle
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
        const mySide = host ? 'Kırmızı (Siz)' : 'Beyaz (Siz)';
        const opponentSide = host ? 'Beyaz (Rakib)' : 'Kırmızı (Rakib)';
        
        // Skorları ve İsimleri Güncelle
        hostScore.textContent = `${scores.host}`;
        guestScore.textContent = `${scores.guest}`;
        hostNameEl.textContent = currentHostName;
        guestNameEl.textContent = currentGuestName;

        const currentTurnName = turn === 1 ? currentHostName : currentGuestName;
        const currentColor = turn === 1 ? 'red' : 'white';

        turnText.innerHTML = `Sıra: <span class="font-bold text-${currentColor}-400">${currentTurnName}</span>`;

        // Benim sıramda iken butonu aktif et
        const isMyTurn = (host && turn === 1) || (!host && turn === 2);
        
        // Sıra rengi
        turnText.classList.remove('text-red-400', 'text-white');
        turnText.classList.add(turn === 1 ? 'text-red-400' : 'text-white');
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
             if (window.socket && window.roomCode) {
                window.socket.emit('resetGame', { roomCode: window.roomCode });
                gameStatus.innerHTML = ''; // Sonuç kutusunu gizle
            }
        });
    },
    
    resetGame: () => {
        UIElements.showScreen('lobby');
        UIElements.clearSelection();
        const gameStatus = document.getElementById('gameStatus');
        if(gameStatus) gameStatus.innerHTML = '';
        if(window.socket) window.socket.disconnect();
    }
};

// Index.html dosyasının bu fonksiyonları kullanabilmesi için global'e açmak
window.showScreen = UIElements.showScreen;
window.UIElements = UIElements;

export { UIElements, showScreen };
