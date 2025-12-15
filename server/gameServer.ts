import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { log } from './index';
import { escrowService } from './escrowService';

interface Point {
  x: number;
  y: number;
}

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  score: number;
  velocity: Point;
  walletAddress?: string;
  balance: number;
  lastCombatTime: number;
  inputVector: Point;
}

interface Food {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  value: number;
}

interface GameState {
  players: Map<string, Player>;
  foods: Food[];
}

interface ClientMessage {
  type: 'JOIN' | 'INPUT' | 'LEAVE';
  payload: any;
}

interface ServerMessage {
  type: 'STATE' | 'JOINED' | 'ELIMINATED' | 'PLAYER_LEFT' | 'ERROR' | 'ROOM_INFO' | 'FOOD_DELTA';
  payload: any;
}

const WORLD_SIZE = 4000;
const INITIAL_RADIUS = 20;
const MAX_SPEED = 2.3;
const FOOD_COUNT = 300;
const MAX_PLAYERS_PER_ROOM = 15;
const MAX_ROOMS = 10;
const TICK_RATE = 30;
const COMBAT_COOLDOWN = 3000;

class GameRoom {
  id: string;
  isStakeMode: boolean;
  private gameState: GameState;
  private clients: Map<string, WebSocket> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private spawnedFoods: Food[] = [];
  private eatenFoodIds: string[] = [];

  constructor(id: string, isStakeMode: boolean = false) {
    this.id = id;
    this.isStakeMode = isStakeMode;
    this.gameState = {
      players: new Map(),
      foods: []
    };
    this.initFood();
    this.startGameLoop();
    log(`Game room ${id} created (${isStakeMode ? 'stake' : 'free'} mode)`, 'room');
  }

