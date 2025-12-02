const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// --- Sunucu Durumu (In-Memory State) ---
// Aktif oyun odalarını tutar. Key: roomCode, Value: room nesnesi
const rooms = new Map();
// Eşleşme bekleyen oyuncuları tutar.
let matchQueue = [];
// Aktif WebSocket bağlantılarını ve ilişkili oyuncu/oda bilgilerini tutar.
// Key: WebSocket nesnesi, Value: { playerId, roomCode }
const playerConnections = new Map();

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Domino WebSocket Server',
        activeConnections: playerConnections.size,
        activeRooms: rooms.size,
        playersInQueue: matchQueue.length
    });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- YARDIMCI FONKSİYONLAR ---

/** Güvenli bir şekilde istemciye JSON mesajı gönderir. */
function sendMessage(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Mesaj gönderme hatası:', error);
        }
    }
}

/** Bir odadaki tüm oyunculara mesaj yayınlar. */
function broadcastToRoom(roomCode, message, excludePlayerId = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.forEach(player => {
        if (player.telegramId !== excludePlayerId) {
            sendMessage(player.ws, message);
        }
    }); 
}

/** 4 haneli rastgele bir oda kodu üretir. */
function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms.has(code)); // Kodun benzersiz olduğundan emin ol
    return code;
}

/** Standart bir domino setini (28 taş) oluşturur. */
function createDominoSet() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return shuffleArray(tiles);
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** İki oyuncu için domino oyununu başlatır ve başlangıç durumunu ayarlar. */
function initializeGame(player1, player2) {
    const tiles = createDominoSet();
    const player1Hand = tiles.slice(0, 7);
    const player2Hand = tiles.slice(7, 14);
    const market = tiles.slice(14);

    // En yüksek çift taşa sahip oyuncuyu bularak başlayacak oyuncuyu belirle
    let highestDouble = -1;
    let startingPlayerId = player1.telegramId; // Varsayılan olarak ilk oyuncu başlar

    const checkHand = (hand, playerId) => {
        for (const tile of hand) {
            if (tile[0] === tile[1] && tile[0] > highestDouble) {
                highestDouble = tile[0];
                startingPlayerId = playerId;
            }
        }
    };

    checkHand(player1Hand, player1.telegramId);
    checkHand(player2Hand, player2.telegramId);

    console.log(`Oyun başlangıcı: En yüksek çift ${highestDouble}. Başlayan: ${startingPlayerId}`);

    return {
        board: [],
        players: {
            [player1.telegramId]: { hand: player1Hand, username: player1.username },
            [player2.telegramId]: { hand: player2Hand, username: player2.username }
        },
        market: market,
        currentPlayer: startingPlayerId,
        turn: 1,
        lastMove: null,
        gameStartedAt: Date.now()
    };
}

/** Belirli bir oyuncuya güncel oyun durumunu gönderir. */
function sendGameState(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState) return;

    room.players.forEach(player => {
        const opponent = room.players.find(p => p.telegramId !== player.telegramId);
        const gameStateForPlayer = {
            type: 'gameUpdate',
            gameState: {
                board: room.gameState.board,
                myHand: room.gameState.players[player.telegramId].hand,
                opponentHandSize: opponent ? room.gameState.players[opponent.telegramId].hand.length : 0,
                marketSize: room.gameState.market.length,
                currentTurn: room.gameState.currentPlayer,
                isMyTurn: room.gameState.currentPlayer === player.telegramId
            }
        };
        sendMessage(player.ws, gameStateForPlayer);
    });
}

// --- WEBSOCKET EVENTLERİ ---

wss.on('connection', (ws, req) => {
    console.log('🔌 Yeni bir istemci bağlandı.');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Gelen mesaja göre ilgili fonksiyonu çağır
            // data.type yerine doğrudan data objesini gönderiyoruz
            if (data.type && typeof handlers[data.type] === 'function') {
                handlersdata.type;
            } else {
                console.warn('Bilinmeyen mesaj tipi:', data.type);
            }
        } catch (error) {
            console.error('Gelen mesaj işlenirken hata:', error);
        }
    });

    ws.on('close', () => handleDisconnect(ws));

    sendMessage(ws, { type: 'connected', message: 'Sunucuya başarıyla bağlandınız.' });
});

// --- MESAJ İŞLEYİCİLER (Handlers) ---

