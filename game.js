const SERVER_URL = 'wss://mario-io-1.onrender.com';

let ws = null;
let telegramId = null;
let playerName = '';
let playerData = null;
let gameState = null;
let selectedDomino = null;
let validMoves = [];
let gameMode = null;
let currentRoomCode = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
    const tg = window.Telegram?.WebApp;
    if (tg) {
        tg.ready();
        const user = tg.initDataUnsafe?.user;
        if (user) {
            telegramId = user.id;
            playerName = user.first_name || 'Oyuncu';
        } else {
            telegramId = Math.floor(Math.random() * 1000000);
            playerName = 'Test' + telegramId;
        }
    } else {
        telegramId = Math.floor(Math.random() * 1000000);
        playerName = 'Test' + telegramId;
    }

    connectWebSocket();
    setupEventListeners();
}

function connectWebSocket() {
    ws = new WebSocket(SERVER_URL);

    ws.onopen = () => {
        console.log('✅ Sunucuya bağlandı');
        updateConnectionStatus(true);
        sendMessage({ type: 'register', telegramId, name: playerName });
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onerror = (error) => {
        console.error('❌ WebSocket hatası:', error);
        updateConnectionStatus(false);
    };

    ws.onclose = () => {
        console.log('❌ Bağlantı kesildi');
        updateConnectionStatus(false);
        setTimeout(() => location.reload(), 3000);
    };
}

function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function handleMessage(data) {
    console.log('📨 Mesaj:', data);

    switch (data.type) {
        case 'playerData':
            playerData = data.data;
            renderPlayerCard();
            break;
        case 'matchFound':
            gameState = data.game;
            gameMode = 'ranked';
            showScreen('game');
            renderGame();
            break;
        case 'roomCreated':
            currentRoomCode = data.roomCode;
            renderRoomCode(data.roomCode);
            break;
        case 'roomJoined':
            gameState = data.game;
            gameMode = 'friendly';
            showScreen('game');
            renderGame();
            break;
        case 'gameUpdate':
            gameState = data.game;
            renderGame();
            break;
        case 'gameEnd':
            gameState = data.game;
            if (data.playerData) playerData = data.playerData;
            renderGameOver(data);
            break;
        case 'leaderboard':
            renderLeaderboard(data.data);
            break;
        case 'validMoves':
            validMoves = data.moves;
            renderGame();
            break;
    }
}

function setupEventListeners() {
    document.getElementById('btn-ranked').addEventListener('click', () => {
        sendMessage({ type: 'searchRanked' });
        document.getElementById('btn-ranked').classList.add('hidden');
        document.getElementById('btn-cancel-search').classList.remove('hidden');
    });

    document.getElementById('btn-cancel-search').addEventListener('click', () => {
        sendMessage({ type: 'cancelSearch' });
        document.getElementById('btn-ranked').classList.remove('hidden');
        document.getElementById('btn-cancel-search').classList.add('hidden');
    });

    document.getElementById('btn-create-room').addEventListener('click', () => {
        sendMessage({ type: 'createRoom' });
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
        const code = document.getElementById('room-code-input').value;
        if (code.length === 4) {
            sendMessage({ type: 'joinRoom', roomCode: code });
        }
    });

    document.getElementById('room-code-input').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^0-9]/g, '');
        document.getElementById('btn-join-room').disabled = e.target.value.length !== 4;
    });

    document.getElementById('btn-leaderboard').addEventListener('click', () => {
        sendMessage({ type: 'getLeaderboard' });
        showScreen('leaderboard');
    });
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('connection-text');
    const btnRanked = document.getElementById('btn-ranked');
    const btnCreateRoom = document.getElementById('btn-create-room');

    if (connected) {
        dot.classList.add('connected');
        dot.classList.remove('disconnected');
        text.textContent = 'Sunucuya Bağlı';
        btnRanked.disabled = false;
        btnCreateRoom.disabled = false;
    } else {
        dot.classList.add('disconnected');
        dot.classList.remove('connected');
        text.textContent = 'Bağlantı Kesildi';
        btnRanked.disabled = true;
        btnCreateRoom.disabled = true;
    }
}

function showScreen(screen) {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('leaderboard-screen').classList.add('hidden');

    if (screen === 'menu') {
        document.getElementById('menu-screen').classList.remove('hidden');
    } else if (screen === 'game') {
        document.getElementById('game-screen').classList.remove('hidden');
    } else if (screen === 'leaderboard') {
        document.getElementById('leaderboard-screen').classList.remove('hidden');
    }
}

function getLevelIcon(level) {
    if (level >= 7) return '💎';
    if (level >= 4) return '⭐';
    return '🔰';
}

function getLevelColor(level) {
    if (level >= 7) return 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)';
    if (level >= 4) return 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)';
    return 'linear-gradient(135deg, #fbbf24 0%, #f97316 100%)';
}