  private initFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawnFood(false);
    }
  }

  private spawnFood(trackDelta: boolean = true): Food {
    const food: Food = {
      id: `food-${Math.random().toString(36).substr(2, 9)}`,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      radius: 4 + Math.random() * 4,
      color: `hsl(${Math.random() * 360}, 60%, 50%)`,
      value: 5
    };
    this.gameState.foods.push(food);
    if (trackDelta) {
      this.spawnedFoods.push(food);
    }
    return food;
  }

  private startGameLoop() {
    this.tickInterval = setInterval(() => {
      this.update();
      this.broadcastState();
    }, 1000 / TICK_RATE);
  }

  stopGameLoop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  getPlayerCount(): number {
    return this.gameState.players.size;
  }

  isFull(): boolean {
    return this.gameState.players.size >= MAX_PLAYERS_PER_ROOM;
  }

  isEmpty(): boolean {
    return this.gameState.players.size === 0;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  addPlayer(playerId: string, ws: WebSocket, payload: { name: string; walletAddress?: string; playerColor?: string }): boolean {
    if (this.isFull()) {
      return false;
    }

    let balance = 1;
    if (payload.walletAddress) {
      const depositResult = escrowService.deposit(payload.walletAddress);
      if (depositResult.success) {
        balance = depositResult.balance;
      }
    }

    const defaultColors = ['#D40046', '#00CC7A', '#00A3CC', '#CC7A00', '#A300CC', '#CCCC00'];
    const player: Player = {
      id: playerId,
      name: payload.name || 'Anonymous',
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      radius: INITIAL_RADIUS,
      color: payload.playerColor || defaultColors[Math.floor(Math.random() * defaultColors.length)],
      score: 10,
      velocity: { x: 0, y: 0 },
      walletAddress: payload.walletAddress,
      balance,
      lastCombatTime: 0,
      inputVector: { x: 0, y: 0 }
    };

    this.gameState.players.set(playerId, player);
    this.clients.set(playerId, ws);

    this.send(ws, {
      type: 'JOINED',
      payload: { playerId, player, roomId: this.id, foods: this.gameState.foods }
    });

    this.send(ws, {
      type: 'ROOM_INFO',
      payload: { roomId: this.id, playerCount: this.getPlayerCount(), maxPlayers: MAX_PLAYERS_PER_ROOM }
    });

    log(`Player ${payload.name} (${playerId}) joined room ${this.id}. Room total: ${this.gameState.players.size}`, 'room');
    return true;
  }

  handleInput(playerId: string, payload: { x: number; y: number }) {
    const player = this.gameState.players.get(playerId);
    if (!player) return;

    const length = Math.sqrt(payload.x * payload.x + payload.y * payload.y);
    if (length > 1) {
      payload.x /= length;
      payload.y /= length;
    }
    player.inputVector = { x: payload.x, y: payload.y };
  }

  handleLeave(playerId: string): boolean {
    const player = this.gameState.players.get(playerId);
    if (!player) return false;

    const now = Date.now();
    if (now - player.lastCombatTime < COMBAT_COOLDOWN) {
      const ws = this.clients.get(playerId);
      if (ws) {
        this.send(ws, { 
          type: 'ERROR', 
          payload: { message: 'Cannot leave during or shortly after combat' } 
        });
      }
      return false;
    }

    if (player.walletAddress) {
      const withdrawResult = escrowService.withdraw(player.walletAddress);
      if (withdrawResult.success) {
        log(`Player ${player.name} withdrew ${withdrawResult.netAmount.toFixed(4)} USDC (fee: ${withdrawResult.fee.toFixed(4)})`, 'room');
      }
    }

    this.removePlayer(playerId, 'left');
    return true;
  }

  handleDisconnect(playerId: string) {
    this.removePlayer(playerId, 'disconnected');
  }

  hasPlayer(playerId: string): boolean {
    return this.gameState.players.has(playerId);
  }

  private removePlayer(playerId: string, reason: string) {
    const player = this.gameState.players.get(playerId);
    if (player) {
      log(`Player ${player.name} (${playerId}) ${reason} from room ${this.id}. Room total: ${this.gameState.players.size - 1}`, 'room');
    }
    this.gameState.players.delete(playerId);
    this.clients.delete(playerId);

    this.broadcast({
      type: 'PLAYER_LEFT',
      payload: { playerId }
    });
  }

  private update() {
    const dt = 1 / TICK_RATE;

    this.gameState.players.forEach(player => {
      const { inputVector } = player;
      const length = Math.sqrt(inputVector.x * inputVector.x + inputVector.y * inputVector.y);
      
      if (length > 0) {
        const speedFactor = Math.max(0.5, 1 - (player.radius / 200));
        const targetSpeed = MAX_SPEED * speedFactor;
        
        // Get current speed magnitude
        const currentSpeed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.y * player.velocity.y);
        
        // Blend speed (momentum) but use instant direction
        const blendedSpeed = currentSpeed + (targetSpeed - currentSpeed) * 0.15;
        
        // Apply instant direction with blended speed
        player.velocity.x = (inputVector.x / length) * blendedSpeed;
        player.velocity.y = (inputVector.y / length) * blendedSpeed;
      } else {
        // Decelerate with momentum when no input
        player.velocity.x *= 0.85;
        player.velocity.y *= 0.85;
        if (Math.abs(player.velocity.x) < 0.01) player.velocity.x = 0;
        if (Math.abs(player.velocity.y) < 0.01) player.velocity.y = 0;
      }

      const timeScale = dt * 60;
      player.x += player.velocity.x * timeScale;
      player.y += player.velocity.y * timeScale;

      player.x = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.y));
    });

    this.gameState.players.forEach(player => {
      for (let i = this.gameState.foods.length - 1; i >= 0; i--) {
        const food = this.gameState.foods[i];
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < player.radius + food.radius) {
          this.eatenFoodIds.push(food.id);
          this.gameState.foods.splice(i, 1);
          this.growPlayer(player, food.value);
          this.spawnFood();
        }
      }
    });

    const players = Array.from(this.gameState.players.values());
    const sortedPlayers = players.sort((a, b) => b.radius - a.radius);

    for (let i = 0; i < sortedPlayers.length; i++) {
      const predator = sortedPlayers[i];
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const prey = sortedPlayers[j];

        if (!this.gameState.players.has(prey.id)) continue;
        if (!this.gameState.players.has(predator.id)) continue;

        const dx = predator.x - prey.x;
        const dy = predator.y - prey.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < predator.radius && predator.radius > prey.radius) {
          this.handleElimination(predator, prey);
        }
      }
    }
  }

  private handleElimination(predator: Player, prey: Player) {
    const now = Date.now();
    predator.lastCombatTime = now;
    prey.lastCombatTime = now;

    this.growPlayer(predator, prey.score);

    if (predator.walletAddress && prey.walletAddress) {
      const result = escrowService.transferOnKill(predator.walletAddress, prey.walletAddress);
      if (result.success) {
        predator.balance = result.killerBalance;
        prey.balance = result.victimBalance;
      }
    } else if (prey.balance > 0 && predator.walletAddress) {
      const transfer = Math.min(1, prey.balance);
      prey.balance -= transfer;
      predator.balance += transfer;
      log(`In-memory transfer: ${transfer} USDC from ${prey.name} to ${predator.name}`, 'game');
    }

    const preyWs = this.clients.get(prey.id);
    if (preyWs) {
      this.send(preyWs, {
        type: 'ELIMINATED',
        payload: {
          killerName: predator.name,
          score: prey.score,
          balance: prey.balance
        }
      });
    }

    log(`${predator.name} eliminated ${prey.name} in room ${this.id}`, 'room');
    this.gameState.players.delete(prey.id);
    this.clients.delete(prey.id);
  }

  private growPlayer(player: Player, amount: number) {
    player.score += Math.floor(amount);
    player.radius = INITIAL_RADIUS + Math.sqrt(player.score) * 2;
  }

  private broadcastState() {
    const playersArray = Array.from(this.gameState.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      radius: p.radius,
      color: p.color,
      score: p.score,
      balance: p.balance
    }));

    const stateMessage: ServerMessage = {
      type: 'STATE',
      payload: {
        players: playersArray
      }
    };

    this.broadcast(stateMessage);

    if (this.spawnedFoods.length > 0 || this.eatenFoodIds.length > 0) {
      const deltaMessage: ServerMessage = {
        type: 'FOOD_DELTA',
        payload: {
          spawned: this.spawnedFoods,
          eaten: this.eatenFoodIds
        }
      };
      this.broadcast(deltaMessage);
      this.spawnedFoods = [];
      this.eatenFoodIds = [];
    }
  }

  private send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: ServerMessage) {
    const data = JSON.stringify(message);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

export class GameServer {
  private wss: WebSocketServer;
  private freeRooms: Map<string, GameRoom> = new Map();
  private stakeRooms: Map<string, GameRoom> = new Map();
  private playerToRoom: Map<string, string> = new Map();
  private playerStakeMode: Map<string, boolean> = new Map();
  private roomIdCounter: number = 0;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    
    this.createRoom(false);
    this.createRoom(true);

    this.wss.on('connection', (ws) => {
      const playerId = `player-${Math.random().toString(36).substr(2, 9)}`;
      
      ws.on('message', (data) => {
        try {
          const message: ClientMessage = JSON.parse(data.toString());
          this.handleMessage(playerId, ws, message);
        } catch (e) {
          log(`Invalid message from ${playerId}`, 'ws');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(playerId);
      });

      ws.on('error', (err) => {
        log(`WebSocket error for ${playerId}: ${err.message}`, 'ws');
      });
    });

    log('WebSocket game server initialized with room support on /ws', 'ws');
  }

  private createRoom(isStakeMode: boolean): GameRoom {
    const pool = isStakeMode ? this.stakeRooms : this.freeRooms;
    const prefix = isStakeMode ? 'stake' : 'free';
    this.roomIdCounter++;
    const roomId = `${prefix}-room-${this.roomIdCounter}`;
    const room = new GameRoom(roomId, isStakeMode);
    pool.set(roomId, room);
    return room;
  }

  private getTotalRoomCount(): number {
    return this.freeRooms.size + this.stakeRooms.size;
  }

  private findAvailableRoom(isStakeMode: boolean): GameRoom | null {
    const pool = isStakeMode ? this.stakeRooms : this.freeRooms;
    const rooms = Array.from(pool.values());
    for (const room of rooms) {
      if (!room.isFull()) {
        return room;
      }
    }
    
    if (this.getTotalRoomCount() < MAX_ROOMS) {
      return this.createRoom(isStakeMode);
    }
    
    return null;
  }

  private handleMessage(playerId: string, ws: WebSocket, message: ClientMessage) {
    switch (message.type) {
      case 'JOIN':
        this.handleJoin(playerId, ws, message.payload);
        break;
      case 'INPUT':
        this.handleInput(playerId, message.payload);
        break;
      case 'LEAVE':
        this.handleLeave(playerId);
        break;
    }
  }

  private handleJoin(playerId: string, ws: WebSocket, payload: { name: string; isStakeMode?: boolean; walletAddress?: string }) {
    const isStakeMode = payload.isStakeMode ?? false;
    const room = this.findAvailableRoom(isStakeMode);
    
    if (!room) {
      ws.send(JSON.stringify({ 
        type: 'ERROR', 
        payload: { message: 'All rooms are full. Please try again later.' } 
      }));
      return;
    }

    const added = room.addPlayer(playerId, ws, payload);
    if (added) {
      this.playerToRoom.set(playerId, room.id);
      this.playerStakeMode.set(playerId, isStakeMode);
      log(`Player ${payload.name} (${playerId}) matched to ${room.id} (${isStakeMode ? 'stake' : 'free'}). Total players: ${this.getTotalPlayerCount()}`, 'ws');
    }
  }

  private getRoom(playerId: string): GameRoom | undefined {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return undefined;
    const isStakeMode = this.playerStakeMode.get(playerId) ?? false;
    const pool = isStakeMode ? this.stakeRooms : this.freeRooms;
    return pool.get(roomId);
  }

  private handleInput(playerId: string, payload: { x: number; y: number }) {
    const room = this.getRoom(playerId);
    room?.handleInput(playerId, payload);
  }

  private handleLeave(playerId: string) {
    const room = this.getRoom(playerId);
    if (room?.handleLeave(playerId)) {
      this.playerToRoom.delete(playerId);
      this.playerStakeMode.delete(playerId);
      this.cleanupEmptyRooms();
    }
  }

  private handleDisconnect(playerId: string) {
    const room = this.getRoom(playerId);
    room?.handleDisconnect(playerId);
    this.playerToRoom.delete(playerId);
    this.playerStakeMode.delete(playerId);
    this.cleanupEmptyRooms();
  }

  private cleanupEmptyRooms() {
    const cleanupPool = (pool: Map<string, GameRoom>) => {
      if (pool.size <= 1) return;
      
      const entries = Array.from(pool.entries());
      for (const [roomId, room] of entries) {
        const playersInRoom = Array.from(this.playerToRoom.values()).filter(r => r === roomId).length;
        if (room.isEmpty() && room.getClientCount() === 0 && playersInRoom === 0 && pool.size > 1) {
          room.stopGameLoop();
          pool.delete(roomId);
          log(`Room ${roomId} removed (no players or clients)`, 'room');
          break;
        }
      }
    };
    
    cleanupPool(this.freeRooms);
    cleanupPool(this.stakeRooms);
  }

  getTotalPlayerCount(): number {
    let total = 0;
    for (const room of this.freeRooms.values()) {
      total += room.getPlayerCount();
    }
    for (const room of this.stakeRooms.values()) {
      total += room.getPlayerCount();
    }
    return total;
  }

  getRoomCount(): number {
    return this.freeRooms.size + this.stakeRooms.size;
  }

  getMaxTotalPlayers(): number {
    return MAX_ROOMS * MAX_PLAYERS_PER_ROOM;
  }

  getRoomStats(): { id: string; players: number; maxPlayers: number; isStakeMode: boolean }[] {
    const stats: { id: string; players: number; maxPlayers: number; isStakeMode: boolean }[] = [];
    for (const room of this.freeRooms.values()) {
      stats.push({
        id: room.id,
        players: room.getPlayerCount(),
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        isStakeMode: false
      });
    }
    for (const room of this.stakeRooms.values()) {
      stats.push({
        id: room.id,
        players: room.getPlayerCount(),
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        isStakeMode: true
      });
    }
    return stats;
  }
}

let gameServerInstance: GameServer | null = null;

export function initGameServer(httpServer: Server): GameServer {
  if (!gameServerInstance) {
    gameServerInstance = new GameServer(httpServer);
  }
  return gameServerInstance;
}

export function getGameServer(): GameServer | null {
  return gameServerInstance;
}
