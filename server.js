```javascript

if (ws.playerId) playerConnections.delete(ws.playerId);

// Kuyruktan temizleme: Hem WS referansına hem de TelegramID'ye göre detaylı temizlik
const qIdx = matchQueue.findIndex(p => p.ws === ws || (ws.telegramId && p.telegramId === ws.telegramId));
if (qIdx !== -1) {
    matchQueue.splice(qIdx, 1);
    console.log(`❌ Kuyruktan çıkarıldı(Disconnect) - Kalan: ${ matchQueue.length } `);
}

if (ws.roomCode) {
    console.log(`🏠 Odadan ayrıldı(Kopma): ${ ws.roomCode } `);
    broadcastToRoom(ws.roomCode, { type: 'playerDisconnected', message: 'Rakip bağlantısı koptu, bekleniyor...', timeoutSeconds: 20 });

    // Timeout başlat: 20 saniye içinde gelmezse oyunu bitir
    const timeoutId = setTimeout(() => {
        const room = rooms.get(ws.roomCode);
        if (room) {
            const winnerId = Object.keys(room.gameState.players).find(pid => pid !== ws.playerId); // Corrected to room.gameState.players
            if (winnerId) {
                console.log(`⏱️ Timeout doldu, kazanan: ${ winnerId } `);
                broadcastToRoom(ws.roomCode, { type: 'opponentTimeout', message: 'Rakip süre dolduğu için oyunu kaybetti.' });
                handleGameEnd(ws.roomCode, winnerId, room.gameState);
            }
        }
        activeDisconnects.delete(ws.roomCode);
    }, 20000);

    activeDisconnects.set(ws.roomCode, timeoutId);

    // Odayı silme! Oyuncu geri gelebilir.
    // rooms.delete(ws.roomCode); 

    // İsteğe bağlı: Belli bir süre sonra silmek için timeout eklenebilir
    // Ancak DB'de kayıtlı olduğu için sonsuza kadar kalmaz, oyun bitince silinir
}
}

// Assuming this matchmaking logic is part of a message handler or similar context
// where `ws`, `playerId`, `matchQueue`, `rooms`, `playerConnections`, etc., are defined.
// The original document provided did not contain the old matchmaking logic,
// so this new block is inserted as a new feature.
if (ws.playerId)    playerConnections.set(playerId, ws);

    // Eşleşme Mantığı:
    // 1. Guest sadece Guest ile eşleşebilir.
    // 2. Telegram kayıtlı kullanıcı sadece Telegram kullanıcısı ile eşleşebilir (Ranked).
    
    let opponentIndex = -1;

    if (ws.isGuest) {
        // Guest arıyoruz
        opponentIndex = matchQueue.findIndex(p => p.isGuest === true);
    } else {
        // Telegram user arıyoruz (Kendi kendisiyle eşleşmemeli)
        opponentIndex = matchQueue.findIndex(p => p.isGuest === false && p.telegramId !== ws.telegramId);
    }

    if (opponentIndex !== -1) {
        // RUYGUN RAKİP BULUNDU
        const opponent = matchQueue.splice(opponentIndex, 1)[0];
        
        const roomCode = generateRoomCode();
        // İkisi de Guest ise Casual, İkisi de Telegram ise Ranked (Filter sayesinde zaten böyle olacak)
        // Ancak kodun sağlamlığı için yine de kontrol edelim.
        const gameType = (ws.isGuest || opponent.isGuest) ? 'casual' : 'ranked';
        
        console.log(`🎮 Maç oluşturuluyor(${ gameType.toUpperCase() }): ${ ws.playerName } vs ${ opponent.playerName } `);

        const room = {
            code: roomCode,
            players: {
                [ws.playerId]: {
                    name: ws.playerName,
                    telegramId: ws.telegramId,
                    photoUrl: ws.photoUrl,
                    level: ws.level,
                    elo: ws.elo,
                    isGuest: ws.isGuest
                },
                [opponent.playerId]: {
                    name: opponent.playerName,
                    telegramId: opponent.telegramId,
                    photoUrl: opponent.photoUrl,
                    level: opponent.level,
                    elo: opponent.elo,
                    isGuest: opponent.isGuest
                }
            },
            type: gameType,
            startTime: Date.now()
        };

        rooms.set(roomCode, room);
        ws.roomCode = roomCode;
        opponent.ws.roomCode = roomCode;

        const gameState = initializeGame(roomCode, ws.playerId, opponent.playerId);

        // Her iki oyuncuya da matchFound gönder
        sendMessage(ws, { type: 'matchFound', roomCode, opponent: room.players[opponent.playerId], gameType });
        sendMessage(opponent.ws, { type: 'matchFound', roomCode, opponent: room.players[ws.playerId], gameType });

        // Oyunu başlat
        setTimeout(() => {
            const gameStartMsg1 = { type: 'gameStart', gameState: { ...gameState, playerId: ws.playerId } };
            sendMessage(ws, gameStartMsg1);

            const gameStartMsg2 = { type: 'gameStart', gameState: { ...gameState, playerId: opponent.playerId } };
            sendMessage(opponent.ws, gameStartMsg2);

            console.log(`✅ Oyun başladı: ${ roomCode } `);
        }, 500);

    } else {
        // UYGUN RAKİP YOK, KUYRUĞA EKLE
        matchQueue.push({
            ws,
            playerId,
            playerName: ws.playerName,
            telegramId: ws.telegramId,
            photoUrl: ws.photoUrl,
            level: ws.level,
            elo: ws.elo,
            isGuest: ws.isGuest
        });

        const playerType = ws.isGuest ? 'GUEST' : `LVL ${ ws.level }, ELO ${ ws.elo } `;
        console.log(`✅ ${ ws.playerName } (${ playerType }) kuyrukta - Uygun rakip bekleniyor...`);
        sendMessage(ws, { type: 'searchStatus', message: 'Rakip aranıyor...' });
    }

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${ PORT } `);
});
```

