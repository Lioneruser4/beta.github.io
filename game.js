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

// Oyun başlatma / seviye hazırlama (SERVER MANTIQINA UYĞUNLAŞDIRILDI)
function initializeGame(boardSize) {
    // Tüm seviyelerde 20 kart kullanıldığı varsayıldı
    const actualBoardSize = 20; 
    
    gameData.board = Array.from({ length: actualBoardSize }, () => ({ opened: false, content: '' }));
    gameData.cardsLeft = actualBoardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Can sayıları server'dan gelen değerlerle güncellenmeli.
    // Başlangıçta minimum 3 can olarak ayarlanır (Level 1 varsayımı).
    gameData.hostLives = gameData.hostLives || 3;
    gameData.guestLives = gameData.guestLives || 3;
    
    gameStage = 'PLAY'; // Board hazırlandıktan sonra hemen PLAY aşamasına geçer
    drawBoard();
    updateStatusDisplay();
}

// --- OYUN DURUMU ---
let level = 1; 
// Kart sayıları: Server'a göre tüm levellerde 20 kart
const BOARD_SIZE = 20; 
let gameStage = 'WAITING'; // 'PLAY' veya 'ENDED'
let selectedBombs = []; // Host/Guest tarafından seçilen bombalar (artık kullanılmır, server idare edir)

let gameData = {
    board: [], 
    turn: 0,   // 0 = Host, 1 = Guest
    hostLives: 0,  
    guestLives: 0, 
    cardsLeft: 0,
    hostBombs: [], // Sadece client'ın bilmesi gereken kendi bomba pozisyonları
    guestBombs: [],
    isGameOver: false
};

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
    // Grid düzenini 4 sütun (5 sıra) olarak ayarla (20 kart için 4x5)
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
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
    
    // 💣 Emojisi canlar için bomba olarak kullanıldı
    myLivesEl.textContent = '💣'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '💣'.repeat(Math.max(0, opponentLives));

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING') {
        turnStatusEl.textContent = '⏳ RAKİP BEKLENİYOR / HAZIRLANIYOR...';
        actionMessageEl.textContent = "Bombalar otomatik yerleştiriliyor...";
        turnStatusEl.classList.remove('text-red-600', 'text-green-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SENDE!';
            actionMessageEl.textContent = "Bir kart aç! Rakibinizin bombalarından kaçınmaya çalışın.";
            turnStatusEl.classList.remove('text-red-600', 'text-yellow-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ RAKİBİN SIRASI';
            actionMessageEl.textContent = "Rakibinizin hamlesini bekleyin...";
            turnStatusEl.classList.remove('text-green-600', 'text-yellow-600');
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
    // Kalan kart sayısını 20'den (BOARD_SIZE) hesapla
    const cardsOpened = gameData.board.filter(card => card.opened).length;
    const cardsLeft = BOARD_SIZE - cardsOpened; 

    // Son 8 kart kaldığında titreşimi başlat
    if (cardsLeft <= 8 && gameStage === 'PLAY') { 
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
    const cardContainer = event.currentTarget; 
    const cardElement = cardContainer.querySelector('.card');
    
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
        console.log(`📤 Hamle gönderildi: Kart ${index}`);
    }
}

// SERVER'DAN GELEN HAMLEYİ UYGULA (Can azaltma SERVER'IN SORUMLULUĞUNDADIR)
async function applyMove(index, emoji, isBomb) {
    if (gameData.board[index].opened) return;

    await triggerWaitAndVibrate();

    gameData.board[index].opened = true;
    
    if (isBomb) {
        gameData.board[index].content = '💣';
        playSound(audioBomb);
        showGlobalMessage(`BOOM! Bombaya bastınız!`, true);
        
        // Can azalması Server'dan 'lifeUpdate' event'i ile gelmelidir.
        // Bu kısım sadece görsel feedback sağlar.
    } else {
        gameData.board[index].content = emoji; // Server'dan gelen emoji
        playSound(audioEmoji);
    }
    
    // Sırayı değiştir (Server'dan gelen bilgiye göre değişmeli, burada sadece tahmini)
    gameData.turn = gameData.turn === 0 ? 1 : 0;
    
    drawBoard(); 
    updateStatusDisplay();
    
    // Oyunun bitip bitmediğini kontrol et (Can güncellemeleri Server'dan gelince daha kesin)
    checkLevelCompletion();
    
    // Canların son durumunu kontrol et
    if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
         // Canlar sıfırlandığında oyunu bitir (Canlar Server'dan güncellenmiş olmalı)
        const winner = (gameData.hostLives <= 0 && gameData.guestLives <= 0) ? 'DRAW' : 
                     (gameData.hostLives <= 0 ? 'Guest' : 'Host');
        endGame(winner);
    }
}

