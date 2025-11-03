// Dosya Adı: pong.js
// İki Oyunlu Yapı için Yeni Ping Pong İstemci Mantığı

let pongSocket;
let pongCurrentRoomCode = '';
let pongIsHost = false;
let pongOpponentName = '';

// --- Canvas ve Oyun Ayarları ---
const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');
let animationFrameId;

// Oyun Alanı Boyutları (CSS tarafından ayarlanacak, burada oranları kullanıyoruz)
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 400;

// Çubuk (Paddle) Ayarları
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 60;
const PADDLE_SPEED = 6;

let hostPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
let guestPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;

// Top Ayarları
const BALL_SIZE = 8;
let ballX = CANVAS_WIDTH / 2;
let ballY = CANVAS_HEIGHT / 2;
let ballSpeedX = 4; // Başlangıç X hızı
let ballSpeedY = 4; // Başlangıç Y hızı
const MAX_SPEED = 12; // Maksimum Top Hızı

// Skor
let hostScore = 0;
let guestScore = 0;

// Giriş Kontrolü
const keys = {};

// --- DOM Referansları (pong özel) ---
const pongScoreEl = document.getElementById('pongScore');
const pongStatusEl = document.getElementById('pongStatus');

// --- SESLER (Yeni) ---
const audioPaddle = new Audio('paddle_hit.mp3');
const audioWall = new Audio('wall_hit.mp3');
const audioScore = new Audio('score.mp3');

function playPongSound(audioElement) {
    if (!audioElement) return;
    const clone = audioElement.cloneNode();
    clone.volume = 0.5;
    clone.play().catch(() => {});
}

// --- ÇİZİM FONKSİYONLARI ---

function drawRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}

function drawCircle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
}

function draw() {
    // Arka plan
    drawRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 'black');

    // Merkez Çizgisi
    for (let i = 0; i < CANVAS_HEIGHT; i += 20) {
        drawRect(CANVAS_WIDTH / 2 - 1, i, 2, 10, 'gray');
    }

    // Çubuklar
    drawRect(0, hostPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT, 'white');
    drawRect(CANVAS_WIDTH - PADDLE_WIDTH, guestPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT, 'white');

    // Top
    drawCircle(ballX, ballY, BALL_SIZE, 'white');
}

// --- GÜNCELLEME VE ÇARPIŞMA MANTIĞI ---

function updateLocalPaddle() {
    const isUp = keys['w'] || keys['W'] || keys['ArrowUp'];
    const isDown = keys['s'] || keys['S'] || keys['ArrowDown'];

    if (pongIsHost) {
        if (isUp) hostPaddleY -= PADDLE_SPEED;
        if (isDown) hostPaddleY += PADDLE_SPEED;
        hostPaddleY = Math.max(0, Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, hostPaddleY));
        pongSocket.emit('pongMove', { roomCode: pongCurrentRoomCode, y: hostPaddleY, isHost: true });
    } else {
        if (isUp) guestPaddleY -= PADDLE_SPEED;
        if (isDown) guestPaddleY += PADDLE_SPEED;
        guestPaddleY = Math.max(0, Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, guestPaddleY));
        pongSocket.emit('pongMove', { roomCode: pongCurrentRoomCode, y: guestPaddleY, isHost: false });
    }
}

