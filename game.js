// Dosya Adı: game.js (Memory/Bomb Oyunu Mantığı)

// main.js dosyasından gerekli global fonksiyonları içe aktar
import { showScreen, showGlobalMessage, t } from './main.js'; 

// --- Global Değişkenler ve Durum Yönetimi ---

let socket;
export let currentRoomCode = ''; 
export let isHost = false; 
export let opponentName = ''; 

// Oyun Durumu
let gameData = {
    turn: 0, // 0 = Host, 1 = Guest
    hostBombs: [],
    guestBombs: [],
    hostLives: 3,
    guestLives: 3,
    level: 1,
    opened: [],
    boardSize: 20
};

// Emojiler (server.js'teki ile aynı olmalıdır)
const EMOJIS = ['😀', '😎', '🦄', '🐱', '🍀', '🍕', '🌟', '⚽', '🎵', '🚀', '🎲', '🥇'];

// --- DOM Referansları (Memory Oyunu Özel) ---
const board = document.getElementById('gameBoard');
const turnStatusEl = document.getElementById('turnStatus');
const myLivesEl = document.getElementById('myLives');
const opponentLivesEl = document.getElementById('opponentLives');
const opponentNameEl = document.getElementById('opponentName');
const roleStatusEl = document.getElementById('roleStatus');


// --- Yardımcı Fonksiyonlar ---

function updateLivesDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;

    // Canları göstermek için emoji barı
    const myLivesText = t('lives', { lives: '❤️'.repeat(myLives) });
    const opponentLivesText = t('lives', { lives: '❤️'.repeat(opponentLives) });

    // Seviye bilgisini de ekle
    const levelText = t('level', { level: gameData.level });
    
    // Benim tarafım (Can + Seviye)
    myLivesEl.innerHTML = `
        ${myLivesText}
        <span class="text-sm font-light text-gray-400 block mt-1">${levelText}</span>
    `;
    
    // Rakip tarafı (Sadece Can)
    opponentLivesEl.textContent = opponentLivesText;
    
    roleStatusEl.textContent = isHost ? t('roleHost') : t('roleGuest');
    opponentNameEl.textContent = t('opponent', { name: opponentName });
}

function updateTurnStatus() {
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    
    turnStatusEl.textContent = isMyTurn ? t('yourTurn') : t('opponentTurn');
    turnStatusEl.classList.toggle('text-yellow-400', isMyTurn);
    turnStatusEl.classList.toggle('text-gray-400', !isMyTurn);
}

function checkLevelCompletion() {
    const totalCards = gameData.boardSize;
    const openedCount = gameData.opened.length;
    const bombCount = gameData.hostBombs.length; 
    
    const winnableCards = totalCards - (bombCount * 2);

    if (openedCount >= winnableCards) {
        
        if (gameData.hostLives > 0 && gameData.guestLives > 0) {
            // Seviye atlama
            showGlobalMessage(`🏆 Seviye ${gameData.level} Başarıyla Tamamlandı!`, false);
            
            if (isHost) {
                 socket.emit('levelComplete', { 
                    roomCode: currentRoomCode, 
                    level: gameData.level,
                    nextLevel: gameData.level + 1
                });
            }

        } else {
            // Oyun Sonu (Canlar bitmiş olmalı)
            endGame();
        }
    }
}

function endGame() {
    let messageKey;
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;

    if (myLives > opponentLives) {
        messageKey = 'youWon';
    } else if (myLives < opponentLives) {
        messageKey = 'youLost';
    } else {
        messageKey = 'draw';
    }

    showGlobalMessage(t('gameOver') + ' ' + t(messageKey), myLives <= opponentLives);
    
    setTimeout(() => {
        resetGame(); 
        showScreen('menu');
    }, 4000);
}

// --- Oyun Tahtası Mantığı ---

function createBoard(size) {
    board.innerHTML = '';
    board.style.gridTemplateColumns = `repeat(4, 1fr)`; 
    
    for (let i = 0; i < size; i++) {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'p-1 card-container';
        
        const card = document.createElement('div');
        // Kart boyutu ayarlaması için h-20 kaldırıldı, css ile ayarlanacak
        card.className = 'card aspect-square w-full h-auto'; 
        card.dataset.index = i;
        
        const frontFace = document.createElement('div');
        frontFace.className = 'card-face front';
        frontFace.textContent = '?'; 

        const backFace = document.createElement('div');
        backFace.className = 'card-face back';
        backFace.textContent = ''; 

        card.appendChild(frontFace);
        card.appendChild(backFace);
        cardContainer.appendChild(card);
        board.appendChild(cardContainer);

        card.addEventListener('click', handleCardClick);
    }
}