const handlers = {
    /** Eşleşme arama isteğini işler. */
    findMatch: (ws, data) => {
        const { telegramId, isGuest = false, gameType = 'friendly', playerData = {} } = data;
        if (!telegramId) {
            return sendMessage(ws, { type: 'error', message: 'Eşleşme için `telegramId` gereklidir.' });
        }

        // 1. Bu oyuncunun kuyruktaki eski kayıtlarını temizle
        matchQueue = matchQueue.filter(p => p.telegramId !== telegramId);

        // 2. Yeni oyuncu nesnesi oluştur
        const player = {
            ws,
            telegramId,
            username: playerData.username || (isGuest ? `Guest_${Math.floor(Math.random() * 10000)}` : 'Player'),
            elo: playerData.elo || 0,
            isGuest,
            gameType,
            playerData
        };

        // 3. Rakip ara
        const opponentIndex = matchQueue.findIndex(
            p => p.gameType === player.gameType && p.telegramId !== player.telegramId
        );

        if (opponentIndex !== -1) {
            // 4. Rakip bulundu!
            const opponent = matchQueue.splice(opponentIndex, 1)[0];
            console.log(`✅ Eşleşme bulundu: ${player.username} vs ${opponent.username}`);

            // Renkleri ata (istemci dama oyunu olduğu için 'red'/'white' kullanılıyor)
            player.color = 'red';
            opponent.color = 'white';

            // Yeni bir oyun odası oluştur
            const roomCode = generateRoomCode();
            const room = {
                code: roomCode,
                players: [player, opponent],
                status: 'playing',
                gameType: player.gameType,
                createdAt: new Date()
            };

            // Oyunu başlat (Domino mantığı)
            room.gameState = initializeGame(player, opponent);
            rooms.set(roomCode, room);

            // Her iki oyuncunun bağlantı bilgilerini kaydet
            playerConnections.set(player.ws, { playerId: player.telegramId, roomCode });
            playerConnections.set(opponent.ws, { playerId: opponent.telegramId, roomCode });

            // Her iki oyuncuya da eşleşme bulunduğunu bildir
            sendMessage(player.ws, {
                type: 'matchFound',
                roomCode,
                color: player.color,
                opponent: { username: opponent.username, elo: opponent.elo },
                gameState: room.gameState
            });

            sendMessage(opponent.ws, {
                type: 'matchFound',
                roomCode,
                color: opponent.color,
                opponent: { username: player.username, elo: player.elo },
                gameState: room.gameState
            });

        } else {
            // 5. Rakip bulunamadı, kuyruğa ekle
            matchQueue.push(player);
            playerConnections.set(ws, { playerId: player.telegramId, roomCode: null }); // Henüz odası yok
            console.log(`⏳ ${player.username} (${gameType}) kuyruğa eklendi. Sırada: ${matchQueue.length}`);
            sendMessage(ws, {
                type: 'queueUpdate',
                message: `Rakip aranıyor... Sırada ${matchQueue.length}. kişisiniz.`,
                position: matchQueue.length
            });
        }
    },

    /** Eşleşme aramasını iptal etme isteğini işler. */
    cancelSearch: (ws, data) => {
        const connection = playerConnections.get(ws);
        let foundAndRemoved = false;

        if (connection && connection.playerId) {
            const initialLength = matchQueue.length;
            matchQueue = matchQueue.filter(p => p.telegramId !== connection.playerId);
            if (matchQueue.length < initialLength) {
                console.log(`🚫 Arama iptal edildi: ${connection.playerId}`);
                foundAndRemoved = true;
            }
        }

        // İstemciye her durumda (bulunsa da bulunmasa da) onay gönder
        sendMessage(ws, {
            type: 'searchCancelled',
            message: foundAndRemoved ? 'Arama başarıyla iptal edildi.' : 'Aktif bir arama bulunamadı.',
            success: foundAndRemoved
        });

        if (foundAndRemoved) {
            playerConnections.delete(ws);
        }
    },

    /** Yeni bir özel oda oluşturma isteğini işler. */
    createRoom: (ws, data) => {
        const { playerName, isGuest, telegramId } = data;
        const roomCode = generateRoomCode();

        const hostPlayer = {
            ws,
            telegramId: telegramId || (isGuest ? `guest_${uuidv4()}` : `host_${uuidv4()}`),
            username: playerName || 'Host',
            isHost: true,
            color: 'red'
        };

        const room = {
            code: roomCode,
            players: [hostPlayer],
            status: 'waiting', // Rakip bekleniyor
            gameType: 'friendly',
            createdAt: new Date()
        };

        rooms.set(roomCode, room);
        playerConnections.set(ws, { playerId: hostPlayer.telegramId, roomCode });

        console.log(`🏡 ${hostPlayer.username} bir oda oluşturdu: ${roomCode}`);

        sendMessage(ws, {
            type: 'roomCreated',
            roomCode,
            isHost: true,
            message: `Oda oluşturuldu. Kod: ${roomCode}`
        });
    },

    /** Mevcut bir özel odaya katılma isteğini işler. */
    joinRoom: (ws, data) => {
        const { roomCode, playerName, isGuest, telegramId } = data;
        const room = rooms.get(roomCode);

        if (!room) {
            return sendMessage(ws, { type: 'roomNotFound', message: 'Oda bulunamadı.' });
        }

        if (room.players.length >= 2) {
            return sendMessage(ws, { type: 'roomFull', message: 'Oda dolu.' });
        }

        const guestPlayer = {
            ws,
            telegramId: telegramId || (isGuest ? `guest_${uuidv4()}` : `guest_${uuidv4()}`),
            username: playerName || 'Guest',
            isHost: false,
            color: 'white'
        };

        room.players.push(guestPlayer);
        room.status = 'playing';
        playerConnections.set(ws, { playerId: guestPlayer.telegramId, roomCode });

        const hostPlayer = room.players[0];

        // Oyunu başlat
        room.gameState = initializeGame(hostPlayer, guestPlayer);

        console.log(`👍 ${guestPlayer.username} odaya katıldı: ${roomCode}. Oyun başlıyor.`);

        // Her iki oyuncuya da oyunun başladığını bildir
        sendMessage(hostPlayer.ws, {
            type: 'joinedRoom', // veya 'opponentJoined'
            roomCode,
            opponent: { username: guestPlayer.username },
            message: 'Rakip katıldı, oyun başlıyor!',
            gameState: room.gameState
        });

        sendMessage(guestPlayer.ws, {
            type: 'joinedRoom',
            roomCode,
            color: guestPlayer.color,
            opponent: { username: hostPlayer.username },
            message: 'Odaya katıldınız, oyun başlıyor!',
            gameState: room.gameState
        });
    },

    /** Oyuncunun oyundan ayrılma isteğini işler. */
    leaveGame: (ws, data) => {
        handleDisconnect(ws); // Bağlantı kopmasıyla aynı mantığı kullanabiliriz.
    },

    /** Domino taşı oynama isteğini işler (Bu kısım Dama/Domino uyumsuzluğu nedeniyle tam çalışmayabilir). */
    makeMove: (ws, data) => {
        const connection = playerConnections.get(ws);
        if (!connection || !connection.roomCode) return;

        const room = rooms.get(connection.roomCode);
        if (!room || room.status !== 'playing') return;

        const { playerId } = connection;
        const gameState = room.gameState;

        // Sıra kontrolü
        if (gameState.currentPlayer !== playerId) {
            return sendMessage(ws, { type: 'error', message: 'Sıra sizde değil.' });
        }

        // --- BURAYA DOMİNO OYNAMA MANTIĞI GELECEK ---
        // İstemciden gelen 'makeMove' isteği dama formatında ({from, to})
        // Sunucu ise domino formatında bir hamle bekliyor.
        // Bu uyumsuzluk giderilmelidir. Şimdilik sadece sıra değiştiriyoruz.
        console.log(`Hamle alındı (Dama formatı): ${playerId}`, data);

        // Sıradaki oyuncuyu belirle
        const opponent = room.players.find(p => p.telegramId !== playerId);
        gameState.currentPlayer = opponent.telegramId;
        gameState.turn++;

        // Herkese güncel oyun durumunu gönder
        sendGameState(room.code);
    }
};

