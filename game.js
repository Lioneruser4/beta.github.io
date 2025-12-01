const socket = io('https://mario-io-1.onrender.com');

let currentUser = null;
let playerIndex = null;
let roomCode = null;
let gameState = {
    hand: [],
    board: [],
    currentPlayer: 0,
    opponentHandCount: 7,
    selectedDomino: null,
    validMoves: []
};

const canvas = document.getElementById('game-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

function resizeCanvas() {
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        if (gameState.board.length > 0) {
            drawGame();
        }
    }
}

window.addEventListener('resize', resizeCanvas);

function showNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.5s ease reverse';
        setTimeout(() => notification.remove(), 500);
    }, duration);
}

function initTelegramAuth() {
    const tg = window.Telegram.WebApp;
    tg.ready();

    const initData = tg.initDataUnsafe;

    if (initData && initData.user) {
        const telegramUser = initData.user;

        fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: telegramUser.id.toString(),
                username: telegramUser.username || telegramUser.first_name || 'Oyuncu'
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentUser = data.user;
                updateUserDisplay();
                showScreen('lobby-screen');
            } else {
                showNotification('Giriş başarısız!');
            }
        })
        .catch(error => {
            console.error('Auth error:', error);
            showNotification('Bağlantı hatası!');
        });
    } else {
        currentUser = {
            telegramId: 'demo_' + Date.now(),
            username: 'Demo Oyuncu',
            elo: 100,
            level: 1,
            wins: 0,
            losses: 0,
            totalGames: 0
        };
        updateUserDisplay();
        showScreen('lobby-screen');
        showNotification('Demo modunda oynuyorsunuz. Telegram üzerinden giriş yapın!');
    }
}

function updateUserDisplay() {
    if (!currentUser) return;

    document.getElementById('user-name').textContent = currentUser.username;
    document.getElementById('level-number').textContent = currentUser.level;
    document.getElementById('elo-points').textContent = currentUser.elo;

    const levelBadge = document.getElementById('level-badge');
    levelBadge.className = 'level-badge';
    levelBadge.classList.add(`level-${currentUser.level}`);

    const levelIcons = {
        1: '⭐', 2: '⭐', 3: '⭐',
        4: '🌟', 5: '🌟', 6: '🌟',
        7: '💎', 8: '💎', 9: '💎', 10: '👑'
    };

    levelBadge.querySelector('.level-icon').textContent = levelIcons[currentUser.level] || '⭐';
}

function showScreen(screenId) {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('leaderboard-screen').style.display = 'none';

    document.getElementById(screenId).style.display = 'block';
}

function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

document.getElementById('ranked-button').addEventListener('click', () => {
    if (!currentUser) return;

    socket.emit('join-ranked', {
        telegramId: currentUser.telegramId,
        username: currentUser.username,
        level: currentUser.level,
        elo: currentUser.elo
    });

    showModal('ranked-modal');
});

document.getElementById('cancel-search').addEventListener('click', () => {
    socket.emit('cancel-search');
    hideModal('ranked-modal');
});

document.getElementById('friend-button').addEventListener('click', () => {
    if (!currentUser) return;

    socket.emit('create-room', {
        telegramId: currentUser.telegramId,
        username: currentUser.username,
        level: currentUser.level,
        elo: currentUser.elo
    });
});

document.getElementById('join-button').addEventListener('click', () => {
    showModal('join-room-modal');
    document.getElementById('room-code-input').value = '';
});

document.getElementById('confirm-join-room').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim();

    if (code.length !== 4) {
        showNotification('Geçerli bir oda kodu girin!');
        return;
    }

    socket.emit('join-room', {
        roomCode: code,
        playerData: {
            telegramId: currentUser.telegramId,
            username: currentUser.username,
            level: currentUser.level,
            elo: currentUser.elo
        }
    });

    hideModal('join-room-modal');
});

document.getElementById('close-join-modal').addEventListener('click', () => {
    hideModal('join-room-modal');
});

