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
    // Oda kodu ve seviye bilgisiyle rastgele tohum oluştur
    const seed = currentRoomCode + level;
    const seededRandom = createSeededRandom(seed);
    
    const points = [];
    const bombCount = Math.min(level, 4); // Seviyeye göre bomba sayısı (max 4)
    
    // Kartları doldur
    const board = [];
    
    // Rastgele puanlar ekle (her oyuncu için aynı olacak şekilde)
    for (let i = 0; i < boardSize - bombCount; i++) {
        const randomIndex = Math.floor(seededRandom() * POINTS.length);
        const randomPoint = POINTS[randomIndex];
        points.push(randomPoint);
    }
    
    // Bombaları ekle
    for (let i = 0; i < bombCount; i++) {
        points.push('💣');
    }
    
    // Karıştır (her oyuncu için aynı sıralamada olacak şekilde)
    for (let i = points.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [points[i], points[j]] = [points[j], points[i]];
    }
    
    // Oyun tahtasını oluştur
    gameData.board = points.map(point => ({
        opened: false,
        content: point,
        isBomb: point === '💣'
    }));
    
    gameData.cardsLeft = boardSize;
    gameData.turn = 0; // Host başlar
    gameData.isGameOver = false;
    gameData.bombCount = bombCount;
    
    gameStage = 'PLAY';
    
    console.log(`Yeni seviye başlatıldı - Seviye: ${level}, Bombalar: ${bombCount}`);
    console.log('Kart değerleri:', gameData.board.map(card => card.isBomb ? '💣' : card.content));
    updateStatusDisplay();
}

// Aynı tohum değeriyle aynı rastgele sayıları üreten fonksiyon
function createSeededRandom(seed) {
    let value = 0;
    for (let i = 0; i < seed.length; i++) {
        value = (value << 5) - value + seed.charCodeAt(i);
        value |= 0;
    }
    
    // Basit bir rastgele sayı üreteci
    return function() {
        value = (value * 9301 + 49297) % 233280;
        return value / 233280;
    };
}

// --- OYUN DURUMU ---
let level = 1; 
// Kart sayıları: Level 1'de 16, sonraki tüm levellerde 20 kart
const LEVELS = [16, 20]; 
const POINTS = [10, 15, 20, 50, 70, 100]; // Olası puan değerleri
let gameStage = 'SELECTION'; // 'SELECTION' veya 'PLAY'