function renderPlayerCard() {
    if (!playerData) return;

    const card = document.getElementById('player-card');
    card.classList.remove('hidden');

    const progress = (playerData.points % 100);
    const nextLevel = 100 - progress;

    card.innerHTML = `
        <div class="player-info">
            <div class="level-icon" style="background: ${getLevelColor(playerData.level)}; padding: 10px; border-radius: 15px;">
                ${getLevelIcon(playerData.level)}
            </div>
            <div class="player-stats">
                <div class="player-name">${playerName}</div>
                <div class="player-level">Seviye ${playerData.level} • ${playerData.elo} ELO</div>
            </div>
            <div class="player-points">
                <div style="font-size: 12px; opacity: 0.8;">Puan</div>
                <div class="points-value">${playerData.points}</div>
            </div>
        </div>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div style="text-align: center; font-size: 12px; margin-top: 8px; opacity: 0.9;">
            Bir sonraki seviyeye ${nextLevel} puan
        </div>
    `;
}

function renderRoomCode(code) {
    const display = document.getElementById('room-code-display');
    display.classList.remove('hidden');
    display.innerHTML = `
        <div class="room-code-display">
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">Oda Kodu:</div>
            <div class="room-code">${code}</div>
            <button onclick="copyRoomCode('${code}')" class="btn btn-friend" style="margin: 0;">
                📋 Kodu Kopyala
            </button>
        </div>
    `;
}

function copyRoomCode(code) {
    navigator.clipboard.writeText(code);
    alert('Oda kodu kopyalandı: ' + code);
}

function renderGame() {
    if (!gameState) return;

    const isMyTurn = gameState.currentPlayer === telegramId;
    const myPlayer = gameState.players.find(p => p.id === telegramId);
    const opponent = gameState.players.find(p => p.id !== telegramId);

    const gameScreen = document.getElementById('game-screen');
    gameScreen.innerHTML = `
        <div class="game-container">
            <div class="players-row">
                <div class="player-box opponent ${!isMyTurn ? 'active' : ''}">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="font-size: 30px; background: ${getLevelColor(opponent?.level || 1)}; padding: 5px; border-radius: 10px;">
                            ${getLevelIcon(opponent?.level || 1)}
                        </div>
                        <div>
                            <div style="font-size: 18px; font-weight: bold;">${opponent?.name || 'Rakip'}</div>
                            <div style="font-size: 12px; opacity: 0.9;">Seviye ${opponent?.level || 1} • ${opponent?.hand?.length || 0} Taş</div>
                        </div>
                    </div>
                </div>

                <div class="player-box you ${isMyTurn ? 'active' : ''}">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="font-size: 30px; background: ${getLevelColor(myPlayer?.level || 1)}; padding: 5px; border-radius: 10px;">
                            ${getLevelIcon(myPlayer?.level || 1)}
                        </div>
                        <div>
                            <div style="font-size: 18px; font-weight: bold;">${playerName}</div>
                            <div style="font-size: 12px; opacity: 0.9;">Seviye ${myPlayer?.level || 1} • ${myPlayer?.hand?.length || 0} Taş</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="board">
                <div class="board-tiles">
                    ${gameState.board.length === 0 ? 
                        '<div style="color: white; font-size: 24px; font-weight: bold;">İlk taşı yerleştirin...</div>' :
                        gameState.board.map(domino => `
                            <div class="domino" style="pointer-events: none;">
                                <div class="domino-value">${domino[0]}</div>
                                <div class="domino-divider"></div>
                                <div class="domino-value">${domino[1]}</div>
                            </div>
                        `).join('')
                    }
                </div>
            </div>

            ${validMoves.length > 0 ? `
                <div class="actions">
                    ${validMoves.includes('left') ? `
                        <button onclick="playDomino('left')" class="btn-action btn-left">← Sol Tarafa</button>
                    ` : ''}
                    ${validMoves.includes('right') ? `
                        <button onclick="playDomino('right')" class="btn-action btn-right">Sağ Tarafa →</button>
                    ` : ''}
                </div>
            ` : ''}

            <div class="hand">
                <div class="hand-title">${isMyTurn ? '🎯 Sıra Sizde!' : '⏳ Rakip Oynuyor...'}</div>
                <div class="hand-tiles">
                    ${myPlayer?.hand?.map((domino, idx) => `
                        <div class="domino ${!isMyTurn ? 'disabled' : ''} ${selectedDomino && selectedDomino[0] === domino[0] && selectedDomino[1] === domino[1] ? 'selected' : ''}" 
                             onclick="${isMyTurn ? `selectDomino(${JSON.stringify(domino)})` : ''}">
                            <div class="domino-value">${domino[0]}</div>
                            <div class="domino-divider"></div>
                            <div class="domino-value">${domino[1]}</div>
                        </div>
                    `).join('') || ''}
                </div>
                ${isMyTurn ? `
                    <div style="text-align: center; margin-top: 15px;">
                        <button onclick="drawDomino()" class="btn-action btn-draw">🎲 Taş Çek</button>
                    </div>
                ` : ''}
            </div>

            <button onclick="backToMenu()" class="btn btn-cancel" style="margin-top: 20px;">← Menüye Dön</button>
        </div>
    `;
}

