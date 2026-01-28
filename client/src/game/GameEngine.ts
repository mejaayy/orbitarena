export interface Point {
  x: number;
  y: number;
}

export type CharacterShape = 'circle' | 'triangle' | 'square';
export type PickupType = 'HP' | 'CHARGE';

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  score: number;
  hp: number;
  maxHp: number;
  charge: number;
  maxCharge: number;
  characterShape: CharacterShape;
  velocity: Point;
  balance?: number;
  isStunned?: boolean;
  facingAngle?: number;
}

interface InterpolatedPlayer extends Player {
  prevX: number;
  prevY: number;
  targetX: number;
  targetY: number;
  interpStartTime: number;
  trail: { x: number; y: number }[];
}

export interface Pickup {
  id: string;
  x: number;
  y: number;
  radius: number;
  type: PickupType;
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
  pickups: Pickup[] = [];
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
  
  onGameOver: (stats: { score: number, killer?: string, balance?: number }) => void;
  onUpdateStats: (stats: { fps: number, population: number, balance?: number }) => void;
  onConnectionChange?: (connected: boolean) => void;
  onRoundStatusChange?: (status: RoundStatus) => void;
  onRoundEnd?: (data: RoundEndData) => void;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pendingJoin: { name: string; isStakeMode: boolean; walletAddress?: string; playerColor?: string; characterShape?: CharacterShape } | null = null;

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
    
