const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

// CORS middleware
app.use(cors());
app.use(express.json());

// HTTP server for health checks
app.get('/', (req, res) => {
  res.send('Domino WebSocket Server is running!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

// Game rooms storage
const rooms = new Map();
const waitingPlayers = [];

console.log('WebSocket server starting...');

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type);
      
      switch(data.type) {
        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
          
        case 'START_RANKED_SEARCH':
          handleRankedSearch(ws, data.payload);
          break;
          
        case 'CANCEL_SEARCH':
          handleCancelSearch(ws);
          break;
          
        case 'CREATE_ROOM':
          handleCreateRoom(ws);
          break;
          
        case 'JOIN_ROOM':
          handleJoinRoom(ws, data.payload);
          break;
          
        case 'LEAVE_ROOM':
          handleLeaveRoom(ws, data.payload);
          break;
          
        case 'PLACE_TILE':
          handlePlaceTile(ws, data.payload);
          break;
          
        case 'PASS_TURN':
          handlePassTurn(ws);
          break;
          
        case 'LEAVE_GAME':
          handleLeaveGame(ws);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    handleDisconnect(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  // Send initial connection success
  ws.send(JSON.stringify({ 
    type: 'CONNECTION_SUCCESS',
    payload: { message: 'Connected to Domino server!' }
  }));
});

// Ranked matchmaking
function handleRankedSearch(ws, payload) {
  console.log('Player searching for ranked match:', payload.userId);
  
  // Add to waiting queue
  waitingPlayers.push({
    ws: ws,
    userId: payload.userId,
    elo: payload.elo || 100,
    timestamp: Date.now()
  });
  
  // Check for match
  if (waitingPlayers.length >= 2) {
    const player1 = waitingPlayers.shift();
    const player2 = waitingPlayers.shift();
    
    // Create room
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      players: [
        { id: 'player-0', name: player1.userId, elo: player1.elo, ws: player1.ws },
        { id: 'player-1', name: player2.userId, elo: player2.elo, ws: player2.ws }
      ],
      isRanked: true,
      gameState: null
    };
    
    rooms.set(roomCode, room);
    
    // Notify both players
    player1.ws.send(JSON.stringify({
      type: 'MATCH_FOUND',
      payload: {
        roomCode: roomCode,
        players: [player1.userId, player2.userId],
        myPlayerId: 'player-0',
        isRanked: true
      }
    }));
    
    player2.ws.send(JSON.stringify({
      type: 'MATCH_FOUND',
      payload: {
        roomCode: roomCode,
        players: [player1.userId, player2.userId],
        myPlayerId: 'player-1',
        isRanked: true
      }
    }));
  }
}

// Cancel search
function handleCancelSearch(ws) {
  const index = waitingPlayers.findIndex(p => p.ws === ws);
  if (index !== -1) {
    waitingPlayers.splice(index, 1);
  }
}

// Create private room
function handleCreateRoom(ws) {
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    players: [],
    isRanked: false,
    gameState: null
  };
  
  rooms.set(roomCode, room);
  
  ws.send(JSON.stringify({
    type: 'ROOM_CREATED',
    payload: { code: roomCode }
  }));
}

// Join room
function handleJoinRoom(ws, payload) {
  const room = rooms.get(payload.code);
  
  if (!room) {
    ws.send(JSON.stringify({
      type: 'JOIN_FAILED',
      payload: { reason: 'Oda bulunamadı' }
    }));
    return;
  }
  
  if (room.players.length >= 2) {
    ws.send(JSON.stringify({
      type: 'JOIN_FAILED',
      payload: { reason: 'Oda dolu' }
    }));
    return;
  }
  
  const player = {
    id: `player-${room.players.length}`,
    name: `Player ${room.players.length + 1}`,
    ws: ws
  };
  
  room.players.push(player);
  
  // Notify room members
  room.players.forEach(p => {
    if (p.ws !== ws) {
      p.ws.send(JSON.stringify({
        type: 'PLAYER_JOINED',
        payload: { name: player.name }
      }));
    }
  });
  
  ws.send(JSON.stringify({
    type: 'JOIN_SUCCESS',
    payload: { roomCode: payload.code, myPlayerId: player.id }
  }));
  
  // Start game if room is full
  if (room.players.length === 2) {
    startGame(room);
  }
}

// Leave room
function handleLeaveRoom(ws, payload) {
  const room = rooms.get(payload.code);
  if (room) {
    const playerIndex = room.players.findIndex(p => p.ws === ws);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      
      // Notify other players
      room.players.forEach(p => {
        p.ws.send(JSON.stringify({
          type: 'PLAYER_LEFT',
          payload: { playerId: `player-${playerIndex}` }
        }));
      });
    }
    
    // Remove empty rooms
    if (room.players.length === 0) {
      rooms.delete(payload.code);
    }
  }
}

// Handle tile placement
function handlePlaceTile(ws, payload) {
  // Find player's room
  let playerRoom = null;
  let player = null;
  
  for (const room of rooms.values()) {
    const foundPlayer = room.players.find(p => p.ws === ws);
    if (foundPlayer) {
      playerRoom = room;
      player = foundPlayer;
      break;
    }
  }
  
  if (!playerRoom) return;
  
  // Broadcast to other player
  playerRoom.players.forEach(p => {
    if (p.ws !== ws) {
      p.ws.send(JSON.stringify({
        type: 'GAME_STATE_UPDATE',
        payload: {
          tilePlaced: payload,
          playerId: player.id
        }
      }));
    }
  });
}

// Handle pass turn
function handlePassTurn(ws) {
  // Similar to handlePlaceTile - broadcast to other player
  for (const room of rooms.values()) {
    const player = room.players.find(p => p.ws === ws);
    if (player) {
      room.players.forEach(p => {
        if (p.ws !== ws) {
          p.ws.send(JSON.stringify({
            type: 'GAME_STATE_UPDATE',
            payload: { turnPassed: true, playerId: player.id }
          }));
        }
      });
      break;
    }
  }
}

// Handle leave game
function handleLeaveGame(ws) {
  handleDisconnect(ws);
}

// Handle disconnection
function handleDisconnect(ws) {
  // Remove from waiting list
  handleCancelSearch(ws);
  
  // Remove from rooms
  for (const [roomCode, room] of rooms.entries()) {
    const playerIndex = room.players.findIndex(p => p.ws === ws);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      
      // Notify other players
      room.players.forEach(p => {
        p.ws.send(JSON.stringify({
          type: 'PLAYER_LEFT',
          payload: { playerId: `player-${playerIndex}` }
        }));
      });
      
      // Remove empty rooms
      if (room.players.length === 0) {
        rooms.delete(roomCode);
      }
      break;
    }
  }
}

// Start game in room
function startGame(room) {
  const playerNames = room.players.map(p => p.name);
  
  room.players.forEach((player, index) => {
    player.ws.send(JSON.stringify({
      type: 'MATCH_FOUND',
      payload: {
        roomCode: room.code,
        players: playerNames,
        myPlayerId: `player-${index}`,
        isRanked: room.isRanked
      }
    }));
  });
}

// Generate room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Start server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`WebSocket server ready`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});
