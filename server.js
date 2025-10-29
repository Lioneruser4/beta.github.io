const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Statik dosyalar
app.use(express.static(path.join(__dirname, '/')));

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// CORS ayarları
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Oda yönetimi
const rooms = new Map();

// Oyun için kullanılacak emojiler
const EMOJIS = ['😀', '😎', '🦄', '🐱', '🍀', '🍕', '🌟', '⚽', '🎵', '🚀', '🎲', '🥇'];

// Oda kodu oluşturma
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Oyun durumu yönetimi
io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id);

  // Oda oluşturma
  socket.on('createRoom', ({ username }) => {
    const roomCode = generateRoomCode();
    
    rooms.set(roomCode, {
      code: roomCode,
      players: [{
        id: socket.id,
        username,
        isHost: true,
        bombs: [],
        lives: 3
      }],
      gameState: {
        stage: 'WAITING',
        turn: 0,
        board: [],
        opened: [],
        level: 1
      },
      maxPlayers: 2
    });

    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
    console.log(`Oda oluşturuldu: ${roomCode} - Kullanıcı: ${username}`);
  });

  // Odaya katılma
  socket.on('joinRoom', ({ username, roomCode }) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('joinFailed', 'Geçersiz oda kodu!');
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit('joinFailed', 'Oda dolu!');
      return;
    }

    // Oyuncuyu odaya ekle
    const player = {
      id: socket.id,
      username,
      isHost: false,
      bombs: [],
      lives: 3
    };
    
    room.players.push(player);
    socket.join(roomCode);
    
    // Oyun başlat
    if (room.players.length === room.maxPlayers) {
      startGame(roomCode);
    }
    
    socket.emit('joinSuccess', { roomCode, players: room.players });
    console.log(`${username} odaya katıldı: ${roomCode}`);
  });
  
  // Oyun başlatma
  function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Oyun tahtasını oluştur
    const boardSize = 12; // İlk seviye için 12 kart (4x3)
    const bombCount = 3; // Her oyuncu için 3 bomba
    
    // Tüm olası pozisyonları oluştur ve karıştır
    const positions = Array.from({ length: boardSize }, (_, i) => i);
    shuffleArray(positions);
    
    // Bombaları ata
    room.players[0].bombs = positions.slice(0, bombCount);
    room.players[1].bombs = positions.slice(bombCount, bombCount * 2);
    
    // Oyun tahtasını başlat
    room.gameState.board = Array(boardSize).fill(null);
    room.gameState.stage = 'PLAY';
    room.gameState.turn = 0; // Host başlar
    
    // Tüm oyunculara oyun başlangıç bilgisini gönder
    io.to(roomCode).emit('gameStart', {
      players: room.players,
      gameState: room.gameState,
      roomCode
    });
    
    console.log(`Oyun başladı: ${roomCode}`);
  }
  
  // Dizi karıştırma yardımcı fonksiyonu
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  // Oyun hareketlerini işleme
  socket.on('gameData', ({ type, cardIndex, roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    const opponent = room.players.find(p => p.id !== socket.id);
    
    if (!player || !opponent) return;
    
    switch (type) {
      case 'MOVE':
        handleMove(room, player, opponent, cardIndex, roomCode);
        break;
      // Diğer oyun olayları buraya eklenebilir
    }
  });
  
  // Hamle işleme
  function handleMove(room, player, opponent, cardIndex, roomCode) {
    // Kart zaten açıksa işlem yapma
    if (room.gameState.opened.includes(cardIndex)) return;
    
    // Kartı aç
    room.gameState.opened.push(cardIndex);
    
    // Bomba kontrolü
    const isBomb = opponent.bombs.includes(cardIndex);
    
    // Oyun durumunu güncelle
    if (isBomb) {
      player.lives--;
      
      // Oyun bitiş kontrolü
      if (player.lives <= 0) {
        endGame(room, player, opponent, roomCode);
        return;
      }
    }
    
    // Sırayı değiştir
    room.gameState.turn = room.gameState.turn === 0 ? 1 : 0;
    
    // Tüm oyunculara güncel durumu gönder
    io.to(roomCode).emit('gameUpdate', {
      players: [player, opponent],
      gameState: room.gameState,
      cardIndex,
      isBomb
    });
  }
  
  // Oyun bitişi
  function endGame(room, loser, winner, roomCode) {
    room.gameState.stage = 'ENDED';
    
    io.to(roomCode).emit('gameOver', {
      winner: winner.username,
      loser: loser.username,
      players: room.players
    });
    
    // Odayı temizle
    setTimeout(() => {
      rooms.delete(roomCode);
    }, 10000); // 10 saniye sonra odayı temizle
  }
  
  // Bağlantı kesildiğinde
  socket.on('disconnect', () => {
    console.log('Bağlantı kesildi:', socket.id);
    
    // Oyuncunun bağlı olduğu odayı bul
    for (const [roomCode, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        console.log(`${player.username} oyundan ayrıldı: ${roomCode}`);
        
        // Diğer oyuncuya bildir
        socket.to(roomCode).emit('playerLeft', { username: player.username });
        
        // Odayı kaldır
        rooms.delete(roomCode);
        break;
      }
    }
  });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
