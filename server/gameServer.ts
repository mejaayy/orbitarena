import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { log } from './index';
import { balanceService } from './balanceService';

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
  isSpectator: boolean;
  isBoosting: boolean;
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
  type: 'STATE' | 'JOINED' | 'ELIMINATED' | 'PLAYER_LEFT' | 'ERROR' | 'ROOM_INFO' | 'FOOD_DELTA' | 'ROUND_STATUS' | 'ROUND_END';
  payload: any;
}

type RoundState = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ENDED';

const WORLD_SIZE = 4000;
const INITIAL_RADIUS = 20;
const MAX_SPEED = 2.3;
const FOOD_COUNT = 300;
const MAX_PLAYERS_PER_ROOM = 15;
const MAX_ROOMS = 10;
const TICK_RATE = 30;
const COMBAT_COOLDOWN = 3000;

// Stake mode constants
const ENTRY_FEE = 1.00;
const PLATFORM_FEE = 0.10;
const PRIZE_CONTRIBUTION = 0.90;
const ROUND_DURATION = 120000; // 2 minutes in ms
const COUNTDOWN_DURATION = 3000; // 3 seconds
const PRIZE_1ST = 6.00;
const PRIZE_2ND = 4.50;
const PRIZE_3RD = 3.00;

class GameRoom {
  id: string;
  isStakeMode: boolean;
  protected gameState: GameState;
  protected clients: Map<string, WebSocket> = new Map();
  protected tickInterval: NodeJS.Timeout | null = null;
  protected spawnedFoods: Food[] = [];
  protected eatenFoodIds: string[] = [];

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