/** Bir istemcinin bağlantısı koptuğunda veya oyundan ayrıldığında çağrılır. */
function handleDisconnect(ws) {
    try {
        console.log('🔌 Bir istemcinin bağlantısı kesildi.');
        const connection = playerConnections.get(ws);
        if (!connection) return;

        const { playerId, roomCode } = connection;

        // 1. Oyuncuyu arama kuyruğundan kaldır
        const initialQueueLength = matchQueue.length;
        matchQueue = matchQueue.filter(p => p.telegramId !== playerId);
        if (matchQueue.length < initialQueueLength) {
            console.log(`🚶‍♂️ ${playerId} arama kuyruğundan kaldırıldı.`);
        }

        // 2. Oyuncu bir odadaysa, odayı yönet
        if (roomCode) {
            const room = rooms.get(roomCode);
            if (room) {
                // Diğer oyuncuya rakibin ayrıldığını bildir
                const opponent = room.players.find(p => p.telegramId !== playerId);
                if (opponent) {
                    sendMessage(opponent.ws, {
                        type: 'opponentLeft',
                        message: 'Rakibiniz oyundan ayrıldı.',
                        roomCleared: true
                    });
                }
                // Odayı tamamen sil
                rooms.delete(roomCode);
                console.log(`🗑️ Oda ${roomCode} kapatıldı.`);
            }
        }

        // 3. Oyuncunun bağlantı kaydını sil
        playerConnections.delete(ws);

    } catch (error) {
        console.error("Disconnect hatası:", error);
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor.`);
});
