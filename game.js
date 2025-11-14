// Uçak Savaşı Oyunu
const GAME_SETTINGS = {
    PLAYER_SPEED: 10,
    BULLET_SPEED: 15,
    PLAYER_HEALTH: 100,
    BULLET_DAMAGE: 25,
    GAME_DURATION: 120000 // 2 dakika
};

const GAME_STATES = {
    WAITING: 'waiting',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing',
    FINISHED: 'finished'
};
class TelegramAuth {
    constructor() {
        this.isTelegramWebApp = typeof window.Telegram !== 'undefined' && 
                              typeof window.Telegram.WebApp !== 'undefined';
        this.user = null;
        this.tg = this.isTelegramWebApp ? window.Telegram.WebApp : null;
    }

    init() {
        // Check for existing session first
        const savedUser = localStorage.getItem('gameUser');
        if (savedUser) {
            this.user = JSON.parse(savedUser);
            return true;
        }

        // Try to initialize Telegram WebApp
        if (this.isTelegramWebApp) {
            try {
                this.tg.expand();
                
                const userData = this.tg.initDataUnsafe?.user;
                if (userData) {
                    this.user = {
                        id: userData.id,
                        username: userData.username || `user_${userData.id}`,
                        firstName: userData.first_name,
                        lastName: userData.last_name || '',
                        isTelegramUser: true
                    };
                    this.saveUser();
                    return true;
                }
            } catch (error) {
                console.error('Telegram auth error:', error);
            }
        }
        return false;
    }

    loginAsGuest() {
        const guestName = `Misafir_${Math.floor(1000 + Math.random() * 9000)}`;
        this.user = {
            id: `guest_${Date.now()}`,
            username: guestName,
            firstName: 'Misafir',
            lastName: '',
            isTelegramUser: false
        };
        this.saveUser();
        return this.user;
    }

    getUser() {
        if (this.user) return this.user;
        
        const savedUser = localStorage.getItem('gameUser');
        if (savedUser) {
            this.user = JSON.parse(savedUser);
            return this.user;
        }
        return this.loginAsGuest();
    }

    isAuthenticated() {
        return this.getUser() !== null;
    }

    getUsername() {
        const user = this.getUser();
        return user ? user.username : 'Guest';
    }

    saveUser() {
        if (this.user) {
            localStorage.setItem('gameUser', JSON.stringify(this.user));
        }
    }

    // Close the WebApp (only works in Telegram)
    closeApp() {
        if (this.tg && this.tg.close) {
            this.tg.close();
        }
    }

    // Show a simple alert in Telegram WebApp
    showAlert(message) {
        if (this.tg && this.tg.showAlert) {
            this.tg.showAlert(message);
        } else {
            alert(message);
        }
    }

    // Get the current theme (light/dark)
    getTheme() {
        if (this.tg && this.tg.colorScheme) {
            return this.tg.colorScheme;
        }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches 
            ? 'dark' 
            : 'light';
    }

    // Handle back button in Telegram
    setupBackButton(handler) {
        if (this.tg && this.tg.BackButton) {
            this.tg.BackButton.show();
            this.tg.BackButton.onClick(handler);
        }
    }

    logout() {
        this.user = null;
        localStorage.removeItem('gameUser');
        
        // If in Telegram, close the WebApp, otherwise reload
        if (this.tg && this.tg.close) {
            this.tg.close();
        } else {
            window.location.reload();
        }
    }
}

// Initialize Telegram auth
const telegramAuth = new TelegramAuth();

let socket;
let currentRoomCode = '';
let isHost = false;
let gameState = {
    status: GAME_STATES.WAITING,
    players: {},
    bullets: [],
    countdown: 3,
    startTime: null,
    endTime: null,
    winner: null
};

// Oyun öğeleri
const gameContainer = document.getElementById('gameContainer');
const gameCanvas = document.createElement('canvas');
const ctx = gameCanvas.getContext('2d');
gameContainer.appendChild(gameCanvas);

// Tuş durumları
const keys = {};
document.addEventListener('keydown', (e) => keys[e.code] = true);
document.addEventListener('keyup', (e) => keys[e.code] = false);

