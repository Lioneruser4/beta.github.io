
if (ws.playerId) playerConnections.delete(ws.playerId);

    // Kuyruktan temizleme: Hem WS referansına hem de TelegramID'ye göre detaylı temizlik
    const qIdx = matchQueue.findIndex(p => p.ws === ws || (ws.telegramId && p.telegramId === ws.telegramId));
    if (qIdx !== -1) {
        matchQueue.splice(qIdx, 1);
        console.log(`❌ Kuyruktan çıkarıldı (Disconnect) - Kalan: ${matchQueue.length}`);
    }

    if (ws.roomCode) {
        console.log(`🏠 Odadan ayrıldı (Kopma): ${ws.roomCode}`);
        broadcastToRoom(ws.roomCode, { type: 'playerDisconnected', message: 'Rakip bağlantısı koptu, bekleniyor...', timeoutSeconds: 20 });

        // Timeout başlat: 20 saniye içinde gelmezse oyunu bitir
        const timeoutId = setTimeout(() => {
            const room = rooms.get(ws.roomCode);
            if (room) {
                const winnerId = Object.keys(room.gameState.players).find(pid => pid !== ws.playerId); // Corrected to room.gameState.players
                if (winnerId) {
                    console.log(`⏱️ Timeout doldu, kazanan: ${winnerId}`);
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Domino Sunucusu çalışıyor: Port ${PORT}`);
});
