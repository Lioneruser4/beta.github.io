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

// SESLER
const audioBomb = new Audio('sound1.mp3'); 
const audioEmoji = new Audio('sound2.mp3');
const audioWait = new Audio('sound3.mp3'); 

// Lag-free Sound Playback Function
function playSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {});
}

// Oyun başlatma / seviye hazırlama
function initializeGame(boardSize) {
    gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Her seviyede canları bombalara göre ayarla
    gameData.hostLives = BOMB_COUNT;
    gameData.guestLives = BOMB_COUNT;
    
    gameStage = 'WAITING';
}

// --- OYUN DURUMU ---
let level = 1; 
const MAX_CARDS = 20; // Maksimum kart sayısı
const BOMB_COUNT = 3; // Her oyuncu için sabit bomba sayısı
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; // Kendi seçtiğimiz bombaların indexleri

let gameData = {
    board: [], 
    turn: 0,   // 0 = Host, 1 = Guest
    hostLives: 2,
    guestLives: 2,
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

const EMOTICONS = ['🙂', '😂', '😍', '😎', '🤩', '👍', '🎉', '🌟', '🍕', '🐱'];

// --- TEMEL UI FONKSİYONLARI ---

export function showScreen(screenId) {
     Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    const globalMessageText = document.getElementById('globalMessageText');
    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.remove('hidden');
    globalMessage.classList.add('show');
    setTimeout(() => { globalMessage.classList.add('hidden'); globalMessage.classList.remove('show'); }, 4000);
}

// --- OYUN MANTIĞI VE ÇİZİM ---

function drawBoard() {
    const boardSize = gameData.board.length;
    
    // Grid düzenini sadece 4 sütun (4 aşağı inme) olarak ayarla
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; // 4 sütun (4x3, 4x4, 4x5 için)
    
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';

        const card = document.createElement('div');
        card.className = `card cursor-pointer`;
        card.dataset.index = index;

        const front = document.createElement('div');
        front.className = 'card-face front'; // Sizin stilinize göre front/back
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
            // SADECE SEÇEN KİŞİNİN GÖRMESİ İÇİN KIRMIZILIK
            if (gameStage === 'SELECTION' && selectedBombs.includes(index)) {
                card.classList.add('bomb-selected'); 
            }
            
            // KRİTİK DÜZELTME: TIKLAMA OLAYINI CARD-CONTAINER'A EKLE!
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

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIYOR...';
        actionMessageEl.textContent = "Bombalar otomatik yerleştiriliyor...";
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SENDE!';
            actionMessageEl.textContent = "Bir kart aç! Rakibinizin bombalarından kaçınmaya çalışın.";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ RAKİBİN SIRASI';
            actionMessageEl.textContent = "Rakibinizin hamlesini bekleyin...";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver) {
        turnStatusEl.textContent = "✅ OYUN BİTTİ!";
        actionMessageEl.textContent = "Sonuçlar hesaplanıyor...";
    }
}

// --- ANIMASYON VE SES ---

async function triggerWaitAndVibrate() {
     if (gameData.cardsLeft < 8 && gameStage === 'PLAY') { 
        startVibration();
        await new Promise(resolve => setTimeout(resolve, 2000));
        stopVibration();
    }
}
function startVibration() {
    const cardContainers = gameBoardEl.querySelectorAll('.card-container');
    cardContainers.forEach(container => {
        const card = container.querySelector('.card');
        if (card && !card.classList.contains('flipped')) {
            card.classList.add('vibrate');
        }
    });
    playSound(audioWait);
}

function stopVibration() {
    const cardContainers = gameBoardEl.querySelectorAll('.card-container');
    cardContainers.forEach(container => {
        const card = container.querySelector('.card');
        if (card) {
            card.classList.remove('vibrate');
        }
    });
    audioWait.pause();
    audioWait.currentTime = 0;
}


// --- HAREKET İŞLEYİCİLERİ ---

function handleCardClick(event) {
    // Tıklama olayını başlatan card-container'ı bul
    const cardContainer = event.currentTarget; 
    // İçindeki asıl .card elementini bul
    const cardElement = cardContainer.querySelector('.card');
    
    // Eğer card elementi zaten açılmışsa veya bulunamazsa dur.
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
        socket.emit('gameData', {
            roomCode: currentRoomCode,
            type: 'MOVE',
            cardIndex: index,
        });
    }
}