// Ekran boyutlarını ayarla
function resizeCanvas() {
    gameCanvas.width = window.innerWidth;
    gameCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Oyun döngüsü
function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

// Oyun güncellemeleri
function update() {
    const player = gameState.players[socket?.id];
    if (!player) return;

    // Oyuncu hareketi
    if (keys['ArrowLeft'] || keys['KeyA']) {
        player.x = Math.max(0, player.x - GAME_SETTINGS.PLAYER_SPEED);
    }
    if (keys['ArrowRight'] || keys['KeyD']) {
        player.x = Math.min(gameCanvas.width - 50, player.x + GAME_SETTINGS.PLAYER_SPEED);
    }

    // Sunucuya hareket bilgisini gönder
    if (socket) {
        socket.emit('playerMove', { x: player.x });
    }
}

// Oyun çizimleri
function render() {
    // Arkaplanı temizle
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

    // Oyuncuları çiz
    Object.values(gameState.players).forEach(player => {
        const isCurrentPlayer = player.id === socket?.id;
        
        // Uçak çiz
        ctx.save();
        ctx.translate(player.x, player.y);
        
        // Uçağın yönünü ayarla
        if (!isCurrentPlayer) ctx.rotate(Math.PI);
        
        // Uçak gövdesi
        ctx.fillStyle = isCurrentPlayer ? '#4cc9f0' : '#f72585';
        ctx.beginPath();
        ctx.moveTo(0, -20);
        ctx.lineTo(15, 15);
        ctx.lineTo(-15, 15);
        ctx.closePath();
        ctx.fill();
        
        // Kanatlar
        ctx.fillStyle = isCurrentPlayer ? '#4895ef' : '#b5179e';
        ctx.fillRect(-20, 0, 40, 10);
        
        ctx.restore();
        
        // İsim ve can göster
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.username, player.x, isCurrentPlayer ? player.y - 30 : player.y + 40);
        
        // Can çubuğu
        const healthPercent = player.health / GAME_SETTINGS.PLAYER_HEALTH;
        ctx.fillStyle = healthPercent > 0.6 ? '#4ade80' : healthPercent > 0.3 ? '#fbbf24' : '#ef4444';
        ctx.fillRect(player.x - 25, isCurrentPlayer ? player.y - 45 : player.y + 45, 50 * healthPercent, 5);
    });
    
    // Mermileri çiz
    gameState.bullets.forEach(bullet => {
        ctx.fillStyle = bullet.direction === 'up' ? '#4cc9f0' : '#f72585';
        ctx.fillRect(bullet.x - 2, bullet.y - 5, 4, 10);
    });
    
    // Oyun durumuna göre arayüz göster
    if (gameState.status === GAME_STATES.WAITING) {
        showMessage('Rakip bekleniyor...');
    } else if (gameState.status === GAME_STATES.COUNTDOWN) {
        showMessage(gameState.countdown > 0 ? gameState.countdown : 'BAŞLA!');
    } else if (gameState.status === GAME_STATES.FINISHED && gameState.winner) {
        showMessage(`KAZANAN: ${gameState.winner}`);
    }
    
    // Skor tablosu
    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    Object.values(gameState.players).forEach((player, index) => {
        ctx.fillText(`${player.username}: ${player.score}`, 10, 30 + (index * 25));
    });
    
    // Kalan süre
    if (gameState.endTime) {
        const timeLeft = Math.max(0, Math.ceil((gameState.endTime - Date.now()) / 1000));
        ctx.textAlign = 'right';
        ctx.fillText(`Süre: ${timeLeft}s`, gameCanvas.width - 10, 30);
    }
}

// Mesaj göster
function showMessage(text) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const textWidth = ctx.measureText(text).width;
    const padding = 20;
    const x = (gameCanvas.width - textWidth) / 2 - padding;
    const y = gameCanvas.height / 2 - 30;
    
    ctx.fillRect(x, y, textWidth + padding * 2, 60);
    ctx.fillStyle = '#fff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, gameCanvas.width / 2, gameCanvas.height / 2);
}