let gameData = {
    board: [], 
    turn: 0,  // 0 = Host, 1 = Guest
    hostScore: 0,  // Host'un puanı
    guestScore: 0, // Guest'in puanı
    cardsLeft: 0,
    bombCount: 1, // Başlangıçta 1 bomba
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

// Puan animasyonu oluşturma fonksiyonu
function createScoreAnimation(value, x, y, isBomb = false) {
    const scoreEl = document.createElement('div');
    scoreEl.className = 'score-point';
    scoreEl.textContent = (isBomb ? '💣 -100' : `+${value}`);
    scoreEl.style.color = isBomb ? '#ff4444' : '#4CAF50';
    scoreEl.style.left = `${x}px`;
    scoreEl.style.top = `${y}px`;
    
    document.body.appendChild(scoreEl);
    
    // Animasyon bittiğinde elementi kaldır
    setTimeout(() => {
        scoreEl.classList.add('score-float');
        setTimeout(() => {
            if (document.body.contains(scoreEl)) {
                document.body.removeChild(scoreEl);
            }
        }, 1000);
    }, 10);
}

function drawBoard() {
    const boardSize = LEVELS[level - 1] || 20; // Default 20
    
    // Grid düzenini sadece 4 sütun (4 aşağı inme) olarak ayarla
    gameBoardEl.className = 'grid w-full max-w-sm mx-auto memory-board'; 
    gameBoardEl.style.gridTemplateColumns = 'repeat(4, 1fr)'; // 4 sütun (4x3, 4x4, 4x5 için)
    
    gameBoardEl.innerHTML = '';
    
    gameData.board.forEach((cardState, index) => {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container aspect-square';
        cardContainer.dataset.index = index;

        const card = document.createElement('div');
        card.className = `card ${cardState.opened ? 'flipped' : ''}`;
        
        const front = document.createElement('div');
        front.className = 'card-face front';
        
        // Kartın puanını veya içeriğini göster
        if (cardState.opened) {
            if (cardState.isBomb) {
                front.textContent = '💣';
                // Bomba ikonu büyük olsun
                front.style.fontSize = '2.5rem';
                front.style.display = 'flex';
                front.style.alignItems = 'center';
                front.style.justifyContent = 'center';
            } else {
                front.textContent = cardState.content;
                // Eğer puan kartıysa, üzerinde puanı göster
                if (cardState.content && !isNaN(parseInt(cardState.content))) {
                    const pointsBadge = document.createElement('div');
                    pointsBadge.className = 'card-points';
                    pointsBadge.textContent = cardState.content;
                    front.appendChild(pointsBadge);
                    
                    // Puan kartının reklini puanına göre ayarla
                    const pointValue = parseInt(cardState.content);
                    if (pointValue >= 70) {
                        front.style.background = 'linear-gradient(135deg, #4CAF50, #2E7D32)';
                    } else if (pointValue >= 30) {
                        front.style.background = 'linear-gradient(135deg, #2196F3, #1565C0)';
                    } else {
                        front.style.background = 'linear-gradient(135deg, #f5f5f5, #e0e0e0)';
                        front.style.color = '#333';
                    }
                    
                    // Puan yazısını ortala
                    front.style.display = 'flex';
                    front.style.alignItems = 'center';
                    front.style.justifyContent = 'center';
                    front.style.fontSize = '2rem';
                    front.style.fontWeight = 'bold';
                }
            }
        } else {
            front.textContent = '?';
            // Kapalı kart stili
            front.style.background = 'linear-gradient(135deg, #3B82F6, #1D4ED8)';
            front.style.color = 'white';
            front.style.display = 'flex';
            front.style.alignItems = 'center';
            front.style.justifyContent = 'center';
            front.style.fontSize = '2rem';
        }
        
        const back = document.createElement('div');
        back.className = 'card-face back';
        back.style.background = '#f5f5f5';
        back.style.display = 'flex';
        back.style.alignItems = 'center';
        back.style.justifyContent = 'center';
        
        const backContent = document.createElement('span');
        backContent.textContent = cardState.isBomb ? '💣' : (cardState.content || '?');
        backContent.style.fontSize = '2rem';
        backContent.style.lineHeight = '1';
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
            
            // Tıklama olayını ekle
            cardContainer.addEventListener('click', () => {
                const rect = cardContainer.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                
                if (gameData.board[index].isBomb) {
                    createScoreAnimation(100, x, y, true);
                } else if (gameData.board[index].content) {
                    createScoreAnimation(parseInt(gameData.board[index].content), x, y);
                }
                
                handleCardClick(index);
            });
        }
        
        gameBoardEl.appendChild(cardContainer);
    });
    updateStatusDisplay();
}