function selectDomino(domino) {
    selectedDomino = domino;
    sendMessage({ type: 'getValidMoves', domino });
}

function playDomino(side) {
    if (selectedDomino) {
        sendMessage({ type: 'playDomino', domino: selectedDomino, side });
        selectedDomino = null;
        validMoves = [];
    }
}

function drawDomino() {
    sendMessage({ type: 'drawDomino' });
}

function backToMenu() {
    selectedDomino = null;
    validMoves = [];
    gameState = null;
    showScreen('menu');
}

function renderGameOver(data) {
    const isWinner = data.game.winner === telegramId;
    const gameOverDiv = document.getElementById('game-over');
    
    gameOverDiv.classList.remove('hidden');
    gameOverDiv.innerHTML = `
        <div class="game-over-content">
            <div class="game-over-icon">${isWinner ? '🎉' : '😢'}</div>
            <div class="game-over-title">${isWinner ? 'KAZANDINIZ!' : 'KAYBETTİNİZ!'}</div>
            ${gameMode === 'ranked' && data.eloChange ? `
                <div class="elo-change">
                    <div class="elo-value">${data.eloChange > 0 ? '+' : ''}${data.eloChange} ELO</div>
                    <div style="color: white; font-size: 14px; margin-top: 10px;">
                        Yeni ELO: ${data.playerData?.elo || 0}
                    </div>
                </div>
            ` : ''}
            <p style="font-size: 18px; margin-top: 20px;">Menüye dönülüyor...</p>
        </div>
    `;

    setTimeout(() => {
        gameOverDiv.classList.add('hidden');
        backToMenu();
        renderPlayerCard();
    }, 5000);
}

function renderLeaderboard(data) {
    showScreen('leaderboard');
    const screen = document.getElementById('leaderboard-screen');

    const top3 = data.slice(0, 3);
    const rest = data.slice(3, 10);
    const myRank = data.findIndex(p => p.telegramId === telegramId);

    screen.innerHTML = `
        <div class="leaderboard-container">
            <button onclick="showScreen('menu')" class="btn btn-cancel" style="margin-bottom: 20px;">← Geri Dön</button>
            
            <h1 class="title">🏆 SKOR TABLOSU 🏆</h1>

            <div class="top-three">
                ${top3.map((player, idx) => {
                    const rank = idx + 1;
                    const icons = ['👑', '🥈', '🥉'];
                    const classes = ['first', 'second', 'third'];
                    return `
                        <div class="podium ${classes[idx]}">
                            <div class="podium-icon">${icons[idx]}</div>
                            <div class="podium-rank">#${rank}</div>
                            <div style="font-size: 36px; margin: 10px 0;">${getLevelIcon(player.level)}</div>
                            <div style="font-size: 20px; font-weight: bold; margin-bottom: 5px;">${player.name}</div>
                            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 10px;">Seviye ${player.level}</div>
                            <div style="font-size: 24px; font-weight: bold;">${player.elo} ELO</div>
                            <div style="font-size: 12px; opacity: 0.9;">${player.points} Puan</div>
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="leaderboard-list">
                ${rest.map((player, idx) => `
                    <div class="leaderboard-item">
                        <div class="leaderboard-left">
                            <div class="rank-number">#${idx + 4}</div>
                            <div style="font-size: 28px; background: ${getLevelColor(player.level)}; padding: 8px; border-radius: 10px;">
                                ${getLevelIcon(player.level)}
                            </div>
                            <div>
                                <div style="font-size: 16px; font-weight: bold; color: #1f2937;">${player.name}</div>
                                <div style="font-size: 12px; color: #6b7280;">Seviye ${player.level}</div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 18px; font-weight: bold; color: #f59e0b;">${player.elo} ELO</div>
                            <div style="font-size: 12px; color: #6b7280;">${player.points} Puan</div>
                        </div>
                    </div>
                `).join('')}
            </div>

            ${myRank >= 10 ? `
                <div style="background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%); border-radius: 15px; padding: 20px; margin-top: 20px; color: white;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="font-size: 20px; font-weight: bold; color: #fbbf24;">#${myRank + 1}</div>
                            <div style="font-size: 28px; background: ${getLevelColor(playerData?.level || 1)}; padding: 8px; border-radius: 10px;">
                                ${getLevelIcon(playerData?.level || 1)}
                            </div>
                            <div>
                                <div style="font-size: 16px; font-weight: bold;">${playerName}</div>
                                <div style="font-size: 12px; opacity: 0.9;">Seviye ${playerData?.level || 1}</div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 18px; font-weight: bold; color: #fbbf24;">${playerData?.elo || 0} ELO</div>
                            <div style="font-size: 12px; opacity: 0.9;">${playerData?.points || 0} Puan</div>
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

setTimeout(() => {
    if (document.getElementById('loading-screen').classList.contains('hidden') === false) {
        showScreen('menu');
    }
}, 1000);
