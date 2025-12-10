/***********************************************************************
 *  game.js – Domino 101 Pro (Client)
 *  ---------------------------------------------------------------
 *  Yeni özellikler:
 *   • Otomatik reconnect (30 s timeout, max 5 deneme)
 *   • Match‑found lobisi – 3 s, Telegram username/level/ELO + foto
 *   • Post‑game lobisi – 4 s, kazanan/kaybeden, ELO değişimi gösterir
 *   • İlk hamlede pazardan çekme engeli, misafir‑ranked kısıtlaması
 *   • Bağlantı koptuğunda opponent‑disconnect mesajı ve timeout
 ***********************************************************************/

let socket = null;
const RECONNECT_MAX   = 5;
const RECONNECT_BASE  = 3000;                // 3 s temel gecikme

/* -------------------------- GLOBAL STATE -------------------------- */
const gameState = {
    board: [],                // masa üzerindeki taşlar
    currentPlayer: null,     // sunucudaki currentPlayer ID
    playerId: null,           // bu client’ın ID’si
    roomCode: null,
    isMyTurn: false,
    isGuest: true,
    gameStarted: false,
    isSearching: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    // UI‑state
    playerInfo: null,        // {username, elo, level, photoUrl, telegramId}
    opponentInfo: null,      // aynı yapı
    // oyuncu/rekabet istatistikleri
    playerStats: { elo:0, wins:0, losses:0, draws:0 },
    opponentStats: { username:'', elo:0 }
};

/* -------------------------- UI ELEMENTS -------------------------- */
const connectionStatus = document.getElementById('connection-status');
const statusMessage    = document.getElementById('status-message');

const mainLobby       = document.getElementById('main-lobby');
const rankedLobby     = document.getElementById('ranked-lobby');
const friendLobby     = document.getElementById('friend-lobby');
const gameScreen      = document.getElementById('game-screen');
const matchFoundLobby = document.getElementById('match-found-lobby');
const postGameLobby   = document.getElementById('post-game-lobby');

const dereceliBtn   = document.getElementById('dereceli-btn');
const friendBtn     = document.getElementById('friend-btn');
const cancelSearchBtn = document.getElementById('cancel-search-btn');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn   = document.getElementById('join-room-btn');
const copyCodeBtn   = document.getElementById('copy-code-btn');
const leaveGameBtn  = document.getElementById('leave-game-btn');

const matchPlayer1Photo = document.getElementById('match-player1-photo');
const matchPlayer1Name  = document.getElementById('match-player1-name');
const matchPlayer1Elo   = document.getElementById('match-player1-elo');
const matchPlayer2Photo = document.getElementById('match-player2-photo');
const matchPlayer2Name  = document.getElementById('match-player2-name');
const matchPlayer2Elo   = document.getElementById('match-player2-elo');
const matchTimer        = document.getElementById('match-timer');

const gameResultTitle    = document.getElementById('game-result-title');
const gameResultMessage  = document.getElementById('game-result-message');
const eloChangeDisplay   = document.getElementById('elo-change');
const finalScorePlayerName   = document.getElementById('final-score-player-name');
const finalScorePlayerPoints = document.getElementById('final-score-player-points');
const finalScoreOppName      = document.getElementById('final-score-opponent-name');
const finalScoreOppPoints    = document.getElementById('final-score-opponent-points');

/* -------------------------- UTILITIES -------------------------- */
function logStatus(msg, type = 'info'){
    console.log(msg);
    if (statusMessage){
        statusMessage.textContent = msg;
        const base = 'fixed bottom-4 right-4 px-6 py-2 rounded-full text-white font-medium text-sm animate-slide-up';
        const cls = type === 'error' ? 'bg-red-600' :
                    type === 'success' ? 'bg-green-600' : 'bg-blue-600';
        statusMessage.className = `${base} ${cls}`;
        setTimeout(()=> statusMessage.className = 'hidden', 3000);
    }
}

/* -------------------------- SOCKET HELPERS -------------------------- */
function send(payload){
    if (!socket || socket.readyState !== WebSocket.OPEN){
        logStatus('WebSocket kapalı – mesaj gönderilemedi', 'error');
        return;
    }
    // otomatik olarak roomCode & playerId ekle
    if (gameState.roomCode) payload.roomCode = gameState.roomCode;
    if (gameState.playerId) payload.playerId = gameState.playerId;
    socket.send(JSON.stringify(payload));
}

