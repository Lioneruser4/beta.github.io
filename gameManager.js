// Oyun yöneticisi
class GameManager {
    constructor() {
        this.currentGame = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Oyun kartlarına tıklama olaylarını ekle
        document.querySelectorAll('.game-card').forEach(card => {
            card.addEventListener('click', () => this.selectGame(card.dataset.game));
        });
        
        // Menüye dön butonunu ekle
        document.getElementById('backToMenu')?.addEventListener('click', () => this.showScreen('mainMenu'));
    }

    selectGame(gameType) {
        this.currentGame = gameType;
        this.showLobbyScreen();
    }

    showLobbyScreen() {
        // Lobi ekranını göster
        document.getElementById('lobbyTitle').textContent = 
            this.currentGame === 'bomb' ? 'Bomba Oyunu - Lobi' : 'Dama Oyunu - Lobi';
        
        // Sadece oda kodu giriş alanını göster
        const roomCodeContainer = document.getElementById('roomCodeContainer');
        if (roomCodeContainer) {
            roomCodeContainer.innerHTML = `
                <div class="mb-4 w-full max-w-md mx-auto">
                    <label for="roomCodeInput" class="block text-white text-sm font-medium mb-2">
                        Oda Kodunu Girin
                    </label>
                    <div class="flex">
                        <input type="text" id="roomCodeInput" 
                               class="flex-1 px-4 py-3 rounded-l-lg bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                               placeholder="Oda kodu girin" maxlength="6" style="text-transform: uppercase">
                        <button id="joinRoomBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-r-lg transition-colors">
                            Katıl
                        </button>
                    </div>
                    <div class="mt-2 text-center">
                        <button id="createRoomBtn" class="text-blue-400 hover:text-blue-300 text-sm">
                            Yeni Oda Oluştur
                        </button>
                    </div>
                </div>
            `;
            
            // Odaya katıl butonuna tıklama olayını ekle
            document.getElementById('joinRoomBtn')?.addEventListener('click', () => this.joinRoom());
            
            // Oda oluştur butonuna tıklama olayını ekle
            document.getElementById('createRoomBtn')?.addEventListener('click', () => this.createRoom());
            
            // Enter tuşu ile de göndermeyi etkinleştir
            document.getElementById('roomCodeInput')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.joinRoom();
                }
            });
        }
        
        this.showScreen('lobby');
    }

    createRoom() {
        const username = document.getElementById('telegramUsername')?.textContent || 'Oyuncu';
        
        // SocketManager üzerinden yeni oda oluştur
        if (window.socketManager) {
            window.socketManager.createRoom(username);
            showScreen('wait');
        } else {
            console.error('SocketManager bulunamadı!');
            showGlobalMessage('Bağlantı hatası. Lütfen sayfayı yenileyin.', true);
        }
    }

    joinRoom() {
        const roomCode = document.getElementById('roomCodeInput')?.value.trim().toUpperCase();
        const username = document.getElementById('telegramUsername')?.textContent || 'Oyuncu';
        
        if (!roomCode) {
            showGlobalMessage('Lütfen bir oda kodu girin', true);
            return;
        }
        
        // SocketManager üzerinden odaya katıl
        if (window.socketManager) {
            window.socketManager.joinRoom(roomCode, username);
            showScreen('wait');
        } else {
            console.error('SocketManager bulunamadı!');
            showGlobalMessage('Bağlantı hatası. Lütfen sayfayı yenileyin.', true);
        }
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId)?.classList.add('active');
    }
}

// Sayfa yüklendiğinde GameManager'ı başlat
document.addEventListener('DOMContentLoaded', () => {
    window.gameManager = new GameManager();
    
    // SocketManager'ı başlat
    if (window.SocketManager) {
        window.socketManager = new SocketManager();
        window.socketManager.initialize();
    } else {
        console.error('SocketManager yüklenemedi!');
    }
});