// Ateş et
function fireBullet() {
    const player = gameState.players[socket?.id];
    if (!player || gameState.status !== GAME_STATES.PLAYING) return;
    
    socket.emit('playerShoot', {
        x: player.x,
        y: player.y,
        direction: 'up' // Yukarı doğru ateş et
    });
}

// Oyun başlatma ekranını göster
function showLobby() {
    document.getElementById('lobby').style.display = 'flex';
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('roomScreen').style.display = 'none';
}

// Oda oluştur
function createRoom() {
    const username = document.getElementById('usernameInput').value || 'Oyuncu' + Math.floor(Math.random() * 1000);
    
    // Socket bağlantısı
    socket = io('http://localhost:3000');
    
    // Hata mesajlarını dinle
    socket.on('error', (data) => {
        alert(data.message);
    });
    
    // Oda oluşturulduğunda
    socket.on('roomCreated', (data) => {
        currentRoomCode = data.code;
        isHost = data.isHost;
        gameState = data.gameState;
        
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('roomScreen').style.display = 'flex';
        document.getElementById('roomCode').textContent = currentRoomCode;
        document.getElementById('waitingMessage').textContent = 'Rakip bekleniyor...';
    });
    
    // Rakip katıldığında
    socket.on('opponentJoined', (data) => {
        gameState = data.gameState;
        document.getElementById('waitingMessage').textContent = 'Rakip bağlandı! Oyun başlıyor...';
    });
    
    // Oyun başladığında
    socket.on('gameStart', (data) => {
        gameState = data.gameState;
        document.getElementById('roomScreen').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'block';
    });
    
    // Oyun güncellemelerini dinle
    socket.on('gameUpdate', (state) => {
        gameState = state;
    });
    
    // Yeni mermi eklendiğinde
    socket.on('bulletFired', (bullet) => {
        gameState.bullets.push(bullet);
    });
    
    // Oyun bitişi
    socket.on('gameOver', (winner) => {
        gameState.status = GAME_STATES.FINISHED;
        gameState.winner = winner;
    });
    
    // Oda oluştur
    socket.emit('createRoom', { username });
}

// Odaya katıl
function joinRoom() {
    const username = document.getElementById('usernameInput').value || 'Oyuncu' + Math.floor(Math.random() * 1000);
    const roomCode = document.getElementById('roomCodeInput').value.toUpperCase();
    
    if (!roomCode) {
        alert('Lütfen oda kodunu girin!');
        return;
    }
    
    // Socket bağlantısı
    socket = io('http://localhost:3000');
    
    // Hata mesajlarını dinle
    socket.on('error', (data) => {
        alert(data.message);
    });
    
    // Oyun başladığında
    socket.on('gameStart', (data) => {
        gameState = data.gameState;
        document.getElementById('roomScreen').style.display = 'none';
        document.getElementById('gameContainer').style.display = 'block';
    });
    
    // Oyun güncellemelerini dinle
    socket.on('gameUpdate', (state) => {
        gameState = state;
    });
    
    // Yeni mermi eklendiğinde
    socket.on('bulletFired', (bullet) => {
        gameState.bullets.push(bullet);
    });
    
    // Oyun bitişi
    socket.on('gameOver', (winner) => {
        gameState.status = GAME_STATES.FINISHED;
        gameState.winner = winner;
    });
    
    // Odaya katıl
    socket.emit('joinRoom', { code: roomCode, username });
}

// Ateş butonu
document.getElementById('fireButton')?.addEventListener('click', fireBullet);

// Oyun döngüsünü başlat
gameLoop();

// Buton eventleri
document.getElementById('createRoomBtn')?.addEventListener('click', createRoom);
document.getElementById('joinRoomBtn')?.addEventListener('click', joinRoom);
document.getElementById('backToLobbyBtn')?.addEventListener('click', showLobby);
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const myLivesEl = document.getElementById('myLives');
const opponentLivesEl = document.getElementById('opponentLives');
const opponentNameEl = document.getElementById('opponentName');
const roleStatusEl = document.getElementById('roleStatus');
const scoreDisplayEl = document.getElementById('scoreDisplay'); // Skor göstergesi

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
    
    // İlk seviyede 3 can 4 bomba, diğer seviyelerde 3 can 6 bomba
    gameData.hostLives = 3;
    gameData.guestLives = 3;
    gameData.hostBombs = [];
    gameData.guestBombs = [];
    
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
    turn: 0,  // 0 = Host, 1 = Guest
    hostLives: 0,  // Server'dan gelen değerlerle güncellenecek
    guestLives: 0, // Server'dan gelen değerlerle güncellenecek
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false
};

