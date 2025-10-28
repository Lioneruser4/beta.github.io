// Dosya Adı: game.js
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';

// --- DOM Referansları ---
const screens = { 
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen') 
};
const gameBoardEl = document.getElementById('gameBoard');
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const myLivesEl = document.getElementById('myLives');
const opponentLivesEl = document.getElementById('opponentLives');
const opponentNameEl = document.getElementById('opponentName');
const roleStatusEl = document.getElementById('roleStatus');
// Yeni Başlat Butonu kaldırılıyor
const startButton = document.getElementById('startButton');

// SESLER (Aynı Kalır)
const audioBomb = new Audio('sound1.mp3'); 
const audioEmoji = new Audio('sound2.mp3'); 
const audioWait = new Audio('sound3.mp3'); 

function playSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {});
}

// --- OYUN DURUMU ---
let level = 1; 
const LEVELS = [12, 16, 20]; // 4x3, 4x4, 4x5 
let gameStage = 'PLAY'; // OYUN HER ZAMAN PLAY AŞAMASINDA BAŞLAR

let gameData = {
    board: [], 
    turn: 0, // 0 = Host, 1 = Guest
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

// Rastgele Bomb Seçimi Fonksiyonu
function generateRandomBombs(boardSize) {
    const indices = Array.from({ length: boardSize }, (_, i) => i);
    
    // Rastgele karıştır
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    // İlk 6 kartı Host ve Guest arasında paylaştır (Çakışma Önlenir)
    // NOTE: Eğer kart sayısı (12) 6'dan azsa, bu mantık hataya yol açabilir. 
    // Ancak 4x3 = 12 kart olduğu için sorun olmaz.
    const uniqueBombs = indices.slice(0, 6);
    
    const hostBombs = uniqueBombs.slice(0, 3);
    const guestBombs = uniqueBombs.slice(3, 6);

    return { hostBombs, guestBombs };
}

// --- OYUN MANTIĞI VE ÇİZİM ---

function initializeGame(initialBoardSize, newHostBombs = null, newGuestBombs = null) {
    const cardContents = [];
    for (let i = 0; i < initialBoardSize; i++) {
        cardContents.push(EMOTICONS[Math.floor(Math.random() * EMOTICONS.length)]);
    }
    
    gameData.board = Array(initialBoardSize).fill(null).map((_, index) => ({
        opened: false,
        content: cardContents[index], 
        isBomb: false
    }));
    
    gameData.cardsLeft = initialBoardSize;
    gameData.hostLives = 2;
    gameData.guestLives = 2;
    gameData.turn = 0;
    gameData.isGameOver = false;
    gameStage = 'PLAY'; 
    
    // Bomba Seçimini Ata (Eğer Host tarafından gönderildiyse)
    if (newHostBombs && newGuestBombs) {
        gameData.hostBombs = newHostBombs;
        gameData.guestBombs = newGuestBombs;
    } else {
        // Hata durumunda (normalde olmamalı) boş bırak
        gameData.hostBombs = []; 
        gameData.guestBombs = [];
    }

    if (startButton) startButton.classList.add('hidden'); // Başlat butonunu gizle
}

function drawBoard() {
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; 
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';

        const card = document.createElement('div');
        card.className = `card cursor-pointer`;
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face front'; 
        front.textContent = '?';
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        back.textContent = cardState.content; 

        card.appendChild(front);
        card.appendChild(back);
        cardContainer.appendChild(card);
        
        if (cardState.opened) {
            card.classList.add('flipped');
        } else {
            // Oyun direkt PLAY aşamasında başladığı için SELECTION kontrolü kaldırıldı
            cardContainer.addEventListener('click', handleCardClick);
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const myLives = isHost ? gameData.hostLives : gameData.guestLives;
    const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
    
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));
    
    myLivesEl.className = myLives === 1 ? 'text-orange-500' : 'text-green-600';
    opponentLivesEl.className = opponentLives === 1 ? 'text-orange-500' : 'text-green-600';

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    // SADECE PLAY AŞAMASI VAR
    if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = 'SIRA SENDE!';
            actionMessageEl.textContent = "Bir kart aç!";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = 'RAKİBİN SIRASI';
            actionMessageEl.textContent = "Rakibin hareketini bekle.";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver) {
        turnStatusEl.textContent = "OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuç bekleniyor...";
    }
}


// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    const cardElement = event.currentTarget.querySelector('.card');
    if (!cardElement || cardElement.classList.contains('flipped')) return; 
    
    const cardIndex = parseInt(cardElement.dataset.index);

    if (gameStage === 'PLAY') {
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (!isMyTurn || gameData.isGameOver) return; 
        
        sendMove(cardIndex);
    }
}

function sendMove(index) {
    if (socket && socket.connected) {
        // Sadece kartın index'ini gönder
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
        });
    }
}

