/***********************************************************************
 *  game.js – Domino 101 Pro (Client)
 *  ---------------------------------------------------------------
 *  Özellikler:
 *   • WebSocket‑reconnect (max 5 deneme, exponential back‑off)
 *   • Oyun durumu (roomCode, playerId) localStorage’da saklanır,
 *     böylece sayfa yenilense bile aynı oyuna geri dönülür.
 *   • Server‑dan gelen `matchFound` mesajı → 3 s “eşleşme lobisi”
 *     (rakibin Telegram username, ELO, level gösterilir).
 *   • Server‑dan gelen `gameEnd` mesajı → 4 s “sonuç lobisi”
 *     (kazanan/kaybeden, ELO değişimi, skor detayları).
 *   • `leaveGame` butonu otomatik olarak `leaveGame` mesajı gönderir,
 *     localStorage temizler ve lobby‑a döner.
 *   • UI‑yöneten `showScreen()` fonksiyonu ile
 *     `main‑lobby`, `ranked‑lobby`, `friend‑lobby`,
 *     `game‑screen`, `match‑found‑lobby`, `post‑game‑lobby`
 *     gibi ekranlar arasında geçiş yapılır.
 ***********************************************************************/

let socket = null;                               // WebSocket nesnesi
const RECONNECT_MAX   = 5;                       // max tekrar
const RECONNECT_BASE  = 3000;                    // 3 s temel gecikme

/* -------------------------- GLOBAL STATE -------------------------- */
const gameState = {
  // oyun verileri
  board: [],               // masa üzerindeki taşlar
  currentPlayer: null,     // sunucudaki currentPlayer ID
  playerId: null,          // bu client’ın ID’si
  roomCode: null,
  isMyTurn: false,
  isGuest: true,
  gameStarted: false,

  // UI / kontrol
  isSearching: false,
  reconnectAttempts: 0,
  reconnectTimer: null,

  // oyuncu / rakip bilgileri
  playerInfo: null,    // {username, elo, level, photoUrl, telegramId}
  opponentInfo: null,   // aynı yapı
};

/* -------------------------- UI ELEMENTS -------------------------- */
const connectionStatus   = document.getElementById('connection-status');
const statusMessage     = document.getElementById('status-message');

const mainLobby          = document.getElementById('main-lobby');
const rankedLobby        = document.getElementById('ranked-lobby');
const friendLobby        = document.getElementById('friend-lobby');
const gameScreen         = document.getElementById('game-screen');
const matchFoundLobby    = document.getElementById('match-found-lobby');
const postGameLobby      = document.getElementById('post-game-lobby');

/* match‑found‑lobby elemanları */
const matchPlayer1Name = document.getElementById('match-player1-name');
const matchPlayer1Elo  = document.getElementById('match-player1-elo');
const matchPlayer2Name = document.getElementById('match-player2-name');
const matchPlayer2Elo  = document.getElementById('match-player2-elo');
const matchTimer       = document.getElementById('match-timer');

