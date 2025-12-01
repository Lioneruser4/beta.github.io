// ============================================
// DOMINO GAME LOGIC
// ============================================

class DominoGame {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = [];
        this.leftEnd = -1;
        this.rightEnd = -1;
        this.players = [];
        this.currentPlayerIndex = 0;
        this.status = 'waiting';
        this.isRanked = false;
        this.turnCount = 0;
        this.winner = null;
    }

    // Generate all 28 domino tiles (0-0 to 6-6)
    generateAllTiles() {
        const tiles = [];
        let id = 0;
        for (let i = 0; i <= 6; i++) {
            for (let j = i; j <= 6; j++) {
                tiles.push({
                    id: `tile-${id++}`,
                    left: i,
                    right: j,
                    isDouble: i === j
                });
            }
        }
        return tiles;
    }

    // Fisher-Yates shuffle
    shuffleTiles(tiles) {
        const shuffled = [...tiles];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // Initialize game with players
    initializeGame(playerNames, isRanked = false) {
        this.reset();
        const allTiles = this.shuffleTiles(this.generateAllTiles());
        const tilesPerPlayer = 7;

        this.players = playerNames.map((name, index) => ({
            id: `player-${index}`,
            name: name,
            tiles: allTiles.slice(index * tilesPerPlayer, (index + 1) * tilesPerPlayer),
            level: 1,
            elo: 0,
            isActive: true
        }));

        this.isRanked = isRanked;
        this.status = 'playing';
        this.currentPlayerIndex = 0;

        return this.players;
    }

    // Get current player
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    // Check if a tile can be played
    canPlayTile(tile) {
        if (this.board.length === 0) return true;

        return (
            tile.left === this.leftEnd ||
            tile.right === this.leftEnd ||
            tile.left === this.rightEnd ||
            tile.right === this.rightEnd
        );
    }

    // Get playable positions for a tile
    getPlayablePositions(tile) {
        if (this.board.length === 0) {
            return [
                { side: 'left', matchingValue: tile.left },
                { side: 'right', matchingValue: tile.right }
            ];
        }

        const positions = [];

        if (tile.left === this.leftEnd || tile.right === this.leftEnd) {
            positions.push({ side: 'left', matchingValue: this.leftEnd });
        }

        if (tile.left === this.rightEnd || tile.right === this.rightEnd) {
            positions.push({ side: 'right', matchingValue: this.rightEnd });
        }

        return positions;
    }

    // Check if current player has any playable tile
    hasPlayableTile() {
        const currentPlayer = this.getCurrentPlayer();
        return currentPlayer.tiles.some(tile => this.canPlayTile(tile));
    }

    // Get all playable tiles for current player
    getPlayableTiles() {
        const currentPlayer = this.getCurrentPlayer();
        return currentPlayer.tiles.filter(tile => this.canPlayTile(tile));
    }

    // Place a tile on the board
    placeTile(tileId, side) {
        const currentPlayer = this.getCurrentPlayer();
        const tileIndex = currentPlayer.tiles.findIndex(t => t.id === tileId);

        if (tileIndex === -1) {
            return { success: false, error: 'Tile not found' };
        }

        const tile = currentPlayer.tiles[tileIndex];

        // Validate placement
        if (this.board.length > 0) {
            const positions = this.getPlayablePositions(tile);
            if (!positions.some(p => p.side === side)) {
                return { success: false, error: 'Invalid placement' };
            }
        }

        // Remove tile from player's hand
        currentPlayer.tiles.splice(tileIndex, 1);

        // Calculate new ends and orientation
        let placedTile = { ...tile, placedSide: side, flipped: false };

        if (this.board.length === 0) {
            // First tile
            this.leftEnd = tile.left;
            this.rightEnd = tile.right;
        } else if (side === 'left') {
            // Placing on left end
            if (tile.right === this.leftEnd) {
                this.leftEnd = tile.left;
            } else if (tile.left === this.leftEnd) {
                this.leftEnd = tile.right;
                placedTile.flipped = true;
            }
        } else {
            // Placing on right end
            if (tile.left === this.rightEnd) {
                this.rightEnd = tile.right;
            } else if (tile.right === this.rightEnd) {
                this.rightEnd = tile.left;
                placedTile.flipped = true;
            }
        }

        // Add to board
        if (side === 'left') {
            this.board.unshift(placedTile);
        } else {
            this.board.push(placedTile);
        }

        // Check for win
        if (currentPlayer.tiles.length === 0) {
            this.status = 'finished';
            this.winner = currentPlayer.id;
            return { 
                success: true, 
                gameOver: true, 
                winner: currentPlayer,
                tile: placedTile
            };
        }

        // Next turn
        this.turnCount++;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

        return { success: true, tile: placedTile };
    }

    // Pass turn (when no playable tiles)
    passTurn() {
        this.turnCount++;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

        // Check if game is blocked (no one can play)
        const allBlocked = this.players.every(player => {
            const originalIndex = this.currentPlayerIndex;
            const canPlay = player.tiles.some(tile => this.canPlayTile(tile));
            return !canPlay;
        });

        if (allBlocked) {
            // Game blocked - winner is player with lowest pip count
            let minPips = Infinity;
            let winner = null;

            this.players.forEach(player => {
                const pipCount = player.tiles.reduce((sum, tile) => sum + tile.left + tile.right, 0);
                if (pipCount < minPips) {
                    minPips = pipCount;
                    winner = player;
                }
            });

            this.status = 'finished';
            this.winner = winner.id;

            return { blocked: true, winner: winner };
        }

        return { blocked: false };
    }

    // Calculate ELO change based on game result
    calculateEloChange(isWinner, opponentLeft, halfwayPassed) {
        if (!this.isRanked) return 0;

        if (isWinner) {
            if (opponentLeft) {
                return halfwayPassed ? 20 : 10;
            }
            // Normal win: 12-20 points based on performance
            return Math.floor(Math.random() * 9) + 12;
        } else {
            if (opponentLeft) {
                return 0; // No penalty if opponent left
            }
            return halfwayPassed ? -20 : -10;
        }
    }

    // Get game state for syncing
    getState() {
        return {
            board: this.board,
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd,
            players: this.players.map(p => ({
                ...p,
                tiles: p.tiles // In real implementation, hide opponent tiles
            })),
            currentPlayerIndex: this.currentPlayerIndex,
            status: this.status,
            isRanked: this.isRanked,
            turnCount: this.turnCount,
            winner: this.winner
        };
    }
}

