const WebSocket = require(‘ws’);
const http = require(‘http’);
const express = require(‘express’);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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

function initializeGame(roomCode, player1Id, player2Id) {
const tiles = createDominoSet();
const player1Hand = tiles.slice(0, 7);
const player2Hand = tiles.slice(7, 14);

const room = rooms.get(roomCode);
room.gameState = {
board: [],
players: {
[player1Id]: {
hand: player1Hand,
name: room.players[player1Id].name
},
[player2Id]: {
hand: player2Hand,
name: room.players[player2Id].name
}
},
currentPlayer: player1Id,
turn: 1,
lastMove: null
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

if (position === ‘left’) {
if (tile[1] === leftEnd) {
board.unshift(tile);
} else if (tile[0] === leftEnd) {
board.unshift([tile[1], tile[0]]);
}
} else if (position === ‘right’) {
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
ws.send(JSON.stringify(message));
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

ws.send(JSON.stringify({
type: ‘gameUpdate’,
gameState: gameState
}));
}

wss.on(‘connection’, (ws) => {
console.log(‘Yeni bağlantı kuruldu’);

ws.on(‘message’, (message) => {
try {
const data = JSON.parse(message);

```
  switch (data.type) {
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
  }
} catch (error) {
  console.error('Mesaj işleme hatası:', error);
}
```

});

ws.on(‘close’, () => {
handleDisconnect(ws);
});
});

function handleFindMatch(ws, data) {
const playerId = generateRoomCode();
ws.playerId = playerId;
ws.playerName = data.playerName;

playerConnections.set(playerId, ws);
matchQueue.push({ ws, playerId, playerName: data.playerName });

if (matchQueue.length >= 2) {
const player1 = matchQueue.shift();
const player2 = matchQueue.shift();

```
const roomCode = generateRoomCode();
const room = {
  code: roomCode,
  players: {
    [player1.playerId]: { name: player1.playerName },
    [player2.playerId]: { name: player2.playerName }
  },
  type: 'ranked'
};

rooms.set(roomCode, room);
player1.ws.roomCode = roomCode;
player2.ws.roomCode = roomCode;

const gameState = initializeGame(roomCode, player1.playerId, player2.playerId);

player1.ws.send(JSON.stringify({
  type: 'matchFound',
  roomCode: roomCode
}));

player2.ws.send(JSON.stringify({
  type: 'matchFound',
  roomCode: roomCode
}));

setTimeout(() => {
  sendGameState(roomCode, player1.playerId);
  sendGameState(roomCode, player2.playerId);
  
  player1.ws.send(JSON.stringify({
    type: 'gameStart',
    gameState: { ...gameState, playerId: player1.playerId }
  }));
  
  player2.ws.send(JSON.stringify({
    type: 'gameStart',
    gameState: { ...gameState, playerId: player2.playerId }
  }));
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

function handleCreateRoom(ws, data) {
const roomCode = generateRoomCode();
const playerId = generateRoomCode();

ws.playerId = playerId;
ws.playerName = data.playerName;
ws.roomCode = roomCode;

playerConnections.set(playerId, ws);

const room = {
code: roomCode,
players: {
[playerId]: { name: data.playerName }
},
type: ‘private’,
host: playerId
};

rooms.set(roomCode, room);

ws.send(JSON.stringify({
type: ‘roomCreated’,
roomCode: roomCode
}));
}

function handleJoinRoom(ws, data) {
const room = rooms.get(data.roomCode);

if (!room) {
ws.send(JSON.stringify({
type: ‘error’,
message: ‘Oda bulunamadı’
}));
return;
}

if (Object.keys(room.players).length >= 2) {
ws.send(JSON.stringify({
type: ‘error’,
message: ‘Oda dolu’
}));
return;
}

const playerId = generateRoomCode();
ws.playerId = playerId;
ws.playerName = data.playerName;
ws.roomCode = data.roomCode;

playerConnections.set(playerId, ws);
room.players[playerId] = { name: data.playerName };

const hostId = room.host;
const gameState = initializeGame(data.roomCode, hostId, playerId);

setTimeout(() => {
sendGameState(data.roomCode, hostId);
sendGameState(data.roomCode, playerId);

```
const hostWs = playerConnections.get(hostId);
if (hostWs && hostWs.readyState === WebSocket.OPEN) {
  hostWs.send(JSON.stringify({
    type: 'gameStart',
    gameState: { ...gameState, playerId: hostId }
  }));
}

ws.send(JSON.stringify({
  type: 'gameStart',
  gameState: { ...gameState, playerId: playerId }
}));
```

}, 500);
}

function handlePlayTile(ws, data) {
const roomCode = ws.roomCode;
const playerId = ws.playerId;
const room = rooms.get(roomCode);

if (!room || !room.gameState) return;

const gameState = room.gameState;

if (gameState.currentPlayer !== playerId) {
ws.send(JSON.stringify({
type: ‘error’,
message: ‘Sıra sizde değil’
}));
return;
}

const player = gameState.players[playerId];
const tile = player.hand[data.tileIndex];

if (!tile) return;

if (gameState.board.length > 0 && !canPlayTile(tile, gameState.board)) {
ws.send(JSON.stringify({
type: ‘error’,
message: ‘Bu taş oynanamaz’
}));
return;
}

player.hand.splice(data.tileIndex, 1);

playTileOnBoard(tile, gameState.board, data.position || ‘right’);

const winner = checkWinner(gameState);

if (winner) {
gameState.winner = winner;
broadcastToRoom(roomCode, {
type: ‘gameEnd’,
winner: winner,
winnerName: gameState.players[winner].name
});
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

function handleDisconnect(ws) {
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
if (room) {
broadcastToRoom(ws.roomCode, {
type: ‘playerDisconnected’,
message: ‘Rakip oyundan ayrıldı’
}, playerId);

```
  rooms.delete(ws.roomCode);
}
```

}
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
