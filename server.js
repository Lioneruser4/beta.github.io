const WebSocket = require(‘ws’);
const http = require(‘http’);
const express = require(‘express’);
const { MongoClient } = require(‘mongodb’);

const app = express();

// MongoDB bağlantısı
const MONGODB_URI = ‘mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt’;
let db;
let playersCollection;
let gamesCollection;

MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
.then(client => {
console.log(‘✅ MongoDB bağlantısı başarılı’);
db = client.db(‘domino_game’);
playersCollection = db.collection(‘players’);
gamesCollection = db.collection(‘games’);

```
// Index oluştur
playersCollection.createIndex({ telegramId: 1 }, { unique: true });
playersCollection.createIndex({ elo: -1 });
```

})
.catch(err => console.error(‘❌ MongoDB bağlantı hatası:’, err));

// CORS
app.use((req, res, next) => {
res.header(‘Access-Control-Allow-Origin’, ‘*’);
res.header(‘Access-Control-Allow-Methods’, ‘GET, POST, OPTIONS’);
res.header(‘Access-Control-Allow-Headers’, ‘Content-Type’);
next();
});

app.use(express.json());

// Health check
app.get(’/’, (req, res) => {
res.json({
status: ‘online’,
message: ‘Domino WebSocket Server with ELO System’,
players: playerConnections.size,
rooms: rooms.size
});
});

app.get(’/leaderboard’, async (req, res) => {
try {
const top10 = await playersCollection
.find()
.sort({ elo: -1 })
.limit(10)
.toArray();
res.json(top10);
} catch (error) {
res.status(500).json({ error: ‘Leaderboard alınamadı’ });
}
});

app.get(’/player/:telegramId’, async (req, res) => {
try {
const player = await playersCollection.findOne({ telegramId: req.params.telegramId });
if (!player) {
return res.status(404).json({ error: ‘Oyuncu bulunamadı’ });
}

```
const rank = await playersCollection.countDocuments({ elo: { $gt: player.elo } }) + 1;
res.json({ ...player, rank });
```

} catch (error) {
res.status(500).json({ error: ‘Oyuncu bilgisi alınamadı’ });
}
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
server,
perMessageDeflate: false,
clientTracking: true
});

const rooms = new Map();
const matchQueue = [];
const playerConnections = new Map();

function generateRoomCode() {
return Math.random().toString(36).substr(2, 4).toUpperCase();
}

function createDominoSet() {
const tiles = [];
for (let i = 0; i <= 6; i++) {
for (let j = i; j <= 6; j++) {
tiles.push([i, j]);
}
}
return shuffleArray(tiles);
}

function shuffleArray(array) {
const arr = […array];
for (let i = arr.length - 1; i > 0; i–) {
const j = Math.floor(Math.random() * (i + 1));
[arr[i], arr[j]] = [arr[j], arr[i]];
}
return arr;
}

function calculateLevel(elo) {
return Math.min(Math.floor(elo / 100) + 1, 10);
}

function getLevelIcon(level) {
if (level >= 7 && level <= 10) {
return { icon: ‘💎’, color: ‘diamond’, animated: true };
} else if (level >= 4 && level <= 6) {
return { icon: ‘⭐’, color: ‘gold’, animated: true };
} else {
return { icon: ‘🌟’, color: ‘yellow’, animated: false };
}
}

async function getOrCreatePlayer(telegramId, name) {
let player = await playersCollection.findOne({ telegramId });

if (!player) {
player = {
telegramId,
name,
elo: 0,
level: 1,
wins: 0,
losses: 0,
gamesPlayed: 0,
createdAt: new Date(),
lastPlayed: new Date()
};
await playersCollection.insertOne(player);
console.log(‘🆕 Yeni oyuncu oluşturuldu:’, name);
}

return player;
}