// ============================================
// ELO SYSTEM
// ============================================

class EloSystem {
    constructor() {
        this.levels = [
            { level: 1, minElo: 0, maxElo: 99, color: 'yellow', icon: '🌟' },
            { level: 2, minElo: 100, maxElo: 199, color: 'yellow', icon: '🌟' },
            { level: 3, minElo: 200, maxElo: 299, color: 'yellow', icon: '🌟' },
            { level: 4, minElo: 300, maxElo: 399, color: 'blue', icon: '💎' },
            { level: 5, minElo: 400, maxElo: 499, color: 'blue', icon: '💎' },
            { level: 6, minElo: 500, maxElo: 599, color: 'blue', icon: '💎' },
            { level: 7, minElo: 600, maxElo: 699, color: 'purple', icon: '👑' },
            { level: 8, minElo: 700, maxElo: 799, color: 'purple', icon: '👑' },
            { level: 9, minElo: 800, maxElo: 899, color: 'purple', icon: '👑' },
            { level: 10, minElo: 900, maxElo: Infinity, color: 'purple', icon: '🏆' }
        ];
    }

    getLevelFromElo(elo) {
        return Math.min(10, Math.floor(elo / 100) + 1);
    }

    getLevelInfo(level) {
        return this.levels[Math.min(level - 1, 9)];
    }

    getLevelClass(level) {
        if (level <= 3) return 'level-low';
        if (level <= 6) return 'level-mid';
        return 'level-high';
    }
}

// Export for use in main.js
window.DominoGame = DominoGame;
window.EloSystem = EloSystem;
