/********************************************************************
 *  Domino 101 Pro – Backend (Express + WebSocket)
 *  --------------------------------------------------------------
 *  ÖZET DEĞİŞİKLİKLER
 *   • .env üzerinden MongoDB bağlantısı
 *   • Oda kodu (roomCode) çakışması engellendi
 *   • player.isConnected flag’ı eklendi → disconnect‑timer yönetimi
 *   • Aynı Telegram hesabının iki kez eşleşmesi engellendi
 *   • WebSocket reconnect (client “reconnect” mesajı) desteği
 *   • matchFound mesajı – opponent.username, elo, level gönderilir
 *   • gameEnd mesajı – eloChanges (winner/loser) gönderilir
 *   • Oyun bitiminde tüm playerConnections, disconnect‑timer ve odalar
 *     temizlenir (memory‑leak önleme)
 *   • logger (console‑wrapper) – prod’da rahat izlenebilir
 ********************************************************************/

require('dotenv').config();                 // .env dosyasını oku
const WebSocket = require('ws');
const http      = require('http');
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');

const app = express();

/* ------------------- MongoDB ------------------- */
const MONGODB_URI = process.env.MONGODB_URI; // .env içinde tanımlı
mongoose
  .connect(MONGODB_URI, { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=> console.log('✅ MongoDB bağlantısı başarılı - Domino Game Database'))
  .catch(err=> console.error('❌ MongoDB bağlantı hatası:', err));

/* ------------------- Schemas ------------------- */
const playerSchema = new mongoose.Schema({
  telegramId: { type:String, required:true, unique:true },
  username:   { type:String, required:true },
  firstName:  { type:String },
  lastName:   { type:String },
  photoUrl:   { type:String },
  elo:        { type:Number, default:0 },
  level:      { type:Number, default:1 },
  wins:       { type:Number, default:0 },
  losses:     { type:Number, default:0 },
  draws:      { type:Number, default:0 },
  totalGames: { type:Number, default:0 },
  winStreak:  { type:Number, default:0 },
  bestWinStreak:{ type:Number, default:0 },
  createdAt:  { type:Date, default:Date.now },
  lastPlayed:{ type:Date, default:Date.now }
});

const matchSchema = new mongoose.Schema({
  player1:   { type:mongoose.Schema.Types.ObjectId, ref:'DominoPlayer' },
  player2:   { type:mongoose.Schema.Types.ObjectId, ref:'DominoPlayer' },
  winner:    { type:mongoose.Schema.Types.ObjectId, ref:'DominoPlayer' },
  player1Elo:{ type:Number },
  player2Elo:{ type:Number },
  player1EloChange:{ type:Number },
  player2EloChange:{ type:Number },
  moves:     { type:Number, default:0 },
  duration:  { type:Number },
  isDraw:    { type:Boolean, default:false },
  gameType:  { type:String, enum:['ranked','private'], default:'ranked' },
  createdAt: { type:Date, default:Date.now }
});

const Player = mongoose.model('DominoPlayer', playerSchema);
const Match  = mongoose.model('DominoMatch',  matchSchema);

/* ------------------- Middlewares ------------------- */
app.use(cors());
app.use(express.json());

/* ------------------- In‑Memory Stores ------------------- */
const rooms          = new Map();   // roomCode → {players, gameState, type, …}
const matchQueue     = [];         // waiting players
const playerConnections = new Map(); // playerId → ws
const playerSessions = new Map();   // telegramId → Player (Mongo)

/* ------------------- Helper / Logger ------------------- */
const logger = {
  info:  (...a)=>console.log('[INFO]',...a),
  warn:  (...a)=>console.warn('[WARN]',...a),
  error: (...a)=>console.error('[ERROR]',...a)
};

function generateRoomCode(){
  // 4 karakter, çakışma kontrolü
  let code;
  do {
    code = Math.random().toString(36).slice(2,6).toUpperCase();
  } while (rooms.has(code));
  return code;
}
function createDominoSet(){
  const tiles=[];
  for(let i=0;i<=6;i++){
    for(let j=i;j<=6;j++) tiles.push([i,j]);
  }
  return shuffleArray(tiles);
}
function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ---------- ELO & Level ---------- */
function calculateElo(winnerElo, loserElo, winnerLevel){
  // kazanana 13‑20 / 10‑15 puan, kaybedene %70'i (en az 5)
  const winnerChange = winnerLevel<=5
        ? Math.floor(Math.random()*8)+13   // 13‑20
        : Math.floor(Math.random()*6)+10; // 10‑15
  const loserChange = -Math.max(Math.floor(winnerChange*0.7),5);
  return {
    winnerElo: winnerElo + winnerChange,
    loserElo : Math.max(0, loserElo + loserChange),
    winnerChange,
    loserChange
  };
}
function calculateLevel(elo){ return Math.floor(elo/100)+1; }

/* ------------------- API ROUTES ------------------- */
app.post('/api/auth/telegram', async (req,res)=>{
  try{
    const {telegramId, username, firstName, lastName, photoUrl}=req.body;
    if(!telegramId||!username) return res.status(400).json({error:'Telegram ID ve kullanıcı adı gerekli'});
    let player = await Player.findOne({telegramId});
    if(!player){
      player = new Player({telegramId,username,firstName,lastName,photoUrl});
      await player.save();
      logger.info(`🆕 Yeni oyuncu: ${username} (${telegramId})`);
    }else{
      // güncelle
      player.username=username;
      player.firstName=firstName;
      player.lastName=lastName;
      player.photoUrl=photoUrl;
      player.lastPlayed=new Date();
      await player.save();
    }
    playerSessions.set(telegramId,player);
    res.json({success:true, player});
  }catch(e){
    logger.error('Auth error:',e);
    res.status(500).json({error:'Sunucu hatası'});
  }
});

app.get('/api/leaderboard', async (_,res)=>{
  try{
    const players = await Player.find()
      .sort({elo:-1})
      .limit(10)
      .select('telegramId username photoUrl elo level wins losses draws totalGames winStreak');
    res.json({success:true, leaderboard:players});
  }catch(e){
    logger.error('Leaderboard error:',e);
    res.status(500).json({error:'Sunucu hatası'});
  }
});

/* ------------------- HTTP STATUS ------------------- */
app.get('/', (req,res)=>res.json({
  status:'online',
  message:'Domino WebSocket Server',
  players:playerConnections.size,
  rooms:rooms.size
}));
app.get('/health', (_,res)=>res.json({status:'ok'}));

/* ------------------- HTTP & WS Server ------------------- */
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  perMessageDeflate:false,
  clientTracking:true
});

