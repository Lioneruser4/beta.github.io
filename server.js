// Sunucu Bağımlılıkları: npm install express socket.io
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const PORT = process.env.PORT || 3000; 

const app = express();
const server = http.createServer(app);

// CORS Ayarı
const io = socketio(server, {
    cors: {
        // İstemcinizin (GitHub Pages) tam URL'sini buraya yazın veya "*" kullanın
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// --- KULLANICI VE EŞLEŞTİRME YÖNETİMİ DEĞİŞKENLERİ ---

// Kullanıcı Kimlikleri Haritası: socket.id'yi kullanıcı verileriyle eşler
const users = {}; // { 'socketId': { username: 'Guest123', isSearching: false } } 

// Dereceli Bekleme Kuyruğu (Queue): Eşleşmeyi bekleyenlerin socket ID'leri
let rankedQueue = []; 

// Oyun Durumları: { 'odaKodu': { ... oyun verileri ... } }
const games = {}; 

// --------------------------------------------------------

// --- DAMA MANTIĞI FONKSİYONLARI ---

function initializeBoard() {
    // 8x8 tahta. 1: Siyah (Player 1), 2: Beyaz (Player 2), 3: Siyah Kral, 4: Beyaz Kral
    const board = Array(8).fill(0).map(() => Array(8).fill(0));
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) board[r][c] = 2; // Beyazlar (Üst, tahtanın üstü)
        }
    }
    for (let r = 5; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) board[r][c] = 1; // Siyahlar (Alt, tahtanın altı)
        }
    }
    return board;
}

function applyMove(board, from, to, pieceType) {
    // Hamle kuralları kontrol edilmeli, şimdilik sadece taşıma ve vurulanı silme
    const jumpedRow = (from.row + to.row) / 2;
    const jumpedCol = (from.col + to.col) / 2;
    
    // Vurma/Zıplama kontrolü
    if (Math.abs(from.row - to.row) === 2) {
        board[jumpedRow][jumpedCol] = 0; // Vurulan taşı sil
    }

    let newPieceType = pieceType;
    
    // Kral olma kontrolü
    if (pieceType === 1 && to.row === 0) newPieceType = 3; // Siyah kral
    if (pieceType === 2 && to.row === 7) newPieceType = 4; // Beyaz kral

    board[to.row][to.col] = newPieceType;
    board[from.row][from.col] = 0;
    
    return board;
}

function generateRoomId() {
    let roomId;
    do {
        roomId = Math.floor(1000 + Math.random() * 9000).toString();
    } while (games[roomId]);
    return roomId;
}

// --- YENİ: EŞLEŞTİRME FONKSİYONU ---
function attemptMatchmaking() {
    // Kuyrukta en az iki oyuncu varsa eşleştirme yap
    if (rankedQueue.length >= 2) {
        const player1Id = rankedQueue.shift(); // İlk oyuncuyu kuyruktan çıkar
        const player2Id = rankedQueue.shift(); // İkinci oyuncuyu kuyruktan çıkar
        
        const player1 = users[player1Id];
        const player2 = users[player2Id];

        // Oyuncu verisi eksikse veya bağlantısı kesilmişse
        if (!player1 || !player2 || !io.sockets.sockets.get(player1Id) || !io.sockets.sockets.get(player2Id)) {
             // Eksik olanları temizle, kalan varsa kuyruğa geri ekle ve tekrar dene
             console.log("Hata: Oyuncu verisi veya bağlantısı eksik. Eşleştirme tekrar denenecek.");
             if (player1 && io.sockets.sockets.get(player1Id)) rankedQueue.unshift(player1Id);
             if (player2 && io.sockets.sockets.get(player2Id)) rankedQueue.unshift(player2Id);
             attemptMatchmaking(); 
             return;
        }

        player1.isSearching = false;
        player2.isSearching = false;
        
        const roomId = generateRoomId();

        games[roomId] = {
            player1Id: player1Id,
            player1Name: player1.username,
            player2Id: player2Id,
            player2Name: player2.username,
            board: initializeBoard(),
            turn: 'player1'
        };
        
        // Odalara katıl
        io.sockets.sockets.get(player1Id).join(roomId);
        io.sockets.sockets.get(player2Id).join(roomId);

        console.log(`Dereceli eşleşme bulundu: Oda ${roomId} (${player1.username} vs ${player2.username})`);
        
        // 1. Oyunculara rol ve oda bilgisini gönder (matchFound)
        io.to(player1Id).emit('matchFound', { roomId: roomId, role: 'player1' });
        io.to(player2Id).emit('matchFound', { roomId: roomId, role: 'player2' });

        // 2. Oyunu başlat
        io.to(roomId).emit('gameStart', { 
            board: games[roomId].board, 
            turn: games[roomId].turn,
            player1Name: player1.username,
            player2Name: player2.username
        });

        // Bir sonraki eşleşme için kontrol et
        attemptMatchmaking(); 
    }
}
// -------------------------------------------------------------------