    window.addEventListener('keydown', this.handleKeyDown);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  private handleContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      this.sendAbility('ABILITY_1');
    }
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.sendAbility('ABILITY_2');
    }
  };

  private sendAbility(abilityType: 'ABILITY_1' | 'ABILITY_2') {
    if (this.ws?.readyState === WebSocket.OPEN && this.localPlayerId && !this.isSpectating) {
      const localPlayer = this.players.get(this.localPlayerId);
      if (localPlayer && (localPlayer.charge || 0) < 20) {
        const now = performance.now();
        if (now - this.lastAbilityTime > this.ABILITY_COOLDOWN) {
          this.showLowChargeFlash();
          this.lastAbilityTime = now;
        }
        return;
      }
      
      const msg = JSON.stringify({
        type: 'ABILITY',
        payload: { abilityType }
      });
      console.log('Sending ability:', msg);
      this.ws.send(msg);
    }
  }

  private lowChargeFlashAlpha = 0;

  private showLowChargeFlash() {
    this.lowChargeFlashAlpha = 0.6;
  }

  private lastAbilityTime = 0;
  private readonly ABILITY_COOLDOWN = 500;

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
        this.sendJoin(this.pendingJoin.name, this.pendingJoin.isStakeMode, this.pendingJoin.walletAddress, this.pendingJoin.playerColor, this.pendingJoin.characterShape);
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
        if (message.payload.pickups) {
          this.pickups = message.payload.pickups;
        }
        break;

      case 'STATE':
        this.applyServerState(message.payload);
        break;

      case 'PICKUP_DELTA':
        this.applyPickupDelta(message.payload);
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

      case 'ABILITY_EFFECT':
        console.log('Received ABILITY_EFFECT:', message.payload);
        this.handleAbilityEffect(message.payload);
        break;

      case 'DAMAGE':
        if (message.payload.targetId === this.localPlayerId) {
          this.showDamageFlash();
        }
        break;
    }
  }

  private abilityEffects: Array<{
    type: string;
    x: number;
    y: number;
    angle: number;
    startTime: number;
    duration: number;
  }> = [];

  private damageFlashAlpha = 0;

  private handleAbilityEffect(payload: { playerId: string; ability: string; x: number; y: number; angle: number }) {
    this.abilityEffects.push({
      type: payload.ability,
      x: payload.x,
      y: payload.y,
      angle: payload.angle,
      startTime: performance.now(),
      duration: payload.ability === 'PIERCE' ? 300 : 400
    });
  }

  private showDamageFlash() {
    this.damageFlashAlpha = 0.4;
  }

  private applyPickupDelta(delta: { spawned: Pickup[]; collected: string[] }) {
    if (delta.collected && delta.collected.length > 0) {
      const collectedSet = new Set(delta.collected);
      this.pickups = this.pickups.filter(p => !collectedSet.has(p.id));
    }
    if (delta.spawned && delta.spawned.length > 0) {
      this.pickups.push(...delta.spawned);
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
        existing.hp = p.hp;
        existing.maxHp = p.maxHp;
        existing.charge = p.charge;
        existing.maxCharge = p.maxCharge;
        existing.characterShape = p.characterShape;
        existing.color = p.color;
        existing.balance = p.balance;
        existing.isStunned = p.isStunned;
        existing.facingAngle = p.facingAngle;
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

  private sendJoin(name: string, isStakeMode: boolean, walletAddress?: string, playerColor?: string, characterShape?: CharacterShape) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'JOIN',
        payload: { name, isStakeMode, walletAddress, playerColor, characterShape }
      }));
    }
  }

  private sendInput(vector: Point) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'INPUT',
        payload: { x: vector.x, y: vector.y }
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

  start(playerName: string, isStakeMode: boolean, walletAddress?: string, playerColor?: string, characterShape?: CharacterShape) {
    this.isRunning = true;
    this.isStakeMode = isStakeMode;
    this.players.clear();
    this.pickups = [];
    this.localPlayerId = null;
    
    this.pendingJoin = { name: playerName, isStakeMode, walletAddress, playerColor, characterShape };
    this.connectWebSocket();
    
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
    this.ws?.close();
    this.ws = null;
    this.pendingJoin = null;
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.abilityEffects = [];
    this.damageFlashAlpha = 0;
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
      
      // Update trail - always show for movement
      const movedX = player.x - prevX;
      const movedY = player.y - prevY;
      if (movedX * movedX + movedY * movedY > 2) {
        player.trail.push({ x: player.x, y: player.y });
        if (player.trail.length > 8) {
          player.trail.shift();
        }
      } else if (movedX === 0 && movedY === 0 && player.trail.length > 0) {
        player.trail.shift();
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

    this.pickups.forEach(pickup => {
      if (pickup.x < viewLeft || pickup.x > viewRight || pickup.y < viewTop || pickup.y > viewBottom) return;

      const color = pickup.type === 'HP' ? '#FF4466' : '#FFCC00';
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(pickup.x, pickup.y, pickup.radius, 0, Math.PI * 2);
      this.ctx.fill();
    });

    const sortedPlayers = Array.from(this.players.values()).sort((a, b) => a.radius - b.radius);
    
    sortedPlayers.forEach(player => {
      if (player.x + player.radius < viewLeft || player.x - player.radius > viewRight || 
          player.y + player.radius < viewTop || player.y - player.radius > viewBottom) return;

      this.drawTrail(player);
      this.drawPlayer(player);
    });

    this.drawAbilityEffects();

    this.ctx.restore();

    this.drawDamageFlash();
    this.drawMinimap();
  }

  private drawAbilityEffects() {
    const now = performance.now();
    
    this.abilityEffects = this.abilityEffects.filter(effect => {
      const elapsed = now - effect.startTime;
      if (elapsed > effect.duration) return false;
      
      const progress = elapsed / effect.duration;
      const alpha = 1 - progress;
      
      switch (effect.type) {
        case 'PULL':
          this.drawPullEffect(effect.x, effect.y, progress, alpha);
          break;
        case 'SLAM':
          this.drawSlamEffect(effect.x, effect.y, progress, alpha);
          break;
        case 'DASH':
          this.drawDashEffect(effect.x, effect.y, effect.angle, progress, alpha);
          break;
        case 'PIERCE':
          this.drawPierceEffect(effect.x, effect.y, effect.angle, progress, alpha);
          break;
        case 'PUSH':
          this.drawPushEffect(effect.x, effect.y, progress, alpha);
          break;
        case 'STUN_WAVE':
          this.drawStunWaveEffect(effect.x, effect.y, progress, alpha);
          break;
      }
      
      return true;
    });
  }

  private drawPullEffect(x: number, y: number, progress: number, alpha: number) {
    const radius = 150 * (1 - progress);
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(255, 100, 255, ${alpha * 0.6})`;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
  }

  private drawSlamEffect(x: number, y: number, progress: number, alpha: number) {
    const radius = 150 * progress;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(255, 50, 50, ${alpha * 0.3})`;
    this.ctx.fill();
    this.ctx.strokeStyle = `rgba(255, 100, 100, ${alpha * 0.8})`;
    this.ctx.lineWidth = 4;
    this.ctx.stroke();
  }

  private drawDashEffect(x: number, y: number, angle: number, progress: number, alpha: number) {
    const dashLength = 200;
    const endX = x + Math.cos(angle) * dashLength;
    const endY = y + Math.sin(angle) * dashLength;
    
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(endX, endY);
    this.ctx.strokeStyle = `rgba(100, 255, 255, ${alpha * 0.8})`;
    this.ctx.lineWidth = 8;
    this.ctx.stroke();
  }

  private drawPierceEffect(x: number, y: number, angle: number, progress: number, alpha: number) {
    const projectileDistance = 500 * progress;
    const px = x + Math.cos(angle) * projectileDistance;
    const py = y + Math.sin(angle) * projectileDistance;
    
    this.ctx.beginPath();
    this.ctx.arc(px, py, 15, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(255, 200, 50, ${alpha})`;
    this.ctx.fill();
    
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(px, py);
    this.ctx.strokeStyle = `rgba(255, 200, 50, ${alpha * 0.4})`;
    this.ctx.lineWidth = 4;
    this.ctx.stroke();
  }

  private drawPushEffect(x: number, y: number, progress: number, alpha: number) {
    const radius = 150 * progress;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(100, 200, 255, ${alpha * 0.7})`;
    this.ctx.lineWidth = 5;
    this.ctx.stroke();
  }

  private drawStunWaveEffect(x: number, y: number, progress: number, alpha: number) {
    const radius = 150 * progress;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(255, 255, 100, ${alpha * 0.25})`;
    this.ctx.fill();
    this.ctx.strokeStyle = `rgba(255, 255, 50, ${alpha * 0.8})`;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
  }

  private drawDamageFlash() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (this.damageFlashAlpha > 0) {
      this.ctx.fillStyle = `rgba(255, 0, 0, ${this.damageFlashAlpha})`;
      this.ctx.fillRect(0, 0, width, height);
      
      this.damageFlashAlpha -= 0.02;
      if (this.damageFlashAlpha < 0) this.damageFlashAlpha = 0;
    }
    
    if (this.lowChargeFlashAlpha > 0) {
      const cx = width / 2;
      const cy = height / 2;
      const outerRadius = Math.sqrt(cx * cx + cy * cy);
      const innerRadius = outerRadius * 0.7;
      
      const gradient = this.ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
      gradient.addColorStop(0, 'rgba(255, 200, 0, 0)');
      gradient.addColorStop(1, `rgba(255, 180, 0, ${this.lowChargeFlashAlpha * 0.5})`);
      
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, width, height);
      
      this.lowChargeFlashAlpha -= 0.015;
      if (this.lowChargeFlashAlpha < 0) this.lowChargeFlashAlpha = 0;
    }
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
    
    // Parse color once
    let r = 255, g = 255, b = 255;
    if (player.color.startsWith('#')) {
      let hex = player.color.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    
    // Draw fading trail
    for (let i = 0; i < player.trail.length; i++) {
      const progress = i / player.trail.length;
      const alpha = progress * 0.4;
      const size = player.radius * (0.3 + progress * 0.4);
      
      this.ctx.beginPath();
      this.ctx.arc(player.trail[i].x, player.trail[i].y, size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      this.ctx.fill();
    }
  }

  drawPlayer(player: Player) {
    const shape = player.characterShape || 'circle';
    const angle = player.facingAngle || 0;
    
    this.ctx.save();
    this.ctx.translate(player.x, player.y);
    this.ctx.rotate(angle);
    
    this.ctx.fillStyle = player.color;
    
    // Draw stunned effect
    if (player.isStunned) {
      this.ctx.globalAlpha = 0.5;
    }
    
    if (shape === 'circle') {
      this.ctx.beginPath();
      this.ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (shape === 'triangle') {
      const size = player.radius * 1.2;
      this.ctx.beginPath();
      this.ctx.moveTo(size, 0);
      this.ctx.lineTo(-size * 0.7, -size * 0.8);
      this.ctx.lineTo(-size * 0.7, size * 0.8);
      this.ctx.closePath();
      this.ctx.fill();
    } else if (shape === 'square') {
      const size = player.radius * 0.9;
      this.ctx.fillRect(-size, -size, size * 2, size * 2);
    }
    
    this.ctx.globalAlpha = 1;
    this.ctx.restore();
    
    // Draw Charge bar above player (yellow)
    const barWidth = player.radius * 2;
    const barHeight = 4;
    const barY = player.y - player.radius - 10;
    const chargePercent = (player.charge || 0) / (player.maxCharge || 100);
    
    // Charge bar background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(player.x - barWidth / 2, barY, barWidth, barHeight);
    
    // Charge bar fill (yellow)
    this.ctx.fillStyle = '#FFCC00';
    this.ctx.fillRect(player.x - barWidth / 2, barY, barWidth * chargePercent, barHeight);
    
    // Get local player for comparison
    const localPlayer = this.players.get(this.localPlayerId!);
    
    // Determine name color based on relative HP
    let textColor: string;
    if (player.id === this.localPlayerId) {
      textColor = '#FFFFFF';
    } else if (localPlayer) {
      if ((player.hp || 100) > (localPlayer.hp || 100)) {
        textColor = '#FF4444'; // Red - more HP (danger)
      } else {
        textColor = '#44FF44'; // Green - less HP (weaker)
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
