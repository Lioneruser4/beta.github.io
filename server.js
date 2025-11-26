const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://domino:domino123@cluster0.xxxxx.mongodb.net/domino?retryWrites=true&w=majority')
  .then(() => console.log('MongoDB Bağlandı'))
  .catch(err => console.log('Mongo Hatası:', err));

app.use(express.static(__dirname));

const rooms = {};
const queue = [];

io.on('connection', socket => {
  console.log('Oyuncu:', socket.id);

  socket.on('ranked', () => {
    if (queue.find(s => s.id === socket.id)) return;
    queue.push(socket);
    socket.emit('searching');
    if (queue.length >= 2) {
      const p1 = queue.shift();
      const p2 = queue.shift();
      const room = 'R' + Date.now();
      rooms[room] = { players: [p1.id, p2.id], game: newGame(), type: 'ranked' };
      p1.join(room); p2.join(room);
      p1.emit('match', { room, side: 0 });
      p2.emit('match', { room, side: 1 });
      io.to(room).emit('startGame', rooms[room].game);
    }
  });

  socket.on('cancelRanked', () => {
    queue.splice(queue.indexOf(socket), 1);
    socket.emit('cancelled');
  });

  socket.on('createRoom', () => {
    const code = Math.floor(1000 + Math.random() * 9000) + '';
    rooms[code] = { players: [socket.id], game: newGame(), type: 'private' };
    socket.join(code);
    socket.emit('roomCreated', code);
  });

  socket.on('joinRoom', code => {
    if (!rooms[code] || rooms[code].players.length > 1) return socket.emit('error', 'Oda dolu veya yok!');
    rooms[code].players.push(socket.id);
    socket.join(code);
    socket.emit('joined', { code, side: 1 });
    io.to(code).emit('startGame', rooms[code].game);
  });

  socket.on('playTile', ({ room, tile, side }) => {
    const r = rooms[room];
    if (!r || r.game.turn !== r.players.indexOf(socket.id)) return;
    if (playTile(r.game, tile, side)) {
      io.to(room).emit('update', r.game);
      if (r.game.winner !== null) io.to(room).emit('win', r.game.winner);
    }
  });

  socket.on('disconnect', () => {
    queue.splice(queue.indexOf(socket), 1);
    for (let r in rooms) {
      if (rooms[r].players.includes(socket.id)) {
        io.to(r).emit('opponentLeft');
        delete rooms[r];
      }
    }
  });
});

function newGame() {
  const tiles = [];
  for (let i = 0; i <= 6; i++)
    for (let j = i; j <= 6; j++) tiles.push([i, j]);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return {
    hands: [tiles.splice(0,7), tiles.splice(0,7)],
    board: [],
    ends: [null, null],
    turn: 0,
    winner: null
  };
}

function playTile(g, tile, side) {
  const hand = g.hands[g.turn];
  const idx = hand.findIndex(t => t[0] === tile[0] && t[1] === tile[1]);
  if (idx === -1) return false;

  const left = g.ends[0], right = g.ends[1];
  const canPlay = !g.board.length || tile[0] === left || tile[1] === left || tile[0] === right || tile[1] === right;
  if (!canPlay) return false;

  hand.splice(idx, 1);
  const placed = (side === 'left' && tile[1] === left) || (side === 'right' && tile[0] === right) ? [tile[1], tile[0]] : tile;

  if (side === 'left') {
    g.board.unshift(placed);
    g.ends[0] = placed[0];
  } else {
    g.board.push(placed);
    g.ends[1] = placed[1];
  }
  if (!left) g.ends = [placed[0], placed[1]];

  if (hand.length === 0) g.winner = g.turn;
  g.turn = 1 - g.turn;
  return true;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Domino SUNUCU AÇIK → https://mario-io-1.onrender.com`);
});
