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
    
    // Seviyeye göre can ve bomba sayısını ayarla
    if (level === 1) {
        // Level 1'de bomba yok, can yok
        gameData.hostLives = 0;
        gameData.guestLives = 0;
    } else {
        // Level 2 ve sonrası 3 can, 3 bomba
        gameData.hostLives = 3;
        gameData.guestLives = 3;
    }
    
    gameStage = 'WAITING';
}

// --- OYUN DURUMU ---
let level = 1; 
// Kart sayıları: Level 1'de 16, sonraki tüm levellerde 20 kart
const LEVELS = [16, 20]; 
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; // Kendi seçtiğimiz bombaların indexleri

let gameData = {
    board: [], 
    turn: 0,   // 0 = Host, 1 = Guest
    hostLives: 0,  // Server'dan gelen değerlerle güncellenecek
    guestLives: 0, // Server'dan gelen değerlerle güncellenecek
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
    const boardSize = LEVELS[level - 1];
    
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
    
    // Oyun tahtasını güncelle
    drawBoard();
    
    setTimeout(() => {
        // Sırayı değiştir
        gameData.turn = gameData.turn === 0 ? 1 : 0;
        updateStatusDisplay();
        
        // Oyunun bitip bitmediğini kontrol et
        if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            const winner = (gameData.hostLives <= 0 && gameData.guestLives <= 0) ? 'DRAW' : 
                         (gameData.hostLives <= 0 ? 'Guest' : 'Host');
            endGame(winner);
        } else {
            // Tüm kartların açılıp açılmadığını kontrol et
            checkLevelCompletion();
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
    
    // 2 saniye bekle ve yeni seviyeye geç
    setTimeout(() => {
        const nextLevel = level + 1;
        const bombCount = nextLevel === 1 ? 3 : 4; // İlk seviyede 3, sonra 4 bomba
        
        console.log(`🔄 Yeni seviyeye geçiliyor: ${nextLevel}, ${bombCount} bomba ile`);
        
        // Oyun durumunu sıfırla
        gameData = {
            board: [],
            turn: 0, // Host başlar
            hostLives: bombCount,
            guestLives: bombCount,
            cardsLeft: 20, // Her zaman 20 kart
            hostBombs: [],
            guestBombs: [],
            isGameOver: false
        };
        
        // Seviyeyi güncelle
        level = nextLevel;
        gameStage = 'PLAY';
        
        // Yeni oyun tahtasını oluştur
        initializeGame(20);
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        // Sunucuya yeni seviyeyi bildir
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya nextLevel isteği gönderiliyor: Seviye ${nextLevel}`);
            socket.emit('nextLevel', { 
                roomCode: currentRoomCode,
                level: nextLevel
            });
            
            // Ayrıca levelComplete olayını da gönder
            socket.emit('levelComplete', {
                roomCode: currentRoomCode,
                level: level - 1,
                nextLevel: nextLevel
            });
        } else {
            console.error('❌ Sunucuya bağlı değil!');
        }
    }, 2000); // 2 saniye bekle
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
    
    // İlk seviye için board boyutunu ayarla (16 kart ile başla)
    const boardSize = 16; // İlk seviye 16 kart
    initializeGame(boardSize);
    
    // Can sayılarını server'dan gelen bilgiyle güncelle
    socket.once('gameReady', ({ hostBombs, guestBombs }) => {
        gameData.hostLives = hostBombs.length;
        gameData.guestLives = guestBombs.length;
        updateStatusDisplay();
    });
    
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
        gameData.hostLives = gameState.hostLives || (level === 1 ? 3 : 4);
        gameData.guestLives = gameState.guestLives || (level === 1 ? 3 : 4);
        gameData.turn = gameState.turn || 0;
        
        gameStage = 'PLAY';
        
        console.log('✅ Oyun durumu güncellendi:', {
            level: level,
            hostBombs: gameData.hostBombs,
            guestBombs: gameData.guestBombs,
            hostLives: gameData.hostLives,
            guestLives: gameData.guestLives,
            turn: gameData.turn
        });
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Seviye ${level} başlıyor! ${level === 1 ? '3' : '4'} bomba ile oynanıyor.`, false);
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Yeni seviye başlatılıyor:', data);
        
        // Seviye bilgisini güncelle (sayıya çevirerek)
        level = parseInt(data.level) || 1;
        
        // Bomba sayısını hesapla
        const bombCount = level === 1 ? 3 : 4;
        
        // Oyun durumunu sıfırla
        gameData = {
            board: [],
            turn: 0, // Host başlasın
            hostLives: bombCount,
            guestLives: bombCount,
            cardsLeft: 20, // Her zaman 20 kart
            hostBombs: [],
            guestBombs: [],
            isGameOver: false
        };
        
        gameStage = 'PLAY';
        
        // Yeni oyun tahtasını oluştur
        initializeGame(20); // Her zaman 20 kart
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        console.log(`✅ Yeni seviye başlatıldı: ${level}, ${bombCount} bomba ile`);
        console.log(`🔵 Host Can: ${gameData.hostLives}, 🔴 Guest Can: ${gameData.guestLives}`);
        
        showGlobalMessage(`🎮 Seviye ${level} başlıyor! ${bombCount} bomba ile oynanıyor.`, false);
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

    // Tüm kartlar açıldı mı kontrol et
    const checkLevelCompletion = () => {
        if (gameStage !== 'PLAY' || gameData.isGameOver) return;
        if (!gameData.board || gameData.board.length === 0) return;
        
        // Açılan kart sayısını kontrol et
        const openedCards = gameData.board.filter(card => card && card.opened).length;
        const totalCards = gameData.board.length;
        
        console.log(`🔍 Seviye tamamlama kontrolü: Açılan ${openedCards}/${totalCards} kart`);
        
        if (openedCards === totalCards) {
            const nextLevel = level + 1;
            const bombCount = nextLevel === 1 ? 3 : 4;
            
            console.log(`🎯 Tüm kartlar açıldı! Yeni seviye: ${nextLevel}, ${bombCount} bomba ile`);
            showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
            
            // Oyun durumunu güncelle
            gameStage = 'WAITING';
            gameData.isGameOver = true;
            
            // 1 saniye bekle ve yeni seviyeyi başlat
            setTimeout(() => {
                console.log(`🔄 Seviye ${nextLevel} başlatılıyor...`);
                
                // Oyun durumunu sıfırla
                gameData = {
                    board: [],
                    turn: 0, // Host başlasın
                    hostLives: bombCount,
                    guestLives: bombCount,
                    cardsLeft: 20, // Her zaman 20 kart
                    hostBombs: [],
                    guestBombs: [],
                    isGameOver: false
                };
                
                // Seviyeyi güncelle
                level = nextLevel;
                
                // Yeni oyun tahtasını oluştur
                initializeGame(20);
                
                // UI'ı güncelle
                updateStatusDisplay();
                
                // Sunucuya yeni seviyeyi bildir
                if (socket && socket.connected) {
                    console.log(`📤 Sunucuya nextLevel isteği gönderiliyor: Seviye ${nextLevel}`);
                    socket.emit('nextLevel', { 
                        roomCode: currentRoomCode,
                        level: nextLevel
                    });
                    
                    // Ayrıca levelComplete olayını da gönder
                    socket.emit('levelComplete', {
                        roomCode: currentRoomCode,
                        level: level - 1,
                        nextLevel: nextLevel
                    });
                } else {
                    console.error('❌ Sunucuya bağlı değil!');
                    gameStage = 'PLAY';
                    showGlobalMessage(`🎮 Seviye ${level} başlıyor! ${bombCount} bomba ile oynanıyor.`, false);
                }
            }, 1000);
        }
    };
    
    // Oyun başlangıcında ve her hamle sonrası kontrol et
    checkLevelCompletion();

    // Yeni seviye başlatma işlemi
    socket.on('newLevel', ({ level: newLevel, boardSize, hostLives, guestLives }) => {
        level = newLevel;
        gameData.hostLives = hostLives;
        gameData.guestLives = guestLives;
        
        showGlobalMessage(`🎮 Seviye ${level} başlıyor! ${hostLives} bomba ile oynanıyor.`, false);
        
        // Yeni oyun tahtasını başlat
        initializeGame(boardSize);
        updateStatusDisplay();
    });
    
    // Eski nextLevel olayını kaldırmak için
    socket.off('nextLevel');
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
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
