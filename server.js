const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
let db;

MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    db = client.db('domino_game');
    console.log('✅ MongoDB bağlandı!');
  })
  .catch(err => console.error('❌ MongoDB hata:', err));

const players = new Map();
const rooms = new Map();
const rankedQueue = [];

function createDominoes() {
  const dominoes = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      dominoes.push([i, j]);
    }
  }
  return shuffleArray(dominoes);
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createGame(player1, player2, isRanked = false) {
  const dominoes = createDominoes();
  return {
    id: Math.random().toString(36).substr(2, 9),
    players: [
      { id: player1.id, name: player1.name, hand: dominoes.slice(0, 7), level: player1.level },
      { id: player2.id, name: player2.name, hand: dominoes.slice(7, 14), level: player2.level }
    ],
    board: [],
    pool: dominoes.slice(14),
    currentPlayer: player1.id,
    isRanked,
    moveCount: 0,
    startTime: Date.now()
  };
}

function getValidMoves(domino, board) {
  if (board.length === 0) return ['left', 'right'];
  
  const moves = [];
  const leftEnd = board[0][0];
  const rightEnd = board[board.length - 1][1];
  
  if (domino.includes(leftEnd)) moves.push('left');
  if (domino.includes(rightEnd)) moves.push('right');
  
  return moves;
}

function playDomino(game, playerId, domino, side) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return false;
  
  const dominoIndex = player.hand.findIndex(d => d[0] === domino[0] && d[1] === domino[1]);
  if (dominoIndex === -1) return false;
  
  const validMoves = getValidMoves(domino, game.board);
  if (!validMoves.includes(side)) return false;
  
  player.hand.splice(dominoIndex, 1);
  
  if (game.board.length === 0) {
    game.board.push(domino);
  } else if (side === 'left') {
    const leftEnd = game.board[0][0];
    const oriented = domino[1] === leftEnd ? domino : [domino[1], domino[0]];
    game.board.unshift(oriented);
  } else {
    const rightEnd = game.board[game.board.length - 1][1];
    const oriented = domino[0] === rightEnd ? domino : [domino[1], domino[0]];
    game.board.push(oriented);
  }
  
  game.moveCount++;
  
  if (player.hand.length === 0) {
    game.winner = playerId;
    return true;
  }
  
  const currentIndex = game.players.findIndex(p => p.id === playerId);
  game.currentPlayer = game.players[(currentIndex + 1) % 2].id;
  
  return true;
}

function calculateElo(game, winnerId) {
  const halfGame = game.moveCount >= 10;
  const basePoints = Math.floor(Math.random() * 9) + 12;
  
  return {
    winner: basePoints,
    loser: halfGame ? -20 : -10
  };
}

async function updatePlayerData(telegramId, eloChange, won) {
  try {
    const collection = db.collection('players');
    const player = await collection.findOne({ telegramId });
    
    if (!player) {
      const newPlayer = {
        telegramId,
        elo: 1000 + eloChange,
        points: Math.abs(eloChange),
        level: 1,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1
      };
      await collection.insertOne(newPlayer);
      return newPlayer;
    }
    
    const newElo = Math.max(0, player.elo + eloChange);
    const newPoints = player.points + Math.abs(eloChange);
    const newLevel = Math.min(10, Math.floor(newPoints / 100) + 1);
    
    await collection.updateOne(
      { telegramId },
      { 
        $set: { elo: newElo, points: newPoints, level: newLevel },
        $inc: won ? { wins: 1 } : { losses: 1 }
      }
    );
    
    return { ...player, elo: newElo, points: newPoints, level: newLevel };
  } catch (err) {
    console.error('❌ updatePlayerData hata:', err);
    return null;
  }
}

