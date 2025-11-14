// Dama Oyunu Sınıfı
class CheckersGame {
    constructor() {
        this.board = [];
        this.selectedPiece = null;
        this.currentPlayer = 1; // 1: Kırmızı (Player 1), 2: Mavi (Player 2)
        this.validMoves = [];
        this.gameOver = false;
        this.boardElement = document.getElementById('checkersBoard');
        this.turnElement = document.getElementById('checkersTurn');
        this.statusElement = document.getElementById('checkersStatus');
        this.moveHistory = [];
        
        this.init();
    }
    
    init() {
        this.createBoard();
        this.setupEventListeners();
        this.updateStatus();
    }
    
    createBoard() {
        this.board = [];
        this.boardElement.innerHTML = '';
        
        // 8x8 dama tahtası oluştur
        for (let row = 0; row < 8; row++) {
            this.board[row] = [];
            for (let col = 0; col < 8; col++) {
                // Boş kare oluştur
                const square = document.createElement('div');
                square.className = `checkers-square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                
                // Taşları yerleştir (sadece koyu karelere)
                if ((row + col) % 2 === 1) {
                    if (row < 3) {
                        // Üstteki oyuncunun taşları (Mavi)
                        this.board[row][col] = { player: 2, isKing: false };
                        this.createPiece(square, 2, false);
                    } else if (row > 4) {
                        // Alttaki oyuncunun taşları (Kırmızı)
                        this.board[row][col] = { player: 1, isKing: false };
                        this.createPiece(square, 1, false);
                    } else {
                        // Boş kare
                        this.board[row][col] = null;
                    }
                } else {
                    this.board[row][col] = null;
                }
                
                this.boardElement.appendChild(square);
            }
        }
    }
    
    createPiece(square, player, isKing) {
        const piece = document.createElement('div');
        piece.className = `checkers-piece player${player} ${isKing ? 'king' : ''}`;
        piece.innerHTML = isKing ? '♚' : '●';
        square.appendChild(piece);
    }
    
    setupEventListeners() {
        // Kare tıklamalarını dinle
        this.boardElement.addEventListener('click', (e) => {
            const square = e.target.closest('.checkers-square');
            if (!square || this.gameOver) return;
            
            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);
            
            this.handleSquareClick(row, col);
        });
        
        // Geri Al butonu
        document.getElementById('checkersUndoBtn')?.addEventListener('click', () => this.undoMove());
        
        // Yeniden Başlat butonu
        document.getElementById('checkersRestartBtn')?.addEventListener('click', () => this.restartGame());
        
        // Menüye Dön butonu
        document.getElementById('checkersBackBtn')?.addEventListener('click', () => {
            document.getElementById('checkersScreen')?.classList.remove('active');
            document.getElementById('gameSelectScreen')?.classList.add('active');
        });
    }
    
    handleSquareClick(row, col) {
        // Geçerli hamleleri temizle
        this.clearHighlights();
        
        const piece = this.board[row][col];
        
        // Eğer seçili bir taş yoksa ve tıklanan yerde oyuncunun taşı varsa seç
        if (!this.selectedPiece && piece && piece.player === this.currentPlayer) {
            this.selectPiece(row, col);
        }
        // Eğer zaten seçili bir taş varsa ve tıklanan yer geçerli bir hamle ise hamle yap
        else if (this.selectedPiece) {
            const move = this.validMoves.find(m => m.toRow === row && m.toCol === col);
            if (move) {
                this.makeMove(move);
            } else if (piece && piece.player === this.currentPlayer) {
                // Farklı bir taş seçildi
                this.selectPiece(row, col);
            }
        }
    }
    
    selectPiece(row, col) {
        this.selectedPiece = { row, col };
        this.validMoves = this.getValidMoves(row, col);
        
        // Seçili taşı vurgula
        const square = this.getSquareElement(row, col);
        square?.classList.add('selected');
        
        // Geçerli hamleleri göster
        this.highlightValidMoves();
    }
    
    getValidMoves(row, col) {
        const piece = this.board[row][col];
        if (!piece) return [];
        
        const moves = [];
        const directions = [];
        
        // Yönleri belirle (kale ise her yöne gidebilir)
        if (piece.isKing || piece.player === 1) {
            directions.push({ dr: -1, dc: -1 }); // Sol üst
            directions.push({ dr: -1, dc: 1 });  // Sağ üst
        }
        if (piece.isKing || piece.player === 2) {
            directions.push({ dr: 1, dc: -1 });  // Sol alt
            directions.push({ dr: 1, dc: 1 });   // Sağ alt
        }
        
        // Normal hamleleri kontrol et
        for (const dir of directions) {
            const newRow = row + dir.dr;
            const newCol = col + dir.dc;
            
            if (this.isValidPosition(newRow, newCol) && !this.board[newRow][newCol]) {
                moves.push({
                    fromRow: row,
                    fromCol: col,
                    toRow: newRow,
                    toCol: newCol,
                    isCapture: false
                });
            }
        }
        
        // Taş yeme hamlelerini kontrol et
        const captureMoves = this.getCaptureMoves(row, col, piece.player, true);
        
        // Eğer taş yeme zorunluluğu varsa sadece onları döndür
        if (this.hasCaptureMove(piece.player)) {
            return captureMoves.length > 0 ? captureMoves : [];
        }
        
        return moves;
    }
    
    getCaptureMoves(row, col, player, isInitial = false) {
        const moves = [];
        const piece = this.board[row][col];
        if (!piece) return moves;
        
        const directions = [
            { dr: -1, dc: -1 }, // Sol üst
            { dr: -1, dc: 1 },  // Sağ üst
            { dr: 1, dc: -1 },  // Sol alt
            { dr: 1, dc: 1 }    // Sağ alt
        ];
        
        for (const dir of directions) {
            const jumpRow = row + dir.dr;
            const jumpCol = col + dir.dc;
            const landRow = row + 2 * dir.dr;
            const landCol = col + 2 * dir.dc;
            
            // Atlanacak konumda rakip taş var mı ve inilecek yer boş mu?
            if (this.isValidPosition(jumpRow, jumpCol) && 
                this.isValidPosition(landRow, landCol) &&
                this.board[jumpRow][jumpCol] && 
                this.board[jumpRow][jumpCol].player !== player &&
                !this.board[landRow][landCol]) {
                
                // Taş yeme hamlesini ekle
                moves.push({
                    fromRow: row,
                    fromCol: col,
                    toRow: landRow,
                    toCol: landCol,
                    captureRow: jumpRow,
                    captureCol: jumpCol,
                    isCapture: true,
                    isKing: piece.isKing
                });
                
                // Çoklu taş yeme için rekürsif olarak devam et
                if (isInitial) {
                    const tempBoard = JSON.parse(JSON.stringify(this.board));
                    tempBoard[landRow][landCol] = { ...tempBoard[row][col] };
                    tempBoard[jumpRow][jumpCol] = null;
                    tempBoard[row][col] = null;
                    
                    const additionalMoves = this.getCaptureMoves(
                        landRow, landCol, player, false
                    );
                    
                    // Ek hamleleri birleştir
                    additionalMoves.forEach(move => {
                        moves.push({
                            ...move,
                            fromRow: row,
                            fromCol: col,
                            firstCaptureRow: jumpRow,
                            firstCaptureCol: jumpCol
                        });
                    });
                }
            }
        }
        
        return moves;
    }
    
    hasCaptureMove(player) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.player === player) {
                    const captureMoves = this.getCaptureMoves(row, col, player, true);
                    if (captureMoves.length > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    makeMove(move) {
        // Hamle yapmadan önce mevcut durumu kaydet
        const moveInfo = {
            board: JSON.parse(JSON.stringify(this.board)),
            currentPlayer: this.currentPlayer,
            selectedPiece: this.selectedPiece ? { ...this.selectedPiece } : null
        };
        
        const { fromRow, fromCol, toRow, toCol, captureRow, captureCol } = move;
        const piece = this.board[fromRow][fromCol];
        
        // Taşı hareket ettir
        this.board[toRow][toCol] = { ...piece };
        this.board[fromRow][fromCol] = null;
        
        // Eğer taş yeme hamlesiyse taşı kaldır
        if (move.isCapture && captureRow !== undefined && captureCol !== undefined) {
            this.board[captureRow][captureCol] = null;
            
            // Taş yendikten sonra başka taş yeme şansı var mı kontrol et
            const moreCaptures = this.getCaptureMoves(toRow, toCol, piece.player, true);
            if (moreCaptures.length > 0) {
                // Aynı oyuncu tekrar oynasın
                this.selectedPiece = { row: toRow, col: toCol };
                this.validMoves = moreCaptures;
                this.highlightValidMoves();
                
                // Hamle geçmişine ekle
                moveInfo.nextMoves = moreCaptures;
                this.moveHistory.push(moveInfo);
                
                this.updateStatus(`Taş yediniz! Başka taş yeme şansınız var.`);
                return;
            }
        }
        
        // Kale olma kontrolü
        if ((piece.player === 1 && toRow === 0) || (piece.player === 2 && toRow === 7)) {
            this.board[toRow][toCol].isKing = true;
            const pieceElement = this.getSquareElement(toRow, toCol)?.querySelector('.checkers-piece');
            if (pieceElement) {
                pieceElement.classList.add('king');
                pieceElement.innerHTML = '♚';
            }
        }
        
        // Sıra diğer oyuncuya geçsin
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.selectedPiece = null;
        this.validMoves = [];
        
        // Hamle geçmişine ekle
        this.moveHistory.push(moveInfo);
        
        // Oyun bitti mi kontrol et
        if (this.isGameOver()) {
            this.endGame();
            return;
        }
        
        this.updateStatus();
        this.updateBoardView();
    }
    
    isGameOver() {
        // Bir oyuncunun taşı kalmadıysa oyun biter
        let player1HasPieces = false;
        let player2HasPieces = false;
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece) {
                    if (piece.player === 1) player1HasPieces = true;
                    else player2HasPieces = true;
                }
            }
        }
        
        return !player1HasPieces || !player2HasPieces;
    }
    
    endGame() {
        this.gameOver = true;
        const winner = this.currentPlayer === 1 ? 2 : 1;
        this.updateStatus(`Oyun Bitti! ${winner === 1 ? 'Kırmızı' : 'Mavi'} oyuncu kazandı!`);
    }
    
    undoMove() {
        if (this.moveHistory.length === 0) return;
        
        const lastMove = this.moveHistory.pop();
        this.board = lastMove.board;
        this.currentPlayer = lastMove.currentPlayer;
        this.selectedPiece = lastMove.selectedPiece;
        
        // Tahtayı güncelle
        this.updateBoardView();
        
        // Eğer hamle devam ediyorsa, geçerli hamleleri güncelle
        if (this.selectedPiece) {
            this.validMoves = this.getValidMoves(this.selectedPiece.row, this.selectedPiece.col);
            this.highlightValidMoves();
        } else {
            this.clearHighlights();
        }
        
        this.updateStatus();
    }
    
    restartGame() {
        if (confirm('Oyunu sıfırlamak istediğinize emin misiniz?')) {
            this.board = [];
            this.selectedPiece = null;
            this.currentPlayer = 1;
            this.validMoves = [];
            this.gameOver = false;
            this.moveHistory = [];
            
            this.createBoard();
            this.updateStatus();
        }
    }
    
    updateBoardView() {
        // Tahtayı temizle
        this.boardElement.innerHTML = '';
        
        // Tahtayı yeniden oluştur
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `checkers-square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
                square.dataset.row = row;
                square.dataset.col = col;
                
                const piece = this.board[row][col];
                if (piece) {
                    this.createPiece(square, piece.player, piece.isKing);
                }
                
                this.boardElement.appendChild(square);
            }
        }
        
        // Seçili taşı ve geçerli hamleleri tekrar işaretle
        if (this.selectedPiece) {
            const { row, col } = this.selectedPiece;
            const square = this.getSquareElement(row, col);
            square?.classList.add('selected');
            this.highlightValidMoves();
        }
    }
    