/* ------------------- Messaging Helpers ------------------- */
function sendMessage(ws,msg){
  if(ws.readyState===WebSocket.OPEN){
    try{ ws.send(JSON.stringify(msg)); }catch(_){}
  }
}
function broadcastToRoom(roomCode,msg,exclude=null){
  const room = rooms.get(roomCode);
  if(!room) return;
  for(const pid in room.players){
    if(pid===exclude) continue;
    const ws = playerConnections.get(pid);
    if(ws && ws.readyState===WebSocket.OPEN){
      try{ ws.send(JSON.stringify(msg)); }catch(_){}
    }
  }
}

/* ------------------- Game Core Functions ------------------- */
function initializeGame(roomCode, player1Id, player2Id){
  const tiles = createDominoSet();
  const p1Hand = tiles.slice(0,7);
  const p2Hand = tiles.slice(7,14);
  const market = tiles.slice(14);

  const room = rooms.get(roomCode);
  if(!room) throw new Error('Room not found during init');

  // en küçük çift taşı bulan oyuncu
  let startingPlayer = null;
  let startingDouble = -1;

  for(let i=1;i<=6 && !startingPlayer;i++){
    for(const pid of [player1Id,player2Id]){
      const hand = pid===player1Id? p1Hand : p2Hand;
      if(hand.some(t=>t[0]===i && t[1]===i)){
        startingPlayer=pid; startingDouble=i; break;
      }
    }
  }
  if(!startingPlayer){
    // 0‑0 kontrolü
    for(const pid of [player1Id,player2Id]){
      const hand = pid===player1Id? p1Hand : p2Hand;
      if(hand.some(t=>t[0]===0 && t[1]===0)){
        startingPlayer=pid; startingDouble=0; break;
      }
    }
  }
  if(!startingPlayer){
    // rastgele seç
    startingPlayer = Math.random()<0.5? player1Id : player2Id;
    startingDouble = -1;
    logger.info('ℹ️ Çift taş bulunamadı, rastgele başlangıç yapıldı.');
  }

  room.gameState = {
    board:[],
    market,
    players:{
      [player1Id]:{hand:p1Hand, name:room.players[player1Id].name},
      [player2Id]:{hand:p2Hand, name:room.players[player2Id].name}
    },
    currentPlayer:startingPlayer,
    turn:1,
    startingDouble
  };
  logger.info(`🎮 Oyun başlatıldı → ${startingPlayer===player1Id?room.players[player1Id].name:room.players[player2Id].name} (double ${startingDouble===-1?'Rastgele':`${startingDouble}|${startingDouble}`})`);
  return room.gameState;
}
function canPlayTile(tile, board){
  if(board.length===0) return true;
  const left  = board[0][0];
  const right = board[board.length-1][1];
  return tile[0]===left||tile[1]===left||tile[0]===right||tile[1]===right;
}
function playTileOnBoard(tile, board, position){
  if(board.length===0){ board.push(tile); return true; }
  const left = board[0][0];
  const right= board[board.length-1][1];
  let placed=false;

  if(position==='left' || position==='both'){
    if(tile[1]===left){ board.unshift(tile); placed=true; }
    else if(tile[0]===left){ board.unshift([tile[1],tile[0]]); placed=true; }
  }
  if(!placed && (position==='right' || position==='both')){
    if(tile[0]===right){ board.push(tile); placed=true; }
    else if(tile[1]===right){ board.push([tile[1],tile[0]]); placed=true; }
  }
  return placed;
}
function checkWinner(gs){
  for(const pid in gs.players){
    if(gs.players[pid].hand.length===0) return pid;
  }
  const ids = Object.keys(gs.players);
  const p1Hand = gs.players[ids[0]].hand;
  const p2Hand = gs.players[ids[1]].hand;
  const p1Can = p1Hand.some(t=>canPlayTile(t,gs.board));
  const p2Can = p2Hand.some(t=>canPlayTile(t,gs.board));
  if(!p1Can && !p2Can){
    const sum1 = p1Hand.reduce((s,t)=>s+t[0]+t[1],0);
    const sum2 = p2Hand.reduce((s,t)=>s+t[0]+t[1],0);
    if(sum1===sum2) return 'DRAW';
    return sum1<sum2 ? ids[0] : ids[1];
  }
  return null;
}

