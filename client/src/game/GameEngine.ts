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
  foods: Food[];
}

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  players: Map<string, Player> = new Map();
  foods: Food[] = [];
  localPlayerId: string | null = null;
  
  static WORLD_SIZE = 4000;
  static INITIAL_RADIUS = 20;
  
  isRunning: boolean = false;
  lastTime: number = 0;
  camera: Point = { x: 0, y: 0 };
  baseZoom: number = 0.8;
  
  private frameCount: number = 0;
  private fpsLastTime: number = 0;
  private currentFps: number = 60;
  
  onGameOver: (stats: { score: number, killer?: string, balance?: number }) => void;
  onUpdateStats: (stats: { fps: number, population: number, balance?: number }) => void;
  onConnectionChange?: (connected: boolean) => void;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pendingJoin: { name: string; walletAddress?: string } | null = null;

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
        this.sendJoin(this.pendingJoin.name, this.pendingJoin.walletAddress);
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
        break;

      case 'STATE':
        this.applyServerState(message.payload);
        break;

      case 'ELIMINATED':
        this.onGameOver({
          score: message.payload.score,
          killer: message.payload.killerName,
          balance: message.payload.balance
        });
        this.stop();
        break;

      case 'PLAYER_LEFT':
        this.players.delete(message.payload.playerId);
        break;

      case 'ERROR':
        console.error('Server error:', message.payload.message);
        break;
    }
  }

  private applyServerState(state: ServerState) {
    this.players.clear();
    state.players.forEach(p => {
      this.players.set(p.id, {
        ...p,
        velocity: { x: 0, y: 0 }
      });
    });

    this.foods = state.foods;
  }

  private sendJoin(name: string, walletAddress?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'JOIN',
        payload: { name, walletAddress }
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
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  };

  start(playerName: string, isStakeMode: boolean, walletAddress?: string) {
    this.isRunning = true;
    this.players.clear();
    this.foods = [];
    this.localPlayerId = null;
    
    this.pendingJoin = { name: playerName, walletAddress };
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
    this.sendInput(vector);
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

    this.ctx.strokeStyle = '#1a1a20';
    this.ctx.lineWidth = 2;
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
    
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = `bold ${Math.max(12, player.radius * 0.4)}px Outfit`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(player.name, player.x, player.y);
  }
}