async function applyMove(index, emoji, isBomb) {
    if (gameData.board[index].opened) return;

    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    gameData.cardsLeft -= 1;
    
    if (isBomb) {
        gameData.board[index].content = '💣';
        // Hamle yapan oyuncu can kaybeder
        const currentPlayerIsHost = gameData.turn === 0;
        if (currentPlayerIsHost) {
            gameData.hostLives--;
        } else { 
            gameData.guestLives--;
        }
        
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Bombaya bastınız!`, true);
    } else {
        gameData.board[index].content = emoji; // Server'dan gelen emoji
        playSound(audioEmoji);
    }
    
    drawBoard(); 
    
    setTimeout(() => {
        // Sırayı değiştir
        gameData.turn = gameData.turn === 0 ? 1 : 0;
        updateStatusDisplay();
        
        // Oyun bitişini kontrol et
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = (gameData.hostLives <= 0 && gameData.guestLives <= 0) ? 'DRAW' : (gameData.hostLives <= 0 ? 'Guest' : 'Host');
            endGame(winner);
        }
        
    }, 1000);
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    
    const myRole = isHost ? 'Host' : 'Guest';
    const iWon = (winnerRole === myRole);
    const isDraw = (winnerRole === 'DRAW');
    
    if (isDraw) {
        turnStatusEl.textContent = `🤝 BERABERLİK!`;
        actionMessageEl.textContent = `Her iki oyuncu da tüm canlarını kaybetti!`;
        showGlobalMessage('🤝 Beraberlik! Her ikiniz de harika oynadınız!', false);
    } else if (iWon) {
        turnStatusEl.textContent = `🎉 KAZANDIN!`;
        actionMessageEl.textContent = `Tebrikler! Rakibinizi yendiniz!`;
        showGlobalMessage('🎉 Tebrikler! Bu turu kazandınız!', false);
    } else {
        turnStatusEl.textContent = `😔 KAYBETTİN`;
        actionMessageEl.textContent = `Rakibiniz bu turu kazandı.`;
        showGlobalMessage('😔 Bu turu kaybettiniz. Bir sonrakinde daha dikkatli olun!', true);
    }
    
    setTimeout(() => {
        if (level < 100) {
            level++;
            showGlobalMessage(`🎮 Seviye ${level} Başlıyor! (${gameData.board.length} Kart)`, false);
            
            // Sadece Host, yeni seviye sinyalini gönderir.
            if (isHost) {
                socket.emit('nextLevel', { roomCode: currentRoomCode, newLevel: level });
            }
            // Tüm oyuncular initializeGame'i çağırır (ya sinyalle ya da kendisi).
            // Seviyeye göre board boyutunu hesapla (12, 16, 20, 20, 20, ...)
            let boardSize = 12 + ((level - 1) * 4);
            boardSize = Math.min(boardSize, MAX_CARDS); // Maksimum 20 kart
            
            // Can sayılarını bombalara göre güncelle (her zaman 3 bomba)
            gameData.hostLives = BOMB_COUNT;
            gameData.guestLives = BOMB_COUNT;
            
            // Oyun tahtasını sıfırla ve çiz
            initializeGame(boardSize);
            drawBoard();
            updateStatusDisplay();
        } else {
             showGlobalMessage("🏆 Tüm seviyeler tamamlandı! Harika oyund!", false);
             setTimeout(() => resetGame(), 2000);
        }
    }, 4000);
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!', { roomCode, isHost: host, opponent: opponentNameFromIndex });
    
    socket = s;
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "🎮 Rol: HOST (Sen başla)" : "🎮 Rol: GUEST (Rakip başlar)";

    // Oyun başlatılıyor
    level = 1; // Yeni oyuna başlarken seviyeyi 1'e sıfırla
    
    // İlk seviye için board boyutunu ayarla (12 kart ile başla)
    const boardSize = 12;
    initializeGame(boardSize);
    showScreen('game');
    showGlobalMessage(`🎮 Oyun ${opponentName} ile başladı! 🚀 Bombalar yerleştiriliyor...`, false);
    
    console.log('📡 Socket dinleyicileri kuruluyor...');
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Oyun Başlasın! (Bombalar otomatik seçildi)
    socket.on('gameReady', ({ hostBombs, guestBombs }) => {
        // Oyun durumunu güncelle
        gameData.hostBombs = hostBombs || [];
        gameData.guestBombs = guestBombs || [];
        // Can sayılarını sabit bomba sayısına göre ayarla
        gameData.hostLives = BOMB_COUNT;
        gameData.guestLives = BOMB_COUNT;
        gameData.turn = 0; // Host başlar
        
        gameStage = 'PLAY';
        
        console.log('✅ Oyun durumu güncellendi:', {
            hostBombs: gameData.hostBombs,
            guestBombs: gameData.guestBombs,
            hostLives: gameData.hostLives,
            guestLives: gameData.guestLives,
            turn: gameData.turn
        });
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage('🚀 Oyun başlıyor! Kart açmayı başlatın!', false);
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
    });

    // Seviye Atlama Sinyali
    socket.on('nextLevel', ({ newLevel }) => {
        level = newLevel;
        
        // Seviyeye göre board boyutunu hesapla (12, 16, 20, 20, 20, ...)
        let boardSize = 12 + ((level - 1) * 4);
        boardSize = Math.min(boardSize, MAX_CARDS); // Maksimum 20 kart
        
        showGlobalMessage(`🎆 Seviye ${level} - ${boardSize} Kart! Bombalar yerleştiriliyor...`, false);
        
        // Can sayılarını bombalara göre güncelle (her zaman 3 bomba)
        gameData.hostLives = BOMB_COUNT;
        gameData.guestLives = BOMB_COUNT;
        
        // Oyun tahtasını sıfırla ve çiz
        initializeGame(boardSize);
        drawBoard();
        updateStatusDisplay();
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