wss.on('connection', (ws) => {
  console.log('🔌 Yeni oyuncu bağlandı');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'register':
          const collection = db.collection('players');
          let playerData = await collection.findOne({ telegramId: data.telegramId });
          
          if (!playerData) {
            playerData = {
              telegramId: data.telegramId,
              name: data.name,
              elo: 1000,
              points: 0,
              level: 1,
              wins: 0,
              losses: 0
            };
            await collection.insertOne(playerData);
          }
          
          players.set(ws, { 
            id: data.telegramId, 
            name: data.name,
            elo: playerData.elo,
            level: playerData.level 
          });
          
          ws.send(JSON.stringify({ type: 'playerData', data: playerData }));
          break;
          
        case 'searchRanked':
          const player = players.get(ws);
          if (!player) break;
          
          rankedQueue.push({ player, ws });
          
          if (rankedQueue.length >= 2) {
            const p1 = rankedQueue.shift();
            const p2 = rankedQueue.shift();
            
            const game = createGame(p1.player, p2.player, true);
            rooms.set(game.id, { game, players: [p1, p2] });
            
            p1.ws.send(JSON.stringify({ type: 'matchFound', game }));
            p2.ws.send(JSON.stringify({ type: 'matchFound', game }));
          }
          break;
          
        case 'cancelSearch':
          const idx = rankedQueue.findIndex(q => q.ws === ws);
          if (idx !== -1) rankedQueue.splice(idx, 1);
          break;
          
        case 'createRoom':
          const creator = players.get(ws);
          if (!creator) break;
          
          const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
          rooms.set(roomCode, { creator, ws, waiting: true });
          
          ws.send(JSON.stringify({ type: 'roomCreated', roomCode }));
          break;
          
        case 'joinRoom':
          const room = rooms.get(data.roomCode);
          if (!room || !room.waiting) break;
          
          const joiner = players.get(ws);
          if (!joiner) break;
          
          const friendlyGame = createGame(room.creator, joiner, false);
          rooms.set(friendlyGame.id, { game: friendlyGame, players: [{ ws: room.ws }, { ws }] });
          rooms.delete(data.roomCode);
          
          room.ws.send(JSON.stringify({ type: 'roomJoined', game: friendlyGame }));
          ws.send(JSON.stringify({ type: 'roomJoined', game: friendlyGame }));
          break;
          
        case 'getValidMoves':
          for (const [roomId, roomData] of rooms.entries()) {
            if (!roomData.game) continue;
            const moves = getValidMoves(data.domino, roomData.game.board);
            ws.send(JSON.stringify({ type: 'validMoves', moves }));
          }
          break;
          
        case 'playDomino':
          for (const [roomId, roomData] of rooms.entries()) {
            if (!roomData.game) continue;
            
            const success = playDomino(roomData.game, players.get(ws).id, data.domino, data.side);
            
            if (success) {
              roomData.players.forEach(p => {
                p.ws.send(JSON.stringify({ type: 'gameUpdate', game: roomData.game }));
              });
              
              if (roomData.game.winner) {
                const eloChanges = calculateElo(roomData.game, roomData.game.winner);
                
                if (roomData.game.isRanked) {
                  for (const p of roomData.players) {
                    const playerId = players.get(p.ws).id;
                    const won = playerId === roomData.game.winner;
                    const eloChange = won ? eloChanges.winner : eloChanges.loser;
                    
                    const updated = await updatePlayerData(playerId, eloChange, won);
                    p.ws.send(JSON.stringify({ 
                      type: 'gameEnd', 
                      game: roomData.game,
                      eloChange,
                      playerData: updated
                    }));
                  }
                } else {
                  roomData.players.forEach(p => {
                    p.ws.send(JSON.stringify({ type: 'gameEnd', game: roomData.game }));
                  });
                }
                
                rooms.delete(roomId);
              }
            }
          }
          break;
          
        case 'drawDomino':
          for (const [roomId, roomData] of rooms.entries()) {
            if (!roomData.game || roomData.game.pool.length === 0) continue;
            
            const drawnPlayer = roomData.game.players.find(p => p.id === players.get(ws).id);
            if (drawnPlayer) {
              drawnPlayer.hand.push(roomData.game.pool.pop());
              
              roomData.players.forEach(p => {
                p.ws.send(JSON.stringify({ type: 'gameUpdate', game: roomData.game }));
              });
            }
          }
          break;
          
        case 'getLeaderboard':
          const leaderboardData = await db.collection('players')
            .find()
            .sort({ elo: -1 })
            .limit(100)
            .toArray();
          
          ws.send(JSON.stringify({ type: 'leaderboard', data: leaderboardData }));
          break;
      }
    } catch (err) {
      console.error('❌ Mesaj hata:', err);
    }
  });
  
  ws.on('close', () => {
    const player = players.get(ws);
    if (player) {
      for (const [roomId, roomData] of rooms.entries()) {
        if (roomData.game && roomData.players.some(p => p.ws === ws)) {
          const otherPlayer = roomData.players.find(p => p.ws !== ws);
          if (otherPlayer && roomData.game.isRanked) {
            const halfGame = roomData.game.moveCount >= 10;
            const eloChange = halfGame ? 20 : 10;
            
            updatePlayerData(players.get(otherPlayer.ws).id, eloChange, true);
            updatePlayerData(player.id, halfGame ? -20 : -10, false);
            
            otherPlayer.ws.send(JSON.stringify({ 
              type: 'gameEnd', 
              game: { ...roomData.game, winner: players.get(otherPlayer.ws).id },
              eloChange
            }));
          }
          rooms.delete(roomId);
        }
      }
      
      players.delete(ws);
      console.log('👋 Oyuncu ayrıldı');
    }
  });
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Domino Game Server',
    timestamp: new Date(),
    connections: wss.clients.size 
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    players: players.size,
    rooms: rooms.size,
    queue: rankedQueue.length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server çalışıyor: Port ${PORT}`);
  console.log(`📡 WebSocket hazır`);
});
