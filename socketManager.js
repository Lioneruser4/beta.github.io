// Socket yöneticisi
class SocketManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // 1 saniye
        this.serverUrl = window.location.hostname === 'localhost' ? 
            'http://localhost:3000' : 
            'https://your-production-server.com'; // Gerçek sunucu URL'nizle değiştirin
    }

    // Socket bağlantısını başlat
    initialize() {
        console.log('Socket bağlantısı başlatılıyor...');
        
        // Mevcut bağlantıyı kapat
        this.disconnect();
        
        try {
            // Yeni socket bağlantısı oluştur
            this.socket = io(this.serverUrl, {
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: this.reconnectDelay,
                timeout: 10000
            });
            
            // Olay dinleyicilerini ayarla
            this.setupEventListeners();
            
            return this.socket;
        } catch (error) {
            console.error('Socket bağlantı hatası:', error);
            this.handleConnectionError('Bağlantı hatası oluştu');
            return null;
        }
    }
    
    // Olay dinleyicilerini ayarla
    setupEventListeners() {
        if (!this.socket) return;
        
        // Bağlantı başarılı olduğunda
        this.socket.on('connect', () => {
            console.log('✅ Sunucuya bağlandı');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateStatus(true, 'Sunucuya bağlandı');
            this.hideLoadingMessage();
        });
        
        // Bağlantı hatası olduğunda
        this.socket.on('connect_error', (error) => {
            console.error('❌ Sunucu bağlantı hatası:', error);
            this.handleConnectionError('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
        });
        
        // Bağlantı koptuğunda
        this.socket.on('disconnect', (reason) => {
            console.log('❌ Sunucu bağlantısı kesildi:', reason);
            this.isConnected = false;
            
            if (reason === 'io server disconnect') {
                // Sunucu bağlantıyı kesti, yeniden bağlanmayı dene
                this.socket.connect();
            }
            
            this.updateStatus(false, 'Sunucu bağlantısı kesildi. Yeniden bağlanılıyor...');
        });
        
        // Yeniden bağlanıldığında
        this.socket.on('reconnect', (attemptNumber) => {
            console.log(`✅ Yeniden bağlanıldı (${attemptNumber}. deneme)`);
            this.updateStatus(true, 'Sunucuya yeniden bağlanıldı');
        });
        
        // Yeniden bağlanma denemesi başarısız olduğunda
        this.socket.on('reconnect_failed', () => {
            console.error('❌ Yeniden bağlanma başarısız oldu');
            this.handleConnectionError('Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.');
        });
    }
    
    // Bağlantıyı kapat
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }
    
    // Bağlantı hatasını yönet
    handleConnectionError(message) {
        this.isConnected = false;
        this.updateStatus(false, message);
        this.showLoadingMessage(message);
        
        // Belirli bir süre sonra yeniden bağlanmayı dene
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
            
            console.log(`⏳ ${delay/1000} saniye sonra yeniden bağlanılacak (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.initialize();
            }, delay);
        } else {
            console.error('❌ Maksimum yeniden bağlanma denemesi aşıldı');
            this.updateStatus(false, 'Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin.');
        }
    }
    
    // Durum güncellemesi yap
    updateStatus(isOnline, message) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.style.color = isOnline ? '#4CAF50' : '#F44336';
            statusElement.style.display = 'block';
        }
        
        // Global mesaj göster
        if (window.showGlobalMessage) {
            window.showGlobalMessage(message, !isOnline);
        }
    }
    
    // Yükleme mesajını göster
    showLoadingMessage(message = 'Sunucuya bağlanılıyor...') {
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) {
            loadingMessage.style.display = 'flex';
            const messageText = loadingMessage.querySelector('p');
            if (messageText) {
                messageText.textContent = message;
            }
        }
    }
    
    // Yükleme mesajını gizle
    hideLoadingMessage() {
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }
    }
    
    // Odaya katıl
    joinRoom(roomCode, username) {
        if (!this.isConnected) {
            this.showLoadingMessage('Sunucuya bağlanılıyor...');
            this.initialize();
            
            // Bağlantı sağlandıktan sonra odaya katıl
            this.socket.once('connect', () => {
                this._joinRoom(roomCode, username);
            });
            return;
        }
        
        this._joinRoom(roomCode, username);
    }
    
    // Odaya katılma işlemi
    _joinRoom(roomCode, username) {
        this.socket.emit('joinRoom', {
            room: roomCode,
            username: username
        });
    }
    
    // Oda oluştur
    createRoom(username) {
        if (!this.isConnected) {
            this.showLoadingMessage('Sunucuya bağlanılıyor...');
            this.initialize();
            
            // Bağlantı sağlandıktan sonra oda oluştur
            this.socket.once('connect', () => {
                this._createRoom(username);
            });
            return;
        }
        
        this._createRoom(username);
    }
    
    // Oda oluşturma işlemi
    _createRoom(username) {
        this.socket.emit('createRoom', {
            username: username
        });
    }
}

// Global olarak kullanılabilir yap
window.SocketManager = SocketManager;