// Tüm cihazlarda güvenle çalışacak emojiler
const EMOTICONS = [
    '😀', // Gülümseyen yüz
    '😊', // Gözleri kapalı gülümseyen yüz
    '😎', // Güneş gözlüklü yüz
    '😍', // Kalp gözlü yüz
    '😜', // Dil çıkaran yüz
    '😇', // Halo melek yüzü
    '😴', // Uyuyan yüz
    '😷', // Maske takan yüz
    '🤖', // Robot
    '👻', // Hayalet
    '👽', // Uzaylı
    '🤡', // Palyaço
    '🔥',
    '🌊',
    '🌚',
    '😺',
    '🌼' 
];

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
    const boardSize = LEVELS[level - 1] || 20; // Default 20
    
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
        front.className = 'card-face front';
        const frontContent = document.createElement('span');
        frontContent.textContent = '?';
        front.appendChild(frontContent);
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        const backContent = document.createElement('span');
        backContent.textContent = cardState.content;
        backContent.style.fontSize = '2rem'; // Emoji boyutunu büyüt
        backContent.style.webkitTextStroke = '1px transparent'; // iOS için emoji görünürlüğünü artır
        back.appendChild(backContent);

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
    
    // Skor göstergesini güncelle
    if (gameData.scores) {
        const myScore = isHost ? gameData.scores.host : gameData.scores.guest;
        const opponentScore = isHost ? gameData.scores.guest : gameData.scores.host;
        
        // Eğer isim bilgileri varsa onları kullan, yoksa varsayılan değerleri kullan
        const myName = isHost ? 'Sen' : (gameData.opponentName || 'Rakip');
        const opponentName = isHost ? (gameData.opponentName || 'Rakip') : 'Sen';
        
        scoreDisplayEl.textContent = `${myName} ${myScore} - ${opponentScore} ${opponentName}`;
        scoreDisplayEl.style.display = 'block';
    }

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING' || gameStage === 'SELECTION') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIR...';
        actionMessageEl.textContent = "Bombalar otomatik yerleştiriliyor...";
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SƏNDƏ !';
            actionMessageEl.textContent = "Bir kart aç! Rakibinizin bombalarından kaçınmaya çalışın.";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ ONUN SIRASI';
            actionMessageEl.textContent = "RƏQİBİNİZİ GÖZLƏYİN...";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver && gameStage === 'ENDED') {
        turnStatusEl.textContent = "✅ OYUN BİTDİ!";
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
        
        cardElement.classList.add('flipped');
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
        showGlobalMessage(`❗ BOOM ! Bombanı Partladı ❗`, true);
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
        
        // Tüm bombalar patladı mı kontrol et
        const allBombsExploded = (gameData.hostLives <= 0 && gameData.guestLives <= 0);
        
        if (allBombsExploded) {
            // Tüm bombalar patladı, bir sonraki seviyeye geç
            const nextLevel = level + 1;
            showGlobalMessage(`🎉 Bütün bombalar partladı! Level ${nextLevel}'e geçilir...`, false);
            
            // Sunucuya seviye tamamlandı bilgisini gönder
            if (socket && socket.connected) {
                socket.emit('levelComplete', { 
                    roomCode: currentRoomCode,
                    level: level,
                    nextLevel: nextLevel
                });
            }
        } else if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
            // Normal oyun bitişi (bir oyuncu tüm canlarını kaybetti)
            const winner = gameData.hostLives <= 0 ? 'Guest' : 'Host';
            endGame(winner);
        } else {
            // Oyun devam ediyor, sıradaki oyuncu
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
        turnStatusEl.textContent = `🤝 BƏRABƏRLİK!`;
        actionMessageEl.textContent = `Her iki oyuncu da tüm canlarını kaybetti!`;
        showGlobalMessage('🤝 Beraberlik! Her ikiniz de harika oynadınız!', false);
    } else if (iWon) {
        turnStatusEl.textContent = `🎉 QAZANDIN!`;
        actionMessageEl.textContent = `Tebrikler! Rakibinizi yendiniz!`;
        showGlobalMessage('🎉 Tebrikler! Bu turu kazandınız!', false);
    } else {
        turnStatusEl.textContent = `😔 UDUZDUN!`;
        actionMessageEl.textContent = `Rakibiniz bu turu kazandı.`;
        showGlobalMessage('😔 Bu turu kaybettiniz. Bir sonrakinde daha dikkatli olun!', true);
    }
    
    // 2 saniye bekle ve sunucuya oyun bitti bilgisini gönder
    // Sunucu yeni seviyeyi başlatma işini yapacaktır.
    setTimeout(() => {
        const nextLevel = level + 1;
        
        console.log(`🔄 Oyun bitti, sunucudan yeni seviye bekleniyor: ${nextLevel}`);
        
        // Sunucuya levelComplete olayını gönder (Bu, yeni seviyenin başlamasına yol açar)
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor (endGame): Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', {
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        } else {
            console.error('❌ Sunucuya bağlı değil, yeni seviyeye geçilemiyor!');
        }
    }, 2000); // 2 saniye bekle
}

