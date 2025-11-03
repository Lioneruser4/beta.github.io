// Dosya Adı: pong.js
// Ping Pong İstemci Mantığı

import { showScreen, showGlobalMessage, t } from './main.js'; 

let pongSocket;
let pongCurrentRoomCode = '';
let pongIsHost = false;
let pongOpponentName = '';

// --- Canvas ve Oyun Ayarları ---
const canvas = document.getElementById('pongCanvas');
const ctx = canvas.getContext('2d');
let animationFrameId;

// Oyun Alanı Boyutları (index.html'den sabitlenmiş)
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
let ballSpeedX = 0; // Başlangıçta sıfır, Host başlatır
let ballSpeedY = 0; 
const INITIAL_SPEED = 4;
const MAX_SPEED = 12; 
const MAX_SCORE = 10; // Oyun bitiş skoru

// Skor
let hostScore = 0;
let guestScore = 0;

// Giriş Kontrolü
const keys = {};

// --- DOM Referansları (pong özel) ---
const pongScoreEl = document.getElementById('pongScore');
const pongStatusEl = document.getElementById('pongStatus');

// --- SESLER ---
// Ses dosyalarının root dizinde olduğu varsayılır.
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

// --- GÜNCELLEME VE ÇARPIŞMA MANTIĞI (Sadece Host'ta Çalışır) ---

function updateLocalPaddle() {
    const isUp = keys['w'] || keys['W'] || keys['ArrowUp'];
    const isDown = keys['s'] || keys['S'] || keys['ArrowDown'];

    let currentY;
    if (pongIsHost) {
        currentY = hostPaddleY;
    } else {
        currentY = guestPaddleY;
    }

    if (isUp) currentY -= PADDLE_SPEED;
    if (isDown) currentY += PADDLE_SPEED;
    currentY = Math.max(0, Math.min(CANVAS_HEIGHT - PADDLE_HEIGHT, currentY));
    
    // Y Sınırlama ve Güncelleme
    if (pongIsHost) {
        hostPaddleY = currentY;
    } else {
        guestPaddleY = currentY;
    }

    // Hareketi Server'a gönder
    pongSocket.emit('pongMove', { roomCode: pongCurrentRoomCode, y: currentY, isHost: pongIsHost });
}

function updateBall() {
    if (pongIsHost) { // Topun hareket ve çarpışma mantığı sadece Host'ta çalışır
        ballX += ballSpeedX;
        ballY += ballSpeedY;

        // Duvar Çarpışması (Üst/Alt)
        if (ballY - BALL_SIZE < 0 || ballY + BALL_SIZE > CANVAS_HEIGHT) {
            playPongSound(audioWall);
            ballSpeedY = -ballSpeedY;
            ballY = Math.max(BALL_SIZE, Math.min(CANVAS_HEIGHT - BALL_SIZE, ballY));
        }

        // Çubuk Çarpışması Kontrolü
        const isHostHitting = ballSpeedX < 0 && ballX - BALL_SIZE < PADDLE_WIDTH;
        const isGuestHitting = ballSpeedX > 0 && ballX + BALL_SIZE > CANVAS_WIDTH - PADDLE_WIDTH;

        if (isHostHitting || isGuestHitting) {
            const paddleY = isHostHitting ? hostPaddleY : guestPaddleY;
            
            if (ballY > paddleY && ballY < paddleY + PADDLE_HEIGHT) {
                playPongSound(audioPaddle);
                
                // Dinamik Hız Artışı ve Yön Değiştirme
                const currentSpeed = Math.abs(ballSpeedX);
                let newSpeed = Math.min(MAX_SPEED, currentSpeed + 0.5);
                
                // Yönü tersine çevir ve yeni hızı ata
                ballSpeedX = isHostHitting ? newSpeed : -newSpeed;
                
                // Y Hızı (Açı) Ayarı
                let relativeIntersectY = (paddleY + (PADDLE_HEIGHT / 2)) - ballY;
                let normalizedRelativeIntersectionY = (relativeIntersectY / (PADDLE_HEIGHT / 2));
                
                // Yeni Y hızını X hızının bir oranına ayarla (açı ne kadar dikse, Y hızı o kadar büyük olur)
                ballSpeedY = normalizedRelativeIntersectionY * newSpeed * 0.75; 

                // Rakibe güncel top durumunu gönder
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
            guestScore++;
            playPongSound(audioScore);
            pongSocket.emit('pongScore', { roomCode: pongCurrentRoomCode, score: guestScore, scorerIsHost: false });
            resetBall(1); // Guest'in sahasına düştü, Host başlatsın
        } else if (ballX > CANVAS_WIDTH) {
            hostScore++;
            playPongSound(audioScore);
            pongSocket.emit('pongScore', { roomCode: pongCurrentRoomCode, score: hostScore, scorerIsHost: true });
            resetBall(-1); // Host'un sahasına düştü, Guest başlatsın
        }
    }
}

function resetBall(direction) {
    ballX = CANVAS_WIDTH / 2;
    ballY = CANVAS_HEIGHT / 2;
    
    // Topu Host başlatır (+1 yön), Guest başlatır (-1 yön)
    if (pongIsHost) {
        ballSpeedX = INITIAL_SPEED * direction;
        ballSpeedY = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 3 + 1);
    } else {
        // Guest sadece koordinatları alır, hızı sıfır tutar.
        ballSpeedX = 0;
        ballSpeedY = 0;
    }

    updatePongScoreDisplay();
    
    if (hostScore >= MAX_SCORE || guestScore >= MAX_SCORE) {
        endPongGame();
    }
}

