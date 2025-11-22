import React, { useState, useEffect, useRef } from ‘react’;
import { Users, Copy, Check, Wifi, WifiOff, Crown, Clock, User } from ‘lucide-react’;

const DominoGame = () => {
const [screen, setScreen] = useState(‘lobby’);
const [socket, setSocket] = useState(null);
const [connected, setConnected] = useState(false);
const [playerName, setPlayerName] = useState(’’);
const [roomCode, setRoomCode] = useState(’’);
const [joinRoomCode, setJoinRoomCode] = useState(’’);
const [gameState, setGameState] = useState(null);
const [selectedTile, setSelectedTile] = useState(null);
const [validMoves, setValidMoves] = useState([]);
const [searching, setSearching] = useState(false);
const [copied, setCopied] = useState(false);
const [notification, setNotification] = useState(’’);
const wsRef = useRef(null);

useEffect(() => {
connectToServer();
return () => {
if (wsRef.current) {
wsRef.current.close();
}
};
}, []);

const connectToServer = () => {
try {
const ws = new WebSocket(‘wss://beta-github-io.onrender.com’);

```
  ws.onopen = () => {
    setConnected(true);
    showNotification('✅ Sunucuya bağlanıldı!', 'success');
    wsRef.current = ws;
    setSocket(ws);
  };

  ws.onclose = () => {
    setConnected(false);
    showNotification('❌ Bağlantı kesildi', 'error');
    setTimeout(connectToServer, 3000);
  };

  ws.onerror = () => {
    setConnected(false);
    showNotification('⚠️ Bağlantı hatası', 'error');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  };
} catch (error) {
  showNotification('⚠️ Sunucuya bağlanılamadı', 'error');
  setTimeout(connectToServer, 3000);
}
```

};

const showNotification = (message, type = ‘info’) => {
setNotification({ message, type });
setTimeout(() => setNotification(’’), 3000);
};

const handleServerMessage = (data) => {
switch (data.type) {
case ‘roomCreated’:
setRoomCode(data.roomCode);
showNotification(‘🎮 Oda oluşturuldu!’, ‘success’);
break;
case ‘gameStart’:
setGameState(data.gameState);
setScreen(‘game’);
showNotification(‘🎯 Oyun başladı!’, ‘success’);
break;
case ‘gameUpdate’:
setGameState(data.gameState);
break;
case ‘matchFound’:
showNotification(‘✨ Rakip bulundu!’, ‘success’);
break;
case ‘error’:
showNotification(’❌ ’ + data.message, ‘error’);
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
showNotification(‘⚠️ Lütfen isminizi girin’, ‘warning’);
return;
}
setSearching(true);
sendMessage({ type: ‘findMatch’, playerName });
showNotification(‘🔍 Rakip aranıyor…’, ‘info’);
};

const cancelSearch = () => {
setSearching(false);
sendMessage({ type: ‘cancelSearch’ });
showNotification(‘❌ Arama iptal edildi’, ‘info’);
};

const createRoom = () => {
if (!playerName.trim()) {
showNotification(‘⚠️ Lütfen isminizi girin’, ‘warning’);
return;
}
sendMessage({ type: ‘createRoom’, playerName });
};

const joinRoom = () => {
if (!playerName.trim() || !joinRoomCode.trim()) {
showNotification(‘⚠️ İsim ve oda kodu gerekli’, ‘warning’);
return;
}
sendMessage({ type: ‘joinRoom’, roomCode: joinRoomCode, playerName });
};

const copyRoomCode = () => {
navigator.clipboard.writeText(roomCode);
setCopied(true);
showNotification(‘📋 Oda kodu kopyalandı!’, ‘success’);
setTimeout(() => setCopied(false), 2000);
};

const selectTile = (tile, index) => {
if (gameState?.currentPlayer !== gameState?.playerId) return;

```
setSelectedTile({ tile, index });
const moves = calculateValidMoves(tile);
setValidMoves(moves);
```

};

const calculateValidMoves = (tile) => {
if (!gameState?.board.length) return [‘both’];

```
const leftEnd = gameState.board[0][0];
const rightEnd = gameState.board[gameState.board.length - 1][1];
const moves = [];

if (tile[0] === leftEnd || tile[1] === leftEnd) moves.push('left');
if (tile[0] === rightEnd || tile[1] === rightEnd) moves.push('right');

return moves;
```

};

const playTile = (position) => {
if (!selectedTile || !validMoves.includes(position)) return;

```
sendMessage({
  type: 'playTile',
  tileIndex: selectedTile.index,
  position
});

setSelectedTile(null);
setValidMoves([]);
```

};

const passTurn = () => {
sendMessage({ type: ‘pass’ });
};

if (screen === ‘lobby’) {
return (
<div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4 overflow-hidden relative">
<div className="absolute inset-0 overflow-hidden">
{[…Array(20)].map((_, i) => (
<div
key={i}
className=“absolute animate-pulse”
style={{
left: `${Math.random() * 100}%`,
top: `${Math.random() * 100}%`,
width: `${Math.random() * 4 + 2}px`,
height: `${Math.random() * 4 + 2}px`,
backgroundColor: ‘rgba(255, 255, 255, 0.3)’,
borderRadius: ‘50%’,
animationDelay: `${Math.random() * 2}s`,
animationDuration: `${Math.random() * 3 + 2}s`
}}
/>
))}
</div>

```
    {notification && (
      <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-2xl animate-bounce ${
        notification.type === 'success' ? 'bg-green-500' :
        notification.type === 'error' ? 'bg-red-500' :
        notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
      } text-white font-bold`}>
        {notification.message}
      </div>
    )}

    <div className="absolute top-4 right-4 flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
      {connected ? (
        <>
          <Wifi className="w-5 h-5 text-green-400 animate-pulse" />
          <span className="text-white font-semibold">Bağlı</span>
        </>
      ) : (
        <>
          <WifiOff className="w-5 h-5 text-red-400 animate-pulse" />
          <span className="text-white font-semibold">Bağlanıyor...</span>
        </>
      )}
    </div>

    <div className="relative z-10 max-w-2xl w-full">
      <div className="text-center mb-8 animate-fadeIn">
        <h1 className="text-7xl font-black text-white mb-4 drop-shadow-2xl animate-bounce" style={{ textShadow: '0 0 30px rgba(255,255,255,0.5)' }}>
          🎮 DOMİNO
        </h1>
        <p className="text-2xl text-purple-200 font-semibold animate-pulse">Profesyonel Online Oyun</p>
      </div>

      <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20">
        <input
          type="text"
          placeholder="👤 İsminizi girin..."
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          className="w-full px-6 py-4 rounded-xl bg-white/20 backdrop-blur-sm border-2 border-white/30 text-white placeholder-white/60 text-lg font-semibold mb-6 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-400/50 transition-all"
        />

        <div className="space-y-4">
          {searching ? (
            <div className="bg-gradient-to-r from-yellow-500 to-orange-500 p-6 rounded-2xl shadow-xl animate-pulse">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-white text-xl font-bold">Rakip Aranıyor...</span>
                </div>
              </div>
              <button
                onClick={cancelSearch}
                className="w-full bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-bold text-lg transition-all transform hover:scale-105 active:scale-95"
              >
                ❌ İptal Et
              </button>
            </div>
          ) : (
            <button
              onClick={startRankedMatch}
              disabled={!connected}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-500 disabled:to-gray-600 text-white py-6 rounded-2xl font-black text-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 border-4 border-white/30"
            >
              <Crown className="w-8 h-8 animate-bounce" />
              🏆 DERECELİ MAÇ
            </button>
          )}

          {roomCode ? (
            <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-6 rounded-2xl shadow-xl border-4 border-white/30">
              <div className="flex items-center justify-between mb-4">
                <span className="text-white text-lg font-bold">📱 Oda Kodu:</span>
                <div className="flex items-center gap-2">
                  <span className="text-white text-3xl font-black tracking-wider">{roomCode}</span>
                  <button
                    onClick={copyRoomCode}
                    className="bg-white/30 hover:bg-white/50 p-3 rounded-lg transition-all transform hover:scale-110 active:scale-95"
                  >
                    {copied ? <Check className="w-6 h-6 text-white" /> : <Copy className="w-6 h-6 text-white" />}
                  </button>
                </div>
              </div>
              <p className="text-white/90 text-center font-semibold animate-pulse">Arkadaşın katılmasını bekleyin...</p>
            </div>
          ) : (
            <button
              onClick={createRoom}
              disabled={!connected}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-500 disabled:to-gray-600 text-white py-6 rounded-2xl font-black text-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 border-4 border-white/30"
            >
              <Users className="w-8 h-8 animate-pulse" />
              👥 ARKADAŞLA OYNA
            </button>
          )}

          <div className="bg-white/10 backdrop-blur-sm p-6 rounded-2xl border-2 border-white/20">
            <input
              type="text"
              placeholder="📝 Oda kodunu girin..."
              value={joinRoomCode}
              onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
              className="w-full px-6 py-4 rounded-xl bg-white/20 border-2 border-white/30 text-white placeholder-white/60 text-center text-2xl font-black mb-4 focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/50 transition-all tracking-wider"
            />
            <button
              onClick={joinRoom}
              disabled={!connected}
              className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-gray-500 disabled:to-gray-600 text-white py-5 rounded-xl font-black text-xl shadow-xl transition-all transform hover:scale-105 active:scale-95 border-4 border-white/30"
            >
              🚪 ODAYA KATIL
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
);
```

}

if (screen === ‘game’ && gameState) {
const isMyTurn = gameState.currentPlayer === gameState.playerId;
const myHand = gameState.players[gameState.playerId]?.hand || [];
const opponentId = Object.keys(gameState.players).find(id => id !== gameState.playerId);
const opponent = gameState.players[opponentId];

```
return (
  <div className="min-h-screen bg-gradient-to-br from-green-800 via-green-700 to-emerald-900 p-4 relative overflow-hidden">
    <div className="absolute inset-0 opacity-10">
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
        backgroundSize: '50px 50px'
      }}></div>
    </div>

    {notification && (
      <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-2xl animate-bounce ${
        notification.type === 'success' ? 'bg-green-500' :
        notification.type === 'error' ? 'bg-red-500' :
        notification.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
      } text-white font-bold`}>
        {notification.message}
      </div>
    )}

    <div className="max-w-7xl mx-auto relative z-10">
      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 mb-4 flex justify-between items-center border border-white/20 shadow-2xl">
        <div className={`flex items-center gap-3 px-6 py-3 rounded-xl ${!isMyTurn ? 'bg-purple-500 animate-pulse shadow-lg shadow-purple-500/50' : 'bg-white/20'} transition-all`}>
          <User className="w-6 h-6 text-white" />
          <span className="text-white font-bold text-lg">{opponent?.name || 'Rakip'}</span>
          <span className="text-white font-bold">({opponent?.hand?.length || 0} taş)</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-white/20 px-6 py-3 rounded-xl backdrop-blur-sm">
            <Clock className="w-6 h-6 text-white inline mr-2" />
            <span className="text-white font-bold text-lg">Tur: {gameState.turn || 1}</span>
          </div>
        </div>

        <div className={`flex items-center gap-3 px-6 py-3 rounded-xl ${isMyTurn ? 'bg-green-500 animate-pulse shadow-lg shadow-green-500/50' : 'bg-white/20'} transition-all`}>
          <User className="w-6 h-6 text-white" />
          <span className="text-white font-bold text-lg">Sen</span>
          <span className="text-white font-bold">({myHand.length} taş)</span>
        </div>
      </div>

      <div className="bg-gradient-to-br from-amber-900/80 to-amber-800/80 backdrop-blur-md rounded-3xl p-8 mb-6 min-h-[300px] flex items-center justify-center border-4 border-amber-700 shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-900/20 to-transparent"></div>
        
        {validMoves.includes('left') && (
          <button
            onClick={() => playTile('left')}
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-xl animate-pulse z-20 transform hover:scale-110 transition-all"
          >
            ⬅️
          </button>
        )}

        {validMoves.includes('right') && (
          <button
            onClick={() => playTile('right')}
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-green-500 hover:bg-green-600 text-white p-4 rounded-full shadow-xl animate-pulse z-20 transform hover:scale-110 transition-all"
          >
            ➡️
          </button>
        )}

        <div className="flex items-center gap-2 flex-wrap justify-center relative z-10">
          {gameState.board.length === 0 ? (
            <div className="text-white/50 text-2xl font-bold">Oyun tahtası boş</div>
          ) : (
            gameState.board.map((tile, idx) => (
              <div
                key={idx}
                className="bg-white rounded-lg p-3 shadow-xl transform hover:scale-105 transition-all border-4 border-gray-300"
                style={{ minWidth: '60px' }}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="w-10 h-10 flex items-center justify-center">
                    <span className="text-3xl font-black text-gray-800">{tile[0]}</span>
                  </div>
                  <div className="w-full h-1 bg-gray-800 rounded"></div>
                  <div className="w-10 h-10 flex items-center justify-center">
                    <span className="text-3xl font-black text-gray-800">{tile[1]}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-xl">🎲 Taşlarınız</h3>
          {isMyTurn && (
            <button
              onClick={passTurn}
              className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg"
            >
              ⏭️ Pas Geç
            </button>
          )}
        </div>

        <div className="flex gap-3 flex-wrap justify-center">
          {myHand.map((tile, idx) => {
            const isSelected = selectedTile?.index === idx;
            const canPlay = isMyTurn && (gameState.board.length === 0 || calculateValidMoves(tile).length > 0);
            
            return (
              <button
                key={idx}
                onClick={() => selectTile(tile, idx)}
                disabled={!isMyTurn}
                className={`bg-white rounded-xl p-4 shadow-xl transition-all transform hover:scale-110 active:scale-95 border-4 ${
                  isSelected ? 'border-yellow-400 shadow-yellow-400/50 scale-110' :
                  canPlay ? 'border-green-400 shadow-green-400/50 animate-pulse' :
                  'border-gray-300'
                } ${!isMyTurn ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                style={{ minWidth: '80px' }}
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 flex items-center justify-center">
                    <span className="text-4xl font-black text-gray-800">{tile[0]}</span>
                  </div>
                  <div className="w-full h-1 bg-gray-800 rounded"></div>
                  <div className="w-12 h-12 flex items-center justify-center">
                    <span className="text-4xl font-black text-gray-800">{tile[1]}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  </div>
);
```

}

return null;
};

export default DominoGame;