// --- SEVİYE TAMAMLAMA KONTROLÜ (GLOBAL ALAN) ---
// Bu fonksiyonu global alana taşıyarak, applyMove içerisinden erişilebilir kıldık.
function checkLevelCompletion() {
    if (gameStage !== 'PLAY' || gameData.isGameOver) return;
    if (!gameData.board || gameData.board.length === 0) return;
    
    // Açılan kart sayısını kontrol et
    const openedCards = gameData.board.filter(card => card && card.opened).length;
    const totalCards = gameData.board.length;
    
    console.log(`🔍 Seviye tamamlama kontrolü: Açılan ${openedCards}/${totalCards} kart`);
    
    if (openedCards === totalCards) {
        const nextLevel = level + 1;
        
        console.log(`🎯 Bütün Kartlar Açıldı ! Digər Level: ${nextLevel}`);
        showGlobalMessage(`🎉 Level ${level} tamamlandı! Yeni level yüklənir...`, false);
        
        // Oyun durumunu güncelle (geçiş anında hamle yapılmasın)
        gameStage = 'WAITING';
        gameData.isGameOver = true;
        
        // Sunucuya seviye tamamlandı bilgisini gönder
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor: Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', { 
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel
            });
        } else {
            console.error('❌ Sunucuya bağlı değil!');
        }
        
        // 1 saniye bekle, bu arada sunucudan 'newLevel' olayının gelmesini bekle.
        setTimeout(() => {
            console.log(`🔄 Sunucudan Seviye ${nextLevel} bilgisini bekle...`);
        }, 1000);
    }
}
// --- SON ---


// Yükleme mesajını göster/gizle fonksiyonları
function showLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        console.log('🔵 Yükleme mesajı gösteriliyor');
        loadingMessage.classList.remove('hidden');
        loadingMessage.classList.add('show');
        loadingMessage.style.display = 'flex';
    }
}

function hideLoadingMessage() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        console.log('🔴 Yükleme mesajı gizleniyor');
        loadingMessage.classList.remove('show');
        loadingMessage.classList.add('hidden');
        // 300ms sonra tamamen gizle (CSS geçişi için süre)
        setTimeout(() => {
            loadingMessage.style.display = 'none';
        }, 300);
    }
}

