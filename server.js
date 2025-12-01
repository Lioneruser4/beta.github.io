const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/domino?retryWrites=true&w=majority&appName=sayt';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB bağlantısı başarılı!');
}).catch(err => {
  console.error('MongoDB bağlantı hatası:', err);
});

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  elo: { type: Number, default: 100 },
  level: { type: Number, default: 1 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  totalGames: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { telegramId, username } = req.body;

    if (!telegramId || !username) {
      return res.status(400).json({ error: 'Telegram bilgileri eksik' });
    }

    let user = await User.findOne({ telegramId });

    if (!user) {
      user = new User({
        telegramId,
        username,
        elo: 100,
        level: 1
      });
      await user.save();
    }

    res.json({
      success: true,
      user: {
        telegramId: user.telegramId,
        username: user.username,
        elo: user.elo,
        level: user.level,
        wins: user.wins,
        losses: user.losses,
        totalGames: user.totalGames
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Kimlik doğrulama hatası' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const topPlayers = await User.find()
      .sort({ elo: -1 })
      .limit(10)
      .select('username elo level wins losses totalGames');

    res.json({ success: true, leaderboard: topPlayers });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Liderlik tablosu yüklenemedi' });
  }
});

app.get('/api/user-rank/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const user = await User.findOne({ telegramId });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const rank = await User.countDocuments({ elo: { $gt: user.elo } }) + 1;

    res.json({
      success: true,
      rank,
      user: {
        username: user.username,
        elo: user.elo,
        level: user.level
      }
    });
  } catch (error) {
    console.error('Rank error:', error);
    res.status(500).json({ error: 'Sıralama bilgisi alınamadı' });
  }
});

const waitingPlayers = [];
const rooms = new Map();
const playerSockets = new Map();

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function createDominoes() {
  const dominoes = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      dominoes.push([i, j]);
    }
  }
  return dominoes;
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function calculateEloChange(winner, loser, roundsPlayed, totalRounds, gameAbandoned) {
  let points = 0;

  if (gameAbandoned) {
    if (roundsPlayed < totalRounds / 2) {
      points = 10;
    } else {
      points = 20;
    }
  } else {
    points = Math.floor(Math.random() * 9) + 12;
  }

  return points;
}

async function updatePlayerElo(telegramId, points, isWinner) {
  try {
    const user = await User.findOne({ telegramId });
    if (!user) return;

    if (isWinner) {
      user.elo += points;
      user.wins += 1;
    } else {
      user.elo = Math.max(0, user.elo - points);
      user.losses += 1;
    }

    user.totalGames += 1;
    user.level = Math.min(10, Math.floor(user.elo / 100) + 1);

    await user.save();
    return user;
  } catch (error) {
    console.error('ELO güncelleme hatası:', error);
  }
}