function updateBall() {
    if (pongIsHost) { // Topun hareket mantığı sadece Host'ta çalışır (Server'a daha az yük)
        ballX += ballSpeedX;
        ballY += ballSpeedY;

        // Duvar Çarpışması (Üst/Alt)
        if (ballY - BALL_SIZE < 0 || ballY + BALL_SIZE > CANVAS_HEIGHT) {
            playPongSound(audioWall);
            ballSpeedY = -ballSpeedY;
            ballY = Math.max(BALL_SIZE, Math.min(CANVAS_HEIGHT - BALL_SIZE, ballY));
        }

        // Host Çubuk Çarpışması (Sol taraf)
        if (ballX - BALL_SIZE < PADDLE_WIDTH && ballX - BALL_SIZE > 0) {
            if (ballY > hostPaddleY && ballY < hostPaddleY + PADDLE_HEIGHT) {
                playPongSound(audioPaddle);
                // X Hızını artır ve yönü tersine çevir
                ballSpeedX = Math.min(MAX_SPEED, -ballSpeedX + 0.5); 
                // Y Hızını çubuğun neresine çarptığına göre ayarla
                let relativeIntersectY = (hostPaddleY + (PADDLE_HEIGHT / 2)) - ballY;
                let normalizedRelativeIntersectionY = (relativeIntersectY / (PADDLE_HEIGHT / 2));
                ballSpeedY = normalizedRelativeIntersectionY * (-ballSpeedX) * 0.5; // Açıyı dinamikleştir

                // Server'a güncel top durumunu gönder
                pongSocket.emit('pongBallUpdate', { 
                    roomCode: pongCurrentRoomCode, 
                    x: ballX, 
                    y: ballY, 
                    speedX: ballSpeedX, 
                    speedY: ballSpeedY 
                });
            }
        }
        
        // Guest Çubuk Çarpışması (Sağ taraf)
        if (ballX + BALL_SIZE > CANVAS_WIDTH - PADDLE_WIDTH && ballX + BALL_SIZE < CANVAS_WIDTH) {
            if (ballY > guestPaddleY && ballY < guestPaddleY + PADDLE_HEIGHT) {
                playPongSound(audioPaddle);
                // X Hızını artır ve yönü tersine çevir
                ballSpeedX = Math.min(MAX_SPEED, -ballSpeedX - 0.5);
                // Y Hızını ayarla
                let relativeIntersectY = (guestPaddleY + (PADDLE_HEIGHT / 2)) - ballY;
                let normalizedRelativeIntersectionY = (relativeIntersectY / (PADDLE_HEIGHT / 2));
                ballSpeedY = normalizedRelativeIntersectionY * (ballSpeedX) * 0.5; // Açıyı dinamikleştir

                // Server'a güncel top durumunu gönder
                pongSocket.emit('pongBallUpdate', { 
                    roomCode: pongCurrentRoomCode, 
                    x: ballX, 
                    y: ballY, 
                    speedX: ballSpeedX, 
                    speedY: ballSpeedY 
                });
            }
        }

        // Skor Alma (Sınırları Geçme)
        if (ballX < 0) {
            // Guest puan aldı
            guestScore++;
            playPongSound(audioScore);
            pongSocket.emit('pongScore', { roomCode: pongCurrentRoomCode, score: guestScore, scorerIsHost: false });
            resetBall(pongIsHost ? 1 : -1);
        } else if (ballX > CANVAS_WIDTH) {
            // Host puan aldı
            hostScore++;
            playPongSound(audioScore);
            pongSocket.emit('pongScore', { roomCode: pongCurrentRoomCode, score: hostScore, scorerIsHost: true });
            resetBall(pongIsHost ? 1 : -1);
        }
    }
}

function resetBall(direction) {
    ballX = CANVAS_WIDTH / 2;
    ballY = CANVAS_HEIGHT / 2;
    
    // Yönü rastgele ayarla, hızı sıfırla
    ballSpeedX = 4 * direction;
    ballSpeedY = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 3 + 1);

    // Host değilse ve Host'tan yeni top bilgisi bekleniyorsa
    if (!pongIsHost) {
        ballSpeedX = 0;
        ballSpeedY = 0;
    }
    
    updatePongScoreDisplay();
    
    if (hostScore >= 10 || guestScore >= 10) {
        endPongGame();
    }
}

