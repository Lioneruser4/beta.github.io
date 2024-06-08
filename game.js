
game.js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Oyun kodunu buraya ekleyin
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let score = 0;

// Oyuncu ve boruların diğer kodlarını buraya ekleyin

function draw() {
    // Oyun alanını temizle
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Oyuncuyu ve boruları çiz
    // drawPlayer();
    // drawPipes();

    // Skoru çiz
    ctx.fillStyle = '#000';
    ctx.font = '24px Arial';
    ctx.fillText('Score: ' + score, 10, 30); // Skoru ekrana yazdır
}

// Oyun döngüsü (oyuncu hareketleri, çarpışma kontrolü vb.)
// gameLoop();

// Oyuncu skorunu artır
function increaseScore() {
    score++;
}

// Buraya skor tablosu ekleyebilirsiniz
