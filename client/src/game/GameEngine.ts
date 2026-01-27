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
  shape: 'square' | 'triangle' | 'pentagon';
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
    // Disable smoothing for crisp rendering
    this.ctx.imageSmoothingEnabled = false;
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
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Set canvas size accounting for device pixel ratio for crisp rendering
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    
    // Scale context to match DPR
    this.ctx.scale(dpr, dpr);
    this.ctx.imageSmoothingEnabled = false;
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
      if (isBoosting && player.score > 5) {
        // Initialize trail instantly when starting to boost
        if (player.trail.length === 0) {
          player.trail.push({ x: player.x, y: player.y });
        }
        const movedX = player.x - prevX;
        const movedY = player.y - prevY;
        if (movedX * movedX + movedY * movedY > 2) {
          player.trail.push({ x: player.x, y: player.y });
          if (player.trail.length > 15) {
            player.trail.shift();
          }
        }
      } else {
        // Clear trail immediately when not boosting or out of points
        if (player.trail.length > 0) {
          player.trail = [];
        }
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
    // Use CSS dimensions (not canvas.width which includes DPR scaling)
    const width = window.innerWidth;
    const height = window.innerHeight;
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

      this.ctx.fillStyle = food.color;
      
      if (food.shape === 'square') {
        // Draw square centered at food position
        const size = food.radius * 1.5;
        this.ctx.fillRect(food.x - size / 2, food.y - size / 2, size, size);
      } else if (food.shape === 'pentagon') {
        // Draw pentagon centered at food position
        const size = food.radius * 1.6;
        this.ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (i * 2 * Math.PI / 5) - Math.PI / 2;
          const px = food.x + size * Math.cos(angle);
          const py = food.y + size * Math.sin(angle);
          if (i === 0) this.ctx.moveTo(px, py);
          else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        this.ctx.fill();
      } else {
        // Draw triangle centered at food position
        const size = food.radius * 1.8;
        this.ctx.beginPath();
        this.ctx.moveTo(food.x, food.y - size / 2);
        this.ctx.lineTo(food.x + size / 2, food.y + size / 2);
        this.ctx.lineTo(food.x - size / 2, food.y + size / 2);
        this.ctx.closePath();
        this.ctx.fill();
      }
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
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cx = width / 2;
    const cy = height / 2;
    
    const viewPadding = 100 / this.baseZoom;
    const viewLeft = this.camera.x - (cx / this.baseZoom) - viewPadding;
    const viewRight = this.camera.x + (cx / this.baseZoom) + viewPadding;
    const viewTop = this.camera.y - (cy / this.baseZoom) - viewPadding;
    const viewBottom = this.camera.y + (cy / this.baseZoom) + viewPadding;

    // Hexagon grid parameters (pointy-top hexagons for beehive pattern)
    const hexSize = 50;
    const hexHeight = hexSize * 2;
    const hexWidth = Math.sqrt(3) * hexSize;
    const vertSpacing = hexHeight * 0.75;
    const horizSpacing = hexWidth;

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    // Calculate grid bounds
    const startRow = Math.floor(viewTop / vertSpacing) - 1;
    const endRow = Math.ceil(viewBottom / vertSpacing) + 1;
    const startCol = Math.floor(viewLeft / horizSpacing) - 1;
    const endCol = Math.ceil(viewRight / horizSpacing) + 1;

    // Draw hexagons - only draw top-right 3 edges to avoid overlap
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const offsetX = (row % 2 === 0) ? 0 : hexWidth / 2;
        const centerX = col * horizSpacing + offsetX;
        const centerY = row * vertSpacing;
        
        // Skip if outside world bounds
        if (centerX < -hexSize || centerX > GameEngine.WORLD_SIZE + hexSize ||
            centerY < -hexSize || centerY > GameEngine.WORLD_SIZE + hexSize) continue;

        // Draw only 3 edges per hexagon to avoid overlap (top, top-right, bottom-right)
        const angles = [
          -Math.PI / 2,      // top
          -Math.PI / 6,      // top-right
          Math.PI / 6,       // bottom-right
          Math.PI / 2        // bottom (end point)
        ];
        
        for (let i = 0; i < 3; i++) {
          let x1 = centerX + hexSize * Math.cos(angles[i]);
          let y1 = centerY + hexSize * Math.sin(angles[i]);
          let x2 = centerX + hexSize * Math.cos(angles[i + 1]);
          let y2 = centerY + hexSize * Math.sin(angles[i + 1]);
          
          // Clip lines to world boundaries
          const worldSize = GameEngine.WORLD_SIZE;
          if ((x1 < 0 && x2 < 0) || (x1 > worldSize && x2 > worldSize) ||
              (y1 < 0 && y2 < 0) || (y1 > worldSize && y2 > worldSize)) continue;
          
          // Clamp coordinates to world bounds
          x1 = Math.max(0, Math.min(worldSize, x1));
          y1 = Math.max(0, Math.min(worldSize, y1));
          x2 = Math.max(0, Math.min(worldSize, x2));
          y2 = Math.max(0, Math.min(worldSize, y2));
          
          this.ctx.moveTo(x1, y1);
          this.ctx.lineTo(x2, y2);
        }
      }
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
    if (player.trail.length < 1) return;
    
    // Check if still boosting - don't draw if not
    const isBoosting = player.id === this.localPlayerId ? this.isBoosting : player.isBoosting;
    if (!isBoosting) return;
    
    // Parse color once
    let r = 255, g = 255, b = 255;
    if (player.color.startsWith('#')) {
      let hex = player.color.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    
    // Draw fading trail - bigger circles, higher opacity
    for (let i = 0; i < player.trail.length; i++) {
      const progress = i / player.trail.length;
      const alpha = progress * 0.6;
      const size = player.radius * (0.5 + progress * 0.5);
      
      this.ctx.beginPath();
      this.ctx.arc(player.trail[i].x, player.trail[i].y, size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      this.ctx.fill();
    }
  }

  drawPlayer(player: Player) {
    this.ctx.beginPath();
    this.ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    
    this.ctx.fillStyle = player.color;
    this.ctx.fill();
    
    // Get local player for comparison
    const localPlayer = this.players.get(this.localPlayerId!);
    
    // Determine name color based on relative mass
    let textColor: string;
    if (player.id === this.localPlayerId) {
      textColor = '#FFFFFF';
    } else if (localPlayer) {
      if (player.score > localPlayer.score) {
        textColor = '#FF4444'; // Red - bigger than you (danger)
      } else {
        textColor = '#44FF44'; // Green - smaller than you (safe to eat)
      }
    } else {
      textColor = '#FFFFFF';
    }
    
    const fontSize = Math.max(12, player.radius * 0.35);
    this.ctx.font = `bold ${fontSize}px Outfit`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    
    // Draw name below the player
    this.ctx.fillStyle = textColor;
    this.ctx.fillText(player.name, player.x, player.y + player.radius + 5);
  }
}
