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
  balance?: number;
  isBoosting?: boolean;
}

interface InterpolatedPlayer extends Player {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  interpStartTime: number;
  trail: { x: number; y: number }[];
}

export interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  value: number;
}

interface ServerState {
  players: Player[];
}

export type RoundState = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ENDED';

export interface RoundStatus {
  roundState: RoundState;
  playerCount: number;
  maxPlayers: number;
  prizePool: number;
  countdownRemaining: number;
  timeRemaining?: number;
  prizes: { first: number; second: number; third: number };
}

export interface RoundEndData {
  standings: { rank: number; playerId: string; name: string; score: number; prize: number }[];
  prizePool: number;
}

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  players: Map<string, InterpolatedPlayer> = new Map();
  foods: Food[] = [];
  localPlayerId: string | null = null;
  
  static WORLD_SIZE = 4000;
  static INITIAL_RADIUS = 20;
  static INTERP_DURATION = 100;
  static MAX_SPEED = 2.3;
  
  isRunning: boolean = false;
  isStakeMode: boolean = false;
  isSpectating: boolean = false;
  roundStatus: RoundStatus | null = null;
  lastTime: number = 0;
  camera: Point = { x: 0, y: 0 };
  baseZoom: number = 0.8;
  
  private frameCount: number = 0;
  private fpsLastTime: number = 0;
  private currentFps: number = 60;
  private localInputVector: Point = { x: 0, y: 0 };
  private lastInputSendTime: number = 0;
  private inputSendInterval: number = 33;
  private isBoosting: boolean = false;
  
  onGameOver: (stats: { score: number, killer?: string, balance?: number }) => void;
  onUpdateStats: (stats: { fps: number, population: number, balance?: number }) => void;
  onConnectionChange?: (connected: boolean) => void;
  onRoundStatusChange?: (status: RoundStatus) => void;
  onRoundEnd?: (data: RoundEndData) => void;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pendingJoin: { name: string; isStakeMode: boolean; walletAddress?: string; playerColor?: string } | null = null;

  constructor(
    canvas: HTMLCanvasElement, 
    onGameOver: (stats: any) => void,
    onUpdateStats: (stats: any) => void
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onGameOver = onGameOver;
    this.onUpdateStats = onUpdateStats;

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    
    // Mouse tracking for boost
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mouseleave', this.handleMouseUp);
    // Touch support for boost
    this.canvas.addEventListener('touchstart', this.handleMouseDown);
    this.canvas.addEventListener('touchend', this.handleMouseUp);
    this.canvas.addEventListener('touchcancel', this.handleMouseUp);
  }
  
  private handleMouseDown = () => {
    this.isBoosting = true;
    this.sendInputWithBoost();
  };
  
  private handleMouseUp = () => {
    this.isBoosting = false;
    this.sendInputWithBoost();
  };
  
  private sendInputWithBoost() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'INPUT',
        payload: { x: this.localInputVector.x, y: this.localInputVector.y, boost: this.isBoosting }
      }));
      this.lastInputSendTime = performance.now();
    }
  }

  private connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.onConnectionChange?.(true);
      
      this.players.clear();
      this.localPlayerId = null;
      
      if (this.pendingJoin) {
        this.sendJoin(this.pendingJoin.name, this.pendingJoin.isStakeMode, this.pendingJoin.walletAddress, this.pendingJoin.playerColor);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleServerMessage(message);
      } catch (e) {
        console.error('Failed to parse server message:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.onConnectionChange?.(false);
      
      if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connectWebSocket(), 1000 * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleServerMessage(message: { type: string; payload: any }) {
    switch (message.type) {
      case 'JOINED':
        this.localPlayerId = message.payload.playerId;
        const player = message.payload.player;
        this.camera = { x: player.x, y: player.y };
        if (message.payload.foods) {
          this.foods = message.payload.foods;
        }
        break;

      case 'STATE':
        this.applyServerState(message.payload);
        break;

      case 'FOOD_DELTA':
        this.applyFoodDelta(message.payload);
        break;

      case 'ELIMINATED':
        if (message.payload.isSpectating) {
          // Stake mode - become spectator
          this.isSpectating = true;
        } else {
          // Free mode - game over
          this.onGameOver({
            score: message.payload.score,
            killer: message.payload.killerName,
            balance: message.payload.balance
          });
          this.stop();
        }
        break;

      case 'ROUND_STATUS':
        this.roundStatus = message.payload;
        this.onRoundStatusChange?.(message.payload);
        break;

      case 'ROUND_END':
        this.onRoundEnd?.(message.payload);
        break;

      case 'PLAYER_LEFT':
        this.players.delete(message.payload.playerId);
        break;

      case 'ERROR':
        console.error('Server error:', message.payload.message);
        break;
    }
  }

  private applyFoodDelta(delta: { spawned: Food[]; eaten: string[] }) {
    if (delta.eaten && delta.eaten.length > 0) {
      const eatenSet = new Set(delta.eaten);
      this.foods = this.foods.filter(f => !eatenSet.has(f.id));
    }
    if (delta.spawned && delta.spawned.length > 0) {
      this.foods.push(...delta.spawned);
    }
  }

  private applyServerState(state: ServerState & { roundState?: RoundState; timeRemaining?: number; prizePool?: number }) {
    // Update round status from state if present
    if (state.roundState && this.roundStatus) {
      this.roundStatus.roundState = state.roundState;
      this.roundStatus.timeRemaining = state.timeRemaining;
      this.roundStatus.prizePool = state.prizePool || this.roundStatus.prizePool;
      this.onRoundStatusChange?.(this.roundStatus);
    }
    const now = performance.now();
    const existingIds = new Set(state.players.map(p => p.id));
    
    this.players.forEach((_, id) => {
      if (!existingIds.has(id)) {
        this.players.delete(id);
      }
    });

    state.players.forEach(p => {
      const existing = this.players.get(p.id);
      if (existing) {
        existing.prevX = existing.x;
        existing.prevY = existing.y;
        existing.targetX = p.x;
        existing.targetY = p.y;
        existing.interpStartTime = now;
        existing.radius = p.radius;
        existing.score = p.score;
        existing.color = p.color;
        existing.balance = p.balance;
        existing.isBoosting = p.isBoosting;
      } else {
        this.players.set(p.id, {
          ...p,
          velocity: { x: 0, y: 0 },
          prevX: p.x,
          prevY: p.y,
          targetX: p.x,
          targetY: p.y,
          interpStartTime: now,
          trail: []
        });
      }
    });
  }

  private sendJoin(name: string, isStakeMode: boolean, walletAddress?: string, playerColor?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'JOIN',
        payload: { name, isStakeMode, walletAddress, playerColor }
      }));
    }
  }

  private sendInput(vector: Point) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'INPUT',
        payload: { x: vector.x, y: vector.y, boost: this.isBoosting }
      }));
    }
  }

  sendLeave(): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'LEAVE', payload: {} }));
      return true;
    }
    return false;
  }

  handleResize = () => {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  start(playerName: string, isStakeMode: boolean, walletAddress?: string, playerColor?: string) {
    this.isRunning = true;
    this.isStakeMode = isStakeMode;
    this.players.clear();
    this.foods = [];
    this.localPlayerId = null;
    
    this.pendingJoin = { name: playerName, isStakeMode, walletAddress, playerColor };
    this.connectWebSocket();
    
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
    this.ws?.close();
    this.ws = null;
    this.pendingJoin = null;
  }

  handleInput(vector: Point) {
    const isZero = vector.x === 0 && vector.y === 0;
    const wasZero = this.localInputVector.x === 0 && this.localInputVector.y === 0;
    
    this.localInputVector = { x: vector.x, y: vector.y };
    
    // Always send immediately when stopping (zero vector) to prevent drift
    if (isZero && !wasZero) {
      this.sendInput(vector);
      this.lastInputSendTime = performance.now();
      return;
    }
    
    // Throttle non-zero vectors
    const now = performance.now();
    if (now - this.lastInputSendTime >= this.inputSendInterval) {
      this.sendInput(vector);
      this.lastInputSendTime = now;
    }
  }

  loop = (timestamp: number) => {
    if (!this.isRunning) return;
    
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;

    this.frameCount++;
    if (timestamp - this.fpsLastTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.fpsLastTime = timestamp;
    }

    this.updateInterpolation(timestamp, dt);
    this.updateCamera();
    this.render();
    
    const localPlayer = this.players.get(this.localPlayerId!);
    if (localPlayer) {
      this.onUpdateStats({
        fps: this.currentFps,
        population: this.players.size,
        balance: localPlayer.balance
      });
    }

    requestAnimationFrame(this.loop);
  };

  private updateInterpolation(timestamp: number, dt: number) {
    this.players.forEach(player => {
      const prevX = player.x;
      const prevY = player.y;
      
      if (player.id === this.localPlayerId) {
        const input = this.localInputVector;
        const length = Math.sqrt(input.x * input.x + input.y * input.y);
        
        if (length > 0) {
          const speedFactor = Math.max(0.5, 1 - (player.radius / 200));
          const speed = GameEngine.MAX_SPEED * speedFactor;
          const vx = (input.x / length) * speed;
          const vy = (input.y / length) * speed;
          
          player.x += vx * dt * 60;
          player.y += vy * dt * 60;
          
          player.x = Math.max(player.radius, Math.min(GameEngine.WORLD_SIZE - player.radius, player.x));
          player.y = Math.max(player.radius, Math.min(GameEngine.WORLD_SIZE - player.radius, player.y));
        }
        
        // Gently correct toward server position to prevent drift (only when significant)
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const drift = Math.sqrt(dx * dx + dy * dy);
        if (drift > 20) {
          // Apply gentle correction when drifted more than 20 pixels
          const correction = Math.min(0.15, drift / 200);
          player.x += dx * correction;
          player.y += dy * correction;
        }
      } else {
        const elapsed = timestamp - player.interpStartTime;
        const t = Math.min(1, elapsed / GameEngine.INTERP_DURATION);
        const smoothT = t * t * (3 - 2 * t);
        
        player.x = player.prevX + (player.targetX - player.prevX) * smoothT;
        player.y = player.prevY + (player.targetY - player.prevY) * smoothT;
      }
      
      // Update trail - only when boosting
      const isBoosting = player.id === this.localPlayerId ? this.isBoosting : player.isBoosting;
      if (isBoosting) {
        const movedX = player.x - prevX;
        const movedY = player.y - prevY;
        if (movedX * movedX + movedY * movedY > 4) {
          player.trail.push({ x: player.x, y: player.y });
          if (player.trail.length > 8) {
            player.trail.shift();
          }
        }
      } else {
        // Clear trail when not boosting
        player.trail = [];
      }
    });
  }

  private updateCamera() {
    const localPlayer = this.players.get(this.localPlayerId!);
    if (localPlayer) {
      this.camera.x += (localPlayer.x - this.camera.x) * 0.3;
      this.camera.y += (localPlayer.y - this.camera.y) * 0.3;
    }
  }

  render() {
    const { width, height } = this.canvas;
    const cx = width / 2;
    const cy = height / 2;

    this.ctx.fillStyle = '#050508';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    
    this.ctx.translate(cx, cy);
    this.ctx.scale(this.baseZoom, this.baseZoom);
    this.ctx.translate(-this.camera.x, -this.camera.y);

    this.drawGrid();

    const viewPadding = 100 / this.baseZoom;
    const viewLeft = this.camera.x - (cx / this.baseZoom) - viewPadding;
    const viewRight = this.camera.x + (cx / this.baseZoom) + viewPadding;
    const viewTop = this.camera.y - (cy / this.baseZoom) - viewPadding;
    const viewBottom = this.camera.y + (cy / this.baseZoom) + viewPadding;

    this.foods.forEach(food => {
      if (food.x < viewLeft || food.x > viewRight || food.y < viewTop || food.y > viewBottom) return;

      this.ctx.beginPath();
      this.ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = food.color;
      this.ctx.fill();
    });

    const sortedPlayers = Array.from(this.players.values()).sort((a, b) => a.radius - b.radius);
    
    sortedPlayers.forEach(player => {
      if (player.x + player.radius < viewLeft || player.x - player.radius > viewRight || 
          player.y + player.radius < viewTop || player.y - player.radius > viewBottom) return;

      this.drawTrail(player);
      this.drawPlayer(player);
    });

    this.ctx.restore();

    this.drawMinimap();
  }

  drawMinimap() {
    const size = 140;
    const padding = 20;
    
    const mapX = padding;
    const mapY = padding;
    
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.fillRect(mapX, mapY, size, size);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(mapX, mapY, size, size);
    
    const scale = size / GameEngine.WORLD_SIZE;
    
    this.players.forEach(player => {
      const px = mapX + player.x * scale;
      const py = mapY + player.y * scale;
      
      this.ctx.beginPath();
      if (player.id === this.localPlayerId) {
        this.ctx.fillStyle = '#00FF99';
        this.ctx.arc(px, py, 3, 0, Math.PI * 2);
      } else {
        this.ctx.fillStyle = 'rgba(255, 0, 85, 0.8)';
        this.ctx.arc(px, py, 2, 0, Math.PI * 2);
      }
      this.ctx.fill();
    });
  }

  drawGrid() {
    const { width, height } = this.canvas;
    const cx = width / 2;
    const cy = height / 2;
    
    const viewPadding = 100 / this.baseZoom;
    const viewLeft = this.camera.x - (cx / this.baseZoom) - viewPadding;
    const viewRight = this.camera.x + (cx / this.baseZoom) + viewPadding;
    const viewTop = this.camera.y - (cy / this.baseZoom) - viewPadding;
    const viewBottom = this.camera.y + (cy / this.baseZoom) + viewPadding;

    const gridSize = 100;
    
    const startX = Math.max(0, Math.floor(viewLeft / gridSize) * gridSize);
    const startY = Math.max(0, Math.floor(viewTop / gridSize) * gridSize);
    const endX = Math.min(GameEngine.WORLD_SIZE, Math.ceil(viewRight / gridSize) * gridSize);
    const endY = Math.min(GameEngine.WORLD_SIZE, Math.ceil(viewBottom / gridSize) * gridSize);

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    for (let x = startX; x <= endX; x += gridSize) {
      this.ctx.moveTo(x, Math.max(0, startY));
      this.ctx.lineTo(x, Math.min(GameEngine.WORLD_SIZE, endY));
    }

    for (let y = startY; y <= endY; y += gridSize) {
      this.ctx.moveTo(Math.max(0, startX), y);
      this.ctx.lineTo(Math.min(GameEngine.WORLD_SIZE, endX), y);
    }
    
    this.ctx.stroke();
    
    this.ctx.strokeStyle = '#FF0055';
    this.ctx.lineWidth = 5;
    this.ctx.strokeRect(0, 0, GameEngine.WORLD_SIZE, GameEngine.WORLD_SIZE);
  }

  private getContrastColor(hexColor: string): string {
    // Parse hex color to RGB
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black for light colors, white for dark colors
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  }

  drawTrail(player: InterpolatedPlayer) {
    if (player.trail.length < 2) return;
    
    // Draw simple fading trail using player's color
    for (let i = 0; i < player.trail.length - 1; i++) {
      const alpha = (i / player.trail.length) * 0.4;
      const size = player.radius * (0.3 + (i / player.trail.length) * 0.5);
      
      this.ctx.beginPath();
      this.ctx.arc(player.trail[i].x, player.trail[i].y, size, 0, Math.PI * 2);
      this.ctx.fillStyle = player.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', '');
      
      // Handle hex colors
      if (player.color.startsWith('#')) {
        let hex = player.color.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      
      this.ctx.fill();
    }
  }

  drawPlayer(player: Player) {
    this.ctx.beginPath();
    this.ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    
    if (player.id === this.localPlayerId) {
       this.ctx.shadowBlur = 15;
       this.ctx.shadowColor = player.color;
    } else {
       this.ctx.shadowBlur = 0;
    }
    
    this.ctx.fillStyle = player.color;
    this.ctx.fill();
    
    this.ctx.shadowBlur = 0;
    
    // Use contrasting color for text
    const textColor = this.getContrastColor(player.color);
    this.ctx.fillStyle = textColor;
    
    const fontSize = Math.max(12, player.radius * 0.35);
    this.ctx.font = `bold ${fontSize}px Outfit`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    this.ctx.fillText(player.name, player.x, player.y);
  }
}