// Oyun seçim ekranını başlat
document.addEventListener('DOMContentLoaded', () => {
    const user = telegramAuth.getUser();
    const loginScreen = document.getElementById('telegramLoginScreen');
    
    // Oyun seçim kartlarına tıklama olaylarını ekle
    document.querySelectorAll('.game-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const gameType = card.dataset.game;
            const button = e.target.closest('button');
            
            // Eğer butona tıklandıysa veya doğrudan karta tıklandıysa
            if (button || !e.target.closest('.game-card-back')) {
                document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
                
                if (gameType === 'checkers') {
                    // Dama oyunu ekranını göster
                    document.getElementById('checkersScreen')?.classList.add('active');
                    // Dama oyununu başlat
                    if (!window.checkersGame) {
                        // checkers.js dosyasını dinamik olarak yükle
                        const script = document.createElement('script');
                        script.src = 'checkers.js';
                        document.head.appendChild(script);
                        
                        // Oyunun yüklenmesini bekle
                        script.onload = () => {
                            window.checkersGame = new CheckersGame();
                        };
                    } else {
                        window.checkersGame.updateBoardView();
                    }
                } else {
                    // Mevcut oyunu başlat
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
    const userProfile = document.getElementById('userProfile');
    const userDisplayName = document.getElementById('userDisplayName');

    // If user is already logged in, hide login screen
    if (user) {
        loginScreen.style.display = 'none';
        userProfile.style.display = 'flex';
        userDisplayName.textContent = user.firstName || user.username;
        showLoadingMessage();
    } else {
        // Show login screen
        loginScreen.style.display = 'flex';
        
        // Setup login button
        document.getElementById('telegramLoginBtn').addEventListener('click', () => {
            if (telegramAuth.init()) {
                window.location.reload();
            } else {
                alert('Telegram girişi başarısız. Lütfen tekrar deneyin.');
            }
        });
        
        // Setup guest login
        document.getElementById('guestLoginBtn').addEventListener('click', () => {
            telegramAuth.loginAsGuest();
            window.location.reload();
        });
    }
});

// Make logout function globally available
window.logout = function() {
    telegramAuth.logout();
};

// Kullanıcı bilgilerini güncelle
function updateUserInfo() {
    if (telegramAuth.isAuthenticated()) {
        currentUser = {
            id: telegramAuth.getUserId(),
            name: telegramAuth.getUsername(),
            isTelegramUser: true
        };
    } else {
        // Guest user
        const guestId = 'guest_' + Math.random().toString(36).substr(2, 9);
        currentUser = {
            id: guestId,
            name: document.getElementById('usernameInput')?.value || `Guest_${Math.floor(Math.random() * 1000)}`,
            isTelegramUser: false
        };
    }
    return currentUser;
}

// Kullanıcı adı doğrulama
function validateUsername(username) {
    if (!username || username.trim() === '') {
        showGlobalMessage('Lütfen geçerli bir kullanıcı adı girin.');
        return false;
    }
    if (username.length > 20) {
        showGlobalMessage('Kullanıcı adı çok uzun (maksimum 20 karakter)');
        return false;
    }
    return true;
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, isHostParam, username) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!', { roomCode, isHost: isHostParam, opponent: username });
    
    // Show loading message when setting up socket handlers
    console.log('📡 Yükleme mesajı gösteriliyor...');
    showLoadingMessage();
    
    socket = s;
    currentRoomCode = roomCode;
    isHost = isHostParam;
    
    // Kullanıcı bilgilerini güncelle
    const user = updateUserInfo();
    
    // Sunucuya kullanıcı bilgilerini gönder
    socket.emit('setUserInfo', {
        userId: user.id,
        username: user.name,
        isTelegramUser: user.isTelegramUser,
        roomCode: roomCode
    });
    
    // Rakip adını ayarla
    opponentName = username || (isHost ? 'Guest' : 'Host');
    opponentNameEl.textContent = opponentName;
    roleStatusEl.textContent = isHost ? "🎮 Rol: HOST (Sen başla)" : "🎮 Rol: GUEST (Rakip başlar)";

    // Oyun başlatılıyor
    level = 1; // Yeni oyuna başlarken seviyeyi 1'e sıfırla
    
    // İlk seviye için board boyutunu ayarla (16 kart ile başla)
    const boardSize = LEVELS[level - 1]; // İlk seviye 16 kart
    initializeGame(boardSize);
    
    // Can sayılarını server'dan gelen bilgiyle güncelle
    socket.once('gameReady', ({ hostBombs, guestBombs }) => {
        // Seviyeye göre can sayılarını ayarla
        if (level === 1) {
            gameData.hostLives = 3;
            gameData.guestLives = 3;
        } else {
            gameData.hostLives = 4;
            gameData.guestLives = 4;
        }
        updateStatusDisplay();
    });
    
    drawBoard();
    showScreen('game');
    showGlobalMessage(`🎮 Oyun ${opponentName} ile başladı! 🚀 Bombalar yerleştiriliyor...`, false);
    
    console.log('📡 Socket dinleyicileri kuruluyor...');
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Bağlantı durumunu dinle
    socket.on('connect', () => {
        console.log('✅ Sunucuya bağlandı');
        // Oyun hazır olduğunda gizlenecek
    });

    // Bağlantı hatası olduğunda
    socket.on('connect_error', (error) => {
        console.error('❌ Sunucu bağlantı hatası:', error);
        showGlobalMessage('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.', true);
        hideLoadingMessage();
    });

    // Oyun Başlasın! (Bombalar otomatik seçildi)
    socket.on('gameReady', (gameState) => {
        console.log('🎮 Oyun hazır, yükleme mesajı kaldırılıyor...');
        // Oyun hazır olduğunda yükleme mesajını gizle
        hideLoadingMessage();
        
        // Ekstra güvenlik için 2 saniye sonra tekrar kontrol et
        setTimeout(() => {
            const loadingMessage = document.getElementById('loadingMessage');
            if (loadingMessage && !loadingMessage.classList.contains('hidden')) {
                console.log('🔄 Yükleme mesajı hala görünür, tekrar kaldırılıyor...');
                loadingMessage.classList.add('hidden');
                loadingMessage.style.display = 'none';
            }
        }, 2000);
        console.log('🚀 gameReady EVENT ALINDI!', gameState);
        
        // Oyun durumunu güncelle
        gameData.hostBombs = gameState.hostBombs || [];
        gameData.guestBombs = gameState.guestBombs || [];
        // Server'dan gelen can değerlerini kullan
        gameData.hostLives = gameState.hostLives || (level === 1 ? 3 : 4);
        gameData.guestLives = gameState.guestLives || (level === 1 ? 3 : 4);
        gameData.turn = gameState.turn || 0;
        
        // Skor bilgilerini güncelle
        if (gameState.scores) {
            gameData.scores = gameState.scores;
        }
        if (gameState.hostName) {
            gameData.hostName = gameState.hostName;
        }
        if (gameState.guestName) {
            gameData.guestName = gameState.guestName;
        }
        
        gameStage = 'PLAY';
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Level ${level} Başladı! ${gameData.hostLives} bomba ile oynanıyor.`, false);
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Digər Levelə Geçilir:', data);
        
        // Seviye bilgisini güncelle
        level = parseInt(data.level) || 1;
        
        // Oyun durumunu sıfırla ve yeni canları ayarla
        gameData = {
            board: [],
            turn: 0, // Host başlar
            hostLives: data.hostLives,
            guestLives: data.guestLives,
            cardsLeft: data.boardSize, // Server'dan gelen kart sayısını kullan
            hostBombs: [], 
            guestBombs: [],
            isGameOver: false
        };
        
        gameStage = 'PLAY';
        
        // Skor ve isim bilgilerini güncelle
        if (data.scores) {
            gameData.scores = data.scores;
        }
        if (data.hostName) {
            gameData.hostName = data.hostName;
        }
        if (data.guestName) {
            gameData.guestName = data.guestName;
        }
        
        // Yeni oyun tahtasını oluştur
        initializeGame(data.boardSize);
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        showGlobalMessage(`🎮 Seviye ${level} başladı! ${data.hostLives} can ile oynanıyor.`, false);
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
    
    // Rakip Ayrıldı
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rəqibiniz Oyundan Çıxdı. Lobiye gedilir.', true);
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
    resetGame,
    // Oyun seçim ekranı butonları
    gameSelectScreen: document.getElementById('gameSelectScreen'),
    checkersScreen: document.getElementById('checkersScreen')
};
