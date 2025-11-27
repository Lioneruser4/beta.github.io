<!DOCTYPE html>

<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎮 Profesyonel Domino Oyunu</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
            animation: fadeIn 1s ease-out;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow-x: hidden;
        }
    </style>
</head>
<body>
    <div id="root"></div>

```
<script>
    const { useState, useEffect, useRef } = React;

    const DominoGame = () => {
        const [screen, setScreen] = useState('lobby');
        const [connected, setConnected] = useState(false);
        const [playerName, setPlayerName] = useState('');
        const [playerData, setPlayerData] = useState(null); // Oyuncu verilerini saklamak için
        const [roomCode, setRoomCode] = useState('');
        const [joinRoomCode, setJoinRoomCode] = useState('');
        const [gameState, setGameState] = useState(null);
        const [selectedTile, setSelectedTile] = useState(null);
        const [validMoves, setValidMoves] = useState([]);
        const [searching, setSearching] = useState(false);
        const [copied, setCopied] = useState(false);
        const [notification, setNotification] = useState('');
        const wsRef = useRef(null);

        // --- ADMIN STATE ---
        const [isAdmin, setIsAdmin] = useState(false);
        const [adminScreen, setAdminScreen] = useState(false);

        useEffect(() => {
            connectToServer();
            return () => {
                if (wsRef.current) {
                    wsRef.current.close();
                }
            };
        }, []);

        // Telegram'dan gelen veriyi almak için
        useEffect(() => {
            if (window.Telegram && window.Telegram.WebApp) {
                const tg = window.Telegram.WebApp;
                tg.ready();
                const user = tg.initDataUnsafe?.user;
                if (user) {
                    const name = user.first_name || user.username;
                    setPlayerName(name);
                    // Sunucuya oyuncu verisini gönderip doğrula
                    fetch('http://localhost:10000/api/auth/telegram', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ telegramId: user.id.toString(), username: user.username, firstName: user.first_name, lastName: user.last_name, photoUrl: user.photo_url })
                    }).then(res => res.json()).then(data => {
                        if (data.success) {
                            setPlayerData(data.player);
                            if (data.player.isAdmin) setIsAdmin(true);
                        }
                    });
                }
            }
        }, []);

        const connectToServer = () => {
            try {
                // Local development için localhost
                const wsUrl = 'ws://localhost:10000'; // veya sunucu IP'niz
                console.log('🔌 Sunucuya bağlanılıyor:', wsUrl);
                
                const ws = new WebSocket(wsUrl);
                
                ws.onopen = () => {
                    console.log('✅ WebSocket bağlantısı açıldı');
                    setConnected(true);
                    showNotification('✅ Sunucuya bağlanıldı!', 'success');
                    wsRef.current = ws;
                };

                ws.onclose = (event) => {
                    console.log('❌ WebSocket bağlantısı kapandı:', event.code, event.reason);
                    setConnected(false);
                    showNotification('❌ Bağlantı kesildi, yeniden bağlanıyor...', 'error');
                    setTimeout(connectToServer, 3000);
                };

                ws.onerror = (error) => {
                    console.error('⚠️ WebSocket hatası:', error);
                    setConnected(false);
                    showNotification('⚠️ Bağlantı hatası', 'error');
                };

                ws.onmessage = (event) => {
                    console.log('📨 Mesaj alındı:', event.data);
                    try {
                        const data = JSON.parse(event.data);
                        handleServerMessage(data);
                    } catch (error) {
                        console.error('❌ Mesaj parse hatası:', error);
                    }
                };
            } catch (error) {
                console.error('❌ Bağlantı hatası:', error);
                showNotification('⚠️ Sunucuya bağlanılamadı', 'error');
                setTimeout(connectToServer, 5000);
            }
        };

        const showNotification = (message, type = 'info') => {
            setNotification({ message, type });
            setTimeout(() => setNotification(''), 3000);
        };

        const handleServerMessage = (data) => {
            switch (data.type) {
                case 'roomCreated':
                    setRoomCode(data.roomCode);
                    showNotification('🎮 Oda oluşturuldu!', 'success');
                    break;
                case 'gameStart':
                    setGameState(data.gameState);
                    setScreen('game');
                    showNotification('🎯 Oyun başladı!', 'success');
                    break;
                case 'gameUpdate':
                    setGameState(data.gameState);
                    break;
                case 'matchFound':
                    showNotification('✨ Rakip bulundu!', 'success');
                    break;
                case 'playerDisconnected':
                    showNotification('❌ Rakip oyundan ayrıldı', 'error');
                    setTimeout(() => {
                        setScreen('lobby');
                        setGameState(null);
                    }, 2000);
                    break;
                case 'gameEnd':
                    showNotification(`🏆 Oyun bitti! Kazanan: ${data.winnerName || 'Bilinmiyor'}. ELO: ${data.isRanked ? (data.eloChanges?.winner > 0 ? '+' : '') + (data.eloChanges?.winner || 0) : 'N/A'}`, 'success');
                    setTimeout(() => {
                        setScreen('lobby');
                        setGameState(null);
                    }, 3000);
                    break;
                case 'error':
                    showNotification('❌ ' + data.message, 'error');
                    setSearching(false);
                    break;
            }
        };

        const sendMessage = (data) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify(data));
            }
        };

        const startRankedMatch = () => {
            if (!playerName.trim()) {
                showNotification('⚠️ Lütfen isminizi girin', 'warning');
                return;
            }
            setSearching(true);
            sendMessage({ 
                type: 'findMatch', 
                telegramId: playerData?.telegramId,
                firstName: playerData?.firstName,
                photoUrl: playerData?.photoUrl,
                level: playerData?.level
            });
            showNotification('🔍 Rakip aranıyor...', 'info');
        };

        const cancelSearch = () => {
            setSearching(false);
            sendMessage({ type: 'cancelSearch' });
            showNotification('❌ Arama iptal edildi', 'info');
        };

        const createRoom = () => {
            if (!playerName.trim()) {
                showNotification('⚠️ Lütfen isminizi girin', 'warning');
                return;
            }
            sendMessage({ 
                type: 'createRoom', 
                telegramId: playerData?.telegramId,
                firstName: playerData?.firstName,
                photoUrl: playerData?.photoUrl,
                level: playerData?.level
            });
        };

        const joinRoom = () => {
            if (!playerName.trim() || !joinRoomCode.trim()) {
                showNotification('⚠️ İsim ve oda kodu gerekli', 'warning');
                return;
            }
            sendMessage({ 
                type: 'joinRoom', 
                roomCode: joinRoomCode, 
                telegramId: playerData?.telegramId,
                firstName: playerData?.firstName,
                photoUrl: playerData?.photoUrl,
                level: playerData?.level
            });
        };

        const copyRoomCode = () => {
            navigator.clipboard.writeText(roomCode);
            setCopied(true);
            showNotification('📋 Oda kodu kopyalandı!', 'success');
            setTimeout(() => setCopied(false), 2000);
        };

        const selectTile = (tile, index) => {
            if (gameState?.currentPlayer !== gameState?.playerId) return;
            
            setSelectedTile({ tile, index });
            const moves = calculateValidMoves(tile);
            setValidMoves(moves);
        };

        const calculateValidMoves = (tile) => {
            if (!gameState?.board.length) return ['both'];
            
            const leftEnd = gameState.board[0][0];
            const rightEnd = gameState.board[gameState.board.length - 1][1];
            const moves = [];
            
            if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
            if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');
            
            return moves;
        };

        const playTile = (position) => {
            if (!selectedTile || !validMoves.includes(position)) return;
            
            sendMessage({
                type: 'playTile',
                tileIndex: selectedTile.index,
                position
            });
            
            setSelectedTile(null);
            setValidMoves([]);
        };

        const passTurn = () => {
            sendMessage({ type: 'pass' });
        };

        // --- ADMIN FONKSİYONLARI ---
        const handleAdminAction = async (action, targetTelegramId, amount = 0) => {
            if (!isAdmin) return;
            const endpoint = `http://localhost:10000/api/admin/${action}`;
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adminId: playerData.telegramId,
                        targetTelegramId,
                        amount
                    })
                });
                const result = await response.json();
                if (result.success) {
                    showNotification(result.message, 'success');
                } else {
                    showNotification(result.error, 'error');
                }
            } catch (error) {
                showNotification('Admin işlemi başarısız oldu.', 'error');
            }
        };

        const AdminPanel = () => {
            // Bu kısım, admin paneli için bir arayüz oluşturur.
            // Basitlik adına, şimdilik sadece bir geri butonu ekliyorum.
            // Gerçek bir projede, burada oyuncu listesi, ELO değiştirme formları vb. olurdu.
            const [targetId, setTargetId] = useState('');
            const [eloAmount, setEloAmount] = useState(0);

            return React.createElement('div', { className: 'bg-white/10 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20 mt-8' },
                React.createElement('h2', { className: 'text-3xl font-bold text-white text-center mb-6' }, '🔐 Admin Paneli'),
                React.createElement('div', { className: 'space-y-4' },
                    React.createElement('input', { type: 'text', placeholder: 'Hedef Oyuncu Telegram ID', value: targetId, onChange: e => setTargetId(e.target.value), className: 'w-full px-4 py-2 rounded-lg bg-white/20 text-white' }),
                    React.createElement('input', { type: 'number', placeholder: 'ELO Miktarı (+/-)', value: eloAmount, onChange: e => setEloAmount(parseInt(e.target.value, 10)), className: 'w-full px-4 py-2 rounded-lg bg-white/20 text-white' }),
                    React.createElement('button', { onClick: () => handleAdminAction('modify-elo', targetId, eloAmount), className: 'w-full bg-blue-500 text-white py-2 rounded-lg' }, 'ELO Değiştir'),
                    React.createElement('button', { onClick: () => handleAdminAction('toggle-visibility', targetId), className: 'w-full bg-yellow-500 text-white py-2 rounded-lg' }, 'Gizle/Göster'),
                    React.createElement('button', { onClick: () => handleAdminAction('delete-user', targetId), className: 'w-full bg-red-500 text-white py-2 rounded-lg' }, 'Kullanıcıyı Sil'),
                    React.createElement('button', { onClick: () => setAdminScreen(false), className: 'w-full bg-gray-600 text-white py-2 rounded-lg mt-4' }, 'Geri')
                )
            );
        };

        if (screen === 'lobby') {
            return React.createElement('div', { 
                className: 'min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4 overflow-hidden relative' 
            },
                React.createElement('div', { className: 'absolute inset-0 overflow-hidden' },
                    [...Array(20)].map((_, i) => 
                        React.createElement('div', {
                            key: i,
                            className: 'absolute animate-pulse',
                            style: {
                                left: `${Math.random() * 100}%`,
                                top: `${Math.random() * 100}%`,
                                width: `${Math.random() * 4 + 2}px`,
                                height: `${Math.random() * 4 + 2}px`,
                                backgroundColor: 'rgba(255, 255, 255, 0.3)',
                                borderRadius: '50%',
                                animationDelay: `${Math.random() * 2}s`,
                                animationDuration: `${Math.random() * 3 + 2}s`
                            }
                        })
                    )
                ),

                notification && React.createElement('div', { 
                    className: `fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-2xl animate-bounce ${
                        notification.type === 'success' ? 'bg-green-500' :
                        notification.type === 'error' ? 'bg-red-500' :
                        notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                    } text-white font-bold` 
                }, notification.message),

                React.createElement('div', { className: 'absolute top-4 right-4 flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20' },
                    connected ? 
                        React.createElement('div', { className: 'flex items-center gap-2' },
                            React.createElement('div', { className: 'w-3 h-3 bg-green-400 rounded-full animate-pulse' }),
                            React.createElement('span', { className: 'text-white font-semibold' }, 'Bağlı')
                        ) :
                        React.createElement('div', { className: 'flex items-center gap-2' },
                            React.createElement('div', { className: 'w-3 h-3 bg-red-400 rounded-full animate-pulse' }),
                            React.createElement('span', { className: 'text-white font-semibold' }, 'Bağlanıyor...')
                        )
                ),

                React.createElement('div', { className: 'relative z-10 max-w-2xl w-full' },
                    React.createElement('div', { className: 'text-center mb-8 animate-fadeIn' },
                        React.createElement('h1', { 
                            className: 'text-7xl font-black text-white mb-4 drop-shadow-2xl animate-bounce',
                            style: { textShadow: '0 0 30px rgba(255,255,255,0.5)' }
                        }, '🎮 DOMİNO'),
                        React.createElement('p', { className: 'text-2xl text-purple-200 font-semibold animate-pulse' }, 'Profesyonel Online Oyun')
                    ),

                    adminScreen ? React.createElement(AdminPanel) :
                        React.createElement('div', { className: 'bg-white/10 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20' },
                            React.createElement('input', {
                                type: 'text',
                                placeholder: '👤 İsminizi girin...',
                                value: playerName,
                                onChange: (e) => setPlayerName(e.target.value),
                                readOnly: !!playerData, // Telegram'dan geldiyse değiştirilemez
                                className: 'w-full px-6 py-4 rounded-xl bg-white/20 backdrop-blur-sm border-2 border-white/30 text-white placeholder-white/60 text-lg font-semibold mb-6 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-400/50 transition-all'
                            }),

                            React.createElement('div', { className: 'space-y-4' },
                                searching ? 
                                    React.createElement('div', { className: 'bg-gradient-to-r from-yellow-500 to-orange-500 p-6 rounded-2xl shadow-xl animate-pulse' },
                                        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                                            React.createElement('div', { className: 'flex items-center gap-3' },
                                                React.createElement('div', { className: 'w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin' }),
                                                React.createElement('span', { className: 'text-white text-xl font-bold' }, 'Rakip Aranıyor...')
                                            )
                                        ),
                                        React.createElement('button', {
                                            onClick: cancelSearch,
                                            className: 'w-full bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 active:scale-95'
                                        }, '❌ İptal Et')
                                    ) :
                                    React.createElement('button', {
                                        onClick: startRankedMatch,
                                        disabled: !connected || !playerData,
                                        className: 'w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-500 disabled:to-gray-600 text-white py-6 rounded-2xl font-black text-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 border-4 border-white/30'
                                    }, '👑 🏆 DERECELİ MAÇ'),

                                roomCode ? 
                                    React.createElement('div', { className: 'bg-gradient-to-r from-green-500 to-emerald-500 p-6 rounded-2xl shadow-xl border-4 border-white/30' },
                                        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                                            React.createElement('span', { className: 'text-white text-lg font-bold' }, '📱 Oda Kodu:'),
                                            React.createElement('div', { className: 'flex items-center gap-2' },
                                                React.createElement('span', { className: 'text-white text-3xl font-black tracking-wider' }, roomCode),
                                                React.createElement('button', {
                                                    onClick: copyRoomCode,
                                                    className: 'bg-white/30 hover:bg-white/50 p-3 rounded-lg transition-all transform hover:scale-110 active:scale-95'
                                                }, copied ? '✓' : '📋')
                                            )
                                        ),
                                        React.createElement('p', { className: 'text-white/90 text-center font-semibold animate-pulse' }, 'Arkadaşın katılmasını bekleyin...')
                                    ) :
                                    React.createElement('button', {
                                        onClick: createRoom,
                                        disabled: !connected || !playerData,
                                        className: 'w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-500 disabled:to-gray-600 text-white py-6 rounded-2xl font-black text-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 border-4 border-white/30'
                                    }, '👥 ARKADAŞLA OYNA'),

                                React.createElement('div', { className: 'bg-white/10 backdrop-blur-sm p-6 rounded-2xl border-2 border-white/20' },
                                    React.createElement('input', {
                                        type: 'text',
                                        placeholder: '📝 Oda kodunu girin...',
                                        value: joinRoomCode,
                                        onChange: (e) => setJoinRoomCode(e.target.value.toUpperCase()),
                                        maxLength: 4,
                                        className: 'w-full px-6 py-4 rounded-xl bg-white/20 border-2 border-white/30 text-white placeholder-white/60 text-center text-2xl font-black mb-4 focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/50 transition-all tracking-wider'
                                    }),
                                    React.createElement('button', {
                                        onClick: joinRoom,
                                        disabled: !connected || !playerData,
                                        className: 'w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-gray-500 disabled:to-gray-600 text-white py-5 rounded-xl font-black text-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 border-4 border-white/30'
                                    }, '🚪 ODAYA KATIL')
                                ),
                                isAdmin && React.createElement('button', {
                                    onClick: () => setAdminScreen(true),
                                    className: 'w-full mt-4 bg-purple-600 text-white py-3 rounded-xl font-bold'
                                }, '🔐 Admin Paneli')
                            )
                        )
                )
            );
        }

        if (screen === 'game' && gameState) {
            const isMyTurn = gameState.currentPlayer === gameState.playerId;
            const myHand = gameState.players[gameState.playerId]?.hand || [];
            const opponentId = Object.keys(gameState.players).find(id => id !== gameState.playerId);
            const opponent = gameState.players[opponentId];
            const me = gameState.players[gameState.playerId];

            return React.createElement('div', { className: 'min-h-screen bg-gradient-to-br from-green-800 via-green-700 to-emerald-900 p-4 relative overflow-hidden' },
                React.createElement('div', { 
                    className: 'absolute inset-0 opacity-10',
                    style: {
                        backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
                        backgroundSize: '50px 50px'
                    }
                }),

                notification && React.createElement('div', { 
                    className: `fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-2xl animate-bounce ${
                        notification.type === 'success' ? 'bg-green-500' :
                        notification.type === 'error' ? 'bg-red-500' :
                        notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
                    } text-white font-bold` 
                }, notification.message),

                React.createElement('div', { className: 'max-w-7xl mx-auto relative z-10' },
                    React.createElement('div', { className: 'bg-white/10 backdrop-blur-md rounded-2xl p-4 mb-4 flex justify-between items-center border border-white/20 shadow-2xl' },
                        React.createElement('div', { 
                            className: `flex items-center gap-3 px-6 py-3 rounded-xl ${!isMyTurn ? 'bg-purple-500 animate-pulse shadow-lg shadow-purple-500/50' : 'bg-white/20'} transition-all` 
                        },
                            opponent?.photoUrl ? 
                                React.createElement('img', { src: opponent.photoUrl, className: 'w-10 h-10 rounded-full border-2 border-white' }) :
                                React.createElement('span', { className: 'text-2xl' }, '👤'),
                            React.createElement('div', { className: 'flex flex-col' },
                                React.createElement('span', { className: 'text-white font-bold text-lg' }, opponent?.name || 'Rakip'),
                                React.createElement('span', { className: 'text-yellow-300 font-semibold' }, `Lv. ${opponent?.level || 1}`)
                            ),
                            React.createElement('span', { className: 'text-white font-bold' }, `(${opponent?.hand?.length || 0} taş)`)
                        ),

                        React.createElement('div', { className: 'bg-white/20 px-6 py-3 rounded-xl backdrop-blur-sm' },
                            React.createElement('span', { className: 'text-2xl' }, '⏱️'),
                            React.createElement('span', { className: 'text-white font-bold text-lg ml-2' }, `Tur: ${gameState.turn || 1}`),
                            React.createElement('span', { className: 'text-white font-bold text-lg ml-4' }, `Pazar: ${gameState.market?.length || 0}`)
                        ),

                        React.createElement('div', { 
                            className: `flex items-center gap-3 px-6 py-3 rounded-xl ${isMyTurn ? 'bg-green-500 animate-pulse shadow-lg shadow-green-500/50' : 'bg-white/20'} transition-all` 
                        },
                            me?.photoUrl ?
                                React.createElement('img', { src: me.photoUrl, className: 'w-10 h-10 rounded-full border-2 border-white' }) :
                                React.createElement('span', { className: 'text-2xl' }, '👤'),
                            React.createElement('div', { className: 'flex flex-col' },
                                React.createElement('span', { className: 'text-white font-bold text-lg' }, me?.name || 'Sen'),
                                React.createElement('span', { className: 'text-yellow-300 font-semibold' }, `Lv. ${me?.level || 1}`)
                            ),
                            React.createElement('span', { className: 'text-white font-bold' }, `(${myHand.length} taş)`)
                        )
                    ),

                    React.createElement('div', { 
                        className: 'bg-gradient-to-br from-amber-900/80 to-amber-800/80 backdrop-blur-md rounded-3xl p-8 mb-6 min-h-[300px] flex items-center justify-center border-4 border-amber-700 shadow-2xl relative overflow-hidden' 
                    },
                        React.createElement('div', { className: 'absolute inset-0 bg-gradient-to-br from-yellow-900/20 to-transparent' }),
                        
                        validMoves.includes('left') && React.createElement('button', {
                            onClick: () => playTile('left'),
                            className: 'absolute left-4 top-1/2 -translate-y-1/2 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-xl animate-pulse z-20 transform hover:scale-110 transition-all text-2xl'
                        }, '⬅️'),

                        validMoves.includes('right') && React.createElement('button', {
                            onClick: () => playTile('right'),
                            className: 'absolute right-4 top-1/2 -translate-y-1/2 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-xl animate-pulse z-20 transform hover:scale-110 transition-all text-2xl'
                        }, '➡️'),

                        React.createElement('div', { className: 'flex items-center gap-2 flex-wrap justify-center relative z-10' },
                            gameState.board.length === 0 ? 
                                React.createElement('div', { className: 'text-white/50 text-2xl font-bold' }, 'Oyun tahtası boş') :
                                gameState.board.map((tile, idx) =>
                                    React.createElement('div', {
                                        key: idx,
                                        className: 'bg-white rounded-lg p-3 shadow-xl transform hover:scale-105 transition-all border-4 border-gray-300',
                                        style: { minWidth: '60px' }
                                    },
                                        React.createElement('div', { className: 'flex flex-col items-center gap-1' },
                                            React.createElement('div', { className: 'w-10 h-10 flex items-center justify-center' },
                                                React.createElement('span', { className: 'text-3xl font-black text-gray-800' }, tile[0])
                                            ),
                                            React.createElement('div', { className: 'w-full h-1 bg-gray-800 rounded' }),
                                            React.createElement('div', { className: 'w-10 h-10 flex items-center justify-center' },
                                                React.createElement('span', { className: 'text-3xl font-black text-gray-800' }, tile[1])
                                            )
                                        )
                                    )
                                )
                        )
                    ),

                    React.createElement('div', { className: 'bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-2xl' },
                        React.createElement('div', { className: 'flex items-center justify-between mb-4' },
                            React.createElement('h3', { className: 'text-white font-bold text-xl' }, '🎲 Taşlarınız'),
                            isMyTurn && React.createElement('button', {
                                onClick: passTurn,
                                className: 'bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg'
                            }, '⏭️ Pas Geç')
                        ),

                        React.createElement('div', { className: 'flex gap-3 flex-wrap justify-center' },
                            myHand.map((tile, idx) => {
                                const isSelected = selectedTile?.index === idx;
                                const canPlay = isMyTurn && (gameState.board.length === 0 || calculateValidMoves(tile).length > 0);
                                
                                return React.createElement('button', {
                                    key: idx,
                                    onClick: () => selectTile(tile, idx),
                                    disabled: !isMyTurn,
                                    className: `bg-white rounded-xl p-4 shadow-xl transition-all transform hover:scale-110 active:scale-95 border-4 ${
                                        isSelected ? 'border-yellow-400 shadow-yellow-400/50 scale-110' :
                                        canPlay ? 'border-green-400 shadow-green-400/50 animate-pulse' :
                                        'border-gray-300'
                                    } ${!isMyTurn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`,
                                    style: { minWidth: '80px' }
                                },
                                    React.createElement('div', { className: 'flex flex-col items-center gap-2' },
                                        React.createElement('div', { className: 'w-12 h-12 flex items-center justify-center' },
                                            React.createElement('span', { className: 'text-4xl font-black text-gray-800' }, tile[0])
                                        ),
                                        React.createElement('div', { className: 'w-full h-1 bg-gray-800 rounded' }),
                                        React.createElement('div', { className: 'w-12 h-12 flex items-center justify-center' },
                                            React.createElement('span', { className: 'text-4xl font-black text-gray-800' }, tile[1])
                                        )
                                    )
                                );
                            })
                        )
                    )
                )
            );
        }

        return null;
    };

    ReactDOM.render(React.createElement(DominoGame), document.getElementById('root'));
</script>
```

</body>
</html>
