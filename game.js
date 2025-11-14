// Dosya Adı: game.js
// Socket bağlantısı artık SocketManager üzerinden yönetilecek
let socket;
let currentRoomCode = '';
let isHost = false;
let opponentName = '';

// Socket bağlantısını yönetmek için yardımcı fonksiyon
function getSocket() {
    if (window.socketManager && window.socketManager.socket) {
        return window.socketManager.socket;
    }
    console.error('Socket bağlantısı bulunamadı!');
    return null;
}

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

// Bomba oyunu başlatma
function initializeBombGame() {
    // Mevcut oyun mantığını buraya taşıyacağız
    const boardSize = 16; // Varsayılan tahta boyutu
    
    // Oyun tahtasını oluştur
    gameData.board = Array.from({ length: boardSize }, () => ({
        opened: false,
        content: '',
        hasBomb: false,
        flagged: false
    }));
    
    // Oyun durumunu sıfırla
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Can ve bomba ayarları
    if (level === 1) {
        gameData.hostLives = 3;
        gameData.guestLives = 3;
        gameData.hostBombs = [];
        gameData.guestBombs = [];
        
        // Rastgele bombalı kartları seç
        const totalCards = boardSize;
        const allIndices = Array.from({length: totalCards}, (_, i) => i);
        
        // Karıştır
        for (let i = allIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
        }
        
        // İlk bombaları ata (3 tane)
        gameData.hostBombs = allIndices.slice(0, 3);
        gameData.guestBombs = allIndices.slice(3, 6);
        
        // Bombaları işaretle
        gameData.hostBombs.forEach(index => gameData.board[index].hasBomb = true);
        gameData.guestBombs.forEach(index => gameData.board[index].hasBomb = true);
    }
    
    // Skor tablosunu güncelle
    updateScoreDisplay();
    
    // Oyun tahtasını çiz
    drawBoard();
}

// Dama oyunu başlatma
function initializeCheckersGame() {
    // Dama tahtasını oluştur
    const boardSize = 8;
    gameData.board = [];
    gameData.turn = 0; // Siyah taşlar başlar
    gameData.isGameOver = false;
    gameData.selectedPiece = null;
    gameData.validMoves = [];
    
    // Dama tahtasını oluştur
    for (let row = 0; row < boardSize; row++) {
        gameData.board[row] = [];
        for (let col = 0; col < boardSize; col++) {
            // Sadece siyah karelere taş yerleştir
            if ((row + col) % 2 === 1) {
                if (row < 3) {
                    // Üstteki 3 sıra rakibin taşları (beyaz)
                    gameData.board[row][col] = { type: 'man', player: 1, row, col };
                } else if (row > 4) {
                    // Alttaki 3 sıra bizim taşlarımız (siyah)
                    gameData.board[row][col] = { type: 'man', player: 0, row, col };
                } else {
                    // Boş kare
                    gameData.board[row][col] = { type: 'empty', player: null, row, col };
                }
            } else {
                // Beyaz kareler boş olacak
                gameData.board[row][col] = { type: 'empty', player: null, row, col };
            }
        }
    }
    
    // Dama tahtasını çiz
    drawCheckersBoard();
}

