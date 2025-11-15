// Dosya Adı: game.js - DAMA OYUNU İÇİN GÜNCELLENMİŞ VERSİYON
import { UIElements, showScreen, showGlobalMessage } from './ui.js';

let socket;
let roomCode = null;
let isHost = false;
let myUsername = '';
let opponentUsername = '';
let gameState = {}; // board, turn, selectedPiece, validMoves vb.
let playerColor = 0; // 1: Kırmızı (Host), 2: Beyaz (Guest)

// --- Oyun Sabitleri ---
const BOARD_SIZE = 8;
const PIECE_NONE = 0;
const PIECE_RED = 1; // Host
const PIECE_WHITE = 2; // Guest
const PIECE_RED_KING = 3;
const PIECE_WHITE_KING = 4;

// --- Dama Mantığı Fonksiyonları (Basitleştirilmiş) ---

function getValidMoves(board, r, c, piece) {
    const moves = [];
    const player = piece % 2 === 1 ? PIECE_RED : PIECE_WHITE;
    const opponent = player === PIECE_RED ? PIECE_WHITE : PIECE_RED;
    const isKing = piece > 2;
    const direction = player === PIECE_RED ? -1 : 1; // Kırmızı yukarı, Beyaz aşağı

    const directions = isKing ? [-1, 1] : [direction];

    for (const dr of directions) {
        for (const dc of [-1, 1]) {
            const nextR = r + dr;
            const nextC = c + dc;
            
            // Normal Hamle
            if (nextR >= 0 && nextR < BOARD_SIZE && nextC >= 0 && nextC < BOARD_SIZE && board[nextR][nextC] === PIECE_NONE) {
                moves.push({ r: nextR, c: nextC, isCapture: false });
            }

            // Kapma (Capture) Hamlesi
            const captureR = r + 2 * dr;
            const captureC = c + 2 * dc;
            const capturedPieceR = r + dr;
            const capturedPieceC = c + dc;

            if (captureR >= 0 && captureR < BOARD_SIZE && captureC >= 0 && captureC < BOARD_SIZE &&
                board[captureR][captureC] === PIECE_NONE && 
                (board[capturedPieceR][capturedPieceC] === opponent || board[capturedPieceR][capturedPieceC] === opponent + 2)) {
                
                moves.push({ r: captureR, c: captureC, isCapture: true });
            }
        }
    }
    
    // Zorunlu Kapma Kontrolü (Sadece kapmalar varsa normal hamleleri kaldır)
    const captures = moves.filter(m => m.isCapture);
    if (captures.length > 0) {
        return captures;
    }

    return moves;
}

function handlePieceClick(r, c) {
    if (gameState.turn !== playerColor) {
        showGlobalMessage('Sıra rakibinizdədir!', true);
        return;
    }
    
    const piece = gameState.board[r][c];
    
    // Kendi taşım değilse
    if (piece !== playerColor && piece !== playerColor + 2) {
        if (gameState.selectedPiece) {
            // Hamle yap
            const { r: prevR, c: prevC } = gameState.selectedPiece;
            const prevPiece = gameState.board[prevR][prevC];
            const validMoves = getValidMoves(gameState.board, prevR, prevC, prevPiece);
            
            const move = validMoves.find(m => m.r === r && m.c === c);
            
            if (move) {
                // Sunucuya hamleyi gönder
                socket.emit('makeMove', {
                    roomCode: roomCode,
                    fromRow: prevR,
                    fromCol: prevC,
                    toRow: r,
                    toCol: c
                });
                
                // Seçimi temizle
                gameState.selectedPiece = null;
                UIElements.clearSelection();
                return;
            }
        }
        
        // Hamle yapma denemesi başarısız
        showGlobalMessage('Bu sizin daşınız deyil və ya etibarlı hamle deyil.', true);
        return;
    }

    // Seçimi temizle
    if (gameState.selectedPiece && gameState.selectedPiece.r === r && gameState.selectedPiece.c === c) {
        gameState.selectedPiece = null;
        UIElements.clearSelection();
        return;
    }
    
    // Yeni taşı seç
    const validMoves = getValidMoves(gameState.board, r, c, piece);
    
    if (validMoves.length > 0) {
        gameState.selectedPiece = { r, c };
        UIElements.highlightMoves(r, c, validMoves);
    } else {
        showGlobalMessage('Bu daşla etibarlı hamle yoxdur.', true);
        gameState.selectedPiece = null;
        UIElements.clearSelection();
    }
}


// --- Arayüz ve Socket Handler'lar ---

function setupSocketHandlers(s, rCode, host, opponentName) {
    socket = s;
    roomCode = rCode;
    isHost = host;
    opponentUsername = opponentName;
    playerColor = isHost ? PIECE_RED : PIECE_WHITE; // Kırmızı: 1 (Host), Beyaz: 2 (Guest)
    
    // Kullanıcı adını Telegram'dan alıyoruz
    myUsername = document.getElementById('usernameInput').value || window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || 'Player';
    
    // Oyun Ekranını Ayarla
    showScreen('game');
    
    // Dama tahtasını oluştur
    UIElements.initializeBoard(BOARD_SIZE, handlePieceClick);
    
    // --- Socket Olay Dinleyicileri ---
    
    socket.on('gameReady', (data) => {
        console.log('Oyun Başladı! gameReady verisi alındı:', data);
        gameState.board = data.board;
        gameState.turn = data.turn; // 1: Host, 2: Guest
        
        UIElements.updateBoard(gameState.board, isHost); // Tahtayı çiz
        UIElements.updateUI(gameState.turn, isHost, opponentUsername, myUsername); // Sıra ve isimleri güncelle
        
        showGlobalMessage('Oyun Başladı! İlk sıra ' + (data.turn === 1 ? UIElements.getHostName() : UIElements.getGuestName()) + ' oyunçusundadır.', false);
    });

    socket.on('moveMade', (data) => {
        console.log('Hamle Alındı:', data);
        gameState.board = data.board;
        gameState.turn = data.turn; // Yeni sıra
        
        UIElements.updateBoard(gameState.board, isHost);
        UIElements.updateUI(gameState.turn, isHost, opponentUsername, myUsername, data.scores);
        
        // Kazanan kontrolü
        if (data.winner) {
            showGlobalMessage(`🎉 Oyunu Qazanan: ${data.winner}!`, false, 5000);
            
            // Kazanan mesajını göster ve sıfırlama butonu ekle
            UIElements.showGameResult(data.winner);
        } else {
            showGlobalMessage('Rakib hamle etdi.', false, 1500);
        }
    });

    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message, true);
        UIElements.resetGame();
    });

    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
    
    // Emoji mesajı (index.html'den taşındı)
    socket.on('emojiMessage', (data) => {
        console.log('Emoji received:', data.emoji);
        UIElements.showEmoji(data.emoji, isHost);
    });
}

// Global scope'a açılanlar (index.html'deki import için)
export { setupSocketHandlers, showScreen, UIElements };