/* ------------------- Cleaning Room (after game / timeout) ------------------- */
async function cleanUpRoom(roomCode){
  const room = rooms.get(roomCode);
  if(!room) return;
  // cancel disconnect‑timerler
  for(const pid in room.players){
    const pInfo = room.players[pid];
    if(pInfo.disconnectTimer){ clearTimeout(pInfo.disconnectTimer); pInfo.disconnectTimer=null; }
    // sil bağlantı ve oturum
    const ws = playerConnections.get(pid);
    if(ws){ playerConnections.delete(pid); ws.roomCode=null; }
    if(pInfo.telegramId) playerSessions.delete(pInfo.telegramId);
    delete room.players[pid];
  }
  rooms.delete(roomCode);
}

/* ------------------- WebSocket Message Handlers ------------------- */
function handleFindMatch(ws, data){
  // data: playerId, username, telegramId, elo, level, isGuest
  const {playerId, username, telegramId, elo=1000, level=1, isGuest=false} = data;
  // playerId oluştur / güncelle
  const pid = ws.playerId || playerId || generateRoomCode();
  ws.playerId = pid;
  ws.playerName = username || 'Guest';
  ws.telegramId = telegramId || null;
  ws.isGuest = !!isGuest;
  ws.elo = elo;
  ws.level = level;
  playerConnections.set(pid, ws);

  // aynı Telegram aynı anda iki kez kuyruğa eklenmesin
  if(!ws.isGuest && ws.telegramId){
    const dup = matchQueue.find(p=>p.telegramId===ws.telegramId);
    if(dup){
      sendMessage(ws,{type:'error',message:'Bu Telegram hesabı zaten eşleşme kuyruğunda'});
      return;
    }
  }

  matchQueue.push({ws,pid,username:ws.playerName,telegramId:ws.telegramId,elo:ws.elo,level:ws.level,isGuest:ws.isGuest});
  logger.info(`⏳ ${ws.playerName} kuyrukta (${matchQueue.length})`);

  // yeterli kişi varsa eşleştir
  if(matchQueue.length>=2){
    // aynı tipteki oyuncular (ranked ↔ ranked  OR  guest ↔ guest)
    const first = matchQueue.shift();
    const idx = matchQueue.findIndex(p=>p.isGuest===first.isGuest);
    if(idx===-1){
      matchQueue.unshift(first);   // aynı tip yok, bekle
      return;
    }
    const second = matchQueue.splice(idx,1)[0];

    // aynı Telegram hesabı kendi kendine eşleşmesin
    if(!first.isGuest && !second.isGuest && first.telegramId && second.telegramId && first.telegramId===second.telegramId){
      // iki oyuncuyu da kuyruğa geri koy
      matchQueue.unshift(first);
      matchQueue.unshift(second);
      logger.warn('⚠️ Aynı Telegram hesabı kendi kendine eşleşmek istedi, engellendi');
      return;
    }

    const roomCode = generateRoomCode();
    const gameType = (first.isGuest || second.isGuest) ? 'casual' : 'ranked';
    const room = {
      code:roomCode,
      players:{},
      type:gameType,
      startTime:Date.now()
    };
    // player objeleri (username, elo, level …)
    room.players[first.pid] = {
      name:first.username,
      telegramId:first.telegramId,
      elo:first.elo,
      level:first.level,
      isGuest:first.isGuest,
      isConnected:true
    };
    room.players[second.pid] = {
      name:second.username,
      telegramId:second.telegramId,
      elo:second.elo,
      level:second.level,
      isGuest:second.isGuest,
      isConnected:true
    };
    rooms.set(roomCode,room);

    // WS nesnelerini bağla
    ws = first.ws; ws.roomCode = roomCode; ws.playerId = first.pid; playerConnections.set(first.pid,ws);
    second.ws.roomCode = roomCode; second.ws.playerId = second.pid; playerConnections.set(second.pid,second.ws);

    // oyun state init
    const gs = initializeGame(roomCode, first.pid, second.pid);

    // matchFound mesajı (client‑a 3 s “lobi” gösterecek)
    const oppInfo = pid=>room.players[pid];
    const notifyMatchFound = (me,oppId)=>{
      sendMessage(me.ws,{
        type:'matchFound',
        roomCode,
        opponent:{
          username: oppInfo(oppId).name,
          elo:      oppInfo(oppId).elo,
          level:    oppInfo(oppId).level,
          telegramId: oppInfo(oppId).telegramId,
          isGuest:   oppInfo(oppId).isGuest
        },
        playerId: me.pid,
        gameType
      });
    };
    notifyMatchFound(first,second.pid);
    notifyMatchFound(second,first.pid);

    // 3 s sonra gerçek oyun başlatılıyor (client’da “gameStart” alır)
    setTimeout(()=>{
      const payload = pid=>({
        type:'gameStart',
        roomCode,
        gameState:gs,
        playerId: pid,
        opponent:{
          username: oppInfo(pid===first.pid?second.pid:first.pid).name,
          elo:      oppInfo(pid===first.pid?second.pid:first.pid).elo,
          level:    oppInfo(pid===first.pid?second.pid:first.pid).level
        }
      });
      sendMessage(first.ws, payload(first.pid));
      sendMessage(second.ws,payload(second.pid));
    },3000);
  }else{
    sendMessage(ws,{type:'searchStatus',message:'Rakip aranıyor...'});
  }
}
function handleCancelSearch(ws){
  const idx = matchQueue.findIndex(p=>p.ws===ws);
  if(idx!==-1){
    matchQueue.splice(idx,1);
    sendMessage(ws,{type:'searchCancelled',message:'Arama iptal edildi'});
    logger.info(`❌ ${ws.playerName||'Birisi'} aramayı iptal etti`);
  }
}
function handleCreateRoom(ws, data){
  const roomCode = generateRoomCode();
  ws.playerId = data.telegramId || `guest_${Date.now()}`;
  ws.playerName = data.playerName || data.username || 'Guest';
  ws.roomCode = roomCode;
  ws.isGuest = !data.telegramId;
  playerConnections.set(ws.playerId, ws);
  rooms.set(roomCode,{
    code:roomCode,
    players:{
      [ws.playerId]:{
        name:ws.playerName,
        telegramId:data.telegramId,
        isGuest:ws.isGuest,
        isConnected:true
      }
    },
    type:'private',
    host:ws.playerId
  });
  sendMessage(ws,{type:'roomCreated',roomCode});
  logger.info(`🏠 Oda oluşturuldu ${roomCode} (kurucu: ${ws.playerName})`);
}
function handleJoinRoom(ws, data){
  const room = rooms.get(data.roomCode);
  if(!room || Object.keys(room.players).length>=2){
    sendMessage(ws,{type:'error',message:'Oda bulunamadı veya dolu'});
    return;
  }
  ws.playerId = data.telegramId || `guest_${Date.now()}`;
  ws.playerName = data.playerName || data.username || 'Guest';
  ws.roomCode = data.roomCode;
  ws.isGuest = !data.telegramId;
  playerConnections.set(ws.playerId,ws);
  room.players[ws.playerId]={
    name:ws.playerName,
    telegramId:data.telegramId,
    isGuest:ws.isGuest,
    isConnected:true
  };
  // init game
  const hostId = room.host;
  const joinerId = ws.playerId;
  const gs = initializeGame(data.roomCode, hostId, joinerId);
  // Hemen gameStart gönder (odev‑a menzil)
  const sendStart = (pid,oppId)=>{
    const opp = room.players[oppId];
    sendMessage(playerConnections.get(pid),{
      type:'gameStart',
      roomCode,
      gameState:gs,
      playerId:pid,
      opponent:{
        username:opp.name,
        elo:opp.elo||0,
        level:opp.level||1
      }
    });
  };
  sendStart(hostId,joinerId);
  sendStart(joinerId,hostId);
  logger.info(`🔗 ${ws.playerName} ${room.players[hostId].name}'in odasına katıldı ${room.code}`);
}
function handlePlayTile(ws, data){
  const room = rooms.get(ws.roomCode);
  if(!room||!room.gameState) return;
  const gs = room.gameState;
  if(gs.currentPlayer!==ws.playerId){
    sendMessage(ws,{type:'error',message:'Sıra sizde değil'});
    return;
  }
  const player = gs.players[ws.playerId];
  const tile = player.hand[data.tileIndex];
  if(!tile){ sendMessage(ws,{type:'error',message:'Geçersiz taş'}); return; }
  const ok = playTileOnBoard(tile,gs.board,data.position);
  if(!ok){ sendMessage(ws,{type:'error',message:'Geçersiz hamle'}); return; }
  player.hand.splice(data.tileIndex,1);
  gs.turn++;
  const winner = checkWinner(gs);
  if(winner){
    handleGameEnd(ws.roomCode,winner,gs);
  }else{
    gs.currentPlayer = Object.keys(gs.players).find(id=>id!==ws.playerId);
    broadcastToRoom(ws.roomCode,{type:'gameUpdate',gameState:gs});
  }
}
function handleDrawFromMarket(ws){
  const room = rooms.get(ws.roomCode);
  if(!room||!room.gameState) return;
  const gs = room.gameState;
  if(gs.currentPlayer!==ws.playerId){
    sendMessage(ws,{type:'error',message:'Sıra sizde değil'}); return;
  }
  // İlk hamlede çift taş yoksa çekilmesine izin verme
  if(gs.turn===1 && gs.startingDouble>-1){
    sendMessage(ws,{type:'error',message:`İlk hamle ${gs.startingDouble}|${gs.startingDouble} olmalı`});
    return;
  }
  if(!gs.market||gs.market.length===0){
    // pazar boş → sırayı geç
    gs.turn++;
    gs.currentPlayer = Object.keys(gs.players).find(id=>id!==ws.playerId);
    broadcastToRoom(ws.roomCode,{type:'gameUpdate',gameState:gs});
    return;
  }
  const drawn = gs.market.shift();
  gs.players[ws.playerId].hand.push(drawn);
  broadcastToRoom(ws.roomCode,{type:'gameUpdate',gameState:gs});
}
function handlePass(ws){
  const room = rooms.get(ws.roomCode);
  if(!room||!room.gameState) return;
  const gs = room.gameState;
  if(gs.currentPlayer!==ws.playerId){
    sendMessage(ws,{type:'error',message:'Sıra sizde değil'}); return;
  }
  const hand = gs.players[ws.playerId].hand;
  const canPlay = hand.some(t=>canPlayTile(t,gs.board));
  if(canPlay){
    sendMessage(ws,{type:'error',message:'Elinizde oynanabilir taş var, pas geçemezsiniz'});
    return;
  }
  gs.turn++;
  gs.currentPlayer = Object.keys(gs.players).find(id=>id!==ws.playerId);
  const winner = checkWinner(gs);
  if(winner){
    broadcastToRoom(ws.roomCode,{type:'gameEnd',winner,winnerName:gs.players[winner].name});
    cleanUpRoom(ws.roomCode);
  }else{
    broadcastToRoom(ws.roomCode,{type:'gameUpdate',gameState:gs});
  }
}
function handleLeaveGame(ws){
  const room = rooms.get(ws.roomCode);
  if(!room||!room.gameState||!ws.playerId) return;
  const ids = Object.keys(room.gameState.players);
  if(ids.length!==2){
    cleanUpRoom(ws.roomCode);
    return;
  }
  const leaverId = ws.playerId;
  const winnerId = ids.find(id=>id!==leaverId);
  handleGameEnd(ws.roomCode,winnerId,room.gameState);
}
function handleReconnect(ws, data){
  const {roomCode, playerId}=data;
  const room = rooms.get(roomCode);
  if(!room || !room.players[playerId]){
    sendMessage(ws,{type:'error',message:'Geçerli bir oyun bulunamadı'});
    return;
  }
  // Zamanlayıcı iptal
  if(room.players[playerId].disconnectTimer){
    clearTimeout(room.players[playerId].disconnectTimer);
    room.players[playerId].disconnectTimer=null;
    logger.info(`✅ ${playerId} odada yeniden bağlandı`);
  }
  room.players[playerId].isConnected=true;
  ws.playerId = playerId;
  ws.roomCode = roomCode;
  ws.playerName = room.players[playerId].name;
  playerConnections.set(playerId,ws);
  // Oyun state gönder
  sendMessage(ws,{type:'reconnect',gameState:room.gameState});
  // Rakibe bilgi gönder
  broadcastToRoom(roomCode,{type:'opponentReconnected',message:`${room.players[playerId].name} geri döndü`},playerId);
}

