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
  type: 'STATE' | 'JOINED' | 'ELIMINATED' | 'PLAYER_LEFT' | 'ERROR' | 'ROOM_INFO';
  payload: any;
}

const WORLD_SIZE = 4000;
const INITIAL_RADIUS = 20;
const MAX_SPEED = 2;
const FOOD_COUNT = 300;
const MAX_PLAYERS_PER_ROOM = 15;
const MAX_ROOMS = 10;
const TICK_RATE = 30;
const COMBAT_COOLDOWN = 3000;

class GameRoom {
  id: string;
  private gameState: GameState;
  private clients: Map<string, WebSocket> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(id: string) {
    this.id = id;
    this.gameState = {
      players: new Map(),
      foods: []
    };
    this.initFood();
    this.startGameLoop();
    log(`Game room ${id} created`, 'room');
  }

  private initFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawnFood();
    }
  }

  private spawnFood() {
    this.gameState.foods.push({
      id: `food-${Math.random().toString(36).substr(2, 9)}`,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      radius: 4 + Math.random() * 4,
      color: `hsl(${Math.random() * 360}, 60%, 50%)`,
      value: 5
    });
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

  addPlayer(playerId: string, ws: WebSocket, payload: { name: string; walletAddress?: string }): boolean {
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

    const colors = ['#D40046', '#00CC7A', '#00A3CC', '#CC7A00', '#A300CC', '#CCCC00'];
    const player: Player = {
      id: playerId,
      name: payload.name || 'Anonymous',
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      radius: INITIAL_RADIUS,
      color: colors[Math.floor(Math.random() * colors.length)],
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
      payload: { playerId, player, roomId: this.id }
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
        const speed = MAX_SPEED * speedFactor;
        
        const targetVx = (inputVector.x / length) * speed;
        const targetVy = (inputVector.y / length) * speed;
        
        player.velocity.x += (targetVx - player.velocity.x) * 0.8;
        player.velocity.y += (targetVy - player.velocity.y) * 0.8;
      } else {
        player.velocity.x = 0;
        player.velocity.y = 0;
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

    const message: ServerMessage = {
      type: 'STATE',
      payload: {
        players: playersArray,
        foods: this.gameState.foods
      }
    };

    this.broadcast(message);
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
  private rooms: Map<string, GameRoom> = new Map();
  private playerToRoom: Map<string, string> = new Map();

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    
    this.createRoom();

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

  private createRoom(): GameRoom {
    const roomId = `room-${this.rooms.size + 1}`;
    const room = new GameRoom(roomId);
    this.rooms.set(roomId, room);
    return room;
  }

  private findAvailableRoom(): GameRoom | null {
    const rooms = Array.from(this.rooms.values());
    for (const room of rooms) {
      if (!room.isFull()) {
        return room;
      }
    }
    
    if (this.rooms.size < MAX_ROOMS) {
      return this.createRoom();
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

  private handleJoin(playerId: string, ws: WebSocket, payload: { name: string; walletAddress?: string }) {
    const room = this.findAvailableRoom();
    
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
      log(`Player ${payload.name} (${playerId}) matched to ${room.id}. Total players: ${this.getTotalPlayerCount()}`, 'ws');
    }
  }

  private handleInput(playerId: string, payload: { x: number; y: number }) {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return;
    
    const room = this.rooms.get(roomId);
    room?.handleInput(playerId, payload);
  }

  private handleLeave(playerId: string) {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return;
    
    const room = this.rooms.get(roomId);
    if (room?.handleLeave(playerId)) {
      this.playerToRoom.delete(playerId);
      this.cleanupEmptyRooms();
    }
  }

  private handleDisconnect(playerId: string) {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return;
    
    const room = this.rooms.get(roomId);
    room?.handleDisconnect(playerId);
    this.playerToRoom.delete(playerId);
    this.cleanupEmptyRooms();
  }

  private cleanupEmptyRooms() {
    // Keep at least one room always, and only cleanup rooms that have no players tracked anywhere
    if (this.rooms.size <= 1) return;
    
    const entries = Array.from(this.rooms.entries());
    for (const [roomId, room] of entries) {
      // Only cleanup if room is truly empty AND no players reference this room
      const playersInRoom = Array.from(this.playerToRoom.values()).filter(r => r === roomId).length;
      if (room.isEmpty() && room.getClientCount() === 0 && playersInRoom === 0 && this.rooms.size > 1) {
        room.stopGameLoop();
        this.rooms.delete(roomId);
        log(`Room ${roomId} removed (no players or clients)`, 'room');
        break;
      }
    }
  }

  getTotalPlayerCount(): number {
    let total = 0;
    const rooms = Array.from(this.rooms.values());
    for (const room of rooms) {
      total += room.getPlayerCount();
    }
    return total;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getMaxTotalPlayers(): number {
    return MAX_ROOMS * MAX_PLAYERS_PER_ROOM;
  }

  getRoomStats(): { id: string; players: number; maxPlayers: number }[] {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      players: room.getPlayerCount(),
      maxPlayers: MAX_PLAYERS_PER_ROOM
    }));
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
