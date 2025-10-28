// Dosya Adı: server.js (DOMINO OYUNU)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(express.static(__dirname));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const rooms = {};

// --- DOMINO MANTIĞI YARDIMCI FONKSİYONLAR ---

function createDominoSet() {
    const set = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            set.push({ p1: i, p2: j });
        }
    }
    // Karıştırma
    for (let i = set.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [set[i], set[j]] = [set[j], set[i]];
    }
    return set;
}

function generateRoomCode() {
    let code = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (rooms[code]) {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    return code;
}

function checkValidMove(table, tile, endToPlay) {
    if (table.length === 0) return true; // İlk hamle serbest
    
    const [leftEnd, rightEnd] = [table[0].p1, table[table.length - 1].p2];

    if (endToPlay === 'left') {
        return tile.p1 === leftEnd || tile.p2 === leftEnd;
    } else if (endToPlay === 'right') {
        return tile.p1 === rightEnd || tile.p2 === rightEnd;
    }
    return false;
}

function getPlayableEnds(table) {
    if (table.length === 0) return [0, 0]; // İlk hamle, herhangi bir sayıya eşleşir
    return [table[0].p1, table[table.length - 1].p2];
}

// --- SOCKET.IO Olay Yönetimi ---

io.on('connection', (socket) => {
    
    socket.on('createRoom', ({ username }) => {
        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerCount: 1,
            hostId: socket.id,
            hostUsername: username,
            guestId: null, 
            guestUsername: null, 
            deck: [],
            hostHand: [],
            guestHand: [],
            table: [], // Masadaki taş zinciri
            currentTurn: 0, // 0: Host, 1: Guest
        };
        socket.join(code);
        socket.emit('roomCreated', code);
    });

    socket.on('joinRoom', ({ username, roomCode }) => {
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room || room.playerCount >= 2) {
            socket.emit('joinFailed', 'Oda bulunamadı veya dolu.');
            return;
        }

        room.playerCount = 2;
        room.guestId = socket.id;
        room.guestUsername = username;
        
        // Oyunu Başlat
        room.deck = createDominoSet();
        room.hostHand = room.deck.splice(0, 7);
        room.guestHand = room.deck.splice(0, 7);
        room.table = [];
        room.currentTurn = 0; // Host Başlasın

        socket.join(code);

        // Her iki oyuncuya da başlangıç verilerini gönder
        io.to(room.hostId).emit('gameStart', {
            opponentName: room.guestUsername,
            isHost: true,
            myHand: room.hostHand,
            table: room.table,
            deckSize: room.deck.length,
            initialTurn: room.currentTurn,
        });

        io.to(room.guestId).emit('gameStart', {
            opponentName: room.hostUsername,
            isHost: false,
            myHand: room.guestHand,
            table: room.table,
            deckSize: room.deck.length,
            initialTurn: room.currentTurn,
        });
    });

    // DOMINO HAMLESİ
    socket.on('DOMINO_MOVE', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        const isHostPlayer = socket.id === room.hostId;
        const expectedTurn = isHostPlayer ? 0 : 1;

        if (room.currentTurn !== expectedTurn) return; // Sıra kontrolü

        let playerHand = isHostPlayer ? room.hostHand : room.guestHand;
        const playedTile = playerHand[data.tileIndex];

        if (!playedTile) return; // Geçersiz taş endeksi

        // 1. Geçerlilik Kontrolü
        const isValid = checkValidMove(room.table, playedTile, data.endToPlay);

        if (isValid) {
            // Taşı elden çıkar
            playerHand.splice(data.tileIndex, 1);

            // Taşı masaya yerleştir
            let rotated = false;
            if (room.table.length === 0) {
                // İlk taş: Olduğu gibi koy
                room.table.push(playedTile);
            } else {
                const [leftEnd, rightEnd] = getPlayableEnds(room.table);
                
                if (data.endToPlay === 'left') {
                    if (playedTile.p1 !== leftEnd) { 
                        // Ters çevir
                        [playedTile.p1, playedTile.p2] = [playedTile.p2, playedTile.p1];
                        rotated = true;
                    }
                    room.table.unshift(playedTile);
                } else { // 'right'
                    if (playedTile.p2 !== rightEnd) { 
                        // Ters çevir
                        [playedTile.p1, playedTile.p2] = [playedTile.p2, playedTile.p1];
                        rotated = true;
                    }
                    room.table.push(playedTile);
                }
            }
            
            // Oyun Bitiş Kontrolü
            if (playerHand.length === 0) {
                io.to(data.roomCode).emit('gameOver', { winner: expectedTurn });
                return;
            }

            // Sırayı değiştir ve yeni durumu yay
            room.currentTurn = room.currentTurn === 0 ? 1 : 0;
            io.to(data.roomCode).emit('dominoUpdate', {
                hostHandSize: room.hostHand.length,
                guestHandSize: room.guestHand.length,
                myHand: playerHand,
                table: room.table,
                deckSize: room.deck.length,
                newTurn: room.currentTurn,
                lastMove: { tile: playedTile, tileIndex: data.tileIndex, player: expectedTurn, rotated: rotated }
            });
            
        } else {
            // Geçersiz hamle bildirimi (opsiyonel)
            socket.emit('invalidMove', 'Geçersiz hamle! Taş masanın ucuna uymuyor.');
        }
    });

    // STOKTAN ÇEKME HAMLESİ
    socket.on('DOMINO_DRAW', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        const isHostPlayer = socket.id === room.hostId;
        const expectedTurn = isHostPlayer ? 0 : 1;
        
        if (room.currentTurn !== expectedTurn) return; // Sıra kontrolü

        let playerHand = isHostPlayer ? room.hostHand : room.guestHand;

        if (room.deck.length > 0) {
            // Taş çek
            const newTile = room.deck.pop();
            playerHand.push(newTile);

            // Yeni el durumunu yalnızca çeken oyuncuya gönder
            socket.emit('drawUpdate', { myHand: playerHand, deckSize: room.deck.length });
        
        } else {
            // Stok bitti, sırayı rakibe geçir
            room.currentTurn = room.currentTurn === 0 ? 1 : 0;
            io.to(data.roomCode).emit('dominoUpdate', {
                hostHandSize: room.hostHand.length,
                guestHandSize: room.guestHand.length,
                myHand: isHostPlayer ? room.hostHand : room.guestHand,
                table: room.table,
                deckSize: room.deck.length,
                newTurn: room.currentTurn,
                lastMove: { tile: {p1: -1, p2: -1}, player: expectedTurn, drew: true } // Çekme hamlesi sinyali
            });
        }
    });
    
    // ... (disconnect ve diğer event'ler burada kalır)
    socket.on('disconnect', () => {
        for (const code in rooms) {
            const room = rooms[code];
            if (room.hostId === socket.id || room.guestId === socket.id) {
                const opponentId = (room.hostId === socket.id) ? room.guestId : room.hostId;
                
                if (opponentId) {
                    io.to(opponentId).emit('opponentLeft', 'Rakibiniz bağlantıyı kesti. Lobiye dönülüyor.');
                }
                
                if (room.hostId === socket.id) {
                    delete rooms[code];
                } 
                else if (room.guestId === socket.id) {
                    room.playerCount = 1;
                    room.guestId = null;
                    room.guestUsername = null;
                }
            }
        }
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu port ${PORT} üzerinde çalışıyor.`);
});
