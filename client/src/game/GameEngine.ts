export interface Point {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  score: number;
  velocity: Point;
  isBot: boolean;
  target?: Point; // For bots
}

export interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  value: number;
}

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  players: Map<string, Player> = new Map();
  foods: Food[] = [];
  localPlayerId: string | null = null;
  
  // Game constants
  static WORLD_SIZE = 4000;
  static INITIAL_RADIUS = 20;
  static MAX_SPEED = 2; // Reduced from 3 to 2 for better control
  static DRAG = 0.98; // Friction
  static FOOD_COUNT = 300;
  
  // State
  isRunning: boolean = false;
  lastTime: number = 0;
  camera: Point = { x: 0, y: 0 };
  baseZoom: number = 0.8; // Zoomed out slightly by default
  
  // Callbacks
  onGameOver: (stats: { score: number, killer?: string }) => void;
  onUpdateStats: (stats: { fps: number, population: number }) => void;

  // [SOLANA INTEGRATION NOTE]
  // In a real implementation, you would pass a wallet adapter or socket connection here
  // to sign transactions for entry fees and receive server-authoritative state.

  constructor(
    canvas: HTMLCanvasElement, 
    onGameOver: (stats: any) => void,
    onUpdateStats: (stats: any) => void
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onGameOver = onGameOver;
    this.onUpdateStats = onUpdateStats;
    
    // Handle resize
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  handleResize = () => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  start(playerName: string, isStakeMode: boolean) {
    this.isRunning = true;
    this.players.clear();
    this.foods = [];
    
    // [SOLANA INTEGRATION NOTE]
    // If isStakeMode is true:
    // 1. Trigger wallet transaction to deposit Entry Fee into Escrow Smart Contract.
    // 2. Wait for confirmation.
    // 3. Send signed transaction signature to Game Server via WebSocket to join lobby.
    
    // Spawn local player
    this.localPlayerId = 'player-local';
    this.spawnPlayer(this.localPlayerId, playerName, false);
    
    // Spawn bots (Simulating multiplayer for prototype)
    const botCount = 15; // User requested support for 15 people
    for (let i = 0; i < botCount; i++) {
      this.spawnPlayer(`bot-${i}`, `Bot ${i+1}`, true);
    }
    
    // Spawn food
    this.refillFood();
    
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
  }

  spawnPlayer(id: string, name: string, isBot: boolean) {
    const x = Math.random() * GameEngine.WORLD_SIZE;
    const y = Math.random() * GameEngine.WORLD_SIZE;
    // Darker, less intense colors
    const colors = ['#D40046', '#00CC7A', '#00A3CC', '#CC7A00', '#A300CC', '#CCCC00'];
    
    this.players.set(id, {
      id,
      name,
      x,
      y,
      radius: GameEngine.INITIAL_RADIUS,
      color: isBot ? colors[Math.floor(Math.random() * colors.length)] : '#E0E0E0', // Local player is off-white
      score: 10, // Start with some score/mass
      velocity: { x: 0, y: 0 },
      isBot,
      target: isBot ? { x: Math.random() * GameEngine.WORLD_SIZE, y: Math.random() * GameEngine.WORLD_SIZE } : undefined
    });
  }

  refillFood() {
    while (this.foods.length < GameEngine.FOOD_COUNT) {
      this.foods.push({
        id: `food-${Math.random()}`,
        x: Math.random() * GameEngine.WORLD_SIZE,
        y: Math.random() * GameEngine.WORLD_SIZE,
        radius: 4 + Math.random() * 4,
        color: `hsl(${Math.random() * 360}, 60%, 50%)`, // Lower saturation and lightness
        value: 5 // Food gives 5 score
      });
    }
  }

  handleInput(vector: Point) {
    const player = this.players.get(this.localPlayerId!);
    if (!player) return;
    
    // [WEBSOCKET INTEGRATION NOTE]
    // Instead of updating local state directly, send input vector to server:
    // socket.emit('input', { x: vector.x, y: vector.y });
    
    // Normalize and scale speed
    // vector is usually joystick output (-1 to 1) or mouse direction
    const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    if (length > 0) {
      // Speed decreases as you get bigger
      const speedFactor = Math.max(0.5, 1 - (player.radius / 200)); 
      const speed = GameEngine.MAX_SPEED * speedFactor;
      
      // Calculate target velocity
      const targetVx = (vector.x / length) * speed;
      const targetVy = (vector.y / length) * speed;
      
      // Simple smoothing to prevent jitter from noisy input
      player.velocity.x += (targetVx - player.velocity.x) * 0.2;
      player.velocity.y += (targetVy - player.velocity.y) * 0.2;
    } else {
      // Smooth stop
      player.velocity.x *= 0.8;
      player.velocity.y *= 0.8;
    }
  }

  loop = (timestamp: number) => {
    if (!this.isRunning) return;
    
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    this.update(dt);
    this.render();
    
    // Mock network stats - REDUCED FREQUENCY
    // Only update stats every ~60 frames (approx 1 sec) instead of random chance per frame
    // Using a counter would be better, but for now just reducing the probability significantly
    if (Math.random() < 0.01) { // Was 0.05
      this.onUpdateStats({
        fps: Math.round(1/dt),
        population: this.players.size
      });
    }

    requestAnimationFrame(this.loop);
  };

  update(dt: number) {
    // [WEBSOCKET INTEGRATION NOTE]
    // In a real game, 'update' would process the authoritative state buffer received from server
    // e.g. this.applyServerState(latestServerUpdate);
    
    // 1. Update all players
    this.players.forEach(player => {
      // Bot Logic
      if (player.isBot) {
        this.updateBot(player);
      }

    // Move (Time-based movement)
      // Normalize velocity to pixels per second (MAX_SPEED * 60)
      // If MAX_SPEED was 2 pixels/frame at 60fps, it's 120 pixels/second
      // Let's stick to the previous feeling but make it time-independent
      // We'll treat velocity as pixels-per-frame at 60fps for compatibility, then scale by dt
      
      const timeScale = dt * 60; // Should be ~1.0 at 60fps
      
      player.x += player.velocity.x * timeScale;
      player.y += player.velocity.y * timeScale;
      
      // Boundary check
      player.x = Math.max(player.radius, Math.min(GameEngine.WORLD_SIZE - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(GameEngine.WORLD_SIZE - player.radius, player.y));
    });

    // 2. Collision Detection (Player vs Food)
    this.players.forEach(player => {
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const food = this.foods[i];
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < player.radius + food.radius) {
          // Eat food
          this.foods.splice(i, 1);
          this.growPlayer(player, food.value);
        }
      }
    });

    this.refillFood();

    // 3. Collision Detection (Player vs Player)
    const sortedPlayers = Array.from(this.players.values()).sort((a, b) => b.radius - a.radius);
    
    for (let i = 0; i < sortedPlayers.length; i++) {
      const predator = sortedPlayers[i];
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const prey = sortedPlayers[j];
        
        // Check if deleted (eaten in this frame already)
        if (!this.players.has(prey.id)) continue; 
        if (!this.players.has(predator.id)) continue;

        const dx = predator.x - prey.x;
        const dy = predator.y - prey.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Rule: Strictly larger eats smaller
        if (dist < predator.radius && predator.radius > prey.radius) {
          // Eat prey
          this.growPlayer(predator, prey.score || 10); // Gain their mass/score
          this.players.delete(prey.id);
          
          // [SOLANA INTEGRATION NOTE]
          // If isStakeMode, Server would trigger a Smart Contract Payout here.
          // winnerAddress receives loserStakedAmount.
          
          if (prey.id === this.localPlayerId) {
            this.onGameOver({ score: prey.score, killer: predator.name });
            this.stop();
          }
        }
      }
    }

    // 4. Update Camera
    const localPlayer = this.players.get(this.localPlayerId!);
    if (localPlayer) {
      // Smooth camera follow - Increased lerp from 0.1 to 0.3 for snappier, less "baggy" tracking
      this.camera.x += (localPlayer.x - this.camera.x) * 0.3;
      this.camera.y += (localPlayer.y - this.camera.y) * 0.3;
    }
  }

  updateBot(bot: Player) {
    // Simple AI: Move towards target, change target randomly
    if (!bot.target || Math.random() < 0.02) {
      bot.target = {
        x: Math.random() * GameEngine.WORLD_SIZE,
        y: Math.random() * GameEngine.WORLD_SIZE
      };
    }
    
    // Or move towards nearest food if close
    // (Omitted for performance in simple prototype, random walk is fine)

    const dx = bot.target.x - bot.x;
    const dy = bot.target.y - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 0) {
      const speed = GameEngine.MAX_SPEED * 0.5; // Bots are slower
      bot.velocity.x = (dx / dist) * speed;
      bot.velocity.y = (dy / dist) * speed;
    }
  }

  growPlayer(player: Player, amount: number) {
    player.score += Math.floor(amount);
    // Radius grows with square root of score (area preservation-ish) to prevent becoming massive too fast
    // But user asked for "size equal to score", so we'll make it noticeable
    // Base radius 20 + sqrt(score) * 2
    player.radius = GameEngine.INITIAL_RADIUS + Math.sqrt(player.score) * 2;
  }

  render() {
    const { width, height } = this.canvas;
    const cx = width / 2;
    const cy = height / 2;

    // Clear
    this.ctx.fillStyle = '#050508'; // Darker background
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    
    // Center the camera
    this.ctx.translate(cx, cy);
    // Apply Zoom
    this.ctx.scale(this.baseZoom, this.baseZoom);
    // Move to camera position
    this.ctx.translate(-this.camera.x, -this.camera.y);

    // Draw Grid
    this.drawGrid();

    // Draw Food
    // Adjust view padding for zoom to prevent popping at edges
    const viewPadding = 100 / this.baseZoom;
    const viewLeft = this.camera.x - (cx / this.baseZoom) - viewPadding;
    const viewRight = this.camera.x + (cx / this.baseZoom) + viewPadding;
    const viewTop = this.camera.y - (cy / this.baseZoom) - viewPadding;
    const viewBottom = this.camera.y + (cy / this.baseZoom) + viewPadding;

    this.foods.forEach(food => {
      // Simple viewport culling
      if (food.x < viewLeft || food.x > viewRight || food.y < viewTop || food.y > viewBottom) return;

      this.ctx.beginPath();
      this.ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = food.color;
      this.ctx.fill();
    });

    // Draw Players (Sorted by size so large ones cover small ones)
    const sortedPlayers = Array.from(this.players.values()).sort((a, b) => a.radius - b.radius);
    
    sortedPlayers.forEach(player => {
      // Simple viewport culling
      if (player.x + player.radius < viewLeft || player.x - player.radius > viewRight || 
          player.y + player.radius < viewTop || player.y - player.radius > viewBottom) return;

      this.drawPlayer(player);
    });

    this.ctx.restore();
  }

  drawGrid() {
    const gridSize = 100;
    const startX = Math.floor((this.camera.x - this.canvas.width/2) / gridSize) * gridSize;
    const startY = Math.floor((this.camera.y - this.canvas.height/2) / gridSize) * gridSize;
    const endX = startX + this.canvas.width + gridSize;
    const endY = startY + this.canvas.height + gridSize;

    this.ctx.strokeStyle = '#1a1a20';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    for (let x = startX; x <= endX; x += gridSize) {
      if (x < 0 || x > GameEngine.WORLD_SIZE) continue;
      this.ctx.moveTo(x, Math.max(0, startY));
      this.ctx.lineTo(x, Math.min(GameEngine.WORLD_SIZE, endY));
    }

    for (let y = startY; y <= endY; y += gridSize) {
      if (y < 0 || y > GameEngine.WORLD_SIZE) continue;
      this.ctx.moveTo(Math.max(0, startX), y);
      this.ctx.lineTo(Math.min(GameEngine.WORLD_SIZE, endX), y);
    }
    
    this.ctx.stroke();
    
    // Draw World Borders
    this.ctx.strokeStyle = '#FF0055';
    this.ctx.lineWidth = 5;
    this.ctx.strokeRect(0, 0, GameEngine.WORLD_SIZE, GameEngine.WORLD_SIZE);
  }

  drawPlayer(player: Player) {
    this.ctx.beginPath();
    this.ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    
    // PERFORMANCE: Remove shadowBlur completely for non-local players to reduce lag
    // Only local player gets the fancy glow
    if (player.id === this.localPlayerId) {
       this.ctx.shadowBlur = 15;
       this.ctx.shadowColor = player.color;
    } else {
       this.ctx.shadowBlur = 0;
    }
    
    this.ctx.fillStyle = player.color;
    this.ctx.fill();
    
    // Reset shadow
    this.ctx.shadowBlur = 0;
    
    // Name
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = `bold ${Math.max(12, player.radius * 0.4)}px Outfit`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(player.name, player.x, player.y);
  }
}
