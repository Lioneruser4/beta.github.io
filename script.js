const socket = io("https://mario-io-1.onrender.com", { transports: ['websocket'] });

const screens = {
  lobby: document.getElementById("lobby"),
  matchmaking: document.getElementById("matchmaking"),
  friendMenu: document.getElementById("friendMenu"),
  roomCreated: document.getElementById("roomCreated"),
  roomJoin: document.getElementById("roomJoin"),
  game: document.getElementById("game"),
  winScreen: document.getElementById("winScreen")
};

let currentRoom = null;
let myColor = null;
let selectedPiece = null;
let board = null;

// LOBİ
document.getElementById("rankedBtn").onclick = () => {
  show("matchmaking");
  socket.emit("joinRanked");
  startTimer();
};

document.getElementById("friendBtn").onclick = () => show("friendMenu");

document.getElementById("createRoomBtn").onclick = () => {
  socket.emit("createFriendRoom");
};

document.getElementById("joinRoomBtn").onclick = () => show("roomJoin");

document.getElementById("enterRoomBtn").onclick = () => {
  const code = document.getElementById("codeInput").value.trim();
  if (code.length === 4) socket.emit("joinFriendRoom", code);
};

document.getElementById("copyCodeBtn").onclick = () => {
  navigator.clipboard.writeText(document.getElementById("roomCodeDisplay").textContent);
  alert("Kod kopyalandı!");
};

// Geri butonları
document.querySelectorAll(".back-btn, #backLobby, #cancelRanked, #backFromRoom, #backFromJoin, #backToLobbyBtn").forEach(b => {
  b.onclick = () => { show("lobby"); socket.emit("leaveRoom"); };
});

// SOCKET EVENTS
socket.on("friendRoomCreated", (code) => {
  document.getElementById("roomCodeDisplay").textContent = code;
  show("roomCreated");
});

socket.on("waitingForOpponent", () => {
  document.getElementById("timer").textContent = "Rakip aranıyor...";
});

socket.on("gameStart", (data) => {
  currentRoom = data.roomId;
  myColor = data.color;
  show("game");
  initBoard();
});

socket.on("boardUpdate", (newBoard) => {
  board = newBoard;
  drawBoard();
});

socket.on("gameOver", (winner) => {
  document.getElementById("winText").textContent = winner === myColor ? "KAZANDIN!" : "KAYBETTİN!";
  show("winScreen");
});

// OYUN KANVAS
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const cellSize = 75;

function initBoard() {
  canvas.onclick = handleClick;
  drawBoard();
}

function drawBoard() {
  ctx.clearRect(0, 0, 600, 600);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#eee" : "#333";
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);

      if (board && board[y][x] !== 0) {
        const piece = board[y][x];
        const isKing = Math.abs(piece) === 2;
        const color = piece > 0 ? "#fff" : "#000";
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x * cellSize + 37.5, y * cellSize + 37.5, 30, 0, Math.PI * 2);
        ctx.fill();
        if (isKing) {
          ctx.strokeStyle = "#feca57";
          ctx.lineWidth = 6;
          ctx.stroke();
        }
      }
    }
  }
}

function handleClick(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / cellSize);
  const y = Math.floor((e.clientY - rect.top) / cellSize);
  socket.emit("makeMove", { roomId: currentRoom, from: selectedPiece, to: { x, y } });
  selectedPiece = null;
}

// Yardımcı
function show(screenName) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[screenName].classList.add("active");
}

function startTimer() {
  let sec = 0;
  setInterval(() => {
    document.getElementById("timer").textContent = `${sec++} saniye`;
  }, 1000);
}

// Particle Background
const particlesCanvas = document.getElementById("particles");
const pctx = particlesCanvas.getContext("2d");
particlesCanvas.width = window.innerWidth;
particlesCanvas.height = window.innerHeight;

let particles = [];
for (let i = 0; i < 80; i++) {
  particles.push({
    x: Math.random() * particlesCanvas.width,
    y: Math.random() * particlesCanvas.height,
    vx: Math.random() * 2 - 1,
    vy: Math.random() * 2 - 1,
    radius: Math.random() * 3 + 1
  });
}

function animate() {
  pctx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > particlesCanvas.width) p.vx *= -1;
    if (p.y < 0 || p.y > particlesCanvas.height) p.vy *= -1;

    pctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    pctx.beginPath();
    pctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    pctx.fill();
  });
  requestAnimationFrame(animate);
}
animate();