function updateStatusDisplay() {
    // Sıra kimde gösterimi
    const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
    
    // Sıra durumunu güncelle
    if (isMyTurn) {
        turnStatusEl.textContent = 'SIRA SİZDE';
        turnStatusEl.className = 'text-2xl font-bold text-green-600';
        actionMessageEl.textContent = "Hamlenizi yapın!";
    } else {
        turnStatusEl.textContent = '⏳ RAKİBİN SIRASI';
        turnStatusEl.className = 'text-2xl font-bold text-red-600';
        actionMessageEl.textContent = "Rakibinizin hamlesini bekleyin...";
    }
    
    // Puan durumlarını güncelle
    if (myLivesEl) {
        myLivesEl.textContent = `Puan: ${isHost ? gameData.hostScore : gameData.guestScore}`;
    }
    if (opponentLivesEl) {
        opponentLivesEl.textContent = `Rakip: ${isHost ? gameData.guestScore : gameData.hostScore}`;
    }
    
    // Oyun bittiyse
    if (gameData.isGameOver && gameStage === 'ENDED') {
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

async function applyMove(index, fromServer = false) {
    if (gameData.board[index].opened) return;

    if (!fromServer) {
        // Eğer bu hamle sunucudan gelmediyse, sunucuya gönder
        if (socket && socket.connected) {
            socket.emit('gameMove', {
                roomCode: currentRoomCode,
                cardIndex: index,
                turn: gameData.turn
            });
        }
        
        await triggerWaitAndVibrate();
    }

    const card = gameData.board[index];
    card.opened = true;
    gameData.cardsLeft -= 1;
    
    // Animasyon için kartın konumunu al
    const cardElement = document.querySelector(`.card-container[data-index="${index}"]`);
    let x, y;
    
    if (cardElement) {
        const rect = cardElement.getBoundingClientRect();
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
    }
    
    if (card.isBomb) {
        // Bomba ise karşı oyuncudan 100 puan düş
        if (gameData.turn === 0) { // Host bombaya bastı
            gameData.guestScore = Math.max(0, gameData.guestScore - 100);
            const message = isHost ? 'Siz bombaya bastınız! -100 puan!' : 'Rakibiniz bombaya bastı! -100 puan!';
            showGlobalMessage(`💣 ${message}`, true);
            if (cardElement) createScoreAnimation(100, x, y, true);
        } else { // Guest bombaya bastı
            gameData.hostScore = Math.max(0, gameData.hostScore - 100);
            const message = !isHost ? 'Siz bombaya bastınız! -100 puan!' : 'Rakibiniz bombaya bastı! -100 puan!';
            showGlobalMessage(`💣 ${message}`, true);
            if (cardElement) createScoreAnimation(100, x, y, true);
        }
        playSound(audioBomb);
    } else {
        // Puan kartı ise puanı ekle
        const points = parseInt(card.content);
        const currentPlayer = gameData.turn === 0 ? 'hostScore' : 'guestScore';
        gameData[currentPlayer] += points;
        
        // Sadece kendi puan kazandığında mesaj göster
        const isMyTurn = (isHost && gameData.turn === 0) || (!isHost && gameData.turn === 1);
        if (isMyTurn) {
            showGlobalMessage(`+${points} puan kazandınız!`, false);
        } else {
            showGlobalMessage(`Rakibiniz ${points} puan kazandı!`, false);
        }
        
        if (cardElement) createScoreAnimation(points, x, y);
        playSound(audioEmoji);
    }
    
    drawBoard();
    updateStatusDisplay();
    
    // Tüm kartlar açıldı mı kontrol et
    if (gameData.cardsLeft === 0) {
        // Oyun bitti, puanları karşılaştır
        let winner = null;
        let winnerScore = 0;
        
        if (gameData.hostScore > gameData.guestScore) {
            winner = isHost ? 'Siz' : opponentName;
            winnerScore = gameData.hostScore;
            if (!fromServer) endGame('Host');
            });
        }
    }
}

