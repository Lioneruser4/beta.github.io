// Dosya Adı: main.js
// Uygulamanın ana mantığı ve global fonksiyonları

import * as MemoryGame from './game.js'; 
import * as PongGame from './pong.js';

let socket;
let currentScreen = 'menu';
let selectedGame = null; 

// --- DOM Referansları (Kaldığı Gibi) ---
const screens = { 
    menu: document.getElementById('menu'),
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen'), 
    pongGame: document.getElementById('pongGame') 
};
const waitCodeEl = document.getElementById('waitCode');
const usernameInput = document.getElementById('username');
const roomCodeInput = document.getElementById('roomCodeInput');
const lobbyTitleEl = document.getElementById('lobbyTitle');
const selectMemoryBtn = document.getElementById('selectMemory');
const selectPongBtn = document.getElementById('selectPong');
const matchBtn = document.getElementById('matchBtn');
const joinBtn = document.getElementById('joinBtn');
const globalMessage = document.getElementById('globalMessage');
const globalMessageText = document.getElementById('globalMessageText');

export const t = window.languageManager.t;

// (showScreen ve showGlobalMessage fonksiyonları kaldırıldığı gibi kalır)
export function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
    currentScreen = screenId;
}

export function showGlobalMessage(message, isError = true) {
    globalMessageText.textContent = message;
    globalMessage.classList.remove('bg-red-600', 'bg-green-600', 'hidden');
    globalMessage.classList.add(isError ? 'bg-red-600' : 'bg-green-600');
    globalMessage.classList.add('show');
    
    setTimeout(() => { 
        globalMessage.classList.remove('show');
        globalMessage.classList.add('hidden');
    }, 4000);
}

// (setupLobby ve handleLobbyAction fonksiyonları kaldırıldığı gibi kalır)
function setupLobby(gameType) {
    selectedGame = gameType;
    const gameName = gameType === 'MEMORY' ? t('memoryGame') : t('pongGame');
    lobbyTitleEl.textContent = `${t('selectGame')} - ${gameName}`;
    showScreen('lobby');
}

function handleLobbyAction(isCreate) {
    const username = usernameInput.value.trim();
    const roomCode = roomCodeInput.value.trim().toUpperCase();

    if (!username) {
        showGlobalMessage(t('enterName'), true);
        return;
    }
    
    // --- KRİTİK GÜNCELLEME: Socket Bağlantısı ---
    // Eğer Socket.IO bağlantısı yoksa, basitçe io() ile otomatik olarak
    // mevcut URL'ye (Render URL'sine) bağlanmaya çalışır.
    if (!socket) {
        // io() kullanımı window.location.origin ile aynıdır, Render için en güvenli yoldur.
        socket = io(); 
        setupConnectionHandlers();
    }
    
    if (isCreate || !roomCode) {
        socket.emit('createRoom', { username, gameType: selectedGame });
        showGlobalMessage(`${selectedGame === 'MEMORY' ? '💣' : '🏓'} ${t('waitingForPlayer')}`, false);
    } else {
        socket.emit('joinRoom', { username, roomCode });
    }
}

// (setupConnectionHandlers ve diğer socket olayları kaldırıldığı gibi kalır)
function setupConnectionHandlers() {
    socket.on('roomCreated', (code) => {
        waitCodeEl.textContent = `${t('roomCode')}: ${code}`;
        showScreen('wait');
    });

    socket.on('joinFailed', (message) => {
        showGlobalMessage(message, true);
        showScreen('lobby');
    });
    
    socket.on('roomJoined', (code) => {
        showGlobalMessage(`Oda ${code} bulundu! Başlıyor...`, false);
    });

    socket.on('gameStart', ({ players, roomCode, gameType }) => {
        const myId = socket.id;
        const isHost = players.find(p => p.id === myId)?.isHost || false;
        const opponent = players.find(p => p.id !== myId);
        const opponentName = opponent ? opponent.username : 'Bilinmiyor';

        if (gameType === 'MEMORY') {
            MemoryGame.setupMemorySocketHandlers(socket, roomCode, isHost, opponentName);
        } else if (gameType === 'PONG') {
            PongGame.setupPongSocketHandlers(socket, roomCode, isHost, opponentName);
        }
        
        showGlobalMessage(t('gameStarting'), false);
    });

    socket.on('chatMessage', ({ username, message }) => {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            const msgEl = document.createElement('div');
            msgEl.textContent = `${username}: ${message}`;
            msgEl.className = 'p-1 rounded mb-1 bg-gray-600';
            chatMessages.appendChild(msgEl);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });

    socket.on('error', (message) => {
        showGlobalMessage(message, true);
    });
    
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || t('playerLeft'), true);
        if (currentScreen === 'game') MemoryGame.resetGame();
        if (currentScreen === 'pongGame') PongGame.resetPongGame();
        showScreen('menu');
    });
}

// (handleSendMessage ve DOMContentLoaded olayları kaldırıldığı gibi kalır)
function handleSendMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    
    const message = chatInput.value.trim();
    if (message && socket) {
        const roomCode = MemoryGame.currentRoomCode;
        if (roomCode) {
            socket.emit('chatMessage', { roomCode, message });
            chatInput.value = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.languageManager.initLanguage();

    selectMemoryBtn.addEventListener('click', () => setupLobby('MEMORY'));
    selectPongBtn.addEventListener('click', () => setupLobby('PONG'));

    matchBtn.addEventListener('click', () => handleLobbyAction(true));
    joinBtn.addEventListener('click', () => handleLobbyAction(false));

    document.getElementById('send-message')?.addEventListener('click', handleSendMessage);
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
    });

    showScreen('menu'); 
});