io.on('connection', (socket) => {
    console.log(`Yeni oyuncu bağlandı: ${socket.id}`);

    // --- YENİ: KİMLİK TANIMLAMA (Guest veya Telegram) ---
    socket.on('playerIdentity', (data) => {
        const { username } = data;
        users[socket.id] = { 
            username: username, 
            isSearching: false
        };
        console.log(`Oyuncu kimliği ayarlandı: ${username} (${socket.id})`);
    });

    // --- YENİ: DERECELİ EŞLEŞME ARAMA ---
    socket.on('findRankedMatch', () => {
        const user = users[socket.id];

        if (!user) {
            socket.emit('matchMakingStatus', 'Hata: Kimliğiniz henüz tanımlanmadı.');
            return;
        }

        // Eğer arama yapıyorsa veya zaten kuyruktaysa tekrar ekleme
        if (user.isSearching || rankedQueue.includes(socket.id)) {
            socket.emit('matchMakingStatus', 'Zaten eşleşme aranıyor. Lütfen bekleyin.');
            return;
        }
        
        // Dereceli arama başlat
        user.isSearching = true;
        rankedQueue.push(socket.id);
        socket.emit('matchMakingStatus', `Eşleşme aranıyor... Kuyruktaki sıra: ${rankedQueue.length}`);
        console.log(`${user.username} dereceli arama başlattı. Kuyruk: ${rankedQueue.length}`);

        // Kuyrukta yeterli oyuncu varsa eşleşmeyi tetikle
        attemptMatchmaking(); 
    });

    // --- ÖZEL ODA OLUŞTURMA ---
    socket.on('createGame', (callback) => {
        const user = users[socket.id];
        if (!user) return callback({ success: false, message: 'Kimlik yüklenmedi.' });

        // Dereceli aramayı iptal et (varsa)
        rankedQueue = rankedQueue.filter(id => id !== socket.id);
        user.isSearching = false;
        
        const roomId = generateRoomId();

        games[roomId] = {
            player1Id: socket.id,
            player1Name: user.username,
            player2Id: null,
            player2Name: null,
            board: initializeBoard(),
            turn: 'player1'
        };
        
        socket.join(roomId);
        callback({ success: true, roomId: roomId, role: 'player1' });
        console.log(`Oda ${roomId} oluşturuldu (${user.username}).`);
    });

    // --- ODAYA KATILMA ---
    socket.on('joinGame', (data, callback) => {
        const { roomId } = data;
        const user = users[socket.id];

        if (!user) return callback({ success: false, message: 'Kimlik yüklenmedi.' });
        
        const game = games[roomId];

        if (!game || game.player2Id) {
            callback({ success: false, message: 'Oda dolu veya bulunamadı.' });
            return;
        }
        
        // Dereceli aramayı iptal et (varsa)
        rankedQueue = rankedQueue.filter(id => id !== socket.id);
        user.isSearching = false;
        
        game.player2Id = socket.id;
        game.player2Name = user.username;
        socket.join(roomId);
        callback({ success: true, roomId: roomId, role: 'player2' });

        // İki oyuncu da hazır. Oyunu başlat.
        io.to(roomId).emit('gameStart', { 
            board: game.board, 
            turn: game.turn,
            player1Name: game.player1Name,
            player2Name: game.player2Name
        });
    });

    // --- HAREKET ETME ---
    socket.on('move', (data) => {
        const { roomId, from, to } = data;
        const game = games[roomId];
        
        if (!game) return;

        const isPlayer1 = game.player1Id === socket.id;
        const isPlayer2 = game.player2Id === socket.id;

        const pieceType = game.board[from.row][from.col];
        
        // Sıra Kontrolü
        if ((game.turn === 'player1' && !isPlayer1) || (game.turn === 'player2' && !isPlayer2)) return;
        
        // Taş Tipi Kontrolü (oyuncunun kendi taşı mı?)
        if ((isPlayer1 && (pieceType !== 1 && pieceType !== 3)) || (isPlayer2 && (pieceType !== 2 && pieceType !== 4))) return;
        
        // Hamleyi uygula
        game.board = applyMove(game.board, from, to, pieceType);
        game.turn = game.turn === 'player1' ? 'player2' : 'player1'; // Sırayı değiştir

        // Odanın tüm üyelerine yeni durumu bildir
        io.to(roomId).emit('boardUpdate', { 
            board: game.board, 
            turn: game.turn 
        });
    });

    // --- BAĞLANTI KESİLMESİ ---
    socket.on('disconnect', () => {
        const user = users[socket.id];
        
        if (user) {
            console.log(`Oyuncu ${user.username} ayrıldı: ${socket.id}`);
            
            // 1. Dereceli Kuyruktan çıkar (eğer arama yapıyorsa)
            rankedQueue = rankedQueue.filter(id => id !== socket.id);
            
            // 2. Oyuncunun odasını bul ve diğer oyuncuya haber ver
            for (const roomId in games) {
                if (games[roomId].player1Id === socket.id || games[roomId].player2Id === socket.id) {
                    const opponentId = games[roomId].player1Id === socket.id ? games[roomId].player2Id : games[roomId].player1Id;
                    
                    // Diğer oyuncu hala bağlıysa haber ver
                    if (io.sockets.sockets.get(opponentId)) {
                        io.to(opponentId).emit('opponentDisconnected', 'Rakibiniz oyundan ayrıldı, kazandınız!');
                    }
                    delete games[roomId]; 
                    console.log(`Oda ${roomId} silindi.`);
                    break;
                }
            }
            // 3. Kullanıcı verisini sil
            delete users[socket.id];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