/* -------------------------- RECONNECT LOGIC -------------------------- */
function attemptReconnect(){
    if (gameState.reconnectAttempts >= RECONNECT_MAX){
        logStatus('Bağlantı kurulamadı – sayfayı yenileyin.', 'error');
        return;
    }
    const delay = RECONNECT_BASE * Math.pow(1.5, gameState.reconnectAttempts);
    gameState.reconnectAttempts += 1;
    logStatus(`🔁 Yeniden bağlanıyor… (${gameState.reconnectAttempts}/${RECONNECT_MAX})`, 'info');
    gameState.reconnectTimer = setTimeout(connectWebSocket, delay);
}

/* -------------------------- WEBSOCKET CONNECTION -------------------------- */
function connectWebSocket(){
    const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host  = window.location.hostname === 'localhost' ? `${window.location.hostname}:10000` : window.location.host;
    const url   = `${proto}${host}`;
    socket = new WebSocket(url);

    socket.onopen = () => {
        connectionStatus.textContent = '✅ Sunucuya bağlandınız';
        connectionStatus.className = 'text-green-500';
        logStatus('WebSocket bağlantısı kuruldu', 'success');
        gameState.reconnectAttempts = 0;

        // Otomatik reconnect isteği (kaldığım odada devam et)
        if (gameState.roomCode && gameState.playerId){
            send({type:'reconnectToGame'});   // server‑da handleReconnect tetiklenir
            logStatus('🔁 Yeniden bağlanma isteği gönderildi', 'info');
        }
    };

    socket.onclose = (ev) => {
        connectionStatus.textContent = '⚠️ Bağlantı koptu';
        connectionStatus.className = 'text-red-500';
        logStatus('WebSocket bağlantısı kayboldu', 'error');
        if (!gameState.reconnectTimer) attemptReconnect();
    };

    socket.onerror = (err) => {
        console.error('WebSocket error:', err);
        logStatus('WebSocket hatası', 'error');
    };

    socket.onmessage = (ev) => {
        try{
            const data = JSON.parse(ev.data);
            handleServerMessage(data);
        }catch(e){
            console.error('Message parse error:', e);
        }
    };
}

