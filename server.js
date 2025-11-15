// Sunucu Bağımlılıkları: npm install express socket.io
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const PORT = process.env.PORT || 3000; 
const app = express();
const server = http.createServer(app);

// CORS ayarı her origin'den bağlantıya izin verir.
const io = socketio(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const users = {}; // Tüm kullanıcıların ID ve isimlerini tutar
let rankedQueue = []; // Dereceli arama kuyruğu
const games = {}; // Aktif oyun odaları

// --- DAMA MANTIĞI FONKSİYONLARI ---

function initializeBoard() {
    const board = Array(8).fill(0).map(() => Array(8).fill(0));
    // Beyaz (P2)
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) board[r][c] = 2; 
        }
    }
    // Siyah (P1)
    for (let r = 5; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) board[r][c] = 1; 
        }
    }
    return board;
}

function generateRoomId() {
    let roomId;
    do {
        // 4 haneli rastgele kod
        roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (games[roomId]);
    return roomId;
}

function removeFromQueue(socketId) {
    const index = rankedQueue.indexOf(socketId);
    if (index > -1) {
        rankedQueue.splice(index, 1);
        if (users[socketId]) users[socketId].isSearching = false;
        return true;
    }
    return false;
}

function attemptMatchmaking() {
    // Sadece bağlı ve arayan oyuncuları işleme al
    rankedQueue = rankedQueue.filter(id => io.sockets.sockets.has(id));

    if (rankedQueue.length >= 2) {
        const player1Id = rankedQueue.shift(); 
        const player2Id = rankedQueue.shift(); 
        
        const player1 = users[player1Id];
        const player2 = users[player2Id];

        if (!player1 || !player2) {
             attemptMatchmaking(); 
             return;
        }

        player1.isSearching = false;
        player2.isSearching = false;
        
        const roomId = generateRoomId();

        // OYUN OLUŞTURMA
        games[roomId] = {
            roomId: roomId,
            player1Id: player1Id,
            player1Name: player1.username,
            player2Id: player2Id,
            player2Name: player2.username,
            board: initializeBoard(),
            turn: 'player1'
        };
        
        // Odalara katılım
        io.sockets.sockets.get(player1Id)?.join(roomId);
        io.sockets.sockets.get(player2Id)?.join(roomId);

        // İstemcilere rolleri bildir
        io.to(player1Id).emit('matchFound', { roomId: roomId, role: 'player1' });
        io.to(player2Id).emit('matchFound', { roomId: roomId, role: 'player2' });

        // Oyunu Başlat
        io.to(roomId).emit('gameStart', { 
            roomId: roomId,
            board: games[roomId].board, 
            turn: games[roomId].turn,
            player1Name: player1.username,
            player2Name: player2.username
        });

        attemptMatchmaking(); // Kuyrukta kalanlar için tekrar dene
    } else {
         // Kuyrukta sadece bir kişi kaldıysa durumunu güncelle
         if(rankedQueue.length === 1 && users[rankedQueue[0]]) {
             io.to(rankedQueue[0]).emit('matchMakingStatus', `Eşleşme aranıyor... Kuyrukta: 1 kişi.`);
         }
    }
}

// Zorunlu vurma, geçerli hamleler, hamle uygulama ve kazanma kontrolü fonksiyonlarının 
// tam içeriği burada varsayılır. Basitlik adına içleri boş bırakılmıştır.
function getValidMoves(board, r, c, player) { return []; } 
function getForcedJumps(board, player) { return []; } 
function applyMove(game, from, to) { return { success: true, board: game.board, turn: 'player2', chained: false }; }
function checkWinCondition(board, nextTurn) { return null; }


// --- SOCKET.IO BAĞLANTILARI ---

io.on('connection', (socket) => {
    // Kullanıcı Kimliği Tanımlama (Telegram/Guest)
    socket.on('playerIdentity', (data) => {
        const { username } = data;
        users[socket.id] = { username: username, isSearching: false };
        socket.emit('readyToPlay'); // Butonları aktif et
    });

    // Dereceli Arama
    socket.on('findRankedMatch', () => {
        const user = users[socket.id];
        if (!user || user.isSearching || rankedQueue.includes(socket.id)) return;
        
        user.isSearching = true;
        rankedQueue.push(socket.id);
        socket.emit('matchMakingStatus', `Eşleşme aranıyor... Kuyrukta: ${rankedQueue.length} kişi.`);

        attemptMatchmaking(); 
    });

    // Dereceli Arama İptali
    socket.on('cancelMatchmaking', () => {
        const removed = removeFromQueue(socket.id);
        if (removed) {
            socket.emit('matchMakingCancelled', 'Eşleşme araması iptal edildi.');
            attemptMatchmaking(); // Diğer oyuncuların durumunu güncelle
        } 
    });

    // Oda Kurma
    socket.on('createGame', (callback) => {
        const user = users[socket.id];
        if (!user) return callback({ success: false, message: 'Kimlik yüklenmedi.' });

        removeFromQueue(socket.id);
        const roomId = generateRoomId();
        
        const game = {
            roomId: roomId,
            player1Id: socket.id,
            player1Name: user.username,
            player2Id: null,
            player2Name: null,
            board: initializeBoard(),
            turn: 'player1'
        };
        games[roomId] = game;
        socket.join(roomId);
        
        callback({ success: true, roomId: roomId, role: 'player1' }); 
    });

    // Odaya Katılma
    socket.on('joinGame', (data, callback) => {
        const { roomId } = data;
        const user = users[socket.id];
        const game = games[roomId];

        if (!user || !game || game.player2Id) {
            return callback({ success: false, message: 'Oda bulunamadı veya dolu.' });
        }

        removeFromQueue(socket.id);
        game.player2Id = socket.id;
        game.player2Name = user.username;
        socket.join(roomId);
        callback({ success: true, roomId: roomId, role: 'player2' });

        // Oyunu başlat
        io.to(roomId).emit('gameStart', { 
            roomId: roomId,
            board: game.board, 
            turn: game.turn,
            player1Name: game.player1Name,
            player2Name: game.player2Name
        });
    });

    // Hamle Yapma
    socket.on('move', (data) => {
        const game = games[data.roomId];
        if (!game) return;
        // ... (Hamle uygulama ve tahta güncelleme mantığı) ...
        // io.to(data.roomId).emit('boardUpdate', { board: game.board, turn: game.turn, chained: result.chained });
    });

    // YENİ: Oyuncu Oyunu Terk Etti (Ayrıl Butonu Fix)
    socket.on('leaveGame', (data) => {
        const { roomId } = data;
        const game = games[roomId];

        if (game) {
            const isPlayer1 = game.player1Id === socket.id;
            const opponentId = isPlayer1 ? game.player2Id : game.player1Id;

            // Rakibe bilgi ver (Eğer bağlıysa)
            if (opponentId && io.sockets.sockets.get(opponentId)) {
                io.to(opponentId).emit('opponentDisconnected', 'Rakibiniz oyundan ayrıldı, kazandınız!');
            }

            // Odayı sil
            delete games[roomId];
            
            // Oyuncuya lobiye dönme sinyali gönder
            socket.emit('gameLeft');
        } else {
             // Oyun zaten bitmiş olabilir
             socket.emit('gameLeft');
        }
    });

    // Bağlantı Kesilmesi
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            removeFromQueue(socket.id);
            // Oyun arama ve silme mantığı aynı kalır
            for (const roomId in games) {
                if (games[roomId].player1Id === socket.id || games[roomId].player2Id === socket.id) {
                    const game = games[roomId];
                    const opponentId = game.player1Id === socket.id ? game.player2Id : game.player1Id;
                    
                    if (opponentId && io.sockets.sockets.get(opponentId)) {
                        io.to(opponentId).emit('opponentDisconnected', 'Rakibiniz bağlantıyı kesti, kazandınız!');
                    }
                    delete games[roomId]; 
                    break;
                }
            }
            delete users[socket.id];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
