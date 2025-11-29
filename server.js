const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
let db;

// MongoDB Bağlantısı
MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(client => {
    db = client.db('domino_game');
    console.log('✅ MongoDB bağlandı!');
  })
  .catch(err => console.error('❌ MongoDB hata:', err));

const players = new Map();
const rooms = new Map();
const rankedQueue = [];

// Domino taşlarını oluştur
function createDominoes() {
  const dominoes = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      dominoes.push([i, j]);
    }
  }
  return shuffleArray(dominoes);
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Oyun oluştur
function createGame(player1, player2, isRanked = false) {
  const dominoes = createDominoes();
  return {
    id: Math.random().toString(36).substr(2, 9),
    players: [
      { id: player1.id, name: player1.name, hand: dominoes.slice(0, 7), level: player1.level },
      { id: player2.id, name: player2.name, hand: dominoes.slice(7, 14), level: player2.level }
    ],
    board: [],
    pool: dominoes.slice(14),
    currentPlayer: player1.id,
    isRanked,
    moveCount: 0,
    startTime: Date.now()
  };
}

// Geçerli hamleleri kontrol et
function getValidMoves(domino, board) {
  if (board.length === 0) return ['left', 'right'];
  
  const moves = [];
  const leftEnd = board[0][0];
  const rightEnd = board[board.length - 1][1];
  
  if (domino.includes(leftEnd)) moves.push('left');
  if (domino.includes(rightEnd)) moves.push('right');
  
  return moves;
}

// Taşı yerleştir
function playDomino(game, playerId, domino, side) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return false;
  
  const dominoIndex = player.hand.findIndex(d => d[0] === domino[0] && d[1] === domino[1]);
  if (dominoIndex === -1) return false;
  
  const validMoves = getValidMoves(domino, game.board);
  if (!validMoves.includes(side)) return false;
  
  player.hand.splice(dominoIndex, 1);
  
  if (game.board.length === 0) {
    game.board.push(domino);
  } else if (side === 'left') {
    const leftEnd = game.board[0][0];
    const oriented = domino[1] === leftEnd ? domino : [domino[1], domino[0]];
    game.board.unshift(oriented);
  } else {
    const rightEnd = game.board[game.board.length - 1][1];
    const oriented = domino[0] === rightEnd ? domino : [domino[1], domino[0]];
    game.board.push(oriented);
  }
  
  game.moveCount++;
  
  // Kazanan kontrolü
  if (player.hand.length === 0) {
    game.winner = playerId;
    return true;
  }
  
  // Sırayı değiştir
  const currentIndex = game.players.findIndex(p => p.id === playerId);
  game.currentPlayer = game.players[(currentIndex + 1) % 2].id;
  
  return true;
}

// ELO hesapla
function calculateElo(game, winnerId) {
  const halfGame = game.moveCount >= 10;
  const basePoints = Math.floor(Math.random() * 9) + 12; // 12-20
  
  return {
    winner: basePoints,
    loser: halfGame ? -20 : -10
  };
}

// Oyuncu verilerini güncelle
async function updatePlayerData(telegramId, eloChange, won) {
  try {
    const collection = db.collection('players');
    const player = await collection.findOne({ telegramI