/* ------------------- Game End & Cleanup ------------------- */
async function handleGameEnd(roomCode,winnerId,gameState){
  const room = rooms.get(roomCode);
  if(!room){ logger.warn('GameEnd: room not found'); return; }

  const playerIds = Object.keys(gameState.players);
  const p1Id = playerIds[0];
  const p2Id = playerIds[1];
  const isDraw = winnerId==='DRAW';
  let eloChanges = null;

  const p1Info = room.players[p1Id];
  const p2Info = room.players[p2Id];
  const isRanked = room.type==='ranked' && !p1Info.isGuest && !p2Info.isGuest;

  if(isRanked){
    const p1 = await Player.findOne({telegramId:p1Info.telegramId});
    const p2 = await Player.findOne({telegramId:p2Info.telegramId});
    if(!p1||!p2){
      logger.error('MongoDB player not found for ranked match');
      broadcastToRoom(roomCode,{type:'gameEnd',winner:winnerId,winnerName:isDraw?'Beraberlik':gameState.players[winnerId].name,isRanked:false});
      await cleanUpRoom(roomCode);
      return;
    }
    if(!isDraw){
      const winner = winnerId===p1Id? p1 : p2;
      const loser  = winnerId===p1Id? p2 : p1;
      eloChanges = calculateElo(winner.elo, loser.elo, winner.level);

      // Winner update
      winner.elo = eloChanges.winnerElo;
      winner.level = calculateLevel(winner.elo);
      winner.wins++; winner.winStreak++; winner.bestWinStreak=Math.max(winner.bestWinStreak,winner.winStreak);
      winner.totalGames++; winner.lastPlayed=new Date();

      // Loser update
      loser.elo = eloChanges.loserElo;
      loser.level = calculateLevel(loser.elo);
      loser.losses++; loser.winStreak=0;
      loser.totalGames++; loser.lastPlayed=new Date();

      await winner.save(); await loser.save();

      await new Match({
        player1:p1._id, player2:p2._id, winner:winner._id,
        player1Elo:winnerId===p1Id?eloChanges.winnerElo:eloChanges.loserElo,
        player2Elo:winnerId===p2Id?eloChanges.winnerElo:eloChanges.loserElo,
        player1EloChange:winnerId===p1Id?eloChanges.winnerChange:eloChanges.loserChange,
        player2EloChange:winnerId===p2Id?eloChanges.winnerChange:eloChanges.loserChange,
        moves:gameState.turn,
        duration:Math.floor((Date.now()-room.startTime)/1000),
        gameType:'ranked',
        isDraw:false
      }).save();

      logger.info(`🏆 ${winner.username} kazandı! (+${eloChanges.winnerChange})`);
    }else{
      // Draw handling
      p1.draws++; p1.totalGames++; p1.winStreak=0; p1.lastPlayed=new Date();
      p2.draws++; p2.totalGames++; p2.winStreak=0; p2.lastPlayed=new Date();
      await p1.save(); await p2.save();

      await new Match({
        player1:p1._id, player2:p2._id,
        player1Elo:p1.elo, player2Elo:p2.elo,
        player1EloChange:0, player2EloChange:0,
        moves:gameState.turn,
        duration:Math.floor((Date.now()-room.startTime)/1000),
        gameType:'ranked',
        isDraw:true
      }).save();
    }
  }else{
    logger.info(`🎮 Casual maç bitti – ${isDraw?'Beraberlik':gameState.players[winnerId].name+' kazandı'}`);
  }

  broadcastToRoom(roomCode,{
    type:'gameEnd',
    winner:winnerId,
    winnerName:isDraw?'Beraberlik':gameState.players[winnerId].name,
    isRanked,
    eloChanges
  });

  // Temizlik
  await cleanUpRoom(roomCode);
}