/* post‑game‑lobby elemanları */
const gameResultTitle   = document.getElementById('game-result-title');
const gameResultMessage = document.getElementById('game-result-message');
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
    logStatus('WebSocket bağlantısı yok – mesaj gönderilemedi', 'error');
    return;
  }
  // client‑side’da roomCode / playerId otomatik eklenir
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
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const host = window.location.hostname === 'localhost' ? `${window.location.hostname}:10000` : window.location.host;
  const url = `${protocol}${host}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    connectionStatus.textContent = '✅ Sunucuya bağlandınız';
    connectionStatus.className = 'text-green-500';
    logStatus('WebSocket bağlantısı kuruldu', 'success');
    gameState.reconnectAttempts = 0;

    // Eğer localStorage’da devam eden bir oyun varsa “reconnect” isteği gönder
    const savedRoom   = localStorage.getItem('domino_roomCode');
    const savedPlayer = localStorage.getItem('domino_playerId');
    if (savedRoom && savedPlayer){
      gameState.roomCode = savedRoom;
      gameState.playerId = savedPlayer;
      send({type:'reconnect'});   // server‑a yeniden bağlanma bildirimi
      logStatus('🔁 Yeniden bağlanma isteği gönderildi', 'info');
    }
  };

  socket.onclose = ev => {
    connectionStatus.textContent = '⚠️ Bağlantı koptu';
    connectionStatus.className = 'text-yellow-500 animate-pulse';
    logStatus('WebSocket bağlantısı kapandı', 'error');
    attemptReconnect();
  };

  socket.onerror = err => {
    console.error('WebSocket error:', err);
    logStatus('WebSocket hatası', 'error');
  };

  socket.onmessage = ev => {
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
      if (!msg.isReconnect){
        // yeni oturum → temizle
        localStorage.removeItem('domino_roomCode');
        localStorage.removeItem('domino_playerId');
      }
      break;

    case 'matchFound':
      // opponent bilgileri + roomCode geliyor
      gameState.roomCode   = msg.roomCode;
      gameState.opponentInfo = {
        username:   msg.opponent.username,
        elo:        msg.opponent.elo,
        level:      msg.opponent.level,
        telegramId: msg.opponent.telegramId,
        isGuest:    msg.opponent.isGuest
      };
      // UI – 3 s “match found” lobisi
      matchPlayer1Name.textContent = gameState.playerInfo?.username || 'Sen';
      matchPlayer1Elo.textContent  = `ELO: ${gameState.playerInfo?.elo || 0} (Lv.${gameState.playerInfo?.level || 1})`;
      matchPlayer2Name.textContent = gameState.opponentInfo.username;
      matchPlayer2Elo.textContent  = `ELO: ${gameState.opponentInfo.elo} (Lv.${gameState.opponentInfo.level})`;
      showScreen('matchFound');
      // 3 s countdown → sonra oyun ekranına geç (server zaten “gameStart” gönderecek)
      let sec = 3;
      matchTimer.textContent = `${sec} saniye içinde oyun başlıyor…`;
      const int = setInterval(()=> {
        sec--;
        if (sec<=0){
          clearInterval(int);
          // “gameStart” mesajı gelecektir; burada sadece UI’yı game‑screen’e alıyoruz
          showScreen('game');
        }else{
          matchTimer.textContent = `${sec} saniye içinde oyun başlıyor…`;
        }
      }, 1000);
      break;

    case 'gameStart':
      // oyun başlıyor, server‑dan gameState ve playerId alır
      gameState.gameStarted = true;
      gameState.playerId   = msg.playerId;          // bu client’ın ID’si
      gameState.board      = msg.gameState.board;
      gameState.currentPlayer = msg.gameState.currentPlayer;
      gameState.isMyTurn   = (gameState.currentPlayer===gameState.playerId);
      // opponent info (eğer henüz gelmemişse) doldur
      if (!gameState.opponentInfo && msg.opponent){
        gameState.opponentInfo = {
          username: msg.opponent.username,
          elo:      msg.opponent.elo,
          level:    msg.opponent.level
        };
      }
      // localStorage’da kalıcı tut
      localStorage.setItem('domino_roomCode', gameState.roomCode);
      localStorage.setItem('domino_playerId', gameState.playerId);
      // UI güncelle (board, turn vs.)
      renderGame();               // (senin board çizim fonksiyonun)
      break;

    case 'gameUpdate':
      // sunucu oyun state’ini gönderir
      gameState.board = msg.gameState.board;
      gameState.currentPlayer = msg.gameState.currentPlayer;
      gameState.isMyTurn = (gameState.currentPlayer===gameState.playerId);
      renderGame();               // UI’yı yeniden çiz
      break;

    case 'gameEnd':
      // kazanan, ELO değişimi, rank vs. bilgileri
      const {winner, winnerName, isRanked, eloChanges, isDraw} = msg;
      const isWinner = (winner===gameState.playerId);
      const eloDiff  = eloChanges ? (isWinner? eloChanges.winner : eloChanges.loser) : 0;

      // Sonuç ekranı doldur
      if (isDraw){
        gameResultTitle.textContent = 'Berabere! 🤝';
        gameResultMessage.innerHTML = `Eşit puan.<br>ELO: <span class="text-yellow-500">+${Math.floor((eloDiff||0)/2)}</span>`;
      }else if (isWinner){
        gameResultTitle.textContent = 'Tebrikler Kazandınız! 🎉';
        gameResultMessage.innerHTML = `Rakibi yendiniz!<br>ELO: <span class="text-green-500">+${eloDiff}</span>`;
      }else{
        gameResultTitle.textContent = 'Mağlubiyet! 😢';
        gameResultMessage.innerHTML = `Rakibiniz kazandı.<br>ELO: <span class="text-red-500">${eloDiff}</span>`;
      }

      // Final skor detayları
      finalScorePlayerName.textContent   = gameState.playerInfo?.username || 'Sen';
      finalScoreOpponentName.textContent = gameState.opponentInfo?.username || 'Rakip';
      finalScorePlayerPoints.textContent   = isWinner ? 'Galibiyet' : (isDraw?'Beraberlik':'Mağlubiyet');
      finalScoreOppPoints.textContent      = isWinner ? 'Mağlubiyet' : (isDraw?'Beraberlik':'Galibiyet');

      // Post‑game lobby göster
      showScreen('postGame');
      // 4 s sonra lobby’a dön ve state’i temizle
      setTimeout(()=> {
        if (gameState.currentScreen==='postGame'){
          resetGameState();
          showScreen('main');
        }
      }, 4000);
      break;

    case 'searchStatus':
      // sadece “rakip aranıyor” mesajı
      // (UI’de kendi loading ekranını güncelleyebilirsin)
      break;

    case 'error':
      logStatus(msg.message||'Sunucu hatası', 'error');
      break;
  }
}

/* -------------------------- UI NAVIGATION -------------------------- */
function showScreen(screen){
  // gizle
  mainLobby.style.display   = 'none';
  rankedLobby.style.display = 'none';
  friendLobby.style.display = 'none';
  gameScreen.style.display  = 'none';
  matchFoundLobby.style.display = 'none';
  postGameLobby.style.display   = 'none';

  // göster
  switch(screen){
    case 'main'      : mainLobby.style.display   = 'block'; break;
    case 'ranked'    : rankedLobby.style.display = 'block'; break;
    case 'friend'    : friendLobby.style.display = 'block'; break;
    case 'game'      : gameScreen.style.display  = 'block'; break;
    case 'matchFound': matchFoundLobby.style.display = 'block'; break;
    case 'postGame' : postGameLobby.style.display   = 'block'; break;
    default: mainLobby.style.display = 'block';
  }
  gameState.currentScreen = screen;
}

/* -------------------------- GAME RENDER (basit) -------------------------- */
/* Bu kısım kendi DOM‑taş çizim fonksiyonunla değiştirilebilir.
   Örnek: boardElement.innerHTML = …  */
function renderGame(){
  // basit console‑log; UI update burada yapılmalı
  console.log('🧩 Board:', gameState.board);
  // turn gösterimi:
  const turnInfo = document.getElementById('turn-info');
  if (turnInfo){
    turnInfo.textContent = gameState.isMyTurn ? 'Siz oynuyorsunuz' : `${gameState.opponentInfo?.username || 'Rakip'} oynuyor`;
  }
}

/* -------------------------- ACTIONS -------------------------- */
function startRankedSearch(){
  if (gameState.isSearching) return;
  gameState.isSearching = true;
  showScreen('ranked');
  // burada playerInfo (Telegram kullanıcı bilgileri) UI’den alınmalı
  // örnek bir obje gönderiyoruz; gerçek uygulamada `playerInfo`'yu doldurun.
  const playerInfo = {
    playerId: generateRoomCode(),
    username: 'Kullanıcı_' + Math.floor(Math.random()*1000),
    elo: 1000,
    level: 10,
    isGuest:false,
    telegramId: 'tg_' + Math.floor(Math.random()*10000)
  };
  gameState.playerInfo = playerInfo;
  send({
    type:'findMatch',
    playerId:   playerInfo.playerId,
    username:   playerInfo.username,
    telegramId: playerInfo.telegramId,
    elo:        playerInfo.elo,
    level:      playerInfo.level,
    isGuest:    false
  });
}
function startCasualSearch(){
  // misafir kullanıcı (guest)
  const playerInfo = {
    playerId: generateRoomCode(),
    username: 'Guest_' + Math.floor(Math.random()*1000),
    elo: 0,
    level: 0,
    isGuest:true,
    telegramId: null
  };
  gameState.playerInfo = playerInfo;
  send({type:'findMatch', playerId:playerInfo.playerId, username:playerInfo.username, isGuest:true});
}
function createPrivateRoom(){
  const roomCode = generateRoomCode();
  gameState.roomCode = roomCode;
  send({type:'createRoom', roomCode, playerName:gameState.playerInfo?.username||'Guest'});
}
function joinPrivateRoom(code){
  gameState.roomCode = code;
  send({type:'joinRoom', roomCode:code, playerName:gameState.playerInfo?.username||'Guest'});
}
function playTile(tileIndex, position){
  send({type:'playTile', tileIndex, position});
}
function drawFromMarket(){ send({type:'drawFromMarket'}); }
function passTurn(){ send({type:'pass'}); }
function leaveGame(){
  if (gameState.roomCode){
    send({type:'leaveGame'});               // server‑a bildirim
    localStorage.removeItem('domino_roomCode');
    localStorage.removeItem('domino_playerId');
  }
  resetGameState();
  showScreen('main');
}

/* -------------------------- RESET STATE -------------------------- */
function resetGameState(){
  Object.keys(gameState).forEach(k=> {
    if (['reconnectAttempts','reconnectTimer','currentScreen','isSearching'].includes(k)) return;
    gameState[k] = null;
  });
  gameState.board = [];
  gameState.isMyTurn = false;
  gameState.gameStarted = false;
}

/* -------------------------- UI BUTTON LISTENERS -------------------------- */
document.getElementById('dereceli-btn')?.addEventListener('click', startRankedSearch);
document.getElementById('friend-btn')?.addEventListener('click', startCasualSearch);
document.getElementById('create-room-btn')?.addEventListener('click', createPrivateRoom);
document.getElementById('join-room-btn')?.addEventListener('click',()=>{
  const code = document.getElementById('join-room-input').value.trim().toUpperCase();
  if (code.length===4) joinPrivateRoom(code);
});
document.getElementById('leave-game-btn')?.addEventListener('click', leaveGame);
document.getElementById('back-to-main-btn')?.addEventListener('click',()=>showScreen('main'));

/* -------------------------- INITIALIZE -------------------------- */
window.addEventListener('DOMContentLoaded',()=> {
  connectionStatus.textContent = 'Sunucuya bağlanıyor...';
  connectionStatus.className = 'text-yellow-400 animate-pulse';
  connectWebSocket();
});