function gameLoop() {
    updateLocalPaddle();
    updateBall();
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- UI GÜNCELLEME ---

function updatePongScoreDisplay() {
    const myScore = pongIsHost ? hostScore : guestScore;
    const opponentScore = pongIsHost ? guestScore : hostScore;
    const opponentText = pongOpponentName || 'Rakip';
    
    pongScoreEl.innerHTML = `
        <span class="text-xl font-bold text-blue-400">${myScore}</span> 
        - 
        <span class="text-xl font-bold text-red-400">${opponentScore}</span>
    `;
    
    pongStatusEl.textContent = `🚀 ${t('pongGame', { name: opponentText })}`;
}

function endPongGame() {
    cancelAnimationFrame(animationFrameId);
    
    const winner = hostScore > guestScore ? 'HOST' : 'GUEST';
    const myRole = pongIsHost ? 'HOST' : 'GUEST';
    
    let messageKey = 'draw';
    if (winner === myRole) {
        messageKey = 'youWon';
    } else if (winner !== 'HOST' && winner !== 'GUEST') {
        messageKey = 'draw'; // Should not happen with score limit
    } else {
        messageKey = 'youLost';
    }
    
    showGlobalMessage(t(messageKey, { name: pongOpponentName }), winner === myRole);
    
    // Geri dönme
    setTimeout(() => {
        showScreen('menu');
        resetPongGame();
    }, 4000);
}

function resetPongGame() {
    cancelAnimationFrame(animationFrameId);
    hostScore = 0;
    guestScore = 0;
    hostPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    guestPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    ballSpeedX = 0;
    ballSpeedY = 0;
    updatePongScoreDisplay();
    pongCurrentRoomCode = '';
    pongOpponentName = '';
}


// --- GİRİŞ İŞLEYİCİLERİ ---

function handleKeyDown(e) {
    keys[e.key] = true;
}

function handleKeyUp(e) {
    keys[e.key] = false;
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---

export function setupPongSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    console.log('🎯 setupPongSocketHandlers ÇAĞRILDI!');
    
    pongSocket = s;
    pongCurrentRoomCode = roomCode;
    pongIsHost = host;
    pongOpponentName = opponentNameFromIndex;
    
    // Canvas boyutunu ayarla (CSS'de ayarlanmış olmalı, burası sadece fallback)
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    
    showScreen('pongGame');
    showGlobalMessage(`🏓 Ping Pong Oyunu ${pongOpponentName} ile başladı!`, false);
    
    // Oyun durumunu sıfırla ve başlat
    hostScore = 0;
    guestScore = 0;
    hostPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    guestPaddleY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    resetBall(pongIsHost ? 1 : -1); 
    
    updatePongScoreDisplay();
    
    // Kontrolcüleri kur
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Animasyonu başlat
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    gameLoop();
    
    // --- SOCKET.IO İŞLEYİCİLERİ ---

    // Rakip çubuk hareketini al
    pongSocket.on('pongMove', ({ y, isHost: movedByHost }) => {
        if (movedByHost) {
            hostPaddleY = y;
        } else {
            guestPaddleY = y;
        }
    });

    // Topun durumunu al (Sadece Host'tan)
    pongSocket.on('pongBallUpdate', ({ x, y, speedX, speedY }) => {
        if (!pongIsHost) {
            ballX = x;
            ballY = y;
            ballSpeedX = speedX;
            ballSpeedY = speedY;
        }
    });
    
    // Skor güncellemesi
    pongSocket.on('pongScore', ({ score, scorerIsHost }) => {
        if (scorerIsHost) {
            hostScore = score;
        } else {
            guestScore = score;
        }
        updatePongScoreDisplay();
        
        if (hostScore >= 10 || guestScore >= 10) {
            endPongGame();
        } else {
            // Skordan sonra topu sıfırla
            resetBall(pongIsHost ? 1 : -1); 
        }
    });

    // Rakip Ayrıldı
    pongSocket.on('opponentLeft', (message) => {
        showGlobalMessage(message || t('playerLeft'), true);
        resetPongGame();
        showScreen('menu');
    });
}