function handleCardClick(e) {
    const card = e.currentTarget;
    const idx = parseInt(card.dataset.index);
    
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    if (!isMyTurn) {
        showGlobalMessage(t('opponentTurn'), true);
        return;
    }
    if (card.classList.contains('flipped') || gameData.opened.includes(idx)) {
        showGlobalMessage('Bu kart zaten açıldı.', true);
        return;
    }
    
    // Hamleyi Server'a gönder
    socket.emit('gameData', {
        type: 'MOVE',
        cardIndex: idx,
        roomCode: currentRoomCode
    });
}

function processMove(index, emoji, isBomb) {
    const card = board.querySelector(`.card[data-index="${index}"]`);
    if (!card || card.classList.contains('flipped')) return;

    card.classList.add('flipped');
    const backFace = card.querySelector('.back');
    backFace.textContent = emoji;

    // Durumu güncelle
    gameData.opened.push(index);

    if (isBomb) {
        // Can Kaybı: Hamleyi yapanın rakibinin bombası açıldığı için, hamleyi yapan can kaybeder.
        // Hamleyi yapan oyuncu, sırası değişmeden önceki oyuncudur.
        const playerWhoMovedIsHost = gameData.turn === 0;
        
        if (playerWhoMovedIsHost) {
             gameData.hostLives = Math.max(0, gameData.hostLives - 1); // Host can kaybeder
        } else {
             gameData.guestLives = Math.max(0, gameData.guestLives - 1); // Guest can kaybeder
        }
        
        card.classList.add('vibrate'); 
        showGlobalMessage(t('bombExploded'), true);

        // Can sıfırlandıysa oyun biter
        if (gameData.hostLives === 0 || gameData.guestLives === 0) {
            endGame();
        }
        
    } else {
        card.classList.remove('vibrate');
    }
    
    // Sırayı değiştir
    gameData.turn = gameData.turn === 0 ? 1 : 0; 
    
    updateLivesDisplay();
    updateTurnStatus();
    checkLevelCompletion();
}

export function resetGame() {
    // Hafıza oyununun tüm lokal durumunu sıfırlar
    gameData = {
        turn: 0, 
        hostBombs: [],
        guestBombs: [],
        hostLives: 3,
        guestLives: 3,
        level: 1,
        opened: [],
        boardSize: 20
    };
    currentRoomCode = '';
    isHost = false;
    opponentName = '';
    board.innerHTML = '';
}

// --- Socket.IO İşleyicileri ---

export function setupMemorySocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    showScreen('game');
    
    // --- GENEL DURUM GÜNCELLEMESİ (gameReady) ---
    socket.off('gameReady'); // Birden fazla kez dinlenmemesi için
    socket.on('gameReady', (state) => {
        gameData.hostBombs = state.hostBombs;
        gameData.guestBombs = state.guestBombs;
        gameData.hostLives = state.hostLives;
        gameData.guestLives = state.guestLives;
        gameData.turn = state.turn;
        gameData.level = state.level;
        gameData.opened = []; 

        createBoard(gameData.boardSize);
        updateLivesDisplay();
        updateTurnStatus();
        document.getElementById('actionMessage').textContent = t('selectCards');
        showGlobalMessage(t('gameStarting'), false);
    });

    // --- HAREKET ALINDI (gameData: MOVE) ---
    socket.off('gameData');
    socket.on('gameData', (data) => {
        if (data.type === 'MOVE') {
            processMove(data.cardIndex, data.emoji, data.isBomb);
        }
    });

    // --- YENİ SEVİYE BİLGİSİ ---
    socket.off('newLevel');
    socket.on('newLevel', ({ level: newLevel, boardSize, hostLives, guestLives }) => {
        gameData.level = newLevel;
        gameData.hostLives = hostLives;
        gameData.guestLives = guestLives;
        gameData.boardSize = boardSize; 

        showGlobalMessage(t('levelStarting', { level: newLevel, lives: hostLives }), false);
        
        createBoard(boardSize);
        updateLivesDisplay();
    });
    
    // Rakip ayrılma ve genel hata işleyicisi main.js'te tanımlı.
}
