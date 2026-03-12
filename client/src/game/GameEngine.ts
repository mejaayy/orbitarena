import { soundManager } from './SoundManager';
import { proceduralMusic } from './ProceduralMusic';

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
  p?: Array<[number, number, number, number, string]>;
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
  static MAX_SPEED = 4.69;
  
  private static readonly TRI_COS = Math.cos(Math.PI / 6);
  private static readonly TRI_SIN = Math.sin(Math.PI / 6);
  private static readonly HEX_SIZE = 200;
  private static readonly HEX_WIDTH = Math.sqrt(3) * 200;
  private static readonly HEX_VERT_SPACING = 200 * 2 * 0.75;
  private static readonly HEX_COS = [
    Math.cos(-Math.PI / 2),
    Math.cos(-Math.PI / 6),
    Math.cos(Math.PI / 6),
    Math.cos(Math.PI / 2)
  ];
  private static readonly HEX_SIN = [
    Math.sin(-Math.PI / 2),
    Math.sin(-Math.PI / 6),
    Math.sin(Math.PI / 6),
    Math.sin(Math.PI / 2)
  ];
  
  private _serverIdSet: Set<string> = new Set();
  
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
  private mouseScreenX: number = -1;
  private mouseScreenY: number = -1;
  private lastSentFacingAngle: number = 0;
  
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
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  private handleContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private handleMouseMove = (e: MouseEvent) => {
    this.mouseScreenX = e.clientX;
    this.mouseScreenY = e.clientY;
  };

  private rightClickHeld = false;
  private pullInterval: ReturnType<typeof setInterval> | null = null;

  private handleKeyDown = (e: KeyboardEvent) => {
    // Space binding removed
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    // Space binding removed
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.sendAbility('ABILITY_2');
    } else if (e.button === 2) {
      e.preventDefault();
      if (!this.rightClickHeld) {
        this.rightClickHeld = true;
        this.sendAbility('ABILITY_1');
        this.pullInterval = setInterval(() => {
          if (this.rightClickHeld) {
            this.sendAbility('ABILITY_1');
          }
        }, 150);
      }
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      this.rightClickHeld = false;
      if (this.pullInterval) {
        clearInterval(this.pullInterval);
        this.pullInterval = null;
      }
    }
  };

  private sendAbility(abilityType: 'ABILITY_1' | 'ABILITY_2') {
    if (this.ws?.readyState === WebSocket.OPEN && this.localPlayerId && !this.isSpectating) {
      const localPlayer = this.players.get(this.localPlayerId);
      const isPull = localPlayer?.characterShape === 'circle' && abilityType === 'ABILITY_1';
      const minCharge = isPull ? 5 : 20;
      if (localPlayer && (localPlayer.charge || 0) < minCharge) {
        const now = performance.now();
        if (now - this.lastAbilityTime > this.ABILITY_COOLDOWN) {
          this.showLowChargeFlash();
          this.lastAbilityTime = now;
        }
        return;
      }

      const isShoot = localPlayer?.characterShape === 'triangle' && abilityType === 'ABILITY_2';
      if (isShoot) {
        const now = performance.now();
        if (now - this.lastShootTime < this.SHOOT_COOLDOWN) return;
        this.lastShootTime = now;
      }
      
      const msg = JSON.stringify({
        type: 'ABILITY',
        payload: { abilityType }
      });
      this.ws.send(msg);
    }
  }

  private lowChargeFlashAlpha = 0;

  private showLowChargeFlash() {
    soundManager.playLowCharge();
  }

  private lastAbilityTime = 0;
  private readonly ABILITY_COOLDOWN = 500;
  private lastShootTime = 0;
  private readonly SHOOT_COOLDOWN = 700;

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
        if (message.payload.player) {
          const player = message.payload.player;
          this.camera = { x: player.x, y: player.y };
          if (message.payload.pickups) {
            this.pickups = message.payload.pickups;
          }
          proceduralMusic.start();
        }
        if (message.payload.isLobby) {
          this.roundStatus = {
            roundState: 'LOBBY',
            playerCount: message.payload.playerCount,
            maxPlayers: message.payload.maxPlayers,
            prizePool: message.payload.prizePool,
            countdownRemaining: 0,
            prizes: { first: 6.00, second: 4.50, third: 3.00 }
          };
          if (this.roundStatus) {
            this.onRoundStatusChange?.(this.roundStatus);
          }
        }
        break;

      case 'STATE':
        this.applyServerState(message.payload);
        break;

      case 'PICKUP_DELTA':
        // Play pickup sound if a collected pickup was near local player
        if (message.payload.collected && Array.isArray(message.payload.collected)) {
          const localPlayer = this.players.get(this.localPlayerId);
          if (localPlayer) {
            for (const pickupId of message.payload.collected) {
              const pickup = this.pickups.find(p => p.id === pickupId);
              if (pickup) {
                const dx = localPlayer.x - pickup.x;
                const dy = localPlayer.y - pickup.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // If pickup was close to local player, they probably collected it
                if (dist < localPlayer.radius + pickup.radius + 30) {
                  if (pickup.type === 'HP') {
                    soundManager.playPickupHP();
                  } else if (pickup.type === 'CHARGE') {
                    soundManager.playPickupCharge();
                  }
                }
              }
            }
          }
        }
        this.applyPickupDelta(message.payload);
        break;

      case 'ELIMINATED':
        soundManager.playElimination();
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

      case 'KILL':
        soundManager.playKillPing();
        break;

      case 'PLAYER_LEFT':
        this.players.delete(message.payload.playerId);
        break;

      case 'ERROR':
        console.error('Server error:', message.payload.message);
        break;

      case 'ABILITY_EFFECT':
        this.handleAbilityEffect(message.payload);
        // Play ability sound (server sends 'ability' field)
        soundManager.playAbility(message.payload.ability);
        break;

      case 'HEAL': {
        const now = performance.now();
        if (this.healCounter && now - this.healCounter.lastHealTime < 1000) {
          this.healCounter.totalHeal += message.payload.amount;
          this.healCounter.lastHealTime = now;
          this.healCounter.x = message.payload.x;
          this.healCounter.y = message.payload.y;
        } else {
          this.healCounter = {
            totalHeal: message.payload.amount,
            x: message.payload.x,
            y: message.payload.y,
            lastHealTime: now,
            floatOffset: 0,
          };
        }
        break;
      }

      case 'DAMAGE':
        if (message.payload.targetId === this.localPlayerId) {
          this.showDamageFlash();
          soundManager.playDamage();
        }
        if (message.payload.attackerId === this.localPlayerId && message.payload.victimX !== undefined) {
          const now = performance.now();
          const key = message.payload.targetId;
          const existing = this.damageCounters.get(key);
          if (existing && now - existing.lastHitTime < 1000) {
            existing.totalDamage += message.payload.damage;
            existing.lastHitTime = now;
            existing.x = message.payload.victimX;
            existing.y = message.payload.victimY;
          } else {
            this.damageCounters.set(key, {
              targetId: key,
              totalDamage: message.payload.damage,
              x: message.payload.victimX,
              y: message.payload.victimY,
              lastHitTime: now,
              floatOffset: 0,
            });
          }
        }
        break;
    }
  }

  private damageCounters: Map<string, {
    targetId: string;
    totalDamage: number;
    x: number;
    y: number;
    lastHitTime: number;
    floatOffset: number;
  }> = new Map();

  private healCounter: {
    totalHeal: number;
    x: number;
    y: number;
    lastHealTime: number;
    floatOffset: number;
  } | null = null;

  private abilityEffects: Array<{
    type: string;
    x: number;
    y: number;
    angle: number;
    startTime: number;
    duration: number;
    playerId: string;
  }> = [];

  private serverProjectiles: Array<{
    x: number;
    y: number;
    angle: number;
    radius: number;
    color: string;
  }> = [];

  private missileExplosions: Array<{
    x: number;
    y: number;
    startTime: number;
    duration: number;
  }> = [];

  private damageFlashAlpha = 0;
  
  private screenShake = {
    intensity: 0,
    duration: 0,
    startTime: 0,
    offsetX: 0,
    offsetY: 0
  };
  
  private dashZoom = {
    active: false,
    startTime: 0,
    duration: 200,
    angle: 0
  };

  private handleAbilityEffect(payload: { playerId: string; ability: string; x: number; y: number; angle: number; projectileId?: string }) {
    if (payload.ability === 'MISSILE_EXPLODE') {
      this.missileExplosions.push({
        x: payload.x,
        y: payload.y,
        startTime: performance.now(),
        duration: 500
      });
      this.triggerScreenShake(9, 300, payload.x, payload.y);
      return;
    }

    if (payload.ability === 'MISSILE_LAUNCH') {
      this.triggerScreenShake(4.5, 150, payload.x, payload.y);
      return;
    }

    this.abilityEffects.push({
      type: payload.ability,
      x: payload.x,
      y: payload.y,
      angle: payload.angle,
      startTime: performance.now(),
      duration: 400,
      playerId: payload.playerId,
      distance: (payload as any).distance
    });
    
    const shakeIntensity = this.getShakeIntensity(payload.ability);
    this.triggerScreenShake(shakeIntensity.intensity, shakeIntensity.duration, payload.x, payload.y);
    
    if (payload.playerId === this.localPlayerId && payload.ability === 'DASH') {
      this.dashZoom.active = true;
      this.dashZoom.startTime = performance.now();
      this.dashZoom.angle = payload.angle;
    }
  }
  
  private getShakeIntensity(ability: string): { intensity: number; duration: number } {
    switch (ability) {
      case 'SLAM':
        return { intensity: 18, duration: 450 };
      case 'PUSH':
        return { intensity: 15, duration: 375 };
      case 'STUN_WAVE':
        return { intensity: 12, duration: 450 };
      case 'DASH':
        return { intensity: 9, duration: 225 };
      case 'PIERCE':
        return { intensity: 6, duration: 150 };
      case 'PULL':
        return { intensity: 7.5, duration: 300 };
      default:
        return { intensity: 7.5, duration: 225 };
    }
  }
  
  private triggerScreenShake(intensity: number, duration: number, worldX?: number, worldY?: number) {
    let finalIntensity = intensity;
    if (worldX !== undefined && worldY !== undefined && this.localPlayerId) {
      const localPlayer = this.players.get(this.localPlayerId);
      if (localPlayer) {
        const dx = worldX - localPlayer.x;
        const dy = worldY - localPlayer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxRange = 2000;
        if (dist > maxRange) return;
        const falloff = 1 - (dist / maxRange);
        finalIntensity = intensity * falloff * falloff;
        if (finalIntensity < 0.5) return;
      }
    }
    if (finalIntensity > this.screenShake.intensity) {
      this.screenShake.intensity = finalIntensity;
      this.screenShake.duration = duration;
      this.screenShake.startTime = performance.now();
    }
  }
  
  private updateScreenShake() {
    if (this.screenShake.intensity <= 0) {
      this.screenShake.offsetX = 0;
      this.screenShake.offsetY = 0;
      return;
    }
    
    const elapsed = performance.now() - this.screenShake.startTime;
    if (elapsed >= this.screenShake.duration) {
      this.screenShake.intensity = 0;
      this.screenShake.offsetX = 0;
      this.screenShake.offsetY = 0;
      return;
    }
    
    const progress = elapsed / this.screenShake.duration;
    const decay = 1 - progress;
    const currentIntensity = this.screenShake.intensity * decay;
    
    this.screenShake.offsetX = (Math.random() - 0.5) * 2 * currentIntensity;
    this.screenShake.offsetY = (Math.random() - 0.5) * 2 * currentIntensity;
  }

  private showDamageFlash() {
    this.damageFlashAlpha = 0.4;
    // Add screen shake when taking damage
    this.triggerScreenShake(10, 250);
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
    const serverIds = this._serverIdSet;
    serverIds.clear();
    for (let i = 0, len = state.players.length; i < len; i++) {
      serverIds.add(state.players[i].id);
    }
    
    this.players.forEach((_, id) => {
      if (!serverIds.has(id)) {
        this.players.delete(id);
      }
    });

    for (let i = 0, len = state.players.length; i < len; i++) {
      const p = state.players[i];
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
    }

    if (state.p) {
      const arr = state.p;
      this.serverProjectiles.length = arr.length;
      for (let i = 0; i < arr.length; i++) {
        const d = arr[i];
        this.serverProjectiles[i] = {
          x: d[0],
          y: d[1],
          angle: d[2],
          radius: d[3],
          color: d[4]
        };
      }
    } else {
      this.serverProjectiles.length = 0;
    }
  }

  private sendJoin(name: string, isStakeMode: boolean, walletAddress?: string, playerColor?: string, characterShape?: CharacterShape) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'JOIN',
        payload: { name, isStakeMode, walletAddress, playerColor, characterShape }
      }));
    }
  }

  private getFacingAngle(): number | null {
    if (this.mouseScreenX < 0) return null;
    
    const localPlayer = this.players.get(this.localPlayerId!);
    if (!localPlayer) return null;
    
    const rect = this.canvas.getBoundingClientRect();
    const canvasMouseX = this.mouseScreenX - rect.left;
    const canvasMouseY = this.mouseScreenY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    
    const zoomMultiplier = this.dashZoom.active ? 1 + Math.sin(((performance.now() - this.dashZoom.startTime) / this.dashZoom.duration) * Math.PI) * 0.08 : 1;
    const zoom = this.baseZoom * zoomMultiplier;
    
    const worldMouseX = (canvasMouseX - cx - this.screenShake.offsetX) / zoom + this.camera.x;
    const worldMouseY = (canvasMouseY - cy - this.screenShake.offsetY) / zoom + this.camera.y;
    
    return Math.atan2(worldMouseY - localPlayer.y, worldMouseX - localPlayer.x);
  }

  private sendInput(vector: Point) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const facingAngle = this.getFacingAngle();
      const payload: { x: number; y: number; facingAngle?: number } = { x: vector.x, y: vector.y };
      if (facingAngle !== null) {
        payload.facingAngle = facingAngle;
        this.lastSentFacingAngle = facingAngle;
      }
      this.ws.send(JSON.stringify({ type: 'INPUT', payload }));
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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    
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
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
      this.pullInterval = null;
    }
    this.rightClickHeld = false;
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.abilityEffects = [];
    this.damageCounters.clear();
    this.healCounter = null;
    this.damageFlashAlpha = 0;
    // Stop background music
    proceduralMusic.stop();
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

    if (!this.localPlayerId) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.ctx.fillStyle = '#050508';
      this.ctx.fillRect(0, 0, width, height);
      requestAnimationFrame(this.loop);
      return;
    }

    this.frameCount++;
    if (timestamp - this.fpsLastTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.fpsLastTime = timestamp;
    }

    this.updateInterpolation(timestamp, dt);
    this.updateCamera();
    
    const localPlayer = this.players.get(this.localPlayerId!);
    if (localPlayer && !this.isSpectating) {
      const newAngle = this.getFacingAngle();
      if (newAngle !== null) {
        localPlayer.facingAngle = newAngle;
        this.localInputVector = { x: Math.cos(newAngle), y: Math.sin(newAngle) };
      }
      
      const now = performance.now();
      if (now - this.lastInputSendTime >= this.inputSendInterval) {
        this.sendInput(this.localInputVector);
        this.lastInputSendTime = now;
      }
    }
    
    this.render();
    
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
        
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const drift = Math.sqrt(dx * dx + dy * dy);
        if (drift > 50) {
          if (drift > 200) {
            player.x = player.targetX;
            player.y = player.targetY;
          } else {
            const correction = Math.min(0.08, drift / 500);
            player.x += dx * correction;
            player.y += dy * correction;
          }
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
    
    // Update and apply screen shake
    this.updateScreenShake();
    
    // Calculate dash zoom effect
    let zoomMultiplier = 1;
    if (this.dashZoom.active) {
      const elapsed = performance.now() - this.dashZoom.startTime;
      if (elapsed >= this.dashZoom.duration) {
        this.dashZoom.active = false;
      } else {
        const progress = elapsed / this.dashZoom.duration;
        // Quick zoom out then back in
        zoomMultiplier = 1 + Math.sin(progress * Math.PI) * 0.08;
      }
    }
    
    this.ctx.translate(cx + this.screenShake.offsetX, cy + this.screenShake.offsetY);
    this.ctx.scale(this.baseZoom * zoomMultiplier, this.baseZoom * zoomMultiplier);
    this.ctx.translate(-this.camera.x, -this.camera.y);

    this.drawGrid();

    const viewPadding = 100 / this.baseZoom;
    const viewLeft = this.camera.x - (cx / this.baseZoom) - viewPadding;
    const viewRight = this.camera.x + (cx / this.baseZoom) + viewPadding;
    const viewTop = this.camera.y - (cy / this.baseZoom) - viewPadding;
    const viewBottom = this.camera.y + (cy / this.baseZoom) + viewPadding;

    const triCos = GameEngine.TRI_COS;
    const triSin = GameEngine.TRI_SIN;

    this.ctx.fillStyle = '#00CC7A';
    for (let i = 0, len = this.pickups.length; i < len; i++) {
      const pickup = this.pickups[i];
      if (pickup.x < viewLeft || pickup.x > viewRight || pickup.y < viewTop || pickup.y > viewBottom) continue;
      if (pickup.type !== 'HP') continue;
      const size = pickup.radius * 1.6;
      this.ctx.fillRect(pickup.x - size / 2, pickup.y - size / 2, size, size);
    }

    this.ctx.fillStyle = '#D40046';
    this.ctx.beginPath();
    for (let i = 0, len = this.pickups.length; i < len; i++) {
      const pickup = this.pickups[i];
      if (pickup.x < viewLeft || pickup.x > viewRight || pickup.y < viewTop || pickup.y > viewBottom) continue;
      if (pickup.type !== 'CHARGE') continue;
      const r = pickup.radius * 1.4;
      this.ctx.moveTo(pickup.x, pickup.y - r);
      this.ctx.lineTo(pickup.x + r * triCos, pickup.y + r * triSin);
      this.ctx.lineTo(pickup.x - r * triCos, pickup.y + r * triSin);
      this.ctx.closePath();
    }
    this.ctx.fill();

    // Draw dash trails first (underneath players)
    this.drawDashTrails();
    
    const sortedPlayers = Array.from(this.players.values()).sort((a, b) => a.radius - b.radius);
    
    sortedPlayers.forEach(player => {
      if (player.x + player.radius < viewLeft || player.x - player.radius > viewRight || 
          player.y + player.radius < viewTop || player.y - player.radius > viewBottom) return;

      this.drawPlayer(player);
      if (player.isStunned) {
        this.drawStunnedEffect(player);
      }
    });

    this.drawAbilityEffects();
    this.drawMissiles();
    this.drawMissileExplosions();
    this.drawDamageCounters();
    this.drawHealCounter();

    this.ctx.restore();

    this.drawShootCooldownRing();
    this.drawDamageFlash();
    this.drawMinimap();
  }

  private drawShootCooldownRing() {
    const localPlayer = this.players.get(this.localPlayerId);
    if (!localPlayer || localPlayer.characterShape !== 'triangle') return;

    const elapsed = performance.now() - this.lastShootTime;
    if (elapsed >= this.SHOOT_COOLDOWN || this.lastShootTime === 0) return;

    const progress = elapsed / this.SHOOT_COOLDOWN;
    const remaining = 1 - progress;
    const radius = 6.75;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(this.mouseScreenX, this.mouseScreenY, radius, -Math.PI / 2, -Math.PI / 2 + remaining * Math.PI * 2);
    const alpha = remaining < 0.2 ? remaining / 0.2 : 1;
    this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    this.ctx.lineWidth = 5;
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawDashTrails() {
    const now = performance.now();
    
    this.abilityEffects.forEach(effect => {
      if (effect.type !== 'DASH') return;
      
      const elapsed = now - effect.startTime;
      if (elapsed > effect.duration) return;
      
      const progress = elapsed / effect.duration;
      const alpha = 1 - progress;
      
      this.drawDashEffect(effect.x, effect.y, effect.angle, progress, alpha, effect.playerId);
    });
  }

  private drawDamageCounters() {
    const now = performance.now();
    
    this.damageCounters.forEach((counter, key) => {
      const timeSinceHit = now - counter.lastHitTime;
      
      if (timeSinceHit > 1500) {
        this.damageCounters.delete(key);
        return;
      }
      
      const victim = this.players.get(counter.targetId);
      if (victim) {
        counter.x = victim.x;
        counter.y = victim.y;
      }
      
      if (timeSinceHit > 1000) {
        counter.floatOffset += 0.8;
      }
      
      const fadeStart = 1000;
      let alpha = 1;
      if (timeSinceHit > fadeStart) {
        alpha = 1 - (timeSinceHit - fadeStart) / 500;
      }
      
      const yOffset = -40 - counter.floatOffset;
      const fontSize = Math.min(56, 36 + counter.totalDamage * 0.3);
      
      this.ctx.save();
      this.ctx.font = `bold ${fontSize}px Outfit`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';
      this.ctx.globalAlpha = alpha;
      
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      this.ctx.lineWidth = 3;
      this.ctx.strokeText(`${counter.totalDamage}`, counter.x, counter.y + yOffset);
      
      this.ctx.fillStyle = '#D40046';
      this.ctx.fillText(`${counter.totalDamage}`, counter.x, counter.y + yOffset);
      
      this.ctx.restore();
    });
  }

  private drawHealCounter() {
    if (!this.healCounter) return;
    
    const now = performance.now();
    const timeSinceHeal = now - this.healCounter.lastHealTime;
    
    if (timeSinceHeal > 1300) {
      this.healCounter = null;
      return;
    }
    
    const localPlayer = this.players.get(this.localPlayerId || '');
    if (localPlayer) {
      this.healCounter.x = localPlayer.x;
      this.healCounter.y = localPlayer.y;
    }
    
    if (timeSinceHeal > 800) {
      this.healCounter.floatOffset += 0.8;
    }
    
    let alpha = 1;
    if (timeSinceHeal > 800) {
      alpha = 1 - (timeSinceHeal - 800) / 500;
    }
    
    const yOffset = -40 - this.healCounter.floatOffset;
    const fontSize = Math.min(39, 25 + this.healCounter.totalHeal * 0.21);
    
    this.ctx.save();
    this.ctx.font = `bold ${fontSize}px Outfit`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'bottom';
    this.ctx.globalAlpha = alpha;
    
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.lineWidth = 3;
    this.ctx.strokeText(`+${this.healCounter.totalHeal}`, this.healCounter.x, this.healCounter.y + yOffset);
    
    this.ctx.fillStyle = '#00CC7A';
    this.ctx.fillText(`+${this.healCounter.totalHeal}`, this.healCounter.x, this.healCounter.y + yOffset);
    
    this.ctx.restore();
  }

  private drawAbilityEffects() {
    const now = performance.now();
    
    this.abilityEffects = this.abilityEffects.filter(effect => {
      const elapsed = now - effect.startTime;
      if (elapsed > effect.duration) return false;
      
      const progress = elapsed / effect.duration;
      const alpha = 1 - progress;
      
      // Skip DASH here - it's drawn separately underneath players
      if (effect.type === 'DASH') return true;
      
      switch (effect.type) {
        case 'PULL':
          this.drawPullEffect(effect.x, effect.y, progress, alpha);
          break;
        case 'SLAM':
          this.drawSlamEffect(effect.x, effect.y, progress, alpha);
          break;
        case 'PIERCE':
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
    const radius = 195 * (1 - progress);
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(212, 0, 70, ${alpha * 0.6})`;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
  }

  private drawSlamEffect(x: number, y: number, progress: number, alpha: number) {
    const radius = 195 * progress;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(212, 0, 70, ${alpha * 0.3})`;
    this.ctx.fill();
    this.ctx.strokeStyle = `rgba(212, 0, 70, ${alpha * 0.8})`;
    this.ctx.lineWidth = 4;
    this.ctx.stroke();
  }

  private drawDashEffect(x: number, y: number, angle: number, progress: number, alpha: number, playerId?: string) {
    // Find the player's current position to follow them
    const player = this.players.get(playerId || '');
    const currentX = player ? player.x : x;
    const currentY = player ? player.y : y;
    
    // Trail goes behind the player
    const trailLength = 150 * (1 - progress);
    
    // Calculate trail end (behind current position)
    const trailEndX = currentX - Math.cos(angle) * trailLength;
    const trailEndY = currentY - Math.sin(angle) * trailLength;
    
    const playerColor = player ? player.color : '#00FFFF';
    const [r, g, b] = this.parseHexColor(playerColor);
    
    const gradient = this.ctx.createLinearGradient(currentX, currentY, trailEndX, trailEndY);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.9})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    
    this.ctx.beginPath();
    this.ctx.moveTo(currentX, currentY);
    this.ctx.lineTo(trailEndX, trailEndY);
    this.ctx.strokeStyle = gradient;
    this.ctx.lineWidth = 14;
    this.ctx.lineCap = 'round';
    this.ctx.stroke();
  }

  private parseHexColor(hex: string): [number, number, number] {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
  }

  private drawPierceEffect(x: number, y: number, angle: number, progress: number, alpha: number, color: string, distance: number = 1200) {
    const projectileDistance = distance * progress;
    const px = x + Math.cos(angle) * projectileDistance;
    const py = y + Math.sin(angle) * projectileDistance;
    
    const [r, g, b] = color.startsWith('#') ? this.parseHexColor(color) : [212, 0, 70];
    const size = 15;

    this.ctx.save();
    this.ctx.translate(px, py);
    this.ctx.rotate(angle);
    this.ctx.beginPath();
    this.ctx.moveTo(size, 0);
    this.ctx.lineTo(-size * 0.7, -size * 0.6);
    this.ctx.lineTo(-size * 0.7, size * 0.6);
    this.ctx.closePath();
    this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    this.ctx.fill();
    this.ctx.restore();
    
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(px, py);
    this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.4})`;
    this.ctx.lineWidth = 4;
    this.ctx.stroke();
  }

  private drawMissiles() {
    for (let i = 0; i < this.serverProjectiles.length; i++) {
      const proj = this.serverProjectiles[i];
      const [r, g, b] = proj.color.startsWith('#') ? this.parseHexColor(proj.color) : [212, 0, 70];
      const size = proj.radius;

      this.ctx.save();
      this.ctx.translate(proj.x, proj.y);
      this.ctx.rotate(proj.angle);

      this.ctx.beginPath();
      this.ctx.moveTo(size * 1.2, 0);
      this.ctx.lineTo(-size * 0.8, -size * 0.7);
      this.ctx.lineTo(-size * 0.4, 0);
      this.ctx.lineTo(-size * 0.8, size * 0.7);
      this.ctx.closePath();
      this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      this.ctx.fill();

      const trailLen = size * 2;
      this.ctx.beginPath();
      this.ctx.moveTo(-size * 0.4, -size * 0.25);
      this.ctx.lineTo(-size * 0.4 - trailLen, 0);
      this.ctx.lineTo(-size * 0.4, size * 0.25);
      this.ctx.closePath();
      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
      this.ctx.fill();

      this.ctx.restore();
    }
  }

  private drawMissileExplosions() {
    const now = performance.now();
    this.missileExplosions = this.missileExplosions.filter(exp => {
      const elapsed = now - exp.startTime;
      if (elapsed > exp.duration) return false;

      const progress = elapsed / exp.duration;
      const alpha = 1 - progress;
      const radius = 60 * progress;

      this.ctx.beginPath();
      this.ctx.arc(exp.x, exp.y, radius, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255, 150, 50, ${alpha * 0.4})`;
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.arc(exp.x, exp.y, radius * 0.6, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255, 255, 200, ${alpha * 0.6})`;
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.arc(exp.x, exp.y, radius, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgba(255, 100, 30, ${alpha * 0.8})`;
      this.ctx.lineWidth = 3;
      this.ctx.stroke();

      return true;
    });
  }

  private drawPushEffect(x: number, y: number, progress: number, alpha: number) {
    const now = performance.now();
    const radius = 260 * progress;
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(0, 204, 122, ${alpha * 0.08})`;
    this.ctx.fill();
    
    const segments = 32;
    this.ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const jitter = Math.sin(a * 8 + now * 0.01) * 4 * alpha;
      const rx = x + Math.cos(a) * (radius + jitter);
      const ry = y + Math.sin(a) * (radius + jitter);
      if (i === 0) this.ctx.moveTo(rx, ry);
      else this.ctx.lineTo(rx, ry);
    }
    this.ctx.strokeStyle = `rgba(0, 204, 122, ${alpha * 0.8})`;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
    
    const shardCount = 8;
    for (let i = 0; i < shardCount; i++) {
      const a = (i / shardCount) * Math.PI * 2 + progress * 0.5;
      const dist = radius * (0.6 + Math.sin(now * 0.005 + i * 2) * 0.3);
      const sx = x + Math.cos(a) * dist;
      const sy = y + Math.sin(a) * dist;
      
      this.ctx.save();
      this.ctx.translate(sx, sy);
      this.ctx.rotate(a + Math.PI / 4);
      const size = 4 * alpha;
      this.ctx.fillStyle = `rgba(0, 230, 140, ${alpha * 0.7})`;
      this.ctx.fillRect(-size / 2, -size / 2, size, size);
      this.ctx.restore();
    }
  }

  private drawStunWaveEffect(x: number, y: number, progress: number, alpha: number) {
    const radius = 195 * progress;
    const now = performance.now();
    
    this.ctx.save();
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(80, 180, 255, ${alpha * 0.12})`;
    this.ctx.fill();
    
    const ringSegments = 24;
    this.ctx.beginPath();
    for (let i = 0; i <= ringSegments; i++) {
      const a = (i / ringSegments) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * 8;
      const rx = x + Math.cos(a) * (radius + jitter);
      const ry = y + Math.sin(a) * (radius + jitter);
      if (i === 0) this.ctx.moveTo(rx, ry);
      else this.ctx.lineTo(rx, ry);
    }
    this.ctx.strokeStyle = `rgba(100, 200, 255, ${alpha * 0.9})`;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
    
    this.ctx.beginPath();
    for (let i = 0; i <= ringSegments; i++) {
      const a = (i / ringSegments) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * 5;
      const rx = x + Math.cos(a) * (radius + jitter);
      const ry = y + Math.sin(a) * (radius + jitter);
      if (i === 0) this.ctx.moveTo(rx, ry);
      else this.ctx.lineTo(rx, ry);
    }
    this.ctx.strokeStyle = `rgba(220, 240, 255, ${alpha * 0.5})`;
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(100, 200, 255, ${alpha * 0.6})`;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 12]);
    this.ctx.lineDashOffset = -now * 0.5;
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(150, 220, 255, ${alpha * 0.3})`;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([4, 8]);
    this.ctx.lineDashOffset = now * 0.3;
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    
    this.ctx.restore();
  }

  private drawLightningBolt(x1: number, y1: number, x2: number, y2: number, segments: number, alpha: number, jitter: number) {
    const points: { x: number; y: number }[] = [{ x: x1, y: y1 }];
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const mx = x1 + dx * t + (Math.random() - 0.5) * jitter;
      const my = y1 + dy * t + (Math.random() - 0.5) * jitter;
      points.push({ x: mx, y: my });
    }
    points.push({ x: x2, y: y2 });
    
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.strokeStyle = `rgba(220, 240, 255, ${alpha * 0.6})`;
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }

  private drawStunnedEffect(player: InterpolatedPlayer) {
    const now = performance.now();
    const r = player.radius;
    
    const arcCount = 3;
    for (let i = 0; i < arcCount; i++) {
      const angle1 = ((now * 0.005 + i * Math.PI * 2 / arcCount) % (Math.PI * 2));
      const angle2 = angle1 + Math.PI * (0.4 + Math.random() * 0.3);
      
      const x1 = player.x + Math.cos(angle1) * r * 0.9;
      const y1 = player.y + Math.sin(angle1) * r * 0.9;
      const x2 = player.x + Math.cos(angle2) * r * 0.9;
      const y2 = player.y + Math.sin(angle2) * r * 0.9;
      
      this.drawLightningBolt(x1, y1, x2, y2, 4, 0.8, r * 0.4);
    }
    
    const sparkCount = 4;
    for (let i = 0; i < sparkCount; i++) {
      const seed = (now * 0.01 + i * 137.5) % 360;
      const sparkAngle = seed * Math.PI / 180;
      const sparkDist = r * (0.5 + Math.sin(now * 0.008 + i) * 0.5);
      const sx = player.x + Math.cos(sparkAngle) * sparkDist;
      const sy = player.y + Math.sin(sparkAngle) * sparkDist;
      const sparkSize = 2 + Math.sin(now * 0.015 + i * 2) * 1.5;
      
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, sparkSize, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(180, 230, 255, ${0.6 + Math.sin(now * 0.02 + i) * 0.3})`;
      this.ctx.fill();
    }
    
    const glowPulse = 0.15 + Math.sin(now * 0.01) * 0.08;
    this.ctx.beginPath();
    this.ctx.arc(player.x, player.y, r + 4, 0, Math.PI * 2);
    this.ctx.strokeStyle = `rgba(100, 200, 255, ${glowPulse})`;
    this.ctx.lineWidth = 3;
    this.ctx.stroke();
  }

  private drawVignette() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cx = width / 2;
    const cy = height / 2;
    const outerRadius = Math.sqrt(cx * cx + cy * cy);
    const innerRadius = outerRadius * 0.55;

    const gradient = this.ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
    gradient.addColorStop(0, 'rgba(212, 0, 70, 0)');
    gradient.addColorStop(1, 'rgba(212, 0, 70, 0.4)');

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  private drawDamageFlash() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    if (this.damageFlashAlpha > 0) {
      this.ctx.fillStyle = `rgba(212, 0, 70, ${this.damageFlashAlpha})`;
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
      gradient.addColorStop(0, 'rgba(212, 0, 70, 0)');
      gradient.addColorStop(1, `rgba(212, 0, 70, ${this.lowChargeFlashAlpha * 0.5})`);
      
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
        this.ctx.fillStyle = '#00CC7A';
        this.ctx.arc(px, py, 3, 0, Math.PI * 2);
      } else {
        this.ctx.fillStyle = '#D40046';
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
    const ws = GameEngine.WORLD_SIZE;
    const hexSize = GameEngine.HEX_SIZE;
    const hexWidth = GameEngine.HEX_WIDTH;
    const vertSpacing = GameEngine.HEX_VERT_SPACING;
    const cosArr = GameEngine.HEX_COS;
    const sinArr = GameEngine.HEX_SIN;

    const viewPadding = 100 / this.baseZoom;
    const viewLeft = this.camera.x - (cx / this.baseZoom) - viewPadding;
    const viewRight = this.camera.x + (cx / this.baseZoom) + viewPadding;
    const viewTop = this.camera.y - (cy / this.baseZoom) - viewPadding;
    const viewBottom = this.camera.y + (cy / this.baseZoom) + viewPadding;

    const startRow = Math.floor(viewTop / vertSpacing) - 1;
    const endRow = Math.ceil(viewBottom / vertSpacing) + 1;
    const startCol = Math.floor(viewLeft / hexWidth) - 1;
    const endCol = Math.ceil(viewRight / hexWidth) + 1;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, ws, ws);
    this.ctx.clip();

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    for (let row = startRow; row <= endRow; row++) {
      const offsetX = (row & 1) === 0 ? 0 : hexWidth * 0.5;
      const centerY = row * vertSpacing;
      for (let col = startCol; col <= endCol; col++) {
        const centerX = col * hexWidth + offsetX;
        if (centerX < -hexSize || centerX > ws + hexSize ||
            centerY < -hexSize || centerY > ws + hexSize) continue;

        for (let i = 0; i < 3; i++) {
          this.ctx.moveTo(centerX + hexSize * cosArr[i], centerY + hexSize * sinArr[i]);
          this.ctx.lineTo(centerX + hexSize * cosArr[i + 1], centerY + hexSize * sinArr[i + 1]);
        }
      }
    }
    this.ctx.stroke();
    this.ctx.restore();

    this.ctx.strokeStyle = '#D40046';
    this.ctx.lineWidth = 5;
    this.ctx.strokeRect(0, 0, ws, ws);
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
    
    if (player.isStunned) {
      this.ctx.globalAlpha = 0.5;
    }
    
    if (shape === 'circle') {
      this.ctx.beginPath();
      this.ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (shape === 'triangle') {
      const size = player.radius;
      this.ctx.beginPath();
      this.ctx.moveTo(size, 0);
      this.ctx.lineTo(-size * 0.7, -size * 0.8);
      this.ctx.lineTo(-size * 0.7, size * 0.8);
      this.ctx.closePath();
      this.ctx.fill();
    } else if (shape === 'square') {
      const size = player.radius * 0.8;
      this.ctx.fillRect(-size, -size, size * 2, size * 2);
    }
    
    this.ctx.globalAlpha = 1;
    this.ctx.restore();
    
    // Draw Energy bar above player
    const barWidth = player.radius * 2.5;
    const barHeight = 6;
    const barY = player.y - player.radius - 14;
    const barX = player.x - barWidth / 2;
    const chargePercent = (player.charge || 0) / (player.maxCharge || 100);
    
    // Energy bar background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Energy bar fill (red)
    this.ctx.fillStyle = '#D40046';
    this.ctx.fillRect(barX, barY, barWidth * chargePercent, barHeight);

    // Draw section dividers at each 20-energy increment
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const maxCharge = player.maxCharge || 100;
    const sections = maxCharge / 20;
    for (let i = 1; i < sections; i++) {
      const dividerX = barX + (barWidth * i / sections);
      this.ctx.fillRect(dividerX - 0.5, barY, 1, barHeight);
    }
    
    let textColor: string;
    if (player.id === this.localPlayerId) {
      textColor = '#FFFFFF';
    } else {
      textColor = '#D40046';
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
