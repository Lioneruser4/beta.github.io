// Oyun yöneticisi
class GameManager {
    constructor() {
        this.currentGame = null;
        this.socket = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Oyun kartlarına tıklama olayı
        document.querySelectorAll('.game-card').forEach(card => {
            card.addEventListener('click', () => this.selectGame(card.dataset.game));
        });

        // Menüye dön butonu
        document.getElementById('backToMenu')?.addEventListener('click', () => {
            this.showScreen('mainMenu');
        });
    }

    selectGame(gameType) {
        this.currentGame = gameType;
        const lobbyScreen = document.getElementById('lobby');
        
        // Oyun türüne göre lobi ekranını güncelle
        if (gameType === 'bomb') {
            document.querySelector('.game-title').textContent = '💣 KartBomBot 1v1';
            document.querySelector('.game-description').textContent = 'Dostunuzla oynayın ve bombalardan kaçının!';
            document.querySelector('.rules-list').innerHTML = `
                <li>Kartları açarak rakibinizin bombalarından kaçının</li>
                <li>Canı biten oyunu kaybeder</li>
                <li>Yeni oda oluşturmak için oda kodunu boş bırakın</li>
                <li>Odaya katılmak için oda kodunu girin</li>
            `;
        } else if (gameType === 'checkers') {
            document.querySelector('.game-title').textContent = '♟️ Dama Oyunu';
            document.querySelector('.game-description').textContent = 'Stratejinizi kullanın ve rakip taşları ele geçirin!';
            document.querySelector('.rules-list').innerHTML = `
                <li>Taşlarınızı çapraz hareket ettirin</li>
                <li>Rakip taşlarını atlayarak yiyin</li>
                <li>Karşı tarafa ulaşan taşlarınız vezir olur</li>
                <li>Tüm rakip taşları yiyen veya rakibi hareketsiz bırakan kazanır</li>
            `;
        }
        
        this.showScreen('lobby');
    }

    showScreen(screenId) {
        // Tüm ekranları gizle
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // İstenen ekranı göster
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.classList.add('active');
            
            // Oyun ekranına geçiş yapılıyorsa, seçili oyunu başlat
            if (screenId === 'gameScreen' && this.currentGame) {
                this.startGame();
            }
        }
    }

    startGame() {
        if (!this.currentGame) return;
        
        if (this.currentGame === 'bomb') {
            // Bomba oyununu başlat
            if (typeof initializeBombGame === 'function') {
                initializeBombGame();
            }
        } else if (this.currentGame === 'checkers') {
            // Dama oyununu başlat
            if (typeof initializeCheckersGame === 'function') {
                initializeCheckersGame();
            }
        }
    }
}

// Oyun yöneticisini başlat
document.addEventListener('DOMContentLoaded', () => {
    window.gameManager = new GameManager();
});