/* -------------------------- SERVER MESSAGE HANDLER -------------------------- */
function handleServerMessage(msg){
    console.log('⬅️ Sunucu mesajı:', msg.type, msg);
    switch(msg.type){
        case 'connected':
            // ilk bağlantı
            if (!msg.isReconnect){
                localStorage.removeItem('domino_roomCode');
                localStorage.removeItem('domino_playerId');
            }
            break;

        case 'matchFound':
            // data: {roomCode, opponent:{username, elo, level, photoUrl, isGuest}}
            gameState.roomCode = msg.roomCode;
            gameState.opponentInfo = {
                username: msg.opponent.username,
                elo:      msg.opponent.elo,
                level:    msg.opponent.level,
                photoUrl: msg.opponent.photoUrl,
                isGuest:  msg.opponent.isGuest
            };
            // 3 s lobiyi göster
            showScreen('matchFound');
            matchPlayer1Name.textContent = gameState.playerInfo?.username || 'Siz';
            matchPlayer1Elo.textContent  = `ELO: ${gameState.playerInfo?.elo || 0} (Lv.${gameState.playerInfo?.level || 1})`;
            matchPlayer1Photo.src = gameState.playerInfo?.photoUrl || 'https://via.placeholder.com/120';

            matchPlayer2Name.textContent = gameState.opponentInfo.username;
            matchPlayer2Elo.textContent  = `ELO: ${gameState.opponentInfo.elo} (Lv.${gameState.opponentInfo.level})`;
            matchPlayer2Photo.src = gameState.opponentInfo.photoUrl || 'https://via.placeholder.com/120';

            // 3 s geri sayım
            let secs = 3;
            matchTimer.textContent = `${secs} saniye içinde oyun başlayacak...`;
            const int = setInterval(()=>{
                secs--;
                if (secs<=0){
                    clearInterval(int);
                }else{
                    matchTimer.textContent = `${secs} saniye içinde oyun başlayacak...`;
                }
            },1000);
            break;

        case 'gameStart':
            gameState.gameStarted = true;
            gameState.playerId    = msg.playerId;
            gameState.board      = msg.gameState.board;
            gameState.currentPlayer = msg.gameState.currentPlayer;
            gameState.isMyTurn   = (gameState.currentPlayer===gameState.playerId);
            // localStorage’da sakla (yeniden bağlanma için)
            localStorage.setItem('domino_roomCode', gameState.roomCode);
            localStorage.setItem('domino_playerId', gameState.playerId);
            showScreen('game');
            renderGame();
            break;

        case 'gameUpdate':
            gameState.board = msg.gameState.board;
            gameState.currentPlayer = msg.gameState.currentPlayer;
            gameState.isMyTurn = (gameState.currentPlayer===gameState.playerId);
            renderGame();
            break;

        case 'gameEnd':
            // data: {winner, winnerName, isRanked, eloChanges:{winner, loser}, isDraw}
            const isWinner = (msg.winner===gameState.playerId);
            const isDraw   = msg.winner==='DRAW';
            const eloDiff  = msg.eloChanges ? (isWinner?msg.eloChanges.winner:msg.eloChanges.loser) : 0;

            if (isDraw){
                gameResultTitle.textContent   = '⚖️ BERABERE';
                gameResultMessage.textContent = 'Oyun berabere bitti.';
                eloChangeDisplay.textContent  = `±${Math.abs(eloDiff)} Puan`;
                eloChangeDisplay.className = 'text-gray-400';
            }else if (isWinner){
                gameResultTitle.textContent   = '🎉 KAZANDIN!';
                gameResultMessage.textContent = `${msg.winnerName} kazandı!`;
                eloChangeDisplay.textContent  = `+${eloDiff} Puan`;
                eloChangeDisplay.className = 'text-green-400';
                gameState.playerStats.elo += eloDiff;
                gameState.playerStats.wins++;
            }else{
                gameResultTitle.textContent   = '😢 MAĞLUB';
                gameResultMessage.textContent = `${msg.winnerName} kazandı.`;
                eloChangeDisplay.textContent  = `${eloDiff<0?''+eloDiff:eloDiff} Puan`;
                eloChangeDisplay.className = 'text-red-400';
                gameState.playerStats.elo += eloDiff; // negatif de olur
                gameState.playerStats.losses++;
            }

            finalScorePlayerName.textContent   = gameState.playerInfo?.username || 'Siz';
            finalScoreOpponentName.textContent  = gameState.opponentInfo?.username || 'Rakip';
            finalScorePlayerPoints.textContent   = isWinner ? 'Galibiyet' : (isDraw?'Beraberlik':'Mağlubiyet');
            finalScoreOppPoints.textContent      = isWinner ? 'Mağlubiyet' : (isDraw?'Beraberlik':'Galibiyet');

            showScreen('postGame');

            // 4 s sonra lobiye dön ve state'i sıfırla
            setTimeout(()=>{
                if (postGameLobby.classList.contains('hidden')===false){
                    resetGameState();
                    showScreen('main');
                }
            },4000);
            break;

        case 'searchStatus':
            document.getElementById('ranked-status').textContent = msg.message;
            break;

        case 'searchCancelled':
            logStatus('Arama iptal edildi', 'info');
            gameState.isSearching = false;
            showScreen('main');
            break;

        case 'error':
            logStatus(msg.message||'Sunucu hatası', 'error');
            gameState.isSearching = false;
            showScreen('main');
            break;

        case 'opponentDisconnected':
            logStatus(msg.message, 'warning');
            break;

        case 'opponentReconnected':
            logStatus(msg.message, 'info');
            break;

        default:
            console.warn('Bilinmeyen mesaj:',msg.type);
    }
}

/* -------------------------- UI NAVIGATION -------------------------- */
function showScreen(screen){
    // tüm ekranları gizle
    mainLobby.style.display   = 'none';
    rankedLobby.style.display = 'none';
    friendLobby.style.display = 'none';
    gameScreen.style.display  = 'none';
    matchFoundLobby.style.display = 'none';
    postGameLobby.style.display   = 'none';

    // isteneni göster
    switch(screen){
        case 'main':      mainLobby.style.display   = 'block'; break;
        case 'ranked':   rankedLobby.style.display = 'block'; break;
        case 'friend':   friendLobby.style.display = 'block'; break;
        case 'game':     gameScreen.style.display  = 'block'; break;
        case 'matchFound': matchFoundLobby.style.display = 'block'; break;
        case 'postGame': postGameLobby.style.display   = 'block'; break;
        default: mainLobby.style.display = 'block';
    }
}

