// Dosya Adı: game.js - DAMA OYUNU İÇİN GÜNCELLENMİŞ VERSİYON
import { UIElements, showScreen } from './ui.js';

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
const PIECE_RED = 1; // Host (Kırmızı)
const PIECE_WHITE = 2; // Guest (Beyaz)
const PIECE_RED_KING = 3;
const PIECE_WHITE_KING = 4;

// --- Dama Mantığı Fonksiyonları ---

function getValidMoves(board, r, c, piece) {
    const moves = [];
    const player = piece % 2 === 1 ? PIECE_RED : PIECE_WHITE;
    const opponent = player === PIECE_RED ? PIECE_WHITE : PIECE_RED;
    const isKing = piece > 2;
    const direction = player === PIECE_RED ? -1 : 1; // Kırmızı yukarı, Beyaz aşağı

    const directions = isKing ? [-1, 1] : [direction];

    // Bu, istemci tarafındaki Dama mantığının basitleştirilmiş bir sürümüdür. 
    // Zorunlu kapma kuralları burada tam olarak uygulanmamıştır, sadece olası hamleleri işaretler.
    
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
    
    // Zorunlu Kapma Kontrolü (Client tarafında zorunlu kapma kontrolü)
    const allMoves = getAllPossibleMoves(board, player);
    const requiredCaptures = allMoves.filter(m => m.isCapture && m.from.r === r && m.from.c === c);

    const hasCaptureRequirement = allMoves.some(m => m.isCapture);

    if (hasCaptureRequirement) {
        // Eğer tahtada herhangi bir kapma zorunluluğu varsa
        if (requiredCaptures.length > 0) {
             return requiredCaptures;
        } else {
             // Kapma zorunluluğu var ama bu taşla yapılamıyorsa hamle yok demektir.
             return [];
        }
    }

    return moves;
}

function getAllPossibleMoves(board, player) {
    let allMoves = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (piece === player || piece === player + 2) {
                const pieceMoves = getValidMoves(board, r, c, piece);
                pieceMoves.forEach(m => allMoves.push({ from: { r, c }, ...m, isCapture: m.isCapture }));
            }
        }
    }
    return allMoves;
}

function handlePieceClick(r, c) {
    if (gameState.turn !== playerColor) {
        UIElements.showGlobalMessage('Sıra rakibinizdədir!', true);
        return;
    }
    
    const piece = gameState.board[r][c];
    
    // Hamle Yapma Denemesi
    if (gameState.selectedPiece) {
        const { r: prevR, c: prevC } = gameState.selectedPiece;
        const prevPiece = gameState.board[prevR][prevC];
        const validMoves = getValidMoves(gameState.board, prevR, prevC, prevPiece);
        
        const move = validMoves.find(m => m.r === r && m.c === c);
        
        if (move) {
            // Hamle geçerli, sunucuya gönder
            socket.emit('makeMove', {
                roomCode: roomCode,
                fromRow: prevR,
                fromCol: prevC,
                toRow: r,
                toCol: c
            });
            
            gameState.selectedPiece = null;
            UIElements.clearSelection();
            return;
        }
    }
    
    // Taş Seçme Denemesi (Kendi taşım olmalı)
    if (piece === playerColor || piece === playerColor + 2) {
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
            UIElements.showGlobalMessage('Bu daşla etibarlı hamle yoxdur.', true);
            gameState.selectedPiece = null;
            UIElements.clearSelection();
        }
        return;
    }
    
    // Ne hamle ne de taş seçimi ise
    if (!gameState.selectedPiece) {
        UIElements.showGlobalMessage('Əvvəlcə öz daşınızı seçin.', true);
    }
}


// --- Arayüz ve Socket Handler'lar ---

function setupSocketHandlers(s, rCode, host, opponentName) {
    socket = s;
    roomCode = rCode;
    isHost = host;
    opponentUsername = opponentName;
    playerColor = isHost ? PIECE_RED : PIECE_WHITE; // Kırmızı: 1 (Host), Beyaz: 2 (Guest)
    
    // Kullanıcı adını al
    myUsername = document.getElementById('usernameInput').value;
    
    // Oyun Ekranını Ayarla
    showScreen('gameScreen');
    
    // Dama tahtasını oluştur
    UIElements.initializeBoard(BOARD_SIZE, handlePieceClick);
    
    // --- Socket Olay Dinleyicileri ---
    
    socket.on('gameReady', (data) => {
        console.log('Oyun Başladı! gameReady verisi alındı:', data);
        gameState.board = data.board;
        gameState.turn = data.turn; // 1: Host, 2: Guest
        
        UIElements.updateBoard(gameState.board, isHost); // Tahtayı çiz
        UIElements.updateUI(gameState.turn, isHost, opponentUsername, myUsername, data.scores); // Sıra ve isimleri güncelle
        
        const turnName = data.turn === (isHost ? PIECE_RED : PIECE_WHITE) ? "Sizin" : opponentName + " oyunçunun";
        UIElements.showGlobalMessage(`Oyun Başladı! İlk sıra ${turnName} oyunçusundadır.`, false);
    });

    socket.on('moveMade', (data) => {
        console.log('Hamle Alındı:', data);
        gameState.board = data.board;
        gameState.turn = data.turn; // Yeni sıra
        
        UIElements.updateBoard(gameState.board, isHost);
        UIElements.updateUI(gameState.turn, isHost, opponentUsername, myUsername, data.scores);
        
        // Kazanan kontrolü
        if (data.winner) {
            UIElements.showGameResult(data.winner);
        } else {
            UIElements.showGlobalMessage('Rakib hamle etdi.', false, 1500);
        }
    });
}

// Global scope'a açılanlar (index.html'deki import için)
export { setupSocketHandlers, showScreen, UIElements };