document.getElementById('copy-room-code').addEventListener('click', () => {
    const code = document.getElementById('room-code-display').textContent;
    navigator.clipboard.writeText(code);
    showNotification('Oda kodu kopyalandı!');
});

document.getElementById('close-room-modal').addEventListener('click', () => {
    hideModal('create-room-modal');
});

document.getElementById('leaderboard-button').addEventListener('click', () => {
    loadLeaderboard();
});

document.getElementById('back-to-lobby').addEventListener('click', () => {
    showScreen('lobby-screen');
});

async function loadLeaderboard() {
    try {
        const response = await fetch('/api/leaderboard');
        const data = await response.json();

        if (data.success) {
            const leaderboardList = document.getElementById('leaderboard-list');
            leaderboardList.innerHTML = '';

            data.leaderboard.forEach((player, index) => {
                const item = document.createElement('div');
                item.className = 'leaderboard-item';

                if (index === 0) item.classList.add('top-1');
                else if (index === 1) item.classList.add('top-2');
                else if (index === 2) item.classList.add('top-3');

                const levelIcons = {
                    1: '⭐', 2: '⭐', 3: '⭐',
                    4: '🌟', 5: '🌟', 6: '🌟',
                    7: '💎', 8: '💎', 9: '💎', 10: '👑'
                };

                item.innerHTML = `
                    <div class="rank-number">${index + 1}</div>
                    <div class="player-info">
                        <div class="player-name">${player.username}</div>
                        <div class="player-stats">
                            <span>${levelIcons[player.level]} Seviye ${player.level}</span>
                            <span>•</span>
                            <span>${player.elo} ELO</span>
                            <span>•</span>
                            <span>${player.wins}G / ${player.losses}K</span>
                        </div>
                    </div>
                `;

                leaderboardList.appendChild(item);
            });

            if (currentUser && currentUser.telegramId.indexOf('demo_') === -1) {
                const rankResponse = await fetch(`/api/user-rank/${currentUser.telegramId}`);
                const rankData = await rankResponse.json();

                if (rankData.success && rankData.rank > 10) {
                    const currentRankDiv = document.getElementById('current-user-rank');
                    currentRankDiv.style.display = 'block';

                    const levelIcon = levelIcons[rankData.user.level];
                    document.getElementById('user-rank-display').innerHTML = `
                        <div class="leaderboard-item">
                            <div class="rank-number">${rankData.rank}</div>
                            <div class="player-info">
                                <div class="player-name">${rankData.user.username}</div>
                                <div class="player-stats">
                                    <span>${levelIcon} Seviye ${rankData.user.level}</span>
                                    <span>•</span>
                                    <span>${rankData.user.elo} ELO</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
            }

            showScreen('leaderboard-screen');
        }
    } catch (error) {
        console.error('Leaderboard error:', error);
        showNotification('Liderlik tablosu yüklenemedi!');
    }
}

socket.on('server-connected', (data) => {
    showNotification(data.message);
});

socket.on('searching', (data) => {
    showNotification(data.message);
});

socket.on('search-cancelled', () => {
    showNotification('Arama iptal edildi');
    hideModal('ranked-modal');
});

socket.on('room-created', (data) => {
    roomCode = data.roomCode;
    document.getElementById('room-code-display').textContent = data.roomCode;
    showModal('create-room-modal');
    showNotification('Oda oluşturuldu!');
});

socket.on('game-found', (data) => {
    hideModal('ranked-modal');
    hideModal('create-room-modal');

    roomCode = data.roomCode;
    playerIndex = data.playerIndex;
    gameState.hand = data.hand;
    gameState.board = [];
    gameState.currentPlayer = 0;
    gameState.opponentHandCount = 7;

    showNotification(`Rakip bulundu: ${data.opponent.username}`);
});

socket.on('opponent-joined', (data) => {
    hideModal('create-room-modal');

    gameState.hand = data.hand;
    gameState.board = [];
    gameState.currentPlayer = 0;
    gameState.opponentHandCount = 7;

    showNotification(`${data.opponent.username} oyuna katıldı!`);
});

socket.on('game-joined', (data) => {
    roomCode = data.roomCode;
    playerIndex = data.playerIndex;
    gameState.hand = data.hand;
    gameState.board = [];
    gameState.currentPlayer = 0;
    gameState.opponentHandCount = 7;

    showNotification(`Oyuna katıldınız! Rakip: ${data.opponent.username}`);
});

socket.on('game-start', (data) => {
    gameState.currentPlayer = data.currentPlayer;
    gameState.board = data.board;

    showScreen('game-screen');
    resizeCanvas();
    drawGame();

    showNotification('Oyun başladı!');
});

socket.on('domino-played', (data) => {
    gameState.board = data.board;
    gameState.currentPlayer = data.currentPlayer;
    gameState.opponentHandCount = data.opponentHandCount;
    gameState.selectedDomino = null;
    gameState.validMoves = [];

    drawGame();
});

socket.on('turn-passed', (data) => {
    gameState.currentPlayer = data.currentPlayer;
    showNotification('Sıra geçildi');
    drawGame();
});

socket.on('game-over', async (data) => {
    const message = data.won ?
        `Kazandınız! ${data.pointsChanged ? '+' + data.pointsChanged + ' ELO' : ''}` :
        `Kaybettiniz. ${data.pointsChanged ? '-' + data.pointsChanged + ' ELO' : ''}`;

    showNotification(message, 5000);

    if (data.pointsChanged && currentUser) {
        const response = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: currentUser.telegramId,
                username: currentUser.username
            })
        });

        const authData = await response.json();
        if (authData.success) {
            currentUser = authData.user;
            updateUserDisplay();
        }
    }

    setTimeout(() => {
        showScreen('lobby-screen');
    }, 3000);
});

socket.on('opponent-disconnected', async (data) => {
    showNotification(data.message, 5000);

    if (data.pointsGained && currentUser) {
        const response = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegramId: currentUser.telegramId,
                username: currentUser.username
            })
        });

        const authData = await response.json();
        if (authData.success) {
            currentUser = authData.user;
            updateUserDisplay();
        }
    }

    setTimeout(() => {
        showScreen('lobby-screen');
    }, 3000);
});

socket.on('error', (data) => {
    showNotification(data.message);
});

function drawGame() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const DOMINO_WIDTH = 60;
    const DOMINO_HEIGHT = 120;
    const SPACING = 10;
    const BOARD_Y = canvas.height / 2 - 100;
    const HAND_Y = canvas.height - 160;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0, BOARD_Y - 20, canvas.width, 240);

    if (gameState.board.length > 0) {
        let boardX = (canvas.width - (gameState.board.length * (DOMINO_WIDTH + SPACING))) / 2;

        gameState.board.forEach((item, index) => {
            drawDomino(ctx, item.domino, boardX, BOARD_Y, DOMINO_WIDTH, DOMINO_HEIGHT, false, false);
            boardX += DOMINO_WIDTH + SPACING;
        });
    } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Tahtaya taş koyarak oyuna başlayın', canvas.width / 2, BOARD_Y + 60);
    }

    const handWidth = gameState.hand.length * (DOMINO_WIDTH + SPACING);
    let handX = (canvas.width - handWidth) / 2;

    gameState.hand.forEach((domino, index) => {
        const isSelected = gameState.selectedDomino &&
            gameState.selectedDomino[0] === domino[0] &&
            gameState.selectedDomino[1] === domino[1];

        const canPlay = gameState.currentPlayer === playerIndex && canPlayDomino(domino);

        drawDomino(ctx, domino, handX, HAND_Y, DOMINO_WIDTH, DOMINO_HEIGHT, isSelected, canPlay);
        handX += DOMINO_WIDTH + SPACING;
    });

    ctx.fillStyle = gameState.currentPlayer === playerIndex ? '#00ff00' : '#ff0000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    const turnText = gameState.currentPlayer === playerIndex ? 'SİZİN SIRANIZ' : 'RAKIP OYNUYOR';
    ctx.fillText(turnText, 20, 40);

    ctx.fillStyle = '#ffffff';
    ctx.font = '18px Arial';
    ctx.fillText(`Elinizde: ${gameState.hand.length} taş`, 20, 70);
    ctx.fillText(`Rakipte: ${gameState.opponentHandCount} taş`, 20, 95);

    if (gameState.currentPlayer === playerIndex && gameState.hand.length > 0) {
        const hasValidMove = gameState.hand.some(domino => canPlayDomino(domino));
        if (!hasValidMove) {
            ctx.fillStyle = 'rgba(255, 100, 100, 0.9)';
            ctx.fillRect(canvas.width - 150, 20, 130, 40);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('PAS', canvas.width - 85, 45);
        }
    }
}

function drawDomino(ctx, domino, x, y, width, height, isSelected, canPlay) {
    ctx.save();

    if (isSelected) {
        y -= 20;
    }

    if (canPlay) {
        ctx.shadowColor = '#00ff00';
        ctx.shadowBlur = 20;
    }

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = canPlay ? '#00ff00' : '#333333';
    ctx.lineWidth = canPlay ? 4 : 2;

    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);

    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + height / 2);
    ctx.lineTo(x + width, y + height / 2);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    const dotRadius = 5;

    drawDots(ctx, domino[0], x + width / 2, y + height / 4, width * 0.35, dotRadius);
    drawDots(ctx, domino[1], x + width / 2, y + (height * 3) / 4, width * 0.35, dotRadius);

    ctx.restore();
}

function drawDots(ctx, number, centerX, centerY, size, radius) {
    const positions = [
        [],
        [[0, 0]],
        [[-1, -1], [1, 1]],
        [[-1, -1], [0, 0], [1, 1]],
        [[-1, -1], [1, -1], [-1, 1], [1, 1]],
        [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
        [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]]
    ];

    const dots = positions[number] || [];
    const spacing = size / 2.5;

    dots.forEach(([dx, dy]) => {
        ctx.beginPath();
        ctx.arc(centerX + dx * spacing, centerY + dy * spacing, radius, 0, Math.PI * 2);
        ctx.fill();
    });
}

function canPlayDomino(domino) {
    if (gameState.board.length === 0) {
        return true;
    }

    const leftEnd = gameState.board[0].domino;
    const rightEnd = gameState.board[gameState.board.length - 1].domino;

    const leftValue = gameState.board[0].position === 'left' ? leftEnd[0] : leftEnd[1];
    const rightValue = gameState.board[gameState.board.length - 1].position === 'right' ? rightEnd[1] : rightEnd[0];

    return domino.includes(leftValue) || domino.includes(rightValue);
}

if (canvas) {
    canvas.addEventListener('click', (e) => {
        if (gameState.currentPlayer !== playerIndex) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const DOMINO_WIDTH = 60;
        const DOMINO_HEIGHT = 120;
        const SPACING = 10;
        const HAND_Y = canvas.height - 160;

        const handWidth = gameState.hand.length * (DOMINO_WIDTH + SPACING);
        let handX = (canvas.width - handWidth) / 2;

        gameState.hand.forEach((domino, index) => {
            const dominoX = handX + index * (DOMINO_WIDTH + SPACING);

            if (x >= dominoX && x <= dominoX + DOMINO_WIDTH &&
                y >= HAND_Y && y <= HAND_Y + DOMINO_HEIGHT) {

                if (canPlayDomino(domino)) {
                    gameState.selectedDomino = domino;

                    const position = gameState.board.length === 0 ? 'left' :
                        (x < canvas.width / 2 ? 'left' : 'right');

                    socket.emit('play-domino', {
                        roomCode: roomCode,
                        domino: domino,
                        position: position,
                        playerIndex: playerIndex
                    });
                } else {
                    showNotification('Bu taş oynanamaz!');
                }
            }
        });

        if (x >= canvas.width - 150 && x <= canvas.width - 20 &&
            y >= 20 && y <= 60) {

            const hasValidMove = gameState.hand.some(d => canPlayDomino(d));
            if (!hasValidMove) {
                socket.emit('pass-turn', {
                    roomCode: roomCode,
                    playerIndex: playerIndex
                });
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTelegramAuth();
});