/* -------------------------- GAME RENDER -------------------------- */
function renderGame(){
    // boardı console’da göster (gerçek UI burada eklenebilir)
    console.log('🧩 Board:', gameState.board);
    const turnInfo = document.getElementById('turn-info');
    if (turnInfo){
        turnInfo.textContent = gameState.isMyTurn ?
            'Sıra sizde' :
            `${gameState.opponentInfo?.username || 'Rakip'} oynuyor`;
    }
}

/* -------------------------- ACTIONS -------------------------- */
function startRankedSearch(){
    if (gameState.isSearching) return;
    gameState.isSearching = true;
    gameState.isGuest = false;
    const payload = {
        type:'findMatch',
        telegramId: gameState.playerInfo?.telegramId,
        username:   gameState.playerInfo?.username,
        elo:        gameState.playerInfo?.elo,
        level:      gameState.playerInfo?.level,
        isGuest:false,
        gameType:'ranked'
    };
    send(payload);
    showScreen('ranked');
}

function startCasualSearch(){
    if (gameState.isSearching) return;
    gameState.isSearching = true;
    gameState.isGuest = true;
    const payload = {
        type:'findMatch',
        isGuest:true,
        gameType:'casual',
        username: `Guest_${Math.floor(Math.random()*1000)}`
    };
    send(payload);
    showScreen('ranked'); // 'friend' yerine 'ranked' (arama ekranı)
    document.getElementById('ranked-status').textContent = 'Rakip Aranıyor...';
}

function createPrivateRoom(){
    const code = Math.random().toString(36).substr(2,4).toUpperCase();
    gameState.roomCode = code;
    send({type:'createRoom', roomCode:code, playerName:gameState.playerInfo?.username||'Guest'});
    showScreen('friend');
}

function joinPrivateRoom(code){
    gameState.roomCode = code;
    send({type:'joinRoom', roomCode:code, playerName:gameState.playerInfo?.username||'Guest'});
    showScreen('friend');
}

/* -------------------------- UI LISTENERS -------------------------- */
if (dereceliBtn)  dereceliBtn.onclick  = startRankedSearch;
if (friendBtn)    friendBtn.onclick    = startCasualSearch;
if (createRoomBtn)createRoomBtn.onclick = createPrivateRoom;
if (joinRoomBtn)  joinRoomBtn.onclick  = ()=> {
    const code = document.getElementById('join-room-input').value.trim().toUpperCase();
    if (code.length===4) joinPrivateRoom(code);
    else logStatus('Geçerli oda kodu (4 harf) girin', 'error');
};
if (leaveGameBtn) leaveGameBtn.onclick = leaveGame;
if (cancelSearchBtn) cancelSearchBtn.onclick = ()=> {
    if (gameState.isSearching){
        send({type:'cancelSearch'});
        gameState.isSearching = false;
        showScreen('main');
    }
};

/* -------------------------- LEAVE GAME -------------------------- */
function leaveGame(){
    if (gameState.roomCode){
        send({type:'leaveGame'});
    }
    resetGameState();
    showScreen('main');
}

/* -------------------------- RESET STATE -------------------------- */
function resetGameState(){
    const playerInfoBackup = gameState.playerInfo; // username vs. telegram id korunur
    Object.keys(gameState).forEach(k=>{
        if (['reconnectAttempts','reconnectTimer','playerInfo'].includes(k)) return;
        gameState[k] = null;
    });
    gameState.board = [];
    gameState.isMyTurn = false;
    gameState.gameStarted = false;
    gameState.isSearching = false;
    gameState.playerInfo = playerInfoBackup;
    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');
}

/* -------------------------- INITIALIZE -------------------------- */
document.addEventListener('DOMContentLoaded', ()=>{
    connectionStatus.textContent = 'Sunucuya bağlanıyor...';
    connectionStatus.className = 'text-yellow-400 animate-pulse';
    connectWebSocket();
});
