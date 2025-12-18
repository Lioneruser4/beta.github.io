const io = require('socket.io')(process.env.PORT || 3000, { cors: { origin: "*" } });

let queue = [];
let rooms = {};

io.on('connection', (socket) => {
    socket.on('join_matchmaking', (userData) => {
        queue.push(socket);
        if (queue.length >= 2) {
            const p1 = queue.shift();
            const p2 = queue.shift();
            const roomId = "room_" + Date.now();
            
            p1.join(roomId);
            p2.join(roomId);

            rooms[roomId] = {
                players: [p1.id, p2.id],
                board: [],
                deck: shuffleDeck()
            };

            io.to(p1.id).emit('match_found', { roomId, hand: rooms[roomId].deck.splice(0,7) });
            io.to(p2.id).emit('match_found', { roomId, hand: rooms[roomId].deck.splice(0,7) });
        }
    });

    socket.on('play_tile', (data) => {
        // Domino kurallarına göre taşın uygunluğunu kontrol et
        // Eğer uygunsa io.to(data.roomId).emit('update_board', rooms[data.roomId].board);
    });
});

function shuffleDeck() {
    let d = [];
    for(let i=0; i<=6; i++) for(let j=i; j<=6; j++) d.push({a:i, b:j});
    return d.sort(() => Math.random() - 0.5);
}