    highlightValidMoves() {
        this.validMoves.forEach(move => {
            const square = this.getSquareElement(move.toRow, move.toCol);
            if (square) {
                const highlight = document.createElement('div');
                highlight.className = 'checkers-possible-move';
                square.appendChild(highlight);
            }
        });
    }
    
    clearHighlights() {
        document.querySelectorAll('.checkers-possible-move').forEach(el => el.remove());
        document.querySelectorAll('.checkers-square').forEach(sq => sq.classList.remove('selected'));
    }
    
    updateStatus(message) {
        if (!this.turnElement || !this.statusElement) return;
        
        if (message) {
            this.statusElement.textContent = message;
            return;
        }
        
        if (this.gameOver) return;
        
        const playerName = this.currentPlayer === 1 ? 'Kırmızı' : 'Mavi';
        this.turnElement.textContent = `Sıra: ${playerName} Oyuncu`;
        
        if (this.hasCaptureMove(this.currentPlayer)) {
            this.statusElement.textContent = 'Taş yeme zorunluluğu var!';
        } else {
            this.statusElement.textContent = 'Hamle yapmak için bir taş seçin';
        }
    }
    
    getSquareElement(row, col) {
        return document.querySelector(`.checkers-square[data-row="${row}"][data-col="${col}"]`);
    }
    
    isValidPosition(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }
}

// Sayfa yüklendiğinde oyun seçim ekranını ayarla
document.addEventListener('DOMContentLoaded', () => {
    // Oyun seçim kartlarına tıklama olaylarını ekle
    document.querySelectorAll('.game-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const gameType = card.dataset.game;
            const button = e.target.closest('button');
            
            // Eğer butona tıklandıysa veya doğrudan karta tıklandıysa
            if (button || !e.target.closest('.game-card-back')) {
                document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
                
                if (gameType === 'checkers') {
                    document.getElementById('checkersScreen')?.classList.add('active');
                    // Dama oyununu başlat
                    if (!window.checkersGame) {
                        window.checkersGame = new CheckersGame();
                    } else {
                        window.checkersGame.updateBoardView();
                    }
                } else {
                    document.getElementById('lobby')?.classList.add('active');
                }
            }
        });
    });
    
    // Menüye dön butonlarına tıklama olaylarını ekle
    document.querySelectorAll('.back-to-menu').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
            document.getElementById('gameSelectScreen')?.classList.add('active');
        });
    });
});
