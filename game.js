// Dosya Adı: game.js (ESKİ BAĞLANTI UYUMLU SÜRÜM)
// Bu sürüm sadece bağlantı kurmaya odaklanır. Oyun mantığı sadeleştirilmiştir.

let socket;
let currentRoomCode = '';
let isHost = false; 
let opponentName = '';
let myName = '';
const BOMB_EMOJI = '💣';

const screens = { 
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen') 
};
const gameBoardEl = document.getElementById('gameBoard');

// ... (Diğer DOM Referansları ve playSound fonksiyonları) ...
const turnStatusEl = document.getElementById('turnStatus');
const actionMessageEl = document.getElementById('actionMessage');
const myNameEl = document.getElementById('myName'); 
const opponentNameEl = document.getElementById('opponentName'); 
const messagesEl = document.getElementById('messages');
const chatInputEl = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

// --- TEMEL UI FONKSİYONLARI ---
export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen && screen.classList.remove('active'));
    if (screens[screenId]) { screens[screenId].classList.add('active'); }
}

export function showGlobalMessage(message, isError = true) {
    const globalMessage = document.getElementById('globalMessage');
    const globalMessageText = document.getElementById('globalMessageText');
    if (!globalMessage || !globalMessageText) return;
    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.remove('hidden');
    globalMessage.classList.add('show');
    setTimeout(() => { globalMessage.classList.add('hidden'); globalMessage.classList.remove('show'); }, 4000);
}

function drawBoard() {
    // Bağlantı kurulunca sadece tahtayı gösterir.
    turnStatusEl.textContent = "Oyun Başladı! (Basit Sürüm)";
    // ... (Tahta çizim kodları basitleştirilebilir veya boş bırakılabilir) ...
}


// --- SOCKET.IO İÇİN SETUP FONKSİYONU ---
export function setupSocketHandlers(s, roomCode, selfUsername, opponentUsername, initialData) {
    socket = s;
    currentRoomCode = roomCode;
    myName = selfUsername;
    opponentName = opponentUsername;
    
    // Rol bulma
    const selfPlayer = initialData.players.find(p => p.id === socket.id);
    isHost = selfPlayer ? selfPlayer.isHost : false; 
    
    // Tahta çizilir
    drawBoard();
    showScreen('game');
    
    document.getElementById('roleStatus').textContent = `Rolünüz: ${isHost ? 'Host' : 'Guest'}`;
    myNameEl.textContent = `${myName} (Skor: 0)`;
    opponentNameEl.textContent = `${opponentName} (Skor: 0)`;

    // Sadece zorunlu olayları dinler
    socket.off('opponentLeft').on('opponentLeft', (message) => {
        showGlobalMessage(message || 'Rakibiniz ayrıldı. Lobiye dönülüyor.', true);
        resetGame();
    });
    socket.off('newMessage').on('newMessage', (data) => {
        // ... (sohbet mantığı) ...
    });

}

export function resetGame() { 
    if (socket) {
        socket.disconnect();
    }
    window.location.reload(); 
}

export const UIElements = {
    matchBtn: document.getElementById('matchBtn'), 
    roomCodeInput: document.getElementById('roomCodeInput'), 
    usernameInput: document.getElementById('username'), 
    waitRoomCodeEl: document.getElementById('waitRoomCode'),
    showGlobalMessage, 
    resetGame
};