// Oyun başlatma / seviye hazırlama
function initializeGame(boardSize) {
    gameData.board = Array.from({ length: boardSize }, () => ({ opened: false, content: '' }));
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    
    // Can ve bomba ayarları
    if (level === 1) {
        // İlk seviyede 3 can 3 bomba
        gameData.hostLives = gameData.hostLives || 3;  // Eğer can varsa koru, yoksa 3 yap
        gameData.guestLives = gameData.guestLives || 3;
        const bombCount = 3;
        
        // Bombaları sıfırla ve yeni bombalar ata
        gameData.hostBombs = [];
        gameData.guestBombs = [];
        
        // Rastgele bombalı kartları seç
        const totalCards = boardSize;
        const allIndices = Array.from({length: totalCards}, (_, i) => i);
        
        // Karıştır
        for (let i = allIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
        }
        
        // İlk bombaları ata (3 tane)
        gameData.hostBombs = allIndices.slice(0, bombCount);
        gameData.guestBombs = allIndices.slice(bombCount, bombCount * 2);
        
    } else if (level === 2) {
        // İkinci seviyede 4 can 5 bomba (eğer can 0 değilse bir önceki canları koru)
        gameData.hostLives = gameData.hostLives > 0 ? Math.min(gameData.hostLives + 1, 4) : 4;
        gameData.guestLives = gameData.guestLives > 0 ? Math.min(gameData.guestLives + 1, 4) : 4;
        
        // Yeni bombalar ata (5 tane)
        const bombCount = 5;
        const totalCards = boardSize;
        const allIndices = Array.from({length: totalCards}, (_, i) => i);
        
        // Karıştır
        for (let i = allIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
        }
        
        // Yeni bombaları ata (5 tane)
        gameData.hostBombs = allIndices.slice(0, bombCount);
        gameData.guestBombs = allIndices.slice(bombCount, bombCount * 2);
    }
    
    // Skor tablosunu güncelle
    updateScoreDisplay();
    
    // Oyun durumunu güncelle
    gameStage = 'WAITING';
    
    // Oyun tahtasını çiz
    drawBoard();
    
    // Oyun bilgilerini konsola yazdır (hata ayıklama için)
    console.log(`Level ${level} başladı. Canlar: Host=${gameData.hostLives}, Guest=${gameData.guestLives}`);
    console.log('Host Bombaları:', gameData.hostBombs);
    console.log('Guest Bombaları:', gameData.guestBombs);
}

// --- OYUN DURUMU ---
let level = 1; 
// Kart sayıları: Level 1'de 16, sonraki tüm levellerde 20 kart
const LEVELS = [16, 20]; 
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'
let selectedBombs = []; // Kendi seçtiğimiz bombaların indexleri

// Skor takibi için global değişkenler
let scores = {
    host: 0,
    guest: 0
};

let gameData = {
    board: [], 
    turn: 0,  // 0 = Host, 1 = Guest
    hostLives: 0,  // Server'dan gelen değerlerle güncellenecek
    guestLives: 0, // Server'dan gelen değerlerle güncellenecek
    cardsLeft: 0,
    hostBombs: [], 
    guestBombs: [],
    isGameOver: false,
    scores: { host: 0, guest: 0 } // Oyun skorları
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
    
    // Eğer message bir dize ise doğrudan kullan, değilse çeviri fonksiyonunu kullan
    const displayMessage = typeof message === 'string' ? message : 
        (window.languageManager ? window.languageManager.t(message) : message);
    
    globalMessageText.textContent = displayMessage;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.remove('hidden');
    globalMessage.classList.add('show');
    setTimeout(() => { globalMessage.classList.add('hidden'); globalMessage.classList.remove('show'); }, 4000);
}