  protected initFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawnFood(false);
    }
  }

  protected spawnFood(trackDelta: boolean = true): Food {
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

  protected startGameLoop() {
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
      balance: 0,
      lastCombatTime: 0,
      inputVector: { x: 0, y: 0 },
      isSpectator: false,
      isBoosting: false
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

  handleInput(playerId: string, payload: { x: number; y: number; boost?: boolean }) {
    const player = this.gameState.players.get(playerId);
    if (!player || player.isSpectator) return;

    const length = Math.sqrt(payload.x * payload.x + payload.y * payload.y);
    if (length > 1) {
      payload.x /= length;
      payload.y /= length;
    }
    player.inputVector = { x: payload.x, y: payload.y };
    player.isBoosting = payload.boost === true && player.score > 15;
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

    this.removePlayer(playerId, 'left');
    return true;
  }

  handleDisconnect(playerId: string) {
    this.removePlayer(playerId, 'disconnected');
  }

  hasPlayer(playerId: string): boolean {
    return this.gameState.players.has(playerId);
  }

  protected removePlayer(playerId: string, reason: string) {
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

  protected update() {
    const dt = 1 / TICK_RATE;

    this.gameState.players.forEach(player => {
      if (player.isSpectator) return;
      
      // Check boost eligibility BEFORE draining
      const canBoost = player.isBoosting && player.score > 15;
      
      const { inputVector } = player;
      const length = Math.sqrt(inputVector.x * inputVector.x + inputVector.y * inputVector.y);
      
      if (length > 0) {
        const speedFactor = Math.max(0.5, 1 - (player.radius / 200));
        let speed = MAX_SPEED * speedFactor;
        
        // Apply 60% speed boost when boosting
        if (canBoost) {
          speed *= 1.6;
        }
        
        player.velocity.x = (inputVector.x / length) * speed;
        player.velocity.y = (inputVector.y / length) * speed;
      } else {
        player.velocity.x = 0;
        player.velocity.y = 0;
      }
      
      // Apply boost drain AFTER movement (0.5 points per tick = ~15 pts/sec)
      if (canBoost) {
        player.score -= 0.5;
        player.radius = INITIAL_RADIUS + Math.sqrt(player.score) * 2;
        // Stop boosting if score drops too low
        if (player.score <= 15) {
          player.isBoosting = false;
        }
      }

      const timeScale = dt * 60;
      player.x += player.velocity.x * timeScale;
      player.y += player.velocity.y * timeScale;

      player.x = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.y));
    });

    this.gameState.players.forEach(player => {
      if (player.isSpectator) return;
      
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

    const players = Array.from(this.gameState.players.values()).filter(p => !p.isSpectator);
    const sortedPlayers = players.sort((a, b) => b.radius - a.radius);

    for (let i = 0; i < sortedPlayers.length; i++) {
      const predator = sortedPlayers[i];
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const prey = sortedPlayers[j];

        if (!this.gameState.players.has(prey.id) || prey.isSpectator) continue;
        if (!this.gameState.players.has(predator.id) || predator.isSpectator) continue;

        const dx = predator.x - prey.x;
        const dy = predator.y - prey.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist + prey.radius * 0.8 <= predator.radius && predator.radius > prey.radius) {
          this.handleElimination(predator, prey);
        }
      }
    }
  }

  protected handleElimination(predator: Player, prey: Player) {
    const now = Date.now();
    predator.lastCombatTime = now;
    prey.lastCombatTime = now;

    this.growPlayer(predator, prey.score);

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

  protected growPlayer(player: Player, amount: number) {
    player.score += Math.floor(amount);
    player.radius = INITIAL_RADIUS + Math.sqrt(player.score) * 2;
  }

  protected broadcastState() {
    const playersArray = Array.from(this.gameState.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      radius: p.radius,
      color: p.color,
      score: p.score,
      balance: p.balance,
      isSpectator: p.isSpectator,
      isBoosting: p.isBoosting
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

  protected send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  protected broadcast(message: ServerMessage) {
    const data = JSON.stringify(message);
    this.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

// Stake room with round-based tournament system
class StakeGameRoom extends GameRoom {
  private roundState: RoundState = 'LOBBY';
  private roundStartTime: number = 0;
  private countdownStartTime: number = 0;
  private countdownTimeout: NodeJS.Timeout | null = null;
  private roundEndTimeout: NodeJS.Timeout | null = null;
  private prizePool: number = 0;
  private matchId: string = '';
  private lobbyPlayers: Map<string, { ws: WebSocket; name: string; walletAddress?: string; playerColor?: string }> = new Map();

  constructor(id: string) {
    super(id, true);
    this.stopGameLoop(); // Don't run game loop until round starts
    this.matchId = `${id}_${Date.now()}`;
    log(`Stake room ${id} created - waiting for players in lobby`, 'room');
  }

  getPlayerCount(): number {
    if (this.roundState === 'LOBBY' || this.roundState === 'COUNTDOWN') {
      return this.lobbyPlayers.size;
    }
    return this.gameState.players.size;
  }

  isFull(): boolean {
    return this.lobbyPlayers.size >= MAX_PLAYERS_PER_ROOM;
  }

  isEmpty(): boolean {
    return this.lobbyPlayers.size === 0 && this.gameState.players.size === 0;
  }

  getClientCount(): number {
    return this.lobbyPlayers.size + this.clients.size;
  }

  getRoundState(): RoundState {
    return this.roundState;
  }

  async addPlayer(playerId: string, ws: WebSocket, payload: { name: string; walletAddress?: string; playerColor?: string }): Promise<boolean> {
    // Only allow joining during LOBBY phase
    if (this.roundState !== 'LOBBY' && this.roundState !== 'COUNTDOWN') {
      this.send(ws, {
        type: 'ERROR',
        payload: { message: 'Round in progress. Please wait for the next round.' }
      });
      return false;
    }

    if (this.lobbyPlayers.size >= MAX_PLAYERS_PER_ROOM) {
      return false;
    }

    // Require wallet for stake mode
    if (!payload.walletAddress) {
      this.send(ws, {
        type: 'ERROR',
        payload: { message: 'Wallet connection required for stake mode.' }
      });
      return false;
    }

    // Lock entry fee from internal balance
    const lockResult = await balanceService.lockForMatch(payload.walletAddress, this.matchId);
    if (!lockResult.success) {
      this.send(ws, {
        type: 'ERROR',
        payload: { message: lockResult.error || 'Insufficient balance for entry fee.' }
      });
      return false;
    }

    // Add to lobby
    this.lobbyPlayers.set(playerId, {
      ws,
      name: payload.name,
      walletAddress: payload.walletAddress,
      playerColor: payload.playerColor
    });

    // Send lobby info
    this.send(ws, {
      type: 'JOINED',
      payload: { 
        playerId, 
        roomId: this.id, 
        isLobby: true,
        playerCount: this.lobbyPlayers.size,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        prizePool: this.lobbyPlayers.size * PRIZE_CONTRIBUTION
      }
    });

    this.broadcastRoundStatus();

    log(`Player ${payload.name} joined stake lobby ${this.id}. Lobby: ${this.lobbyPlayers.size}/${MAX_PLAYERS_PER_ROOM}`, 'room');

    // Check if lobby is full
    if (this.lobbyPlayers.size >= MAX_PLAYERS_PER_ROOM) {
      this.startCountdown();
    }

    return true;
  }

  private startCountdown() {
    if (this.roundState !== 'LOBBY') return;

    this.roundState = 'COUNTDOWN';
    this.countdownStartTime = Date.now();
    this.prizePool = this.lobbyPlayers.size * PRIZE_CONTRIBUTION;

    log(`Starting ${COUNTDOWN_DURATION/1000}s countdown for stake room ${this.id}. Prize pool: $${this.prizePool.toFixed(2)}`, 'room');

    this.broadcastRoundStatus();

    this.countdownTimeout = setTimeout(() => {
      this.startRound();
    }, COUNTDOWN_DURATION);
  }

  private cancelCountdown() {
    if (this.countdownTimeout) {
      clearTimeout(this.countdownTimeout);
      this.countdownTimeout = null;
    }
    this.roundState = 'LOBBY';
    this.broadcastRoundStatus();
    log(`Countdown cancelled for stake room ${this.id} - player left`, 'room');
  }

  private startRound() {
    this.roundState = 'PLAYING';
    this.roundStartTime = Date.now();
    this.prizePool = this.lobbyPlayers.size * PRIZE_CONTRIBUTION;

    // Reset food
    this.gameState.foods = [];
    this.initFood();

    // Create players from lobby
    const defaultColors = ['#D40046', '#00CC7A', '#00A3CC', '#CC7A00', '#A300CC', '#CCCC00'];
    
    this.lobbyPlayers.forEach((data, playerId) => {
      const player: Player = {
        id: playerId,
        name: data.name || 'Anonymous',
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        radius: INITIAL_RADIUS,
        color: data.playerColor || defaultColors[Math.floor(Math.random() * defaultColors.length)],
        score: 10,
        velocity: { x: 0, y: 0 },
        walletAddress: data.walletAddress,
        balance: ENTRY_FEE,
        lastCombatTime: 0,
        inputVector: { x: 0, y: 0 },
        isSpectator: false,
        isBoosting: false
      };

      this.gameState.players.set(playerId, player);
      this.clients.set(playerId, data.ws);

      // Send game start message
      this.send(data.ws, {
        type: 'JOINED',
        payload: { 
          playerId, 
          player, 
          roomId: this.id, 
          foods: this.gameState.foods,
          roundStartTime: this.roundStartTime,
          roundDuration: ROUND_DURATION,
          prizePool: this.prizePool
        }
      });
    });

    // Clear lobby
    this.lobbyPlayers.clear();

    // Start game loop
    this.startGameLoop();
    this.broadcastRoundStatus();

    log(`Round started in stake room ${this.id}. ${this.gameState.players.size} players. Prize pool: $${this.prizePool.toFixed(2)}`, 'room');

    // Set round end timer
    this.roundEndTimeout = setTimeout(() => {
      this.endRound();
    }, ROUND_DURATION);
  }

  private async endRound() {
    this.roundState = 'ENDED';
    this.stopGameLoop();

    if (this.roundEndTimeout) {
      clearTimeout(this.roundEndTimeout);
      this.roundEndTimeout = null;
    }

    // Calculate final standings
    const allPlayers = Array.from(this.gameState.players.values());
    const sortedByScore = allPlayers.sort((a, b) => b.score - a.score);

    // Build standings for payout
    const standings = sortedByScore
      .filter(p => p.walletAddress)
      .map((player, index) => ({
        walletAddress: player.walletAddress!,
        rank: index + 1,
        name: player.name,
        score: player.score
      }));

    // Process payouts via balance service (idempotent)
    await balanceService.settlePayouts(this.matchId, standings);

    // Broadcast round end to all players
    this.broadcast({
      type: 'ROUND_END',
      payload: {
        standings: sortedByScore.map((p, i) => ({
          rank: i + 1,
          playerId: p.id,
          name: p.name,
          score: p.score,
          prize: i === 0 ? PRIZE_1ST : i === 1 ? PRIZE_2ND : i === 2 ? PRIZE_3RD : 0
        })),
        prizePool: this.prizePool
      }
    });

    log(`Round ended in stake room ${this.id}. Winner: ${sortedByScore[0]?.name || 'N/A'}`, 'room');

    // Reset for next round after a delay
    setTimeout(() => {
      this.resetForNextRound();
    }, 5000);
  }

  private resetForNextRound() {
    // Clear all players
    this.gameState.players.clear();
    this.clients.clear();
    this.lobbyPlayers.clear();
    
    // Reset state
    this.roundState = 'LOBBY';
    this.prizePool = 0;
    this.roundStartTime = 0;
    this.matchId = `${this.id}_${Date.now()}`;
    
    // Reset food
    this.gameState.foods = [];
    this.initFood();

    log(`Stake room ${this.id} reset for next round`, 'room');
  }

  handleInput(playerId: string, payload: { x: number; y: number }) {
    if (this.roundState !== 'PLAYING') return;
    super.handleInput(playerId, payload);
  }

  async handleLeave(playerId: string): Promise<boolean> {
    // Handle lobby leave
    if (this.lobbyPlayers.has(playerId)) {
      const playerData = this.lobbyPlayers.get(playerId);
      
      // Release locked entry fee back to available balance
      if (playerData?.walletAddress) {
        await balanceService.releaseLock(playerData.walletAddress, this.matchId);
      }
      
      this.lobbyPlayers.delete(playerId);
      log(`Player left stake lobby ${this.id}. Lobby: ${this.lobbyPlayers.size}/${MAX_PLAYERS_PER_ROOM}`, 'room');
      
      // Cancel countdown if in countdown phase
      if (this.roundState === 'COUNTDOWN') {
        this.cancelCountdown();
      }
      
      this.broadcastRoundStatus();
      return true;
    }

    // During game, leaving is not allowed (they become spectator on death)
    if (this.roundState === 'PLAYING') {
      const ws = this.clients.get(playerId);
      if (ws) {
        this.send(ws, {
          type: 'ERROR',
          payload: { message: 'Cannot leave during an active round.' }
        });
      }
      return false;
    }

    return super.handleLeave(playerId);
  }

  async handleDisconnect(playerId: string) {
    // Handle lobby disconnect
    if (this.lobbyPlayers.has(playerId)) {
      const playerData = this.lobbyPlayers.get(playerId);
      
      // Release locked entry fee back to available balance
      if (playerData?.walletAddress) {
        await balanceService.releaseLock(playerData.walletAddress, this.matchId);
      }
      
      this.lobbyPlayers.delete(playerId);
      log(`Player disconnected from stake lobby ${this.id}. Lobby: ${this.lobbyPlayers.size}/${MAX_PLAYERS_PER_ROOM}`, 'room');
      
      // Cancel countdown if in countdown phase
      if (this.roundState === 'COUNTDOWN') {
        this.cancelCountdown();
      }
      
      this.broadcastRoundStatus();
      return;
    }

    // During game, disconnecting forfeits (become spectator or removed)
    if (this.roundState === 'PLAYING') {
      const player = this.gameState.players.get(playerId);
      if (player && !player.isSpectator) {
        player.isSpectator = true;
        log(`Player ${player.name} disconnected during round in ${this.id} - forfeited`, 'room');
      }
      this.clients.delete(playerId);
      return;
    }

    super.handleDisconnect(playerId);
  }

  protected handleElimination(predator: Player, prey: Player) {
    const now = Date.now();
    predator.lastCombatTime = now;
    prey.lastCombatTime = now;

    // Add prey's score to predator
    this.growPlayer(predator, prey.score);

    // Convert prey to spectator (no player-to-player money transfer)
    prey.isSpectator = true;
    prey.inputVector = { x: 0, y: 0 };
    prey.velocity = { x: 0, y: 0 };

    const preyWs = this.clients.get(prey.id);
    if (preyWs) {
      this.send(preyWs, {
        type: 'ELIMINATED',
        payload: {
          killerName: predator.name,
          score: prey.score,
          isSpectating: true,
          timeRemaining: Math.max(0, ROUND_DURATION - (Date.now() - this.roundStartTime))
        }
      });
    }

    log(`${predator.name} eliminated ${prey.name} in stake room ${this.id} - prey now spectating`, 'room');
    
    // Check if only one active player remains
    const activePlayers = Array.from(this.gameState.players.values()).filter(p => !p.isSpectator);
    if (activePlayers.length <= 1) {
      // End round early if only one player left
      this.endRound();
    }
  }

  protected broadcastState() {
    if (this.roundState !== 'PLAYING') return;

    const playersArray = Array.from(this.gameState.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      radius: p.radius,
      color: p.color,
      score: p.score,
      balance: p.balance,
      isSpectator: p.isSpectator,
      isBoosting: p.isBoosting
    }));

    const timeRemaining = Math.max(0, ROUND_DURATION - (Date.now() - this.roundStartTime));

    const stateMessage: ServerMessage = {
      type: 'STATE',
      payload: {
        players: playersArray,
        roundState: this.roundState,
        timeRemaining,
        prizePool: this.prizePool
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

  private broadcastRoundStatus() {
    const status = {
      roundState: this.roundState,
      playerCount: this.lobbyPlayers.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      prizePool: this.lobbyPlayers.size * PRIZE_CONTRIBUTION,
      countdownRemaining: this.roundState === 'COUNTDOWN' 
        ? Math.max(0, COUNTDOWN_DURATION - (Date.now() - this.countdownStartTime))
        : 0,
      prizes: { first: PRIZE_1ST, second: PRIZE_2ND, third: PRIZE_3RD }
    };

    // Broadcast to lobby players
    this.lobbyPlayers.forEach(({ ws }) => {
      this.send(ws, {
        type: 'ROUND_STATUS',
        payload: status
      });
    });

    // Broadcast to game clients (for spectators)
    this.clients.forEach(ws => {
      this.send(ws, {
        type: 'ROUND_STATUS',
        payload: status
      });
    });
  }
}

export class GameServer {
  private wss: WebSocketServer;
  private freeRooms: Map<string, GameRoom> = new Map();
  private stakeRooms: Map<string, StakeGameRoom> = new Map();
  private playerToRoom: Map<string, string> = new Map();
  private playerStakeMode: Map<string, boolean> = new Map();
  private roomIdCounter: number = 0;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    
    this.createRoom(false);
    this.createStakeRoom();

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
    const pool = this.freeRooms;
    this.roomIdCounter++;
    const roomId = `free-room-${this.roomIdCounter}`;
    const room = new GameRoom(roomId, false);
    pool.set(roomId, room);
    return room;
  }

  private createStakeRoom(): StakeGameRoom {
    this.roomIdCounter++;
    const roomId = `stake-room-${this.roomIdCounter}`;
    const room = new StakeGameRoom(roomId);
    this.stakeRooms.set(roomId, room);
    return room;
  }

  private getTotalRoomCount(): number {
    return this.freeRooms.size + this.stakeRooms.size;
  }

  private findAvailableRoom(isStakeMode: boolean): GameRoom | StakeGameRoom | null {
    if (isStakeMode) {
      // For stake mode, find a room in LOBBY state
      for (const room of this.stakeRooms.values()) {
        if (!room.isFull() && (room.getRoundState() === 'LOBBY' || room.getRoundState() === 'COUNTDOWN')) {
          return room;
        }
      }
      
      // Create new stake room if needed
      if (this.getTotalRoomCount() < MAX_ROOMS) {
        return this.createStakeRoom();
      }
      
      return null;
    }

    // For free mode
    for (const room of this.freeRooms.values()) {
      if (!room.isFull()) {
        return room;
      }
    }
    
    if (this.getTotalRoomCount() < MAX_ROOMS) {
      return this.createRoom(false);
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

  private handleJoin(playerId: string, ws: WebSocket, payload: { name: string; isStakeMode?: boolean; walletAddress?: string; playerColor?: string }) {
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

  private getRoom(playerId: string): GameRoom | StakeGameRoom | undefined {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return undefined;
    const isStakeMode = this.playerStakeMode.get(playerId) ?? false;
    if (isStakeMode) {
      return this.stakeRooms.get(roomId);
    }
    return this.freeRooms.get(roomId);
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
    // Only cleanup free rooms, keep at least one stake room
    if (this.freeRooms.size <= 1) return;
    
    const entries = Array.from(this.freeRooms.entries());
    for (const [roomId, room] of entries) {
      const playersInRoom = Array.from(this.playerToRoom.values()).filter(r => r === roomId).length;
      if (room.isEmpty() && room.getClientCount() === 0 && playersInRoom === 0 && this.freeRooms.size > 1) {
        room.stopGameLoop();
        this.freeRooms.delete(roomId);
        log(`Room ${roomId} removed (no players or clients)`, 'room');
        break;
      }
    }
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

  getRoomStats(): { id: string; players: number; maxPlayers: number; isStakeMode: boolean; roundState?: RoundState }[] {
    const stats: { id: string; players: number; maxPlayers: number; isStakeMode: boolean; roundState?: RoundState }[] = [];
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
        isStakeMode: true,
        roundState: room.getRoundState()
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
