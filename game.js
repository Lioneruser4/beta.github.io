// game.js - TAM PROFESYONEL DOMINO
const socket = io('https://mario-io-1.onrender.com');
let room = null, mySide = null, selectedTile = null;

document.getElementById('rankedBtn').onclick = () => socket.emit('ranked');
document.getElementById('createBtn').onclick = () => socket.emit('createRoom');
document.getElementById('joinBtn').onclick = () => {
  const code = document.getElementById('roomInput').value.trim();
  if (code.length === 4) socket.emit('joinRoom', code);
  else alert("4 rakam gir!");
};

function status(text) {
  document.getElementById('status').innerHTML = text;
}

function copyCode(code) {
  navigator.clipboard.writeText(code);
  alert("Kopyalandı: " + code);
}

// Socket Events
socket.on('searching', () => status('Eşleşme aranıyor... <button class="btn" style="padding:10px 20px;margin-left:10px" onclick="socket.emit(\'cancelRanked\')">İPTAL</button>'));
socket.on('cancelled', () => status('İptal edildi'));
socket.on('roomCreated', code => status(`ODA KODUN: <b style="color:#00ff88">${code}</b> <button class="btn" style="padding:10px 20px" onclick="copyCode('${code}')">KOPYALA</button>`));
socket.on('error', msg => alert("Hata: " + msg));

socket.on('match', data => startGame(data.room, data.side));
socket.on('joined', data => startGame(data.code, data.side));

socket.on('startGame', game => render(game));
socket.on('update', game => render(game));
socket.on('win', winner => alert(winner === mySide ? "KAZANDIN!" : "KAYBETTİN!"));
socket.on('opponentLeft', () => alert("Rakip oyunu terketti! Kazandın!"));

function startGame(r, side) {
  room = r; mySide = side;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
}

function render(game) {
  document.getElementById('turnIndicator').textContent = game.turn === mySide ? "SIRANIZ!" : "RAKİP DÜŞÜNÜYOR...";
  document.getElementById('turnIndicator').style.color = game.turn === mySide ? "#00ff88" : "#ff4081";

  // Board
  const board = document.getElementById('board');
  board.innerHTML = '';
  game.board.forEach((tile, i) => {
    const el = createTile(tile[0], tile[1]);
    el.style.transform = i % 2 === 0 ? 'rotate(90deg)' : 'rotate(-90deg)';
    el.classList.add('valid-spot');
    el.onclick = () => playHere('right');
    board.appendChild(el);
  });

  // Eller
  document.getElementById('myHand').innerHTML = '';
  document.getElementById('oppHand').innerHTML = '';

  // Rakip taşları (arka yüz)
  game.hands[1 - mySide].forEach(() => {
    const back = document.createElement('div');
    back.className = 'back';
    back.textContent = 'DOM';
    document.getElementById('oppHand').appendChild(back);
  });

  // Kendi taşlarım
  game.hands[mySide].forEach((tile, i) => {
    const el = createTile(tile[0], tile[1]);
    el.dataset.index = i;
    el.onclick = () => selectTile(el, tile);
    document.getElementById('myHand').appendChild(el);
  });

  highlightValidMoves(game);
}

function selectTile(el, tile) {
  document.querySelectorAll('.glow').forEach(e => e.classList.remove('glow'));
  el.classList.add('glow');
  selectedTile = tile;
}

function playHere(side) {
  if (!selectedTile) return;
  socket.emit('playTile', { room, tile: selectedTile, side });
  selectedTile = null;
  document.querySelectorAll('.glow').forEach(e => e.classList.remove('glow'));
}

function highlightValidMoves(game) {
  const left = game.ends[0], right = game.ends[1];
  const myTiles = document.querySelectorAll('#myHand .tile');

  myTiles.forEach(el => {
    const [a, b] = el.dataset.tile ? JSON.parse(el.dataset.tile) : [0,0];
    el.dataset.tile = JSON.stringify([a,b]);
    const canPlay = !game.board.length || a === left || b === left || a === right || b === right;
    if (canPlay && game.turn === mySide) el.classList.add('valid-spot');
    else el.classList.remove('valid-spot');
  });
}

function createTile(a, b) {
  const div = document.createElement('div');
  div.className = 'tile';
  div.innerHTML = `
    <div style="display:flex; justify-content:space-around;">${dots(a)}</div>
    <div style="display:flex; justify-content:space-around;">${dots(b)}</div>
  `;
  return div;
}

function dots(n) {
  const patterns = [
    [], [[1,1]], [[0,0],[2,2]], [[0,0],[1,1],[2,2]], 
    [[0,0],[0,2],[2,0],[2,2]], [[0,0],[0,2],[1,1],[2,0],[2,2]], 
    [[0,0],[0,1],[0,2],[2,0],[2,1],[2,2]]
  ];
  if (n === 0) return '<div style="width:30px;height:30px"></div>';
  return patterns[n].map(p => `<div class="dot"></div>`).join('');
}
