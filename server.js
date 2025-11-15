const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public')); // GitHub Pages'ten değil, Render'dan sun

const rooms = {};
const queue = [];

io.on('connection', (socket) => {
  console.log('Oyuncu bağlandı:', socket.id);

  socket.on('ranked', () => {
    if (queue.length > 0) {
      const opponent = queue.shift();
      const roomId = `ranked_${Date.now()}`;
      rooms[roomId] = { players: [socket.id, opponent.id], turn: 0 };
      socket.join(roomId);
      opponent.join(roomId);
      io.to(roomId).emit('startGame', { roomId, opponent: opponent.id === socket.id ? socket.id : opponent.id });
    } else {
      queue.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('createRoom', () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[code] = { players: [socket.id], creator: socket.id };
    socket.join(code);
    socket.emit('roomCreated', code);
  });

  socket.on('joinRoom', (code) => {
    if (rooms[code] && rooms[code].players.length === 1) {
      rooms[code].players.push(socket.id);
      socket.join(code);
      io.to(code).emit('startGame', { roomId: code });
    } else {
      socket.emit('error', 'Oda dolu veya bulunamadı!');
    }
  });

  socket.on('move', ({ roomId, from, to }) => {
    socket.to(roomId).emit('opponentMove', { from, to });
  });

  socket.on('disconnect', () => {
    queue = queue.filter(s => s.id !== socket.id);
    console.log('Oyuncu ayrıldı:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Checkers Global sunucu çalışıyor → Port: ${PORT}`);
});
