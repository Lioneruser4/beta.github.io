const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const { MongoClient } = require('mongodb');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const MONGO_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test';

let db;
let usersCollection;
let matchesCollection;

const mongoClient = new MongoClient(MONGO_URI);

async function initDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('domino');
    usersCollection = db.collection('users');
    matchesCollection = db.collection('matches');
    await usersCollection.createIndex({ telegramId: 1 }, { unique: true, sparse: true });
    console.log('MongoDB bağlandı');
  } catch (e) {
    console.error('DB Hatası:', e.message);
  }
}

const rooms = new Map();
const clients = new Map();
let matchmakingQueue = [];

function generateCode() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, '0');
}

function calculateELOChange(winnerELO, loserELO, isRanked, partialPlay = false) {
  if (!isRanked) return { winner: 0, loser: 0 };
  
  const maxChange = 20;
  const minChange = 12;
  const expectedWinner = 1 / (1 + Math.pow(10, (loserELO - winnerELO) / 400));
  const change = minChange + (maxChange - minChange) * expectedWinner;
  
  if (partialPlay) {
    return { 
      winner: Math.max(10, Math.round(change)), 
      loser: -Math.max(10, Math.round(change)) 
    };
  }
  return { 
    winner: Math.round(change), 
    loser: -Math.round(change) 
  };
}

function getLevel(elo) {
  const baseLevel = Math.floor(elo / 100);
  return Math.min(baseLevel, 10);
}

function getLevelColor(level) {
  if (level <= 3) return 'sarı';
  if (level <= 6) return 'mavi';
  return 'qızıl';
}

function getLevelIcon(level) {
  const icons = ['⭐', '⭐⭐', '⭐⭐⭐', '🥉', '🥈', '🥇', '💎', '💎💎', '🔥', '👑'];
  return icons[Math.max(0, level - 1)];
}

async function createOrGetUser(telegramId, firstName) {
  const user = await usersCollection.findOne({ telegramId });
  if (user) return user;
  
  const newUser = {
    telegramId,
    firstName,
    elo: 1000,
    level: 1,
    wins: 0,
    losses: 0,
    createdAt: new Date(),
    lastMatch: new Date()
  };
  await usersCollection.insertOne(newUser);
  return newUser;
}

async function updateUserELO(telegramId, eloChange, isWin) {
  const result = await usersCollection.findOneAndUpdate(
    { telegramId },
    {
      $inc: { 
        elo: eloChange,
        [isWin ? 'wins' : 'losses']: 1
      },
      $set: { lastMatch: new Date() }
    },
    { returnDocument: 'after' }
  );
  return result.value;
}

async function getLeaderboard() {
  return await usersCollection
    .find({})
    .sort({ elo: -1 })
    .limit(10)
    .toArray();
}

async function getUserRank(telegramId) {
  const count = await usersCollection.countDocuments({ elo: { $gt: (await usersCollection.findOne({ telegramId })).elo } });
  return count + 1;
}