io.on('connection', (socket) => {
  console.log('Yeni oyuncu bağlandı:', socket.id);

  socket.emit('server-connected', { message: 'Sunucuya başarıyla bağlandınız!' });

  socket.on('join-ranked', (playerData) => {
    playerSockets.set(socket.id, playerData);

    const existingIndex = waitingPlayers.findIndex(p => p.telegramId === playerData.telegramId);
    if (existingIndex !== -1) {
      waitingPlayers.splice(existingIndex, 1);
    }

    waitingPlayers.push({
      socketId: socket.id,
      ...playerData,
      isRanked: true
    });

    socket.emit('searching', { message: 'Rakip aranıyor...' });

    if (waitingPlayers.length >= 2) {
      const player1 = waitingPlayers.shift();
      const player2 = waitingPlayers.shift();

      const roomCode = generateRoomCode();
      const dominoes = shuffleArray(createDominoes());

      const room = {
        code: roomCode,
        players: [player1, player2],
        dominoes: dominoes,
        player1Hand: dominoes.slice(0, 7),
        player2Hand: dominoes.slice(7, 14),
        board: [],
        currentPlayer: 0,
        isRanked: true,
        gameStarted: true,
        roundsPlayed: 0,
        totalRounds: 28
      };

      rooms.set(roomCode, room);

      io.to(player1.socketId).emit('game-found', {
        roomCode,
        playerIndex: 0,
        opponent: { username: player2.username, level: player2.level, elo: player2.elo },
        hand: room.player1Hand
      });

      io.to(player2.socketId).emit('game-found', {
        roomCode,
        playerIndex: 1,
        opponent: { username: player1.username, level: player1.level, elo: player1.elo },
        hand: room.player2Hand
      });

      setTimeout(() => {
        io.to(player1.socketId).emit('game-start', {
          currentPlayer: 0,
          board: []
        });
        io.to(player2.socketId).emit('game-start', {
          currentPlayer: 0,
          board: []
        });
      }, 1000);
    }
  });

  socket.on('cancel-search', () => {
    const index = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      waitingPlayers.splice(index, 1);
      socket.emit('search-cancelled');
    }
  });

  socket.on('create-room', (playerData) => {
    playerSockets.set(socket.id, playerData);

    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      players: [{ socketId: socket.id, ...playerData }],
      dominoes: null,
      player1Hand: null,
      player2Hand: null,
      board: [],
      currentPlayer: 0,
      isRanked: false,
      gameStarted: false
    };

    rooms.set(roomCode, room);
    socket.emit('room-created', { roomCode });
  });

  socket.on('join-room', (data) => {
    const { roomCode, playerData } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Oda bulunamadı!' });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('error', { message: 'Oda dolu!' });
      return;
    }

    if (room.gameStarted) {
      socket.emit('error', { message: 'Oyun zaten başlamış!' });
      return;
    }

    playerSockets.set(socket.id, playerData);
    room.players.push({ socketId: socket.id, ...playerData });

    const dominoes = shuffleArray(createDominoes());
    room.dominoes = dominoes;
    room.player1Hand = dominoes.slice(0, 7);
    room.player2Hand = dominoes.slice(7, 14);
    room.gameStarted = true;

    io.to(room.players[0].socketId).emit('opponent-joined', {
      opponent: { username: playerData.username, level: playerData.level, elo: playerData.elo },
      hand: room.player1Hand
    });

    socket.emit('game-joined', {
      roomCode,
      playerIndex: 1,
      opponent: { username: room.players[0].username, level: room.players[0].level, elo: room.players[0].elo },
      hand: room.player2Hand
    });

    setTimeout(() => {
      io.to(room.players[0].socketId).emit('game-start', {
        currentPlayer: 0,
        board: []
      });
      io.to(room.players[1].socketId).emit('game-start', {
        currentPlayer: 0,
        board: []
      });
    }, 1000);
  });

  socket.on('play-domino', async (data) => {
    const { roomCode, domino, position, playerIndex } = data;
    const room = rooms.get(roomCode);

    if (!room || room.currentPlayer !== playerIndex) {
      return;
    }

    const hand = playerIndex === 0 ? room.player1Hand : room.player2Hand;
    const dominoIndex = hand.findIndex(d => d[0] === domino[0] && d[1] === domino[1]);

    if (dominoIndex === -1) {
      return;
    }

    hand.splice(dominoIndex, 1);
    room.board.push({ domino, position });
    room.currentPlayer = 1 - room.currentPlayer;
    room.roundsPlayed++;

    room.players.forEach((player, idx) => {
      io.to(player.socketId).emit('domino-played', {
        domino,
        position,
        board: room.board,
        currentPlayer: room.currentPlayer,
        opponentHandCount: idx === 0 ? room.player2Hand.length : room.player1Hand.length
      });
    });

    if (hand.length === 0) {
      const winner = room.players[playerIndex];
      const loser = room.players[1 - playerIndex];

      if (room.isRanked) {
        const points = calculateEloChange(winner, loser, room.roundsPlayed, room.totalRounds, false);

        await updatePlayerElo(winner.telegramId, points, true);
        await updatePlayerElo(loser.telegramId, points, false);

        room.players.forEach((player, idx) => {
          io.to(player.socketId).emit('game-over', {
            winner: playerIndex,
            winnerName: winner.username,
            pointsChanged: points,
            won: idx === playerIndex
          });
        });
      } else {
        room.players.forEach((player, idx) => {
          io.to(player.socketId).emit('game-over', {
            winner: playerIndex,
            winnerName: winner.username,
            won: idx === playerIndex
          });
        });
      }

      rooms.delete(roomCode);
    }
  });

  socket.on('pass-turn', (data) => {
    const { roomCode, playerIndex } = data;
    const room = rooms.get(roomCode);

    if (!room || room.currentPlayer !== playerIndex) {
      return;
    }

    room.currentPlayer = 1 - room.currentPlayer;

    room.players.forEach((player) => {
      io.to(player.socketId).emit('turn-passed', {
        currentPlayer: room.currentPlayer
      });
    });
  });

  socket.on('disconnect', async () => {
    console.log('Oyuncu ayrıldı:', socket.id);

    const waitingIndex = waitingPlayers.findIndex(p => p.socketId === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }

    for (const [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);

      if (playerIndex !== -1) {
        const disconnectedPlayer = room.players[playerIndex];
        const otherPlayerIndex = 1 - playerIndex;

        if (room.players[otherPlayerIndex]) {
          const otherPlayer = room.players[otherPlayerIndex];

          if (room.isRanked && room.gameStarted) {
            const points = calculateEloChange(
              otherPlayer,
              disconnectedPlayer,
              room.roundsPlayed,
              room.totalRounds,
              true
            );

            await updatePlayerElo(otherPlayer.telegramId, points, true);
            await updatePlayerElo(disconnectedPlayer.telegramId, points, false);

            io.to(otherPlayer.socketId).emit('opponent-disconnected', {
              message: 'Rakibiniz oyundan ayrıldı. Kazandınız!',
              pointsGained: points
            });
          } else {
            io.to(otherPlayer.socketId).emit('opponent-disconnected', {
              message: 'Rakibiniz oyundan ayrıldı.'
            });
          }
        }

        rooms.delete(roomCode);
        break;
      }
    }

    playerSockets.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