// Skor tablosunu güncelle
function updateScoreDisplay() {
    const scoreDisplay = document.getElementById('scoreDisplay');
    const playerName = document.getElementById('telegramUsername')?.textContent || 'SEN';
    const opponentName = document.getElementById('opponentName')?.textContent || 'RAKİP';
    
    if (scoreDisplay) {
        // Can durumunu göster
        const playerLives = isHost ? gameData.hostLives : gameData.guestLives;
        const opponentLives = isHost ? gameData.guestLives : gameData.hostLives;
        
        // Seviye bilgisini hazırla
        const levelText = window.languageManager ? 
            `${window.languageManager.t('level')} ${level}` : 
            `Səviyyə ${level} / Level ${level}`;
        
        scoreDisplay.innerHTML = `
            <div class="w-full flex flex-col items-center mb-2">
                <div class="text-lg font-bold text-yellow-300 mb-1">${levelText}</div>
                <div class="flex justify-center items-center gap-6 w-full">
                    <div class="text-center">
                        <div class="font-bold text-sm text-white truncate">${isHost ? playerName : opponentName}</div>
                        <div class="text-2xl font-bold text-green-400">${isHost ? scores.host : scores.guest}</div>
                        <div class="text-sm text-gray-300">${'❤️'.repeat(playerLives)}</div>
                    </div>
                    <div class="text-2xl font-bold">-</div>
                    <div class="text-center">
                        <div class="font-bold text-sm text-white truncate">${!isHost ? playerName : opponentName}</div>
                        <div class="text-2xl font-bold text-red-400">${!isHost ? scores.host : scores.guest}</div>
                        <div class="text-sm text-gray-300">${'❤️'.repeat(opponentLives)}</div>
                    </div>
                </div>
            </div>
        `;
        scoreDisplay.style.display = 'block';
    }
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
    
    // Can göstergelerini güncelle
    myLivesEl.textContent = '❤️'.repeat(Math.max(0, myLives));
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));
    
    // Sıra bilgisini güncelle
    if (gameData.turn === (isHost ? 0 : 1)) {
        turnStatusEl.textContent = window.languageManager ? window.languageManager.t('yourTurn') : 'Sizin növbəniz / Your turn';
    } else {
        turnStatusEl.textContent = window.languageManager ? window.languageManager.t('opponentTurn') : 'Rəqibin növbəsi / Opponent\'s turn';
    }
    
    // Rol bilgisini güncelle
    if (isHost) {
        roleStatusEl.textContent = window.languageManager ? window.languageManager.t('roleHost') : '🎮 Rol: HOST (Siz başlayırsınız) / 🎮 Role: HOST (You start)';
    } else {
        roleStatusEl.textContent = window.languageManager ? window.languageManager.t('roleGuest') : '🎮 Rol: QONAQ (Rəqib başlayır) / 🎮 Role: GUEST (Opponent starts)';
    }
    opponentLivesEl.textContent = '❤️'.repeat(Math.max(0, opponentLives));
    
    // Skor göstergesini güncelle
    if (gameData.scores) {
        const myScore = isHost ? gameData.scores.host : gameData.scores.guest;
        const opponentScore = isHost ? gameData.scores.guest : gameData.scores.host;
        
        // Skor göstergesi kaldırıldı
        scoreDisplayEl.style.display = 'none';
    }

    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);

    if (gameStage === 'WAITING' || gameStage === 'SELECTION') {
        turnStatusEl.textContent = '⏳ OYUN HAZIRLANIR...';
        actionMessageEl.textContent = "Bombalar otomatik yerleştiriliyor...";
        turnStatusEl.classList.remove('text-red-600');
        turnStatusEl.classList.add('text-yellow-600');
    } else if (gameStage === 'PLAY') {
        if (isMyTurn) {
            turnStatusEl.textContent = '✅ SIRA SƏNDƏ / You Play';
            actionMessageEl.textContent = "Bir kart aç! Rakibinizin bombalarından kaçınmaya çalışın.";
            turnStatusEl.classList.remove('text-red-600');
            turnStatusEl.classList.add('text-green-600');
        } else {
            turnStatusEl.textContent = '⏳ ONUN SIRASI / HIS TURN';
            actionMessageEl.textContent = "RƏQİBİNİZİ GÖZLƏYİN / WAIT FOR YOUR OPPONENT";
            turnStatusEl.classList.remove('text-green-600');
            turnStatusEl.classList.add('text-red-600');
        }
    }
    
    if (gameData.isGameOver && gameStage === 'ENDED') {
        turnStatusEl.textContent = "✅ OYUN BİTDİ! ";
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
    
    // Skorları güncelle
    if (!isDraw) {
        if (winnerRole === 'Host') {
            scores.host++;
        } else {
            scores.guest++;
        }
    }
    
    // Skorları oyun verisine de kopyala (sunucu senkronizasyonu için)
    gameData.scores = { ...scores };
    
    // Skor tablosunu güncelle
    updateScoreDisplay();
    
    if (isDraw) {
        turnStatusEl.textContent = `🤝 BƏRABƏRLİK!`;
        actionMessageEl.textContent = `Her iki oyuncu da tüm canlarını kaybetti!`;
        showGlobalMessage('🤝 Beraberlik! Her ikiniz de harika oynadınız!', false);
    } else if (iWon) {
        turnStatusEl.textContent = `🎉 QAZANDIN! (${scores[winnerRole.toLowerCase()]}-${scores[winnerRole === 'Host' ? 'guest' : 'host']})`;
        actionMessageEl.textContent = `Tebrikler! Rakibinizi yendiniz!`;
        showGlobalMessage(`🎉 Tebrikler! Bu turu kazandınız! (${scores[winnerRole.toLowerCase()]}-${scores[winnerRole === 'Host' ? 'guest' : 'host']})`, false);
    } else {
        turnStatusEl.textContent = `😔 UDUZDUN! (${scores[winnerRole === 'Host' ? 'guest' : 'host']}-${scores[winnerRole.toLowerCase()]})`;
        actionMessageEl.textContent = `Rakibiniz bu turu kazandı.`;
        showGlobalMessage(`😔 Bu turu kaybettiniz. (${scores[winnerRole === 'Host' ? 'guest' : 'host']}-${scores[winnerRole.toLowerCase()]})`, true);
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

// Sayfa yüklendiğinde yükleme mesajını göster
document.addEventListener('DOMContentLoaded', () => {
    showLoadingMessage();
});

// Basit bir ping endpoint'i ekleyelim
export function setupPingEndpoint(app) {
    app.get('/ping', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.status(200).json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            server: 'KartBomBot Server',
            version: '1.0.0'
        });
    });
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(socket, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupSocketHandlers ÇAĞRILDI!', { roomCode, isHost: host, opponent: opponentNameFromIndex });
    
    // Socket bağlantısını kontrol et
    if (!socket) {
        console.error('❌ Socket bağlantısı geçersiz!');
        showGlobalMessage('Sunucu bağlantı hatası. Lütfen sayfayı yenileyin.', true);
        return;
    }
    
    // Global değişkenleri güncelle
    currentRoomCode = roomCode;
    isHost = host;
    opponentName = opponentNameFromIndex;
    
    // Rakip adını güncelle
    const opponentNameEl = document.getElementById('opponentName');
    if (opponentNameEl) {
        opponentNameEl.textContent = opponentName;
    }
    
    // Rol durumunu güncelle
    const roleStatusEl = document.getElementById('roleStatus');
    if (roleStatusEl) {
        roleStatusEl.textContent = isHost ? "🎮 Rol: HOST (Sen başla)" : "🎮 Rol: GUEST (Rakip başlar)";
    }
    
    // Oyun başlatılıyor
    level = 1; // Yeni oyuna başlarken seviyeyi 1'e sıfırla
    
    // İlk seviye için board boyutunu ayarla (16 kart ile başla)
    const boardSize = LEVELS[level - 1]; // İlk seviye 16 kart
    initializeGame(boardSize);
    
    // Oyun başladı mesajını göster
    showGlobalMessage(`🎮 Oyun ${opponentName} ile başladı! 🚀`, false);
    
    // Oyun ekranını göster
    showScreen('game');
    
    // Socket olay dinleyicilerini ayarla
    setupGameSocketHandlers(socket);
    
    // Oyun başladı mesajını gönder
    if (isHost) {
        // Sadece host oyun başlatma isteği gönderecek
        console.log('🏁 Oyun başlatma isteği gönderiliyor...');
        socket.emit('startGame', { room: currentRoomCode });
    }
}