wss.on('connection', (ws) => {
  let clientId = Math.random().toString(36).slice(2);
  let clientUser = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'auth') {
        const telegramData = msg.data;
        if (telegramData && telegramData.id) {
          clientUser = await createOrGetUser(telegramData.id, telegramData.first_name || 'Oyuncu');
          clientId = telegramData.id.toString();
          clients.set(clientId, { ws, user: clientUser, roomId: null });
          ws.send(JSON.stringify({ type: 'auth_ok', user: clientUser }));
        }
      } else if (msg.type === 'join_matchmaking') {
        if (!clientUser) return;
        matchmakingQueue.push({ clientId, ws, user: clientUser });
        ws.send(JSON.stringify({ type: 'status', message: 'Rəqib axtarılır...' }));

        if (matchmakingQueue.length >= 2) {
          const p1 = matchmakingQueue.shift();
          const p2 = matchmakingQueue.shift();
          const roomId = Math.random().toString(36).slice(2);
          const room = {
            id: roomId,
            code: '',
            players: [
              { id: p1.clientId, name: p1.user.firstName, elo: p1.user.elo, level: p1.user.level, hand: [], user: p1.user },
              { id: p2.clientId, name: p2.user.firstName, elo: p2.user.elo, level: p2.user.level, hand: [], user: p2.user }
            ],
            table: [],
            currentTurn: 0,
            gameState: 'playing',
            matchType: 'ranked',
            startTime: Date.now()
          };
          rooms.set(roomId, room);
          clients.set(p1.clientId, { ws: p1.ws, user: p1.user, roomId });
          clients.set(p2.clientId, { ws: p2.ws, user: p2.user, roomId });

          const game = require('./game.js');
          const gameState = game.initializeGame(room.players.length);
          room.players[0].hand = gameState.hands[0];
          room.players[1].hand = gameState.hands[1];
          room.table = gameState.table;

          broadcast(roomId, {
            type: 'game_start',
            players: room.players.map(p => ({ id: p.id, name: p.name, elo: p.elo, level: getLevel(p.elo), levelIcon: getLevelIcon(getLevel(p.elo)) })),
            currentTurn: 0,
            table: room.table,
            myHand: room.players[0].hand
          });
        }
      } else if (msg.type === 'create_room') {
        if (!clientUser) return;
        const roomId = Math.random().toString(36).slice(2);
        const code = generateCode();
        const room = {
          id: roomId,
          code,
          players: [{ id: clientId, name: clientUser.firstName, elo: clientUser.elo, level: clientUser.level, hand: [], user: clientUser }],
          table: [],
          currentTurn: 0,
          gameState: 'waiting',
          matchType: 'private',
          startTime: null
        };
        rooms.set(roomId, room);
        clients.set(clientId, { ws, user: clientUser, roomId });
        ws.send(JSON.stringify({ type: 'room_created', code, roomId }));
      } else if (msg.type === 'join_room') {
        if (!clientUser) return;
        const room = Array.from(rooms.values()).find(r => r.code === msg.code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Oda tapılmadı' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: 'Oda doludur' }));
          return;
        }
        room.players.push({ id: clientId, name: clientUser.firstName, elo: clientUser.elo, level: clientUser.level, hand: [], user: clientUser });
        clients.set(clientId, { ws, user: clientUser, roomId: room.id });

        const game = require('./game.js');
        const gameState = game.initializeGame(room.players.length);
        room.players[0].hand = gameState.hands[0];
        room.players[1].hand = gameState.hands[1];
        room.table = gameState.table;

        broadcast(room.id, {
          type: 'game_start',
          players: room.players.map(p => ({ id: p.id, name: p.name, elo: p.elo, level: getLevel(p.elo), levelIcon: getLevelIcon(getLevel(p.elo)) })),
          currentTurn: 0,
          table: room.table,
          myHand: room.players[0].hand
        });
      } else if (msg.type === 'play_domino') {
        const client = clients.get(clientId);
        if (!client) return;
        const room = rooms.get(client.roomId);
        if (!room) return;

        const playerIdx = room.players.findIndex(p => p.id === clientId);
        if (playerIdx !== room.currentTurn) return;

        const player = room.players[playerIdx];
        const dominoIdx = player.hand.findIndex(d => d.left === msg.domino.left && d.right === msg.domino.right);
        if (dominoIdx === -1) return;

        const domino = player.hand.splice(dominoIdx, 1)[0];
        const game = require('./game.js');
        game.playDomino(domino, room.table, msg.atEnd ?? true);

        if (player.hand.length === 0) {
          const loserIdx = (playerIdx + 1) % 2;
          const matchDuration = (Date.now() - room.startTime) / 1000;
          const isHalfGame = matchDuration < 30;

          if (room.matchType === 'ranked') {
            const winnerELO = player.elo;
            const loserELO = room.players[loserIdx].elo;
            const changes = calculateELOChange(winnerELO, loserELO, true, isHalfGame);

            await updateUserELO(clientId, changes.winner, true);
            await updateUserELO(room.players[loserIdx].id, changes.loser, false);

            const winner = await usersCollection.findOne({ telegramId: parseInt(clientId) });
            const loser = await usersCollection.findOne({ telegramId: parseInt(room.players[loserIdx].id) });

            await matchesCollection.insertOne({
              winner: { id: clientId, name: player.name, elo: winner.elo },
              loser: { id: room.players[loserIdx].id, name: room.players[loserIdx].name, elo: loser.elo },
              eloChange: changes.winner,
              timestamp: new Date(),
              matchType: 'ranked'
            });
          }

          broadcast(client.roomId, { 
            type: 'game_end', 
            winner: clientId, 
            winnerName: player.name,
            eloChange: room.matchType === 'ranked' ? calculateELOChange(player.elo, room.players[loserIdx].elo, true, isHalfGame).winner : 0
          });
          rooms.delete(client.roomId);
          return;
        }

        room.currentTurn = (room.currentTurn + 1) % room.players.length;

        broadcast(client.roomId, {
          type: 'move_played',
          table: room.table,
          currentTurn: room.currentTurn,
          myHand: room.players[room.currentTurn].hand,
          playerHands: room.players.map(p => p.hand.length)
        });
      } else if (msg.type === 'get_leaderboard') {
        const lb = await getLeaderboard();
        const formatted = lb.map((u, i) => ({
          rank: i + 1,
          name: u.firstName,
          elo: u.elo,
          level: getLevel(u.elo),
          levelIcon: getLevelIcon(getLevel(u.elo)),
          wins: u.wins,
          losses: u.losses
        }));
        ws.send(JSON.stringify({ type: 'leaderboard', data: formatted }));

        if (clientUser) {
          const rank = await getUserRank(clientUser.telegramId);
          ws.send(JSON.stringify({ type: 'my_rank', rank }));
        }
      } else if (msg.type === 'get_profile') {
        if (clientUser) {
          const updated = await usersCollection.findOne({ telegramId: clientUser.telegramId });
          ws.send(JSON.stringify({ 
            type: 'profile',
            user: {
              name: updated.firstName,
              elo: updated.elo,
              level: getLevel(updated.elo),
              levelIcon: getLevelIcon(getLevel(updated.elo)),
              wins: updated.wins,
              losses: updated.losses
            }
          }));
        }
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client && client.roomId) {
      const room = rooms.get(client.roomId);
      if (room) {
        broadcast(client.roomId, { type: 'player_left' });
        rooms.delete(client.roomId);
      }
    }
    clients.delete(clientId);
    matchmakingQueue = matchmakingQueue.filter(q => q.clientId !== clientId);
  });
});

function broadcast(roomId, message) {
  const msg = JSON.stringify(message);
  for (const [, client] of clients) {
    if (client.roomId === roomId && client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

const PORT = parseInt(process.env.PORT || '5000');
server.listen(PORT, '0.0.0.0', async () => {
  await initDB();
  console.log(`Server ${PORT} portunda çalışıyor`);
});