async function updatePlayerElo(telegramId, eloChange, won, leftEarly = false, gameLength = 0) {
const player = await playersCollection.findOne({ telegramId });
if (!player) return;

const newElo = Math.max(0, player.elo + eloChange);
const newLevel = calculateLevel(newElo);

const update = {
$set: {
elo: newElo,
level: newLevel,
lastPlayed: new Date()
},
$inc: {
gamesPlayed: 1,
wins: won ? 1 : 0,
losses: !won ? 1 : 0
}
};

await playersCollection.updateOne({ telegramId }, update);

console.log(`📊 ELO güncellendi: ${player.name} ${eloChange > 0 ? '+' : ''}${eloChange} (${player.elo} → ${newElo}) Level: ${newLevel}`);

return { newElo, newLevel, eloChange };
}

function calculateEloChange(winner, loser, gameState) {
const turnsPlayed = gameState.turn || 1;
const minTurnsForHalf = 10;
const isHalfGame = turnsPlayed >= minTurnsForHalf;

// Kazanan için
let winnerPoints = Math.floor(Math.random() * 9) + 12; // 12-20 arası

// Kaybeden için
let loserPoints = isHalfGame ? -20 : -10;

return { winnerPoints, loserPoints };
}

async function initializeGame(roomCode, player1Id, player2Id, isRanked = false) {
const tiles = createDominoSet();
const player1Hand = tiles.slice(0, 7);
const player2Hand = tiles.slice(7, 14);

const room = rooms.get(roomCode);
room.gameState = {
board: [],
players: {
[player1Id]: {
hand: player1Hand,
name: room.players[player1Id].name,
telegramId: room.players[player1Id].telegramId,
elo: room.players[player1Id].elo || 0,
level: room.players[player1Id].level || 1
},
[player2Id]: {
hand: player2Hand,
name: room.players[player2Id].name,
telegramId: room.players[player2Id].telegramId,
elo: room.players[player2Id].elo || 0,
level: room.players[player2Id].level || 1
}
},
currentPlayer: player1Id,
turn: 1,
lastMove: null,
isRanked,
startTime: new Date()
};

rooms.set(roomCode, room);
return room.gameState;
}

function canPlayTile(tile, board) {
if (board.length === 0) return true;

const leftEnd = board[0][0];
const rightEnd = board[board.length - 1][1];

return tile[0] === leftEnd || tile[1] === leftEnd ||
tile[0] === rightEnd || tile[1] === rightEnd;
}

function playTileOnBoard(tile, board, position) {
if (board.length === 0) {
board.push(tile);
return;
}

const leftEnd = board[0][0];
const rightEnd = board[board.length - 1][1];

if (position === ‘left’ || position === ‘both’) {
if (tile[1] === leftEnd) {
board.unshift(tile);
} else if (tile[0] === leftEnd) {
board.unshift([tile[1], tile[0]]);
}
} else if (position === ‘right’ || position === ‘both’) {
if (tile[0] === rightEnd) {
board.push(tile);
} else if (tile[1] === rightEnd) {
board.push([tile[1], tile[0]]);
}
}
}

function checkWinner(gameState) {
for (const playerId in gameState.players) {
if (gameState.players[playerId].hand.length === 0) {
return playerId;
}
}

const player1Id = Object.keys(gameState.players)[0];
const player2Id = Object.keys(gameState.players)[1];
const player1Hand = gameState.players[player1Id].hand;
const player2Hand = gameState.players[player2Id].hand;

const player1CanPlay = player1Hand.some(tile => canPlayTile(tile, gameState.board));
const player2CanPlay = player2Hand.some(tile => canPlayTile(tile, gameState.board));

if (!player1CanPlay && !player2CanPlay) {
const player1Sum = player1Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
const player2Sum = player2Hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);

```
return player1Sum < player2Sum ? player1Id : player2Id;
```

}

return null;
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
const room = rooms.get(roomCode);
if (!room) return;

for (const playerId in room.players) {
if (playerId === excludePlayer) continue;
const ws = playerConnections.get(playerId);
if (ws && ws.readyState === WebSocket.OPEN) {
try {
ws.send(JSON.stringify(message));
} catch (error) {
console.error(‘Broadcast error:’, error);
}
}
}
}