// SERVER'DAN CAN GÜNCELLEMESİNİ ALIR
function handleLifeUpdate(hostLives, guestLives) {
    gameData.hostLives = hostLives;
    gameData.guestLives = guestLives;
    updateStatusDisplay();
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    
    const myRole = isHost ? 'Host' : 'Guest';
    const iWon = (winnerRole === myRole);
    const isDraw = (winnerRole === 'DRAW');
    
    // ... UI mesajları ...
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
    
    // Yeni seviyeye geçişi sadece bir oyuncu tetiklemelidir. (Genellikle host)
    if (isHost) {
        setTimeout(() => {
            const nextLevel = level + 1;
            console.log(`📤 Sunucuya levelComplete gönderiliyor (Host): Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', {
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        }, 2000); 
    }
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

    level = 1; 
    
    // Board'ı SERVER'daki 20 kart kuralına göre başlat
    initializeGame(BOARD_SIZE); 
    
    drawBoard();
    showScreen('game');
    showGlobalMessage(`🎮 Oyun ${opponentName} ile başladı! 🚀 Bombalar yerleştiriliyor...`, false);
    
    console.log('📡 Socket dinleyicileri kuruluyor...');
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Oyun Başlasın! (Bombalar otomatik seçildi)
    socket.on('gameReady', (gameState) => {
        console.log('🚀 gameReady EVENT ALINDI!', gameState);
        
        // Oyun durumunu güncelle
        gameData.hostBombs = gameState.hostBombs || [];
        gameData.guestBombs = gameState.guestBombs || [];
        gameData.hostLives = gameState.hostLives || 3; // İlk seviyede 3
        gameData.guestLives = gameState.guestLives || 3; // İlk seviyede 3
        gameData.turn = gameState.turn || 0;
        
        gameStage = 'PLAY';
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Seviye ${level} başlıyor! ${gameData.hostLives} bomba ile oynanıyor.`, false);
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
    });
    
    // Yeni seviye başlatma (SERVER'DAN GELİR)
    socket.on('newLevel', (data) => {
        console.log('🆕 Yeni seviye başlatılıyor:', data);
        
        level = parseInt(data.level) || 1;
        const bombCount = level === 1 ? 3 : 4;
        
        // Oyun durumunu sıfırla
        gameData = {
            board: [],
            turn: 0, 
            hostLives: data.hostLives || bombCount,
            guestLives: data.guestLives || bombCount,
            cardsLeft: BOARD_SIZE, 
            hostBombs: [], // Yeni bombalar gameReady ile gelecek
            guestBombs: [],
            isGameOver: false
        };
        
        gameStage = 'PLAY';
        
        // Yeni oyun tahtasını oluştur
        initializeGame(BOARD_SIZE); 
        
        // Can ve seviye UI'ı güncellenir
        updateStatusDisplay();
        
        showGlobalMessage(`🎮 Seviye ${level} başlıyor! ${bombCount} bomba ile oynanıyor.`, false);
    });
    
    // gameData Olayı (Hamle Geldi - Kendi veya Rakip)
    socket.on('gameData', (data) => {
        if (gameStage !== 'PLAY') return;
        
        if (data.type === 'MOVE') {
            // Server tarafından onaylanmış hamleyi uygula
            applyMove(data.cardIndex, data.emoji, data.isBomb); 
        }
    });
    
    // Hata mesajları için dinleyici
    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
    
    // *** KRİTİK EKLENTİ: CAN GÜNCELLEMESİ İÇİN DİNLEYİCİ ***
    // Server'dan canların son durumunu al. (Bu event'i server.js'e eklemelisiniz!)
    socket.on('lifeUpdate', ({ hostLives, guestLives }) => {
        handleLifeUpdate(hostLives, guestLives);
        
        // Canlar sıfırlandı mı kontrol et
        if (hostLives <= 0 || guestLives <= 0) {
            const winner = (hostLives <= 0 && guestLives <= 0) ? 'DRAW' : 
                         (hostLives <= 0 ? 'Guest' : 'Host');
            endGame(winner);
        }
    });

    // Tüm kartlar açıldı mı kontrol et
    const checkLevelCompletion = () => {
        if (gameStage !== 'PLAY' || gameData.isGameOver) return;
        
        // Açılan kart sayısını kontrol et
        const openedCards = gameData.board.filter(card => card && card.opened).length;
        
        // Tüm kartlar açıldıysa
        if (openedCards === BOARD_SIZE) {
            const nextLevel = level + 1;
            
            showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
            
            gameStage = 'ENDED';
            gameData.isGameOver = true;
            
            // Sadece Host, server'a levelComplete sinyalini gönderir.
            if (isHost) {
                 setTimeout(() => {
                    console.log(`📤 Sunucuya levelComplete gönderiliyor (Host): Seviye ${level} tamamlandı`);
                    socket.emit('levelComplete', { 
                        roomCode: currentRoomCode,
                        level: level,
                        nextLevel: nextLevel
                    });
                }, 1000);
            }
        }
    };
    
    // gameData ile gelen hamle sonrası level tamamlama kontrolü
    const originalApplyMove = applyMove;
    applyMove = async (index, emoji, isBomb) => {
        await originalApplyMove(index, emoji, isBomb);
        // Hamle uygulandıktan sonra seviye tamamlama kontrolü yapılır
        checkLevelCompletion();
    };

    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
}

export function resetGame() {
    window.location.reload(); 
}

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