/* ------------------- Disconnect & Timeout ------------------- */
function handleDisconnect(ws){
  logger.info(`🔌 ${ws.playerName||'Bilinmeyen'} bağlantısı koptu`);
  // kuyruktan çıkar
  const qIdx = matchQueue.findIndex(p=>p.ws===ws);
  if(qIdx!==-1){ matchQueue.splice(qIdx,1); }

  if(ws.roomCode && ws.playerId){
    const room = rooms.get(ws.roomCode);
    if(room && room.players[ws.playerId]){
      // sadece bu ws aktifse işleme al
      if(playerConnections.get(ws.playerId)===ws){
        room.players[ws.playerId].isConnected = false;
        playerConnections.delete(ws.playerId);
        logger.info(`⏳ ${ws.playerName} (${ws.playerId}) için 60 s yeniden bağlanma süresi başladı`);
        broadcastToRoom(ws.roomCode,{type:'opponentDisconnected',message:'Rakibin bağlantısı koptu. Yeniden bağlanması bekleniyor...'},ws.playerId);
        room.players[ws.playerId].disconnectTimer = setTimeout(()=>{
          // timeout süresi doldu, oyunu bitir
          endGameDueToTimeout(ws.roomCode, ws.playerId);
        },60000);
      }
    }
  }
}
function endGameDueToTimeout(roomCode, pid){
  const room = rooms.get(roomCode);
  if(!room) return;
  const pInfo = room.players[pid];
  if(pInfo && !pInfo.isConnected){
    const ids = Object.keys(room.players);
    const winnerId = ids.find(id=>id!==pid);
    logger.warn(`⏰ ${pInfo.name} (${pid}) yeniden bağlanmadı → ${room.players[winnerId].name} kazanıyor`);
    handleGameEnd(roomCode,winnerId,room.gameState);
  }
}