function sendGameState(roomCode, playerId) {
const room = rooms.get(roomCode);
if (!room || !room.gameState) return;

const ws = playerConnections.get(playerId);
if (!ws || ws.readyState !== WebSocket.OPEN) return;

const gameState = {
…room.gameState,
playerId: playerId
};

try {
ws.send(JSON.stringify({
type: ‘gameUpdate’,
gameState: gameState
}));
} catch (error) {
console.error(‘Send game state error:’, error);
}
}

function sendMessage(ws, message) {
if (ws.readyState === WebSocket.OPEN) {
try {
ws.send(JSON.stringify(message));
} catch (error) {
console.error(‘Send message error:’, error);
}
}
}

wss.on(‘connection’, (ws, req) => {
console.log(‘✅ Yeni bağlantı:’, req.socket.remoteAddress);

ws.isAlive = true;
ws.on(‘pong’, () => {
ws.isAlive = true;
});

ws.on(‘message’, (message) => {
try {
const data = JSON.parse(message);

```
  switch (data.type) {
    case 'auth':
      handleAuth(ws, data);
      break;
    case 'findMatch':
      handleFindMatch(ws, data);
      break;
    case 'cancelSearch':
      handleCancelSearch(ws);
      break;
    case 'createRoom':
      handleCreateRoom(ws, data);
      break;
    case 'joinRoom':
      handleJoinRoom(ws, data);
      break;
    case 'playTile':
      handlePlayTile(ws, data);
      break;
    case 'pass':
      handlePass(ws);
      break;
    case 'getLeaderboard':
      handleGetLeaderboard(ws);
      break;
    case 'getPlayerStats':
      handleGetPlayerStats(ws, data);
      break;
  }
} catch (error) {
  console.error('❌ Mesaj işleme hatası:', error);
  sendMessage(ws, { type: 'error', message: 'Sunucu hatası' });
}
```

});

ws.on(‘close’, () => {
console.log(‘❌ Bağlantı kapandı’);
handleDisconnect(ws);
});

ws.on(‘error’, (error) => {
console.error(‘❌ WebSocket hatası:’, error);
});

sendMessage(ws, { type: ‘connected’, message: ‘Sunucuya bağlandınız’ });
});

const pingInterval = setInterval(() => {
wss.clients.forEach((ws) => {
if (ws.isAlive === false) {
return ws.terminate();
}
ws.isAlive = false;
ws.ping();
});
}, 30000);

wss.on(‘close’, () => {
clearInterval(pingInterval);
});

async function handleAuth(ws, data) {
try {
const player = await getOrCreatePlayer(data.telegramId, data.playerName);
ws.telegramId = data.telegramId;
ws.playerData = player;

```
sendMessage(ws, {
  type: 'authSuccess',
  player: {
    telegramId: player.telegramId,
    name: player.name,
    elo: player.elo,
    level: player.level,
    levelIcon: getLevelIcon(player.level),
    wins: player.wins,
    losses: player.losses,
    gamesPlayed: player.gamesPlayed
  }
});
```

} catch (error) {
console.error(‘Auth error:’, error);
sendMessage(ws, { type: ‘error’, message: ‘Giriş başarısız’ });
}
}

async function handleFindMatch(ws, data) {
if (!ws.telegramId) {
sendMessage(ws, { type: ‘error’, message: ‘Önce giriş yapmalısınız’ });
return;
}

const playerId = generateRoomCode();
ws.playerId = playerId;
ws.playerName = data.playerName;

const player = await getOrCreatePlayer(ws.telegramId, data.playerName);

playerConnections.set(playerId, ws);
matchQueue.push({
ws,
playerId,
playerName: data.playerName,
telegramId: ws.telegramId,
elo: player.elo,
level: player.level
});

console.log(‘🔍 Oyuncu arama kuyruğuna eklendi:’, data.playerName);

if (matchQueue.length >= 2) {
const player1 = matchQueue.shift();
const player2 = matchQueue.shift();

```
const roomCode = generateRoomCode();
const room = {
  code: roomCode,
  players: {
    [player1.playerId]: { 
      name: player1.playerName,
      telegramId: player1.telegramId,
      elo: player1.elo,
      level: player1.level
    },
    [player2.playerId]: { 
      name: player2.playerName,
      telegramId: player2.telegramId,
      elo: player2.elo,
      level: player2.level
    }
  },
  type: 'ranked'
};

rooms.set(roomCode, room);
player1.ws.roomCode = roomCode;
player2.ws.roomCode = roomCode;

console.log('✨ Eşleşme bulundu! Oda:', roomCode);

const gameState = await initializeGame(roomCode, player1.playerId, player2.playerId, true);

sendMessage(player1.ws, { type: 'matchFound', roomCode });
sendMessage(player2.ws, { type: 'matchFound', roomCode });

setTimeout(() => {
  sendMessage(player1.ws, {
    type: 'gameStart',
    gameState: { ...gameState, playerId: player1.playerId }
  });
  
  sendMessage(player2.ws, {
    type: 'gameStart',
    gameState: { ...gameState, playerId: player2.playerId }
  });
}, 500);
```

}
}

function handleCancelSearch(ws) {
const index = matchQueue.findIndex(p => p.ws === ws);
if (index !== -1) {
matchQueue.splice(index, 1);
}
}

async function handleCreateRoom(ws, data) {
const roomCode = generateRoomCode();
const playerId = generateRoomCode();

ws.playerId = playerId;
ws.playerName = data.playerName;
ws.roomCode = roomCode;

playerConnections.set(playerId, ws);

const room = {
code: roomCode,
players: {
[playerId]: {
name: data.playerName,
telegramId: ws.telegramId || null
}
},
type: ‘private’,
host: playerId
};

rooms.set(roomCode, room);

sendMessage(ws, { type: ‘roomCreated’, roomCode });
}

async function handleJoinRoom(ws, data) {
const room = rooms.get(data.roomCode);

if (!room) {
sendMessage(ws, { type: ‘error’, message: ‘Oda bulunamadı’ });
return;
}

if (Object.keys(room.players).length >= 2) {
sendMessage(ws, { type: ‘error’, message: ‘Oda dolu’ });
return;
}

const playerId = generateRoomCode();
ws.playerId = playerId;
ws.playerName = data.playerName;
ws.roomCode = data.roomCode;

playerConnections.set(playerId, ws);
room.players[playerId] = {
name: data.playerName,
telegramId: ws.telegramId || null
};

const hostId = room.host;
const gameState = await initializeGame(data.roomCode, hostId, playerId, false);

setTimeout(() => {
const hostWs = playerConnections.get(hostId);
if (hostWs && hostWs.readyState === WebSocket.OPEN) {
sendMessage(hostWs, {
type: ‘gameStart’,
gameState: { …gameState, playerId: hostId }
});
}

```
sendMessage(ws, {
  type: 'gameStart',
  gameState: { ...gameState, playerId: playerId }
});
```

}, 500);
}

async function handlePlayTile(ws, data) {
const roomCode = ws.roomCode;
const playerId = ws.playerId;
const room = rooms.get(roomCode);

if (!room || !room.gameState) return;

const gameState = room.gameState;

if (gameState.currentPlayer !== playerId) {
sendMessage(ws, { type: ‘error’, message: ‘Sıra sizde değil’ });
return;
}

const player = gameState.players[playerId];
const tile = player.hand[data.tileIndex];

if (!tile) return;

if (gameState.board.length > 0 && !canPlayTile(tile, gameState.board)) {
sendMessage(ws, { type: ‘error’, message: ‘Bu taş oynanamaz’ });
return;
}

player.hand.splice(data.tileIndex, 1);
playTileOnBoard(tile, gameState.board, data.position || ‘both’);

const winner = checkWinner(gameState);

if (winner) {
await handleGameEnd(roomCode, winner, false);
} else {
const playerIds = Object.keys(gameState.players);
gameState.currentPlayer = playerIds.find(id => id !== playerId);
gameState.turn++;

```
for (const pid in gameState.players) {
  sendGameState(roomCode, pid);
}
```

}
}

function handlePass(ws) {
const roomCode = ws.roomCode;
const playerId = ws.playerId;
const room = rooms.get(roomCode);

if (!room || !room.gameState) return;

const gameState = room.gameState;

if (gameState.currentPlayer !== playerId) return;

const playerIds = Object.keys(gameState.players);
gameState.currentPlayer = playerIds.find(id => id !== playerId);
gameState.turn++;

for (const pid in gameState.players) {
sendGameState(roomCode, pid);
}
}

async function handleGameEnd(roomCode, winnerId, leftEarly = false) {
const room = rooms.get(roomCode);
if (!room || !room.gameState) return;

const gameState = room.gameState;
const playerIds = Object.keys(gameState.players);
const loserId = playerIds.find(id => id !== winnerId);

const winner = gameState.players[winnerId];
const loser = gameState.players[loserId];

if (gameState.isRanked && winner.telegramId && loser.telegramId) {
const { winnerPoints, loserPoints } = calculateEloChange(winner, loser, gameState);

```
const winnerUpdate = await updatePlayerElo(winner.telegramId, winnerPoints, true, false, gameState.turn);
const loserUpdate = await updatePlayerElo(loser.telegramId, loserPoints, false, leftEarly, gameState.turn);

broadcastToRoom(roomCode, {
  type: 'gameEnd',
  winner: winnerId,
  winnerName: winner.name,
  ranked: true,
  eloChanges: {
    [winnerId]: winnerUpdate,
    [loserId]: loserUpdate
  }
});

await gamesCollection.insertOne({
  roomCode,
  winner: winner.telegramId,
  loser: loser.telegramId,
  winnerEloChange: winnerPoints,
  loserEloChange: loserPoints,
  turns: gameState.turn,
  leftEarly,
  endTime: new Date(),
  startTime: gameState.startTime
});
```

} else {
broadcastToRoom(roomCode, {
type: ‘gameEnd’,
winner: winnerId,
winnerName: winner.name,
ranked: false
});
}
}

async function handleDisconnect(ws) {
const playerId = ws.playerId;

if (playerId) {
playerConnections.delete(playerId);
}

const queueIndex = matchQueue.findIndex(p => p.ws === ws);
if (queueIndex !== -1) {
matchQueue.splice(queueIndex, 1);
}

if (ws.roomCode) {
const room = rooms.get(ws.roomCode);
if (room && room.gameState) {
const playerIds = Object.keys(room.gameState.players);
const otherPlayerId = playerIds.find(id => id !== playerId);

```
  if (room.gameState.isRanked && otherPlayerId) {
    await handleGameEnd(ws.roomCode, otherPlayerId, true);
  }
  
  broadcastToRoom(ws.roomCode, {
    type: 'playerDisconnected',
    message: 'Rakip oyundan ayrıldı'
  }, playerId);
  
  rooms.delete(ws.roomCode);
}
```

}
}

async function handleGetLeaderboard(ws) {
try {
const top10 = await playersCollection
.find()
.sort({ elo: -1 })
.limit(10)
.toArray();

```
const leaderboard = top10.map((player, index) => ({
  rank: index + 1,
  name: player.name,
  elo: player.elo,
  level: player.level,
  levelIcon: getLevelIcon(player.level),
  wins: player.wins,
  losses: player.losses,
  gamesPlayed: player.gamesPlayed
}));

sendMessage(ws, {
  type: 'leaderboard',
  data: leaderboard
});
```

} catch (error) {
sendMessage(ws, { type: ‘error’, message: ‘Skor tablosu alınamadı’ });
}
}

async function handleGetPlayerStats(ws, data) {
try {
const player = await playersCollection.findOne({ telegramId: data.telegramId });
if (!player) {
sendMessage(ws, { type: ‘error’, message: ‘Oyuncu bulunamadı’ });
return;
}

```
const rank = await playersCollection.countDocuments({ elo: { $gt: player.elo } }) + 1;

sendMessage(ws, {
  type: 'playerStats',
  data: {
    ...player,
    rank,
    levelIcon: getLevelIcon(player.level)
  }
});
```

} catch (error) {
sendMessage(ws, { type: ‘error’, message: ‘Oyuncu istatistikleri alınamadı’ });
}
}

const PORT = process.env.PORT || 10000;

server.listen(PORT, ‘0.0.0.0’, () => {
console.log(`🚀 Domino ELO Sunucusu ${PORT} portunda çalışıyor`);
});