async function applyMove(index, nextTurn) {
    const cardElement = gameBoardEl.querySelector(`.card[data-index='${index}']`);
    if (!cardElement || cardElement.classList.contains('flipped')) return;

    // Rakibin bombası olup olmadığını kontrol et
    const opponentBombs = isHost ? gameData.guestBombs : gameData.hostBombs;
    const hitBomb = opponentBombs.includes(index);
    
    // Animasyon (Aynı Kalır)
    await triggerWaitAndVibrate();

    cardElement.classList.add('flipped'); 
    
    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (hitBomb) {
        // Bomba Vuruşu
        if (gameData.turn === 0) {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        // Kart içeriğini "BOMBA" olarak güncelle ve ses çal
        cardElement.querySelector('.card-face.back').textContent = '💣';
        
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Rakip ${isHost ? 'Guest' : 'Host'} bombanıza bastı! Can: -1`, true);
    } else {
        // Normal Kart sesi
        playSound(audioEmoji);
    }
    
    await new Promise(resolve => setTimeout(resolve, 600)); 
    
    gameData.turn = nextTurn;
    updateStatusDisplay();
    
    // Oyun Bitti mi Kontrolü (Aynı Kalır)
    if (gameData.hostLives <= 0 || gameData.guestLives <= 0 || gameData.cardsLeft === 0) {
        let winner;
        if (gameData.hostLives <= 0 && gameData.guestLives <= 0) {
            winner = 'DRAW';
        } else if (gameData.hostLives <= 0) {
            winner = 'Guest';
        } else if (gameData.guestLives <= 0) {
            winner = 'Host';
        } else {
            winner = 'LEVEL_UP';
        }
        endGame(winner);
    }
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    // ... winnerDisplay mantığı (Aynı Kalır) ...
    let winnerDisplay = '';
    
    if (winnerRole === 'LEVEL_UP' || gameData.cardsLeft === 0) {
        winnerDisplay = "SEVİYE YÜKSELTİLİYOR";
    } else if (winnerRole === 'DRAW') {
        winnerDisplay = 'BERABERLİK';
    } else {
        winnerDisplay = winnerRole === (isHost ? 'Host' : 'Guest') ? 'SİZ KAZANDINIZ' : 'RAKİP KAZANDI';
    }

    turnStatusEl.textContent = `OYUN BİTTİ! SONUÇ: ${winnerDisplay}!`;
    actionMessageEl.textContent = `Devam etmek için bekleniyor...`;
    
    setTimeout(() => {
        if (level < LEVELS.length) {
            level++;
            showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Yeni Bombalar Rastgele Seçiliyor...`, false);
            
            // HOST yeni bombaları rastgele seçer ve sinyali gönderir.
            if (isHost) {
                const newBombs = generateRandomBombs(LEVELS[level - 1]);
                socket.emit('nextLevel', { 
                    roomCode: currentRoomCode, 
                    newLevel: level, 
                    hostBombs: newBombs.hostBombs,
                    guestBombs: newBombs.guestBombs
                });
            }
            
            // Host, yeni seviyeyi kendi belirlediği bombalarla başlatır. Guest, sunucudan gelen sinyali bekler.
            if (isHost) {
                 const newBombs = generateRandomBombs(LEVELS[level - 1]);
                 initializeGame(LEVELS[level - 1], newBombs.hostBombs, newBombs.guestBombs);
                 drawBoard();
                 updateStatusDisplay();
            }

        } else {
             showGlobalMessage("Oyun sona erdi (Maksimum seviyeye ulaşıldı).", false);
             resetGame();
        }
    }, 4000);
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
// Başlangıçta HOST, rastgele bomba seçer ve oyunu başlatır.
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "Rolünüz: HOST" : "Rolünüz: GUEST";

    level = 1; 
    
    // HOST, oyunu başlatmadan önce bombaları rastgele seçer ve rakibe gönderir.
    if (isHost) {
        const newBombs = generateRandomBombs(LEVELS[level - 1]);
        
        // Rakibe de oyunu başlatması için sinyal gönder
        socket.emit('startGameWithBombs', { 
            roomCode: currentRoomCode, 
            hostBombs: newBombs.hostBombs,
            guestBombs: newBombs.guestBombs,
            level: level
        });
        
        // Kendin için oyunu başlat
        initializeGame(LEVELS[level - 1], newBombs.hostBombs, newBombs.guestBombs);
        drawBoard();
        showScreen('game');
        showGlobalMessage(`Oyun ${opponentName} ile başladı! Host olarak ilk hamle sende.`, false);
        
    } else {
        // GUEST, oyunu HOST'un "startGameWithBombs" sinyali ile başlatır.
        showScreen('game'); 
        showGlobalMessage(`Oyun ${opponentName} ile başladı. Bombalar bekleniyor...`, false);
    }
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---
    
    // HOST'un gönderdiği bombalarla oyunu başlat
    socket.on('startGameWithBombs', ({ hostBombs, guestBombs, level: startLevel }) => {
        level = startLevel;
        initializeGame(LEVELS[level - 1], hostBombs, guestBombs);
        drawBoard();
        updateStatusDisplay();
        showGlobalMessage(`Oyun başladı! Bombalar rastgele seçildi. Rakibin sırası bekleniyor.`, false);
    });

    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            const nextTurn = gameData.turn === 0 ? 1 : 0; 
            applyMove(data.cardIndex, nextTurn); 
        }
    });

    socket.on('nextLevel', ({ newLevel, hostBombs, guestBombs }) => {
        level = newLevel;
        showGlobalMessage(`Yeni Seviye: ${LEVELS[level-1]} Kart! Yeni Bombalar Rastgele Seçildi...`, false);
        initializeGame(LEVELS[level - 1], hostBombs, guestBombs);
        drawBoard();
        updateStatusDisplay();
    });
    
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    window.location.reload(); 
}

// Gerekli diğer yardımcı fonksiyonlar (Aynı Kalır)
async function triggerWaitAndVibrate() { /* ... */ }
function startVibration() { /* ... */ }
function stopVibration() { /* ... */ }
export const UIElements = { /* ... */ };