/* ------------------- WebSocket Event Bindings ------------------- */
wss.on('connection',(ws,req)=>{
  ws.isAlive=true;
  ws.on('pong',()=>ws.isAlive=true);

  ws.on('message',msg=>{
    try{
      const data = JSON.parse(msg);
      switch(data.type){
        case 'findMatch':          handleFindMatch(ws,data); break;
        case 'cancelSearch':       handleCancelSearch(ws); break;
        case 'createRoom':        handleCreateRoom(ws,data); break;
        case 'joinRoom':          handleJoinRoom(ws,data); break;
        case 'playTile':          handlePlayTile(ws,data); break;
        case 'drawFromMarket':    handleDrawFromMarket(ws); break;
        case 'pass':              handlePass(ws); break;
        case 'leaveGame':         handleLeaveGame(ws); break;
        case 'reconnect':         handleReconnect(ws,data); break;
        default: logger.warn('Unknown WS type:',data.type);
      }
    }catch(e){
      logger.error('WS message parse error:',e);
    }
  });

  ws.on('close',()=>handleDisconnect(ws));
  // ilk bağlantı mesajı
  sendMessage(ws,{type:'connected',message:'Sunucuya bağlandınız',isReconnect:false});
});

/* ------------------- Ping / Pong (keep‑alive) ------------------- */
const pingInterval = setInterval(()=>{
  wss.clients.forEach(ws=>{
    if(ws.isAlive===false) return ws.terminate();
    ws.isAlive=false;
    ws.ping();
  });
},30000);
wss.on('close',()=>clearInterval(pingInterval));

/* ------------------- Server Listen ------------------- */
const PORT = process.env.PORT || 10000;
server.listen(PORT,()=>logger.info(`🚀 Domino Sunucusu çalışıyor – Port ${PORT}`));