// Oyun için socket olay dinleyicilerini ayarla
function setupGameSocketHandlers(socket) {
    if (!socket) return;
    
    console.log('📡 Oyun socket dinleyicileri kuruluyor...');
    
    // Oyun hazır olduğunda
    socket.on('gameReady', (gameState) => {
        console.log('🎮 Oyun hazır, yükleme mesajı kaldırılıyor...');
        
        // Oyun durumunu güncelle
        if (gameState) {
            // Eğer oyun durumu geliyorsa, oyun durumunu güncelle
            if (gameState.hostLives !== undefined) gameData.hostLives = gameState.hostLives;
            if (gameState.guestLives !== undefined) gameData.guestLives = gameState.guestLives;
            if (gameState.turn !== undefined) gameData.turn = gameState.turn;
            if (gameState.board) gameData.board = gameState.board;
            
            // Oyun tahtasını güncelle
            drawBoard();
            updateStatusDisplay();
        }
        
        // Yükleme mesajını gizle
        hideLoadingMessage();
    });
    
    // Hamle yapıldığında
    socket.on('moveMade', (moveData) => {
        console.log('🎮 Hamle yapıldı:', moveData);
        
        // Hamleyi uygula
        if (moveData && moveData.index !== undefined) {
            applyMove(moveData.index, moveData.emoji, moveData.isBomb);
        }
    });
    
    // Oyun bittiğinde
    socket.on('gameOver', (result) => {
        console.log('🏁 Oyun bitti:', result);
        
        // Oyun sonucunu göster
        if (result.winner) {
            const winnerName = result.winner === 'host' ? (isHost ? 'Sen' : opponentName) : 
                             (result.winner === 'guest' ? (isHost ? opponentName : 'Sen') : 'Berabere');
            
            showGlobalMessage(`🏆 Oyun bitti! Kazanan: ${winnerName}`, false);
        } else {
            showGlobalMessage('🏁 Oyun bitti!', false);
        }
        
        // 3 saniye sonra lobiye dön
        setTimeout(() => {
            showScreen('lobby');
        }, 3000);
    });
    
    // Hata mesajı geldiğinde
    socket.on('error', (error) => {
        console.error('❌ Oyun hatası:', error);
        showGlobalMessage(`Hata: ${error.message || 'Bilinmeyen bir hata oluştu'}`, true);
    });
    
    // Rakip bağlantısı koptuğunda
    socket.on('opponentDisconnected', () => {
        console.log('⚠️ Rakip bağlantısı koptu');
        showGlobalMessage('Rakip bağlantısı koptu. Lobiye yönlendiriliyorsunuz...', true);
        
        // 3 saniye sonra lobiye dön
        setTimeout(() => {
            showScreen('lobby');
        }, 3000);
    });
}
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
    // Tüm oyun ayarlarını sıfırlar ve lobiye döner
    const message = window.languageManager ? 
        window.languageManager.t('playerLeft') : 'Oyunçu ayrıldı / Player left';
    showGlobalMessage(message, true);
    
    // 2 saniye sonra sayfayı yenile
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

// Oda yönetim butonuna tıklama olayını ekleyelim
document.addEventListener('DOMContentLoaded', () => {
    const roomActionBtn = document.getElementById('roomActionBtn');
    const roomCodeInput = document.getElementById('roomCodeInput');
    
    if (roomActionBtn) {
        roomActionBtn.addEventListener('click', () => {
            const roomCode = roomCodeInput.value.trim().toUpperCase();
            const username = document.getElementById('usernameInput')?.value.trim() || 'Player';
            
            if (!username) {
                showGlobalMessage('İstifadəçi adı daxil edin / Please enter a username', true);
                return;
            }
            
            if (roomCode) {
                // Odaya bağlan
                if (socket) {
                    socket.emit('joinRoom', { room: roomCode, username });
                    showScreen('wait');
                }
            } else {
                // Yeni oda oluştur
                if (socket) {
                    socket.emit('createRoom', { username });
                    showScreen('wait');
                }
            }
        });
        
        // Enter tuşu ile de göndermeyi etkinleştir
        roomCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                roomActionBtn.click();
            }
        });
    }
});

// Lobi Butonlarını dışarıdan erişilebilir yapıyoruz (index.html'in kullanması için)
export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    showGlobalMessage, 
    resetGame
};
