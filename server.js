// Sunucu Bağımlılıkları: npm install express socket.io
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

// Render genellikle kendi PORT değişkenini atar
const PORT = process.env.PORT || 3000; 

const app = express();
const server = http.createServer(app);

// **ÇOK ÖNEMLİ:** CORS Ayarı - GitHub Pages'ten gelen isteklere izin verir
const io = socketio(server, {
    cors: {
        // İstemcinizin (GitHub Pages) tam URL'sini buraya yazın veya "*" kullanın
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Oda durumlarını tutacak ana nesne
const games = {}; // { 'odaKodu': { player1Id: '...', player2Id: '...', board: [], turn: 'player1' } }

// --- DAMA MANTIĞI FONKSİYONLARI (BASİTLEŞTİRİLMİŞ) ---
function initializeBoard() {
    // 8x8 tahta. 1: Siyah (Player 1), 2: Beyaz (Player 2), 3: Siyah Kral, 4: Beyaz Kral
    const board = Array(8).fill(0).map(() => Array(8).fill(0));
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) board[r][c] = 2; // Beyazlar (Üst)
        }
    }
    for (let r = 5; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if ((r + c) % 2 !== 0) board[r][c] = 1; // Siyahlar (Alt)
        }
    }
    return board;
}

// Sunucunun hareketleri kontrol edeceği ve uygulayacağı (ÇOK BASİT) fonksiyon
function applyMove(board, from, to, pieceType) {
    // Burada tüm kurallar (çapraz hareket, zıplama, kral olma) kontrol edilmeli.
    // Şimdilik sadece konumu değiştiriyoruz.
    
    // Zıplama/Vurma kontrolü (eğer bir taş zıplandıysa, o taşı sil)
    const jumpedRow = (from.row + to.row) / 2;
    const jumpedCol = (from.col + to.col) / 2;
    if (Math.abs(from.row - to.row) === 2) {
        board[jumpedRow][jumpedCol] = 0; // Vurulan taşı sil
    }

    // Taşı yeni konuma taşı
    let newPieceType = pieceType;
    
    // Kral olma kontrolü
    if (pieceType === 1 && to.row === 0) newPieceType = 3; // Siyah kral
    if (pieceType === 2 && to.row === 7) newPieceType = 4; // Beyaz kral

    board[to.row][to.col] = newPieceType;
    board[from.row][from.col] = 0;
    
    return board;
}
// -------------------------------------------------------------------


io.on('connection', (socket) => {
    console.log(`Yeni oyuncu bağlandı: ${socket.id}`);

    // --- ODA OLUŞTURMA ---
    socket.on('createGame', (data, callback) => {
        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        
        games[roomId] = {
            player1Id: socket.id,
            player1Name: data.username || 'Oyuncu 1',
            player2Id: null,
            board: initializeBoard(),
            turn: 'player1'
        };
        
        socket.join(roomId);
        callback({ success: true, roomId: roomId, role: 'player1' });
        console.log(`Oda ${roomId} oluşturuldu.`);
    });

    // --- ODAYA KATILMA ---
    socket.on('joinGame', (data, callback) => {
        const { roomId, username } = data;
        const game = games[roomId];

        if (!game || game.player2Id) {
            callback({ success: false, message: 'Oda dolu veya bulunamadı.' });
            return;
        }
        
        game.player2Id = socket.id;
        game.player2Name = username || 'Oyuncu 2';
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
        
        // Sıra ve Taş Kontrolü
        if (game.turn === 'player1' && !isPlayer1) return;
        if (game.turn === 'player2' && !isPlayer2) return;
        if (isPlayer1 && (pieceType !== 1 && pieceType !== 3)) return; // Siyah/Siyah Kral değil
        if (isPlayer2 && (pieceType !== 2 && pieceType !== 4)) return; // Beyaz/Beyaz Kral değil
        
        // Gerçek Dama Kural Kontrolleri (Çok karmaşık, bu kısım tam kodda detaylandırılmalı)

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
        // Bağlantısı kesilen oyuncunun odasını bul ve diğer oyuncuya haber ver
        for (const roomId in games) {
            if (games[roomId].player1Id === socket.id || games[roomId].player2Id === socket.id) {
                // Diğer oyuncuya haber ver
                socket.to(roomId).emit('opponentDisconnected', 'Rakibiniz oyundan ayrıldı, kazandınız!');
                delete games[roomId]; 
                console.log(`Oda ${roomId} silindi.`);
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
