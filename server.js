// Dosya Adı: server.js (DOMINO V2 - GELİŞTİRİLMİŞ KURALLAR)
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

/**
 * Taşın geçerli olup olmadığını ve hangi yöne çevrilmesi gerektiğini kontrol eder.
 * @param {Array} table Masadaki taş zinciri.
 * @param {Object} tile Oynanmak istenen taş.
 * @param {string} endToPlay 'left' veya 'right'.
 * @returns {Object|null} { isValid: boolean, rotated: boolean, playedValue: number }
 */
function checkValidMove(table, tile, endToPlay) {
    if (table.length === 0) {
        // İlk hamle
        return { isValid: true, rotated: false, playedValue: tile.p1 }; 
    }
    
    const [leftEnd, rightEnd] = [table[0].p1, table[table.length - 1].p2];
    const targetEnd = endToPlay === 'left' ? leftEnd : rightEnd;
    
    let isValid = false;
    let rotated = false;
    let playedValue = targetEnd; // Hangi sayıya bağlandığı

    if (tile.p1 === targetEnd) {
        isValid = true;
        rotated = false;
    } else if (tile.p2 === targetEnd) {
        isValid = true;
        rotated = true;
    }
    
    return isValid ? { isValid, rotated, playedValue } : null;
}

/**
 * Oyuncunun elinde oynayabileceği taş olup olmadığını kontrol eder.
 */
function hasPlayableTile(hand, table) {
    if (table.length === 0) return true; // İlk hamle daima oynanabilir
    
    const [leftEnd, rightEnd] = [table[0].p1, table[table.length - 1].p2];
    
    return hand.some(tile => 
        tile.p1 === leftEnd || tile.p2 === leftEnd || 
        tile.p1 === rightEnd || tile.p2 === rightEnd
    );
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

        if (room.currentTurn !== expectedTurn) return; 

        let playerHand = isHostPlayer ? room.hostHand : room.guestHand;
        const playedTile = playerHand[data.tileIndex];

        if (!playedTile) return; 

        // 1. Geçerlilik Kontrolü
        const moveCheck = checkValidMove(room.table, playedTile, data.endToPlay);

        if (moveCheck && moveCheck.isValid) {
            
            // Taşı elden çıkar
            const tileToPlay = playerHand.splice(data.tileIndex, 1)[0];
            
            // Taşı çevir (rotated: true ise p1 ve p2 yer değiştirir)
            if (moveCheck.rotated) {
                [tileToPlay.p1, tileToPlay.p2] = [tileToPlay.p2, tileToPlay.p1];
            }

            // Masaya yerleştir
            if (data.endToPlay === 'left') {
                room.table.unshift(tileToPlay);
            } else { // 'right'
                room.table.push(tileToPlay);
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
                myHand: playerHand, // Sadece bu oyuncunun elini güncel tutar
                table: room.table,
                deckSize: room.deck.length,
                newTurn: room.currentTurn,
                lastMove: { tile: tileToPlay, player: expectedTurn, rotated: moveCheck.rotated }
            });
            
        } else {
            // Geçersiz hamle bildirimi
            socket.emit('invalidMove', `Geçersiz hamle! Taş masanın ${data.endToPlay === 'left' ? 'sol' : 'sağ'} ucuna uymuyor.`);
        }
    });

    // STOKTAN ÇEKME HAMLESİ
    socket.on('DOMINO_DRAW', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        const isHostPlayer = socket.id === room.hostId;
        const expectedTurn = isHostPlayer ? 0 : 1;
        
        if (room.currentTurn !== expectedTurn) return; 

        let playerHand = isHostPlayer ? room.hostHand : room.guestHand;

        // Kural Kontrolü: Oynanabilir taş var mı?
        if (hasPlayableTile(playerHand, room.table)) {
            socket.emit('invalidMove', 'Elinde oynanabilir taş varken stoktan çekemezsin!');
            return;
        }

        if (room.deck.length > 0) {
            // Taş çek
            const newTile = room.deck.pop();
            playerHand.push(newTile);

            // Yeni el durumunu yalnızca çeken oyuncuya gönder
            socket.emit('drawUpdate', { myHand: playerHand, deckSize: room.deck.length });

            // Çekilen taşla oynayabiliyor mu?
            if (hasPlayableTile(playerHand, room.table)) {
                // Oynayabilir, sıra hala onda (sadece durum bildirimi)
                io.to(data.roomCode).emit('infoMessage', { message: `${isHostPlayer ? room.hostUsername : room.guestUsername} stoktan çekti. Şimdi oyna!` });
            } else {
                // Hala oynayamaz, sırayı rakibe geçir (PAS)
                room.currentTurn = room.currentTurn === 0 ? 1 : 0;
                io.to(data.roomCode).emit('dominoUpdate', {
                    hostHandSize: room.hostHand.length,
                    guestHandSize: room.guestHand.length,
                    myHand: playerHand, // Kendi eli güncellensin
                    table: room.table,
                    deckSize: room.deck.length,
                    newTurn: room.currentTurn,
                    lastMove: { tile: {p1: -1, p2: -1}, player: expectedTurn, passed: true } // PAS sinyali
                });
            }
        
        } else {
            // Stok bitti, pas geç
            room.currentTurn = room.currentTurn === 0 ? 1 : 0;
            io.to(data.roomCode).emit('dominoUpdate', {
                hostHandSize: room.hostHand.length,
                guestHandSize: room.guestHand.length,
                myHand: playerHand,
                table: room.table,
                deckSize: room.deck.length,
                newTurn: room.currentTurn,
                lastMove: { tile: {p1: -1, p2: -1}, player: expectedTurn, passed: true } // PAS sinyali
            });
        }
    });
    
    // ... (disconnect event'i aynı kalır)
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
