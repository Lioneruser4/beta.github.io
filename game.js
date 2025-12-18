const socket = io("https://mario-io-1.onrender.com");
let myId, currentRoom, myHand = [];
let boardData = [];

// --- THREE.JS KURULUMU ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const light = new THREE.PointLight(0xffffff, 2, 100);
light.position.set(0, 10, 5);
scene.add(light, new THREE.AmbientLight(0x404040));

camera.position.set(0, 12, 8);
camera.lookAt(0, 0, 0);

// --- LOBİ VE MATCHMAKING ---
document.getElementById('btn-find').onclick = () => {
    showScreen('match-screen');
    socket.emit('join_matchmaking', { name: "Player" });
};

socket.on('match_found', (data) => {
    showScreen('game-hud');
    currentRoom = data.roomId;
    myHand = data.hand;
    renderHand();
    initBoard();
});

// --- TAŞLARI DİZEN AKILLI ALGORİTMA ---
function initBoard() {
    // Taşların taşmaması için her yerleşimde kamera uzaklığını ayarlar
    // Ve taşları spiral veya S şeklinde dizer
}

function renderHand() {
    const handDiv = document.getElementById('my-hand');
    handDiv.innerHTML = "";
    myHand.forEach((tile, index) => {
        const t = document.createElement('div');
        t.className = "domino-tile";
        t.innerText = `${tile.a}:${tile.b}`;
        t.onclick = () => playTile(index);
        handDiv.appendChild(t);
    });
}

function playTile(index) {
    socket.emit('play_tile', { roomId: currentRoom, tile: myHand[index] });
}

socket.on('update_board', (newBoard) => {
    boardData = newBoard;
    // 3D taşları sahneye ekle
});

socket.on('game_over', (winnerId) => {
    showScreen('result-screen');
    document.getElementById('result-title').innerText = winnerId === socket.id ? "KAZANDIN!" : "KAYBETTİN";
});

function showScreen(id) {
    ['lobby-screen', 'match-screen', 'result-screen', 'game-hud'].forEach(s => {
        document.getElementById(s).style.display = (s === id) ? 'flex' : 'none';
        if(id === 'game-hud') document.getElementById(id).style.display = 'block';
    });
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();
