// Dosya Adı: main.js
// Uygulamanın ana mantığı ve global fonksiyonları

// game.js'ten (Memory/Bomb) fonksiyonları içe aktar
import * as MemoryGame from './game.js'; 
// pong.js'ten fonksiyonları içe aktar
import * as PongGame from './pong.js';

let socket;
let currentScreen = 'menu';
let selectedGame = null; 

// --- DOM Referansları (Global) ---
const screens = { 
    menu: document.getElementById('menu'),
    lobby: document.getElementById('lobby'), 
    wait: document.getElementById('waitScreen'), 
    game: document.getElementById('gameScreen'), // Memory
    pongGame: document.getElementById('pongGame') // Pong
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

// Global dil yöneticisinden çeviri fonksiyonunu al
export const t = window.languageManager.t;

// --- Global Yardımcı Fonksiyonlar (Export ediliyor) ---

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

// --- OYUN SEÇİM VE LOBİ MANTIĞI ---

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
    
    // Socket bağlantısı kurulmamışsa kur
    if (!socket) {
        socket = io(window.location.origin); 
        setupConnectionHandlers();
    }
    
    if (isCreate || !roomCode) {
        // Oda Kur
        socket.emit('createRoom', { username, gameType: selectedGame });
        showGlobalMessage(`${selectedGame === 'MEMORY' ? '💣' : '🏓'} ${t('waitingForPlayer')}`, false);
    } else {
        // Odaya Bağlan
        socket.emit('joinRoom', { username, roomCode });
    }
}

// --- SOCKET.IO BAĞLANTI İŞLEYİCİLERİ ---

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

        console.log(`🎮 Oyun Başladı! Tip: ${gameType}, Host: ${isHost}, Rakip: ${opponentName}`);
        
        if (gameType === 'MEMORY') {
            MemoryGame.setupMemorySocketHandlers(socket, roomCode, isHost, opponentName);
        } else if (gameType === 'PONG') {
            PongGame.setupPongSocketHandlers(socket, roomCode, isHost, opponentName);
        }
        
        showGlobalMessage(t('gameStarting'), false);
    });

    // Chat mesajları her iki oyunda da aynı HTML elementini kullanır (index.html'e göre)
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
    
    // Rakip Ayrıldı (Genel İşleyici - Oyun ekranlarında da yakalanır)
    socket.on('opponentLeft', (message) => {
        showGlobalMessage(message || t('playerLeft'), true);
        // İlgili oyunun reset fonksiyonunu çağır (PongGame/MemoryGame içinde tanımlı)
        if (currentScreen === 'game') MemoryGame.resetGame();
        if (currentScreen === 'pongGame') PongGame.resetPongGame();
        showScreen('menu');
    });
}

// --- CHAT MANTIĞI (MEMORY EKRANI İÇİN) ---

function handleSendMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    
    const message = chatInput.value.trim();
    if (message && socket) {
        // Hangi oyunda olursak olalım, chat sadece Memory ekranında aktif
        const roomCode = MemoryGame.currentRoomCode;
        if (roomCode) {
            socket.emit('chatMessage', { roomCode, message });
            chatInput.value = '';
        }
    }
}

// --- Olay Dinleyicilerini Kurma ---

document.addEventListener('DOMContentLoaded', () => {
    // Dil ayarlarını yükle ve UI'ı güncelle
    window.languageManager.initLanguage();

    // Oyun Seçim Butonları
    selectMemoryBtn.addEventListener('click', () => setupLobby('MEMORY'));
    selectPongBtn.addEventListener('click', () => setupLobby('PONG'));

    // Lobi Butonları
    matchBtn.addEventListener('click', () => handleLobbyAction(true)); // Oda Kur
    joinBtn.addEventListener('click', () => handleLobbyAction(false)); // Odaya Bağlan

    // Chat Gönderme
    document.getElementById('send-message')?.addEventListener('click', handleSendMessage);
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
    });

    // Başlangıçta menüyü göster
    showScreen('menu'); 
});
