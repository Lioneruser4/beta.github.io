const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Static dosyaları sun
app.use(express.static(path.join(__dirname, '/')));

// Gelişmiş CORS ve bağlantı ayarları
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:3000", 
            "http://127.0.0.1:3000",
            "https://beta-github-io.onrender.com"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    // Hem WebSocket hem de HTTP long-polling kullan
    transports: ['websocket', 'polling'],
    pingTimeout: 60000, // 60 saniye
    pingInterval: 25000, // 25 saniyede bir ping
    cookie: false
});

// HTTP isteklerini dinle
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Ana sayfayı sun
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Oda yönetimi için Map kullanıyoruz
const rooms = new Map();

// Seviye başına board boyutu ve bomba sayısı
const BOARD_SIZES = [12, 16, 20];
function bombsPerPlayer(level) {
    // 1. seviye: 2 bomba, her seviyede +1 artsın
    return Math.max(2, 1 + level); // level=1 -> 2, 2->3, 3->4
}

// Oyun için kullanılacak rastgele emojiler
const EMOJIS = ['😀','😎','🦄','🐱','🍀','🍕','🌟','⚽','🎵','🚀','🎲','🥇'];

// Oda kodu oluşturma
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Sunucuyu dinlemeye başla
const PORT = process.env.PORT || 10000; // Render'da 10000 portunu kullan
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`Sunucu çalışıyor: http://${HOST}:${PORT}`);
});

// Oyun durumu yönetimi
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);
    
    // Oda oluşturma
    socket.on('createRoom', ({ username }) => {
        try {
            const roomCode = generateRoomCode();
            
            // Odayı oluştur
            rooms.set(roomCode, {
                players: [{
                    id: socket.id,
                    username: username || 'Oyuncu-' + socket.id.substring(0, 4),
                    isHost: true,
                    score: 0,
                    lives: 3
                }],
                status: 'waiting',
                board: null,
                level: 1,
                currentPlayer: null,
                lastMove: null,
                createdAt: Date.now()
            });
            
            // Oyuncuyu odaya ekle
            socket.join(roomCode);
            
            // Odaya giriş yapıldı bilgisini gönder
            socket.emit('roomCreated', roomCode);
            console.log(`Oda oluşturuldu: ${roomCode} - Kullanıcı: ${username}`);
            
        } catch (error) {
            console.error('Oda oluşturma hatası:', error);
            socket.emit('error', { message: 'Oda oluşturulurken bir hata oluştu.' });
        }
    });
    
    // Odaya katılma işlemi
    socket.on('joinRoom', ({ username, roomCode }) => {
        console.log('Odaya katılma isteği alındı:', { username, roomCode });
        
        try {
            // Odayı bul
            const room = rooms.get(roomCode);
            
            // Oda yoksa hata gönder
            if (!room) {
                console.log('Oda bulunamadı:', roomCode);
                socket.emit('joinFailed', 'Böyle bir oda bulunamadı.');
                return;
            }
            
            // Oda dolu mu kontrol et
            if (room.players.length >= 2) {
                console.log('Oda dolu:', roomCode);
                socket.emit('joinFailed', 'Oda dolu.');
                return;
            }
            
            // Yeni oyuncu bilgisi
            const player = {
                id: socket.id,
                username: username || 'Oyuncu-' + socket.id.substring(0, 4),
                isHost: false,
                score: 0,
                lives: 3
            };
            
            // Oyuncuyu odaya ekle
            room.players.push(player);
            socket.join(roomCode);
            
            console.log(`Kullanıcı odaya eklendi: ${player.username} (${roomCode})`);
            
            // İkinci oyuncu geldiğinde oyunu başlat
            if (room.players.length === 2) {
                console.log('İki oyuncu da hazır, oyun başlıyor:', roomCode);
                
                // Oyun başlangıç zamanını ayarla
                room.status = 'playing';
                
                // Tüm oyunculara oyunun başladığını bildir
                io.to(roomCode).emit('gameStart', {
                    players: room.players,
                    roomCode: roomCode,
                    level: room.level || 1
                });
                
                console.log('Oyun başlatıldı:', roomCode);
            } else {
                // İlk oyuncuya başarılı katılım bilgisi gönder
                socket.emit('joinSuccess', { 
                    roomCode: roomCode,
                    message: 'Odaya başarıyla katıldınız. İkinci oyuncu bekleniyor...'
                });
                console.log('İkinci oyuncu bekleniyor:', roomCode);
            }
        } catch (error) {
            console.error('Odaya katılma hatası:', error);
            socket.emit('joinFailed', 'Odaya katılırken bir hata oluştu.');
        }
    });
    
    // Oyun verilerini işle
    socket.on('gameData', ({ type, roomCode, data }) => {
        try {
            const room = rooms.get(roomCode);
            if (!room) return;
            
            // Oyun verisini diğer oyuncuya ilet
            socket.to(roomCode).emit('gameData', { type, data });
            
        } catch (error) {
            console.error('Oyun verisi işleme hatası:', error);
        }
    });
    
    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        console.log('Bağlantı kesildi:', socket.id);
        
        // Oyuncunun bulunduğu odayı bul
        for (const [roomCode, room] of rooms.entries()) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                console.log(`Oyuncu ayrıldı: ${player.username} (${socket.id})`);
                
                // Diğer oyunculara bildir
                socket.to(roomCode).emit('playerLeft', { 
                    playerId: socket.id,
                    username: player.username
                });
                
                // Oyuncuyu odadan çıkar
                room.players.splice(playerIndex, 1);
                
                // Eğer oda boşsa sil
                if (room.players.length === 0) {
                    rooms.delete(roomCode);
                    console.log(`Oda silindi: ${roomCode}`);
                }
                
                break;
            }
        }
    });

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

// Sunucu zaten yukarıda başlatıldı