function endGame(winnerRole) {
    gameData.isGameOver = true;
    gameStage = 'ENDED';
    
    const myRole = isHost ? 'Host' : 'Guest';
    const iWon = (winnerRole === myRole);
    const isDraw = (winnerRole === 'DRAW');
    
    // Puanları al
    const myScore = isHost ? gameData.hostScore : gameData.guestScore;
    const opponentScore = isHost ? gameData.guestScore : gameData.hostScore;
    
    // Oyun sonucunu göster
    if (isDraw) {
        showGlobalMessage(`🤝 Berabere! Her iki oyuncu da ${myScore} puan aldı!`, false);
    } else if (iWon) {
        showGlobalMessage(`🏆 Kazandınız! (${myScore} - ${opponentScore})`, false);
        playSound(audioWin);
    } else {
        showGlobalMessage(`❌ Kaybettiniz! (${opponentScore} - ${myScore})`, true);
        playSound(audioLose);
    }
    
    // Oyun sonu butonlarını göster
    const gameOverEl = document.getElementById('gameOverScreen');
    const gameOverMessage = document.getElementById('gameOverMessage');
    
    if (isDraw) {
        gameOverMessage.textContent = `Berabere! Her iki oyuncu da ${myScore} puan aldı!`;
    } else if (iWon) {
        gameOverMessage.textContent = `Tebrikler, kazandınız! 🏆\nSkor: ${myScore} - ${opponentScore}`;
    } else {
        gameOverMessage.textContent = `Maalesef kaybettiniz! 😢\nSkor: ${opponentScore} - ${myScore}`;
    }
    
    gameOverEl.classList.remove('hidden');
    
    // 5 saniye sonra otomatik olarak yeni oyuna geç
    setTimeout(() => {
        if (gameStage === 'ENDED') {
            startNewGame();
        } else {
            gameData.hostLives = !isHostWinner ? (level === 1 ? 3 : 4) : 0;
            gameData.guestLives = isHostWinner ? (level === 1 ? 3 : 4) : 0;
        }
        
        // Sunucuya levelComplete olayını gönder
        if (socket && socket.connected) {
            console.log(`📤 Sunucuya levelComplete gönderiliyor (endGame): Seviye ${level} tamamlandı`);
            socket.emit('levelComplete', {
                roomCode: currentRoomCode,
                level: level,
                nextLevel: nextLevel,
                hostLives: gameData.hostLives,
                guestLives: gameData.guestLives,
                resetLives: false
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
    
    // Eğer bir oyuncu öldüyse, oyunu bitir
    if (gameData.hostLives <= 0 || gameData.guestLives <= 0) {
        return; // endGame fonksiyonu zaten çağrılacak
    }
    
    // Tüm kartlar açıldıysa yeni seviyeye geç
    if (openedCards === totalCards) {
        const nextLevel = level + 1;
        
        console.log(`🎯 Tüm kartlar açıldı! Yeni seviye: ${nextLevel}`);
        showGlobalMessage(`🎉 Seviye ${level} tamamlandı! Yeni seviye yükleniyor...`, false);
        
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
    const boardSize = LEVELS[level - 1]; // İlk seviye 16 kart
    initializeGame(boardSize);
    
    // Can sayılarını server'dan gelen bilgiyle güncelle
    socket.once('gameReady', ({ hostBombs, guestBombs }) => {
        // Seviyeye göre can sayılarını ayarla
        if (level === 1) {
            gameData.hostLives = 4;
            gameData.guestLives = 4;
        } else {
            gameData.hostLives = 6;
            gameData.guestLives = 6;
        }
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
        // Server'dan gelen can değerlerini kullan (Canlar 0 gelirse default 3 yap, ama level 1'in 3 bomba olma ihtimali var)
        gameData.hostLives = gameState.hostLives === undefined ? (level === 1 ? 3 : 4) : gameState.hostLives;
        gameData.guestLives = gameState.guestLives === undefined ? (level === 1 ? 3 : 4) : gameState.guestLives;
        gameData.turn = gameState.turn || 0;
        
        gameStage = 'PLAY';
        
        // Oyun tahtasını çiz ve durumu güncelle
        drawBoard();
        updateStatusDisplay();
        
        playSound(audioEmoji); // Başlama sesi
        showGlobalMessage(`🚀 Seviye ${level} başlıyor! ${gameData.hostLives} bomba ile oynanıyor.`, false);
    });
    
    // Yeni seviye başlatma
    socket.on('newLevel', (data) => {
        console.log('🆕 Yeni seviye başlatılıyor:', data);
        
        // Seviye bilgisini güncelle
        const newLevel = parseInt(data.level) || 1;
        
        // Eğer bir önceki oyunda biri öldüyse, canları sıfırla (yeniden başlat)
        const shouldResetLives = (gameData.hostLives <= 0 || gameData.guestLives <= 0);
        
        // Mevcut canları koru veya sıfırla
        const hostLives = shouldResetLives ? 
            (newLevel === 1 ? 3 : 4) : // Eğer canlar sıfırlanacaksa, seviyeye göre can ver
            Math.max(0, gameData.hostLives); // Değilse mevcut canları koru (0'ın altına düşmesin)
            
        const guestLives = shouldResetLives ? 
            (newLevel === 1 ? 3 : 4) : // Eğer canlar sıfırlanacaksa, seviyeye göre can ver
            Math.max(0, gameData.guestLives); // Değilse mevcut canları koru (0'ın altına düşmesin)
        
        console.log(`🔁 Can güncellemesi - Host: ${hostLives}, Guest: ${guestLives}, Sıfırlama: ${shouldResetLives}`);
        
        // Oyun durumunu güncelle (mevcut durumu koruyarak)
        gameData = {
            ...gameData, // Mevcut durumu koru
            board: [],
            turn: 0, // Host başlar
            hostLives: hostLives,
            guestLives: guestLives,
            cardsLeft: data.boardSize, // Server'dan gelen kart sayısını kullan
            hostBombs: [], 
            guestBombs: [],
            isGameOver: false,
            bombCount: newLevel === 1 ? 4 : 6, // Level 1'de 4 bomba, diğerlerinde 6 bomba
            level: newLevel // Seviyeyi güncelle
        };
        
        // Seviye değişkenini güncelle
        level = newLevel;
        
        gameStage = 'PLAY';
        
        // Yeni oyun tahtasını oluştur
        initializeGame(data.boardSize);
        
        // UI'ı güncelle
        updateStatusDisplay();
        
        console.log(`Yeni seviye başlatıldı - Seviye: ${level}, Host Can: ${gameData.hostLives}, Guest Can: ${gameData.guestLives}, Bomba Sayısı: ${gameData.bombCount}`);
        showGlobalMessage(`🎮 Seviye ${level} başladı! ${gameData.hostLives} can ile oynanıyor.`, false);
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