function gameLoop() {
    updateLocalPaddle();
    updateBall(); // Sadece Host topu günceller
    draw();
    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- UI GÜNCELLEME ---

function updatePongScoreDisplay() {
    const myScore = pongIsHost ? hostScore : guestScore;
    const opponentScore = pongIsHost ? guestScore : hostScore;
    
    pongScoreEl.innerHTML = `
        <span class="text-xl font-bold text-blue-400">${myScore}</span> 
        - 
        <span class="text-xl font-bold text-red-400">${opponentScore}</span>
    `;
    
    pongStatusEl.textContent = t('pongGameStatus', { name: pongOpponentName });
}

function endPongGame() {
    cancelAnimationFrame(animationFrameId);
    
    const myScore = pongIsHost ? hostScore : guestScore;
    const opponentScore = pongIsHost ? guestScore : hostScore;
    
    let messageKey;
    if (myScore > opponentScore) {
        messageKey = 'youWon';
    } else if (myScore < opponentScore) {
        messageKey = 'youLost';
    } else {
        messageKey = 'draw';
    }
    
    showGlobalMessage(t('gameOver') + ' ' + t(messageKey), myScore <= opponentScore);
    
    setTimeout(() => {
        resetPongGame();
        showScreen('menu');
    }, 4000);
}

export function resetPongGame() {
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
    
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
}


// --- GİRİŞ İŞLEYİCİLERİ ---

function handleKeyDown(e) {
    // W ve S tuşlarını engelle
    if (e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S') {
        e.preventDefault(); 
    }
    keys[e.key] = true;
}

function handleKeyUp(e) {
    keys[e.key] = false;
}

// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---

export function setupPongSocketHandlers(s, roomCode, host, opponentNameFromIndex) {
    pongSocket = s;
    pongCurrentRoomCode = roomCode;
    pongIsHost = host;
    pongOpponentName = opponentNameFromIndex;
    
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    
    showScreen('pongGame');
    showGlobalMessage(`🏓 Ping Pong Oyunu ${opponentNameFromIndex} ile başladı!`, false);
    
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
    pongSocket.off('pongMove').on('pongMove', ({ y, isHost: movedByHost }) => {
        if (movedByHost) {
            hostPaddleY = y;
        } else {
            guestPaddleY = y;
        }
    });

    // Topun durumunu al (Sadece Host'tan)
    pongSocket.off('pongBallUpdate').on('pongBallUpdate', ({ x, y, speedX, speedY }) => {
        if (!pongIsHost) {
            ballX = x;
            ballY = y;
            ballSpeedX = speedX;
            ballSpeedY = speedY;
        }
    });
    
    // Skor güncellemesi
    pongSocket.off('pongScore').on('pongScore', ({ score, scorerIsHost }) => {
        if (scorerIsHost) {
            hostScore = score;
        } else {
            guestScore = score;
        }
        updatePongScoreDisplay();
        
        if (hostScore >= MAX_SCORE || guestScore >= MAX_SCORE) {
            endPongGame();
        } else {
            resetBall(pongIsHost ? 1 : -1); 
        }
    });
    
    // Rakip ayrılma işleyicisi main.js'te tanımlı.
}
