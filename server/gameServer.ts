import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { log } from './index';
import { balanceService } from './balanceService';
import { containsProfanity } from './profanityFilter';

const VALID_SHAPES: CharacterShape[] = ['circle', 'triangle', 'square'];
const VALID_COLORS = ['#D40046', '#00CC7A', '#00A3CC', '#A300CC', '#CCCC00', '#FF69B4'];
const MAX_NAME_LENGTH = 10;
const MAX_WS_MESSAGE_SIZE = 512;
const WS_FLOOD_WINDOW_MS = 1000;
const WS_FLOOD_MAX_MESSAGES = 60;
const WS_MAX_CONNECTIONS_PER_IP = 5;

interface Point {
  x: number;
  y: number;
}

type CharacterShape = 'circle' | 'triangle' | 'square';

interface Player {
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
  knockbackVelocity: Point;
  walletAddress?: string;
  balance: number;
  lastCombatTime: number;
  inputVector: Point;
  isSpectator: boolean;
  isStunned: boolean;
  stunEndTime: number;
  stunAttackerId: string | null;
  lastStunDamageTime: number;
  facingAngle: number;
  lastAbilityTime: number;
  kills: number;
  supercharged: boolean;
}

type PickupType = 'HP' | 'CHARGE';

interface Pickup {
  id: string;
  x: number;
  y: number;
  radius: number;
  type: PickupType;
  value: number;
}

interface Projectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  damage: number;
  spawnTime: number;
  lifespan: number;
  radius: number;
  color: string;
  trackingDisabledUntil: number;
}

interface GameState {
  players: Map<string, Player>;
  pickups: Pickup[];
}

type AbilityType = 'ABILITY_1' | 'ABILITY_2';

interface ClientMessage {
  type: 'JOIN' | 'INPUT' | 'LEAVE' | 'ABILITY';
  payload: any;
}

interface ServerMessage {
  type: 'STATE' | 'JOINED' | 'ELIMINATED' | 'PLAYER_LEFT' | 'ERROR' | 'ROOM_INFO' | 'PICKUP_DELTA' | 'ROUND_STATUS' | 'ROUND_END' | 'DAMAGE' | 'ABILITY_EFFECT' | 'KILL' | 'HEAL';
  payload: any;
}

type RoundState = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ENDED';

const WORLD_SIZE = 4000;
const INITIAL_RADIUS = 20;
const MAX_SPEED = 4.69;
const PICKUP_COUNT = 400;
const MAX_PLAYERS_PER_ROOM = 10;
const MAX_ROOMS = 10;
const TICK_RATE = 30;
const COMBAT_COOLDOWN = 3000;

const INITIAL_HP = 100;
const MAX_HP = 200;
const INITIAL_CHARGE = 0;
const MAX_CHARGE = 150;
const HP_PICKUP_VALUE = 7;
const CHARGE_PICKUP_VALUE = 11;

const ABILITY_CHARGE_COST = 20;
const ABILITY_COOLDOWN = 450;
const MISSILE_COOLDOWN = 700;
const PULL_COOLDOWN = 0;
const ABILITY_RANGE = 400;
const CIRCLE_ABILITY_RANGE = ABILITY_RANGE * 0.7;
const ABILITY_DAMAGE = 25;
const PROJECTILE_RANGE = 1200;
const DASH_DISTANCE = 240;
const LOCK_ON_ANGLE = 22.5 * (Math.PI / 180); // 22.5 degrees in radians (half of missile lock-on)
const BOT_COUNT = 2;
const STUN_DURATION = 1500;
const PROJECTILE_SPEED = 9;
const MISSILE_LIFESPAN = 7000;
const MISSILE_TURN_RATE = 0.09;
const MISSILE_RADIUS = 25;
const ENEMY_SCAN_RANGE = 800;
const SQUARE_AURA_RADIUS = 250;
const SQUARE_AURA_MISSILE_SLOW = 0.5;
const SQUARE_AURA_PLAYER_SLOW = 0.75;
const SQUARE_AURA_TIMER_SLOW = 0.7;

// Stake mode constants
const ENTRY_FEE = 1.00;
const PLATFORM_FEE = 0.10;
const PRIZE_CONTRIBUTION = 0.90;
const ROUND_DURATION = 180000; // 3 minutes in ms
const COUNTDOWN_DURATION = 3000; // 3 seconds
const PRIZE_1ST = 4.00;
const PRIZE_2ND = 3.00;
const PRIZE_3RD = 2.00;
const TOTAL_PRIZE_POOL = PRIZE_1ST + PRIZE_2ND + PRIZE_3RD; // $9.00

const BOT_NAMES = ['Orby', 'Cosmo', 'Nebula', 'Quasar', 'Nova', 'Comet', 'Astro', 'Lunar'];
const BOT_SHAPES: CharacterShape[] = ['circle', 'triangle', 'square'];
const BOT_COLORS = ['#D40046', '#00CC7A', '#00A3CC', '#A300CC', '#CCCC00', '#FF69B4'];

interface BotState {
  id: string;
  targetX: number;
  targetY: number;
  wanderTimer: number;
  chaseTargetId: string | null;
  lastAbilityTime: number;
  behaviorMode: 'wander' | 'chase' | 'flee' | 'collect' | 'strafe' | 'dodge';
  nearestPickupId: string | null;
  strafeDir: number;
  strafeTimer: number;
  aggressionLevel: number;
}

class GameRoom {
  id: string;
  isStakeMode: boolean;
  protected gameState: GameState;
  protected clients: Map<string, WebSocket> = new Map();
  protected tickInterval: NodeJS.Timeout | null = null;
  protected spawnedPickups: Pickup[] = [];
  protected collectedPickupIds: string[] = [];
  protected botStates: Map<string, BotState> = new Map();
  protected botIds: Set<string> = new Set();
  protected comboTrackers: Map<string, { hits: number; lastHitTime: number }> = new Map();
  protected projectiles: Projectile[] = [];
  trainingMode: boolean = false;
  private dummyIds: Set<string> = new Set();

  constructor(id: string, isStakeMode: boolean = false) {
    this.id = id;
    this.isStakeMode = isStakeMode;
    this.gameState = {
      players: new Map(),
      pickups: []
    };
    this.initPickups();
    this.startGameLoop();
    log(`Game room ${id} created (${isStakeMode ? 'stake' : 'free'} mode)`, 'room');

  }

  private botsActive = false;

  private createBotPlayer(botId: string, idx: number): Player {
    const shape = BOT_SHAPES[idx % BOT_SHAPES.length];
    const color = BOT_COLORS[idx % BOT_COLORS.length];
    const name = BOT_NAMES[idx % BOT_NAMES.length];
    const angle = (idx / BOT_COUNT) * Math.PI * 2;
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;
    const spread = 800 + Math.random() * 400;

    const player: Player = {
      id: botId,
      name,
      x: cx + Math.cos(angle) * spread,
      y: cy + Math.sin(angle) * spread,
      radius: INITIAL_RADIUS,
      color,
      score: 0,
      hp: INITIAL_HP,
      maxHp: MAX_HP,
      charge: INITIAL_CHARGE,
      maxCharge: MAX_CHARGE,
      characterShape: shape,
      velocity: { x: 0, y: 0 },
      knockbackVelocity: { x: 0, y: 0 },
      balance: 0,
      lastCombatTime: 0,
      inputVector: { x: 0, y: 0 },
      isSpectator: false,
      isStunned: false,
      stunEndTime: 0,
      stunAttackerId: null,
      lastStunDamageTime: 0,
      facingAngle: Math.random() * Math.PI * 2,
      lastAbilityTime: 0,
      kills: 0,
      supercharged: false
    };

    this.updatePlayerRadius(player);
    return player;
  }

  protected activateBots() {
    if (this.botsActive || this.isStakeMode || this.trainingMode) return;

    for (let i = 0; i < BOT_COUNT; i++) {
      const botId = `bot-${this.id}-${i}`;
      this.botIds.add(botId);

      const player = this.createBotPlayer(botId, i);
      this.gameState.players.set(botId, player);

      this.botStates.set(botId, {
        id: botId,
        targetX: Math.random() * WORLD_SIZE,
        targetY: Math.random() * WORLD_SIZE,
        wanderTimer: 0,
        chaseTargetId: null,
        lastAbilityTime: 0,
        behaviorMode: 'wander',
        nearestPickupId: null,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        strafeTimer: 0,
        aggressionLevel: 0.4 + Math.random() * 0.5,
      });
    }
    this.botsActive = true;
    log(`Activated ${BOT_COUNT} bots in room ${this.id}`, 'room');
  }

  protected deactivateBots() {
    if (!this.botsActive) return;

    for (const botId of this.botIds) {
      this.gameState.players.delete(botId);
      this.botStates.delete(botId);
    }
    this.botIds.clear();
    this.botsActive = false;
    log(`Deactivated bots in room ${this.id}`, 'room');
  }

  enableTrainingMode() {
    this.trainingMode = true;
    this.deactivateBots();
    this.removeDummies();

    const shapes: CharacterShape[] = ['circle', 'triangle', 'square'];
    const colors = ['#FF4444', '#44FF44', '#4444FF'];
    const names = ['Circle Dummy', 'Triangle Dummy', 'Square Dummy'];
    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;

    for (let i = 0; i < 3; i++) {
      const dummyId = `dummy-${this.id}-${shapes[i]}`;
      const angle = (i / 3) * Math.PI * 2;
      const spread = 400;

      const player: Player = {
        id: dummyId,
        name: names[i],
        x: cx + Math.cos(angle) * spread,
        y: cy + Math.sin(angle) * spread,
        radius: INITIAL_RADIUS,
        color: colors[i],
        score: 0,
        hp: INITIAL_HP,
        maxHp: MAX_HP,
        charge: 0,
        maxCharge: MAX_CHARGE,
        characterShape: shapes[i],
        velocity: { x: 0, y: 0 },
        knockbackVelocity: { x: 0, y: 0 },
        balance: 0,
        lastCombatTime: 0,
        inputVector: { x: 0, y: 0 },
        isSpectator: false,
        isStunned: false,
        stunEndTime: 0,
        stunAttackerId: null,
        lastStunDamageTime: 0,
        facingAngle: angle + Math.PI,
        lastAbilityTime: 0,
        kills: 0,
        supercharged: false
      };

      this.updatePlayerRadius(player);
      this.gameState.players.set(dummyId, player);
      this.dummyIds.add(dummyId);
    }

    log(`Training mode enabled in room ${this.id} - spawned 3 dummies`, 'room');
  }

  disableTrainingMode() {
    this.trainingMode = false;
    this.removeDummies();

    if (this.getHumanPlayerCount() > 0 && !this.isStakeMode) {
      this.activateBots();
    }

    log(`Training mode disabled in room ${this.id}`, 'room');
  }

  private removeDummies() {
    for (const dummyId of this.dummyIds) {
      this.gameState.players.delete(dummyId);
    }
    this.dummyIds.clear();
  }

  private respawnDummy(dummyId: string) {
    if (!this.trainingMode || !this.dummyIds.has(dummyId)) return;

    this.gameState.players.delete(dummyId);

    const shapes: CharacterShape[] = ['circle', 'triangle', 'square'];
    const colors = ['#FF4444', '#44FF44', '#4444FF'];
    const names = ['Circle Dummy', 'Triangle Dummy', 'Square Dummy'];
    const shapeIndex = shapes.findIndex(s => dummyId.endsWith(s));
    if (shapeIndex === -1) return;

    const cx = WORLD_SIZE / 2;
    const cy = WORLD_SIZE / 2;
    const angle = (shapeIndex / 3) * Math.PI * 2;
    const spread = 400;

    setTimeout(() => {
      if (!this.trainingMode || !this.dummyIds.has(dummyId)) return;

      const player: Player = {
        id: dummyId,
        name: names[shapeIndex],
        x: cx + Math.cos(angle) * spread,
        y: cy + Math.sin(angle) * spread,
        radius: INITIAL_RADIUS,
        color: colors[shapeIndex],
        score: 0,
        hp: INITIAL_HP,
        maxHp: MAX_HP,
        charge: 0,
        maxCharge: MAX_CHARGE,
        characterShape: shapes[shapeIndex],
        velocity: { x: 0, y: 0 },
        knockbackVelocity: { x: 0, y: 0 },
        balance: 0,
        lastCombatTime: 0,
        inputVector: { x: 0, y: 0 },
        isSpectator: false,
        isStunned: false,
        stunEndTime: 0,
        stunAttackerId: null,
        lastStunDamageTime: 0,
        facingAngle: angle + Math.PI,
        lastAbilityTime: 0,
        kills: 0,
        supercharged: false
      };

      this.updatePlayerRadius(player);
      this.gameState.players.set(dummyId, player);
    }, 1500);
  }

  isDummy(playerId: string): boolean {
    return this.dummyIds.has(playerId);
  }

  private respawnBot(botId: string) {
    const botState = this.botStates.get(botId);
    if (!botState) return;

    this.gameState.players.delete(botId);

    const idx = Array.from(this.botIds).indexOf(botId);

    setTimeout(() => {
      if (!this.botsActive || !this.botIds.has(botId)) return;
      const player = this.createBotPlayer(botId, idx);
      this.gameState.players.set(botId, player);

      botState.targetX = Math.random() * WORLD_SIZE;
      botState.targetY = Math.random() * WORLD_SIZE;
      botState.wanderTimer = 0;
      botState.chaseTargetId = null;
      botState.behaviorMode = 'wander';
      botState.nearestPickupId = null;
      botState.strafeDir = Math.random() < 0.5 ? 1 : -1;
      botState.strafeTimer = 0;
    }, 1000);
  }

  protected updateBots() {
    if (!this.botsActive) return;

    if (this.clients.size === 0) {
      this.deactivateBots();
      return;
    }

    const now = Date.now();

    for (const botId of this.botIds) {
      const player = this.gameState.players.get(botId);
      const botState = this.botStates.get(botId);
      if (!botState) continue;

      if (!player) continue;
      if (player.hp <= 0) {
        this.respawnBot(botId);
        continue;
      }

      if (player.isStunned) continue;

      let nearestEnemy: Player | null = null;
      let nearestEnemyDist = Infinity;
      let secondEnemy: Player | null = null;
      let secondEnemyDist = Infinity;

      let nearestHuman: Player | null = null;
      let nearestHumanDist = Infinity;

      this.gameState.players.forEach(other => {
        if (other.id === botId || other.isSpectator) return;
        const dx = other.x - player.x;
        const dy = other.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isBot = this.botIds.has(other.id);
        if (!isBot && dist < nearestHumanDist) {
          nearestHumanDist = dist;
          nearestHuman = other;
        }
        if (dist < nearestEnemyDist) {
          secondEnemy = nearestEnemy;
          secondEnemyDist = nearestEnemyDist;
          nearestEnemyDist = dist;
          nearestEnemy = other;
        } else if (dist < secondEnemyDist) {
          secondEnemyDist = dist;
          secondEnemy = other;
        }
      });

      const targetIsBot = nearestEnemy ? this.botIds.has(nearestEnemy.id) : false;
      if (nearestHuman && nearestHumanDist < ENEMY_SCAN_RANGE * 1.5) {
        nearestEnemy = nearestHuman;
        nearestEnemyDist = nearestHumanDist;
      } else if (targetIsBot && nearestEnemyDist > ABILITY_RANGE * 0.8) {
        nearestEnemy = null;
        nearestEnemyDist = Infinity;
      }

      let nearestMissileDist = Infinity;
      let nearestMissileAngle = 0;
      for (const proj of this.projectiles) {
        if (proj.ownerId === botId) continue;
        const dx = proj.x - player.x;
        const dy = proj.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestMissileDist) {
          nearestMissileDist = dist;
          nearestMissileAngle = Math.atan2(dy, dx);
        }
      }

      let separationX = 0;
      let separationY = 0;
      this.gameState.players.forEach(other => {
        if (other.id === botId || other.isSpectator) return;
        const dx = player.x - other.x;
        const dy = player.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minSep = player.radius + other.radius + 30;
        if (dist < minSep && dist > 0) {
          separationX += (dx / dist) * 0.5;
          separationY += (dy / dist) * 0.5;
        }
      });

      const needsHp = player.hp < 100;
      const lowHp = player.hp < 50;
      const hasCharge = player.charge >= ABILITY_CHARGE_COST;
      const lowCharge = player.charge < ABILITY_CHARGE_COST;
      const aggro = botState.aggressionLevel;

      let preferredPickup: Pickup | null = null;
      let preferredPickupDist = Infinity;
      const wantsPickup = needsHp || lowCharge || player.charge < player.maxCharge * 0.4;
      if (wantsPickup) {
        const preferType: PickupType = needsHp ? 'HP' : 'CHARGE';
        for (const pickup of this.gameState.pickups) {
          if (pickup.type !== preferType) continue;
          const dx = pickup.x - player.x;
          const dy = pickup.y - player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < preferredPickupDist) {
            preferredPickupDist = dist;
            preferredPickup = pickup;
          }
        }
      }

      if (nearestMissileDist < 200) {
        botState.behaviorMode = 'dodge';
      } else if (lowHp && nearestEnemy && nearestEnemyDist < 400) {
        botState.behaviorMode = 'flee';
      } else if (lowCharge && preferredPickup && preferredPickupDist < 1000) {
        botState.behaviorMode = 'collect';
      } else if (nearestEnemy && nearestEnemyDist < ABILITY_RANGE * 1.5 && hasCharge) {
        botState.behaviorMode = 'strafe';
        botState.chaseTargetId = nearestEnemy.id;
      } else if (nearestEnemy && nearestEnemyDist < ENEMY_SCAN_RANGE * aggro && hasCharge) {
        botState.behaviorMode = 'chase';
        botState.chaseTargetId = nearestEnemy.id;
      } else if (needsHp && preferredPickup && preferredPickupDist < 600) {
        botState.behaviorMode = 'collect';
      } else if (preferredPickup && preferredPickupDist < 400) {
        botState.behaviorMode = 'collect';
      } else if (nearestEnemy && nearestEnemyDist < ENEMY_SCAN_RANGE && hasCharge) {
        botState.behaviorMode = 'chase';
        botState.chaseTargetId = nearestEnemy.id;
      } else if (preferredPickup) {
        botState.behaviorMode = 'collect';
      } else {
        botState.behaviorMode = 'wander';
      }

      let moveX = 0;
      let moveY = 0;

      switch (botState.behaviorMode) {
        case 'wander': {
          botState.wanderTimer--;
          if (botState.wanderTimer <= 0) {
            botState.targetX = 300 + Math.random() * (WORLD_SIZE - 600);
            botState.targetY = 300 + Math.random() * (WORLD_SIZE - 600);
            botState.wanderTimer = 60 + Math.floor(Math.random() * 90);
          }
          const dx = botState.targetX - player.x;
          const dy = botState.targetY - player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 10) {
            moveX = dx / dist;
            moveY = dy / dist;
          }
          break;
        }
        case 'chase': {
          if (nearestEnemy) {
            const dx = nearestEnemy.x - player.x;
            const dy = nearestEnemy.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 10) {
              moveX = dx / dist;
              moveY = dy / dist;
            }

            if (player.characterShape === 'triangle' && hasCharge && dist < 1000 && now - botState.lastAbilityTime > 800) {
              player.facingAngle = Math.atan2(dy, dx);
              this.executeAbility(player, 'ABILITY_2');
              botState.lastAbilityTime = now;
            }
          }
          break;
        }
        case 'strafe': {
          if (nearestEnemy) {
            const dx = nearestEnemy.x - player.x;
            const dy = nearestEnemy.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            botState.strafeTimer--;
            if (botState.strafeTimer <= 0) {
              botState.strafeDir *= -1;
              botState.strafeTimer = 20 + Math.floor(Math.random() * 40);
            }

            const perpX = -dy / dist * botState.strafeDir;
            const perpY = dx / dist * botState.strafeDir;

            const idealDist = ABILITY_RANGE * 0.7;
            const approachFactor = (dist - idealDist) / idealDist;
            const clampedApproach = Math.max(-0.5, Math.min(1, approachFactor));

            moveX = perpX * 0.7 + (dx / dist) * clampedApproach * 0.5;
            moveY = perpY * 0.7 + (dy / dist) * clampedApproach * 0.5;

            const abilityCooldown = player.characterShape === 'triangle' ? 800 : 1200;
            if (hasCharge && now - botState.lastAbilityTime > abilityCooldown) {
              if (dist < ABILITY_RANGE + 50) {
                let abilityType: AbilityType;
                if (player.characterShape === 'circle') {
                  abilityType = dist < ABILITY_RANGE * 0.5 ? 'ABILITY_2' : 'ABILITY_1';
                } else if (player.characterShape === 'triangle') {
                  abilityType = 'ABILITY_2';
                } else {
                  abilityType = Math.random() < 0.6 ? 'ABILITY_2' : 'ABILITY_1';
                }
                player.facingAngle = Math.atan2(dy, dx);
                this.executeAbility(player, abilityType);
                botState.lastAbilityTime = now;
              } else if (player.characterShape === 'triangle' && dist < 1000) {
                player.facingAngle = Math.atan2(dy, dx);
                this.executeAbility(player, 'ABILITY_2');
                botState.lastAbilityTime = now;
              }
            }

            if (player.characterShape === 'triangle' && hasCharge && dist > ABILITY_RANGE && dist < DASH_DISTANCE * 2 && now - botState.lastAbilityTime > 600) {
              player.facingAngle = Math.atan2(dy, dx);
              this.executeAbility(player, 'ABILITY_1');
              botState.lastAbilityTime = now;
            }
          }
          break;
        }
        case 'dodge': {
          const dodgeAngle = nearestMissileAngle + Math.PI / 2 * botState.strafeDir;
          moveX = Math.cos(dodgeAngle);
          moveY = Math.sin(dodgeAngle);

          if (player.characterShape === 'square' && hasCharge && nearestMissileDist < 150 && now - botState.lastAbilityTime > 600) {
            player.facingAngle = nearestMissileAngle;
            this.executeAbility(player, 'ABILITY_1');
            botState.lastAbilityTime = now;
          }
          if (player.characterShape === 'circle' && hasCharge && nearestMissileDist < 120 && now - botState.lastAbilityTime > 600) {
            this.executeAbility(player, 'ABILITY_2');
            botState.lastAbilityTime = now;
          }
          break;
        }
        case 'flee': {
          if (nearestEnemy) {
            const dx = player.x - nearestEnemy.x;
            const dy = player.y - nearestEnemy.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
              moveX = dx / dist;
              moveY = dy / dist;
            }

            if (player.characterShape === 'square' && hasCharge && dist < ABILITY_RANGE && now - botState.lastAbilityTime > 800) {
              player.facingAngle = Math.atan2(nearestEnemy.y - player.y, nearestEnemy.x - player.x);
              this.executeAbility(player, 'ABILITY_1');
              botState.lastAbilityTime = now;
            }
            if (player.characterShape === 'triangle' && hasCharge && now - botState.lastAbilityTime > 600) {
              this.executeAbility(player, 'ABILITY_1');
              botState.lastAbilityTime = now;
            }
          }
          break;
        }
        case 'collect': {
          if (preferredPickup) {
            const dx = preferredPickup.x - player.x;
            const dy = preferredPickup.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 5) {
              moveX = dx / dist;
              moveY = dy / dist;
            }
            if (nearestEnemy && nearestEnemyDist < ABILITY_RANGE && hasCharge && now - botState.lastAbilityTime > 1000) {
              player.facingAngle = Math.atan2(nearestEnemy.y - player.y, nearestEnemy.x - player.x);
              const abilityType: AbilityType = player.characterShape === 'square' ? 'ABILITY_1' : 'ABILITY_2';
              this.executeAbility(player, abilityType);
              botState.lastAbilityTime = now;
            }
          }
          break;
        }
      }

      moveX += separationX;
      moveY += separationY;

      const len = Math.sqrt(moveX * moveX + moveY * moveY);
      if (len > 1) {
        moveX /= len;
        moveY /= len;
      }

      player.inputVector = { x: moveX, y: moveY };
      if (moveX !== 0 || moveY !== 0) {
        player.facingAngle = Math.atan2(moveY, moveX);
      }
    }
  }

  protected initPickups() {
    const hpCount = Math.floor(PICKUP_COUNT * 0.5);
    const chargeCount = PICKUP_COUNT - hpCount;
    
    const gridSize = Math.ceil(Math.sqrt(PICKUP_COUNT));
    const cellSize = WORLD_SIZE / gridSize;
    let count = 0;
    
    const types: PickupType[] = [];
    for (let i = 0; i < hpCount; i++) types.push('HP');
    for (let i = 0; i < chargeCount; i++) types.push('CHARGE');
    
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    
    for (let row = 0; row < gridSize && count < PICKUP_COUNT; row++) {
      for (let col = 0; col < gridSize && count < PICKUP_COUNT; col++) {
        const x = col * cellSize + Math.random() * cellSize;
        const y = row * cellSize + Math.random() * cellSize;
        this.spawnPickupAt(x, y, types[count], false);
        count++;
      }
    }
  }

  protected spawnPickupAt(x: number, y: number, type: PickupType, trackDelta: boolean = true): Pickup {
    const hpValue = type === 'HP' ? (Math.random() < 0.5 ? 7 : 8) : 0;
    const pickup: Pickup = {
      id: `pickup-${Math.random().toString(36).substr(2, 9)}`,
      x,
      y,
      radius: type === 'HP' ? (hpValue === 8 ? 10 : 8) : 7,
      type,
      value: type === 'HP' ? hpValue : CHARGE_PICKUP_VALUE
    };
    this.gameState.pickups.push(pickup);
    if (trackDelta) {
      this.spawnedPickups.push(pickup);
    }
    return pickup;
  }

  protected spawnPickup(trackDelta: boolean = true): Pickup {
    const type: PickupType = Math.random() < 0.5 ? 'HP' : 'CHARGE';
    const x = Math.random() * WORLD_SIZE;
    const y = Math.random() * WORLD_SIZE;
    return this.spawnPickupAt(x, y, type, trackDelta);
  }

  protected spawnPickupOfType(type: PickupType, trackDelta: boolean = true): Pickup {
    const x = Math.random() * WORLD_SIZE;
    const y = Math.random() * WORLD_SIZE;
    return this.spawnPickupAt(x, y, type, trackDelta);
  }

  protected startGameLoop() {
    this.tickInterval = setInterval(() => {
      this.update();
      this.updateProjectiles();
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
    return this.gameState.players.size - this.botIds.size - this.dummyIds.size;
  }

  getHumanPlayerCount(): number {
    return this.gameState.players.size - this.botIds.size - this.dummyIds.size;
  }

  isFull(): boolean {
    if (this.trainingMode) {
      return this.getHumanPlayerCount() >= 1;
    }
    return this.getHumanPlayerCount() >= MAX_PLAYERS_PER_ROOM;
  }

  isEmpty(): boolean {
    return this.getHumanPlayerCount() === 0;
  }

  isBot(playerId: string): boolean {
    return this.botIds.has(playerId);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  addPlayer(playerId: string, ws: WebSocket, payload: { name: string; walletAddress?: string; playerColor?: string; characterShape?: CharacterShape }): boolean {
    if (this.isFull()) {
      return false;
    }

    const defaultColors = ['#D40046', '#00CC7A', '#00A3CC', '#A300CC', '#CCCC00', '#FF69B4', '#00FFFF'];
    const player: Player = {
      id: playerId,
      name: payload.name || 'Anonymous',
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      radius: INITIAL_RADIUS,
      color: payload.playerColor || defaultColors[Math.floor(Math.random() * defaultColors.length)],
      score: 0,
      hp: INITIAL_HP,
      maxHp: MAX_HP,
      charge: INITIAL_CHARGE,
      maxCharge: MAX_CHARGE,
      characterShape: payload.characterShape || 'circle',
      velocity: { x: 0, y: 0 },
      knockbackVelocity: { x: 0, y: 0 },
      walletAddress: payload.walletAddress,
      balance: 0,
      lastCombatTime: 0,
      inputVector: { x: 0, y: 0 },
      isSpectator: false,
      isStunned: false,
      stunEndTime: 0,
      stunAttackerId: null,
      lastStunDamageTime: 0,
      facingAngle: 0,
      kills: 0,
      supercharged: false
    };

    // Set initial radius based on HP
    this.updatePlayerRadius(player);

    this.gameState.players.set(playerId, player);
    this.clients.set(playerId, ws);

    if (!this.isStakeMode && !this.botsActive) {
      this.activateBots();
    }

    if (this.trainingMode) {
      player.charge = MAX_CHARGE;
    }

    this.send(ws, {
      type: 'JOINED',
      payload: { playerId, player, roomId: this.id, pickups: this.gameState.pickups }
    });

    this.send(ws, {
      type: 'ROOM_INFO',
      payload: { roomId: this.id, playerCount: this.getPlayerCount(), maxPlayers: MAX_PLAYERS_PER_ROOM }
    });

    log(`Player ${payload.name} (${playerId}) joined room ${this.id}. Room total: ${this.getHumanPlayerCount()}`, 'room');
    return true;
  }

  handleInput(playerId: string, payload: { x: number; y: number; facingAngle?: number }) {
    const player = this.gameState.players.get(playerId);
    if (!player || player.isSpectator || player.isStunned) return;

    const length = Math.sqrt(payload.x * payload.x + payload.y * payload.y);
    if (length > 1) {
      payload.x /= length;
      payload.y /= length;
    }
    player.inputVector = { x: payload.x, y: payload.y };
    if (typeof payload.facingAngle === 'number' && isFinite(payload.facingAngle)) {
      player.facingAngle = Math.atan2(Math.sin(payload.facingAngle), Math.cos(payload.facingAngle));
    } else if (length > 0.1) {
      player.facingAngle = Math.atan2(payload.y, payload.x);
    }
  }

  handleAbility(playerId: string, abilityType: AbilityType, held?: boolean) {
    const player = this.gameState.players.get(playerId);
    if (!player || player.isSpectator || player.isStunned) return;
    
    this.executeAbility(player, abilityType, held);
  }

  protected executeAbility(player: Player, abilityType: AbilityType, held?: boolean) {
    const isPull = player.characterShape === 'circle' && abilityType === 'ABILITY_1';
    const isMissile = player.characterShape === 'triangle' && abilityType === 'ABILITY_2';
    const cooldown = isPull ? PULL_COOLDOWN : isMissile ? MISSILE_COOLDOWN : ABILITY_COOLDOWN;
    const now = Date.now();

    if (cooldown > 0 && now - player.lastAbilityTime < cooldown) return;

    const chargeCost = isPull ? (held ? 7 : 20) : ABILITY_CHARGE_COST;
    
    if (!this.useCharge(player, chargeCost)) {
      const ws = this.clients.get(player.id);
      if (ws) {
        this.send(ws, { type: 'ERROR', payload: { message: 'Not enough charge' } });
      }
      return;
    }

    player.lastAbilityTime = now;

    const shape = player.characterShape;
    let abilityName = '';
    
    if (shape === 'circle') {
      if (abilityType === 'ABILITY_1') {
        abilityName = 'PULL';
        this.executePull(player, held);
      } else {
        abilityName = 'SLAM';
        this.executeSlam(player);
      }
    } else if (shape === 'triangle') {
      if (abilityType === 'ABILITY_1') {
        abilityName = 'DASH';
        this.executeDash(player);
      } else {
        abilityName = 'PIERCE';
        this.executePierce(player);
        return; // Pierce handles its own broadcast and damage timing
      }
    } else if (shape === 'square') {
      if (abilityType === 'ABILITY_1') {
        abilityName = 'PUSH';
        this.executePush(player);
      } else {
        abilityName = 'STUN_WAVE';
        this.executeStunWave(player);
      }
    }

    this.broadcast({
      type: 'ABILITY_EFFECT',
      payload: {
        playerId: player.id,
        ability: abilityName,
        x: player.x,
        y: player.y,
        angle: player.facingAngle
      }
    });
  }

  protected executePull(player: Player, held?: boolean) {
    const pullStrength = held ? 25 : 45;
    const pullRange = CIRCLE_ABILITY_RANGE * 1.5;
    this.gameState.players.forEach(other => {
      if (other.id === player.id || other.isSpectator) return;
      
      const dx = player.x - other.x;
      const dy = player.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < pullRange && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const distRatio = 1 - (dist / pullRange);
        const force = pullStrength * (0.3 + distRatio * 0.7);
        other.knockbackVelocity.x += nx * force;
        other.knockbackVelocity.y += ny * force;
      }
    });
  }

  protected executeSlam(player: Player) {
    const range = player.supercharged ? CIRCLE_ABILITY_RANGE * 1.25 : CIRCLE_ABILITY_RANGE;
    const damageMult = player.supercharged ? 1.5 : 1.0;

    this.gameState.players.forEach(other => {
      if (other.id === player.id || other.isSpectator) return;
      
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < range) {
        const distRatio = dist / range;
        const damage = Math.floor((50 - distRatio * 30) * damageMult);
        this.damagePlayer(player, other, damage);
      }
    });

    const toDetonate: number[] = [];
    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const dx = proj.x - player.x;
      const dy = proj.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < range) {
        this.explodeProjectile(proj);
        toDetonate.push(i);
      }
    }
    for (let i = toDetonate.length - 1; i >= 0; i--) {
      this.projectiles.splice(toDetonate[i], 1);
    }
  }

  protected executeDash(player: Player) {
    let angle = player.facingAngle;
    
    // Lock-on logic
    let closestTarget: Player | null = null;
    let minAngleDiff = LOCK_ON_ANGLE;

    this.gameState.players.forEach(other => {
      if (other.id === player.id || other.isSpectator) return;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > DASH_DISTANCE * 2) return;

      const angleToTarget = Math.atan2(dy, dx);
      let diff = Math.abs(angle - angleToTarget);
      while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

      if (diff < minAngleDiff) {
        minAngleDiff = diff;
        closestTarget = other;
      }
    });

    if (closestTarget) {
      angle = Math.atan2(closestTarget.y - player.y, closestTarget.x - player.x);
      player.facingAngle = angle; // Update player's facing angle to visually point at target
    }

    const startX = player.x;
    const startY = player.y;

    player.x += Math.cos(angle) * DASH_DISTANCE;
    player.y += Math.sin(angle) * DASH_DISTANCE;
    player.x = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.x));
    player.y = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.y));

    const endX = player.x;
    const endY = player.y;
    const segDx = endX - startX;
    const segDy = endY - startY;
    const segLenSq = segDx * segDx + segDy * segDy;

    this.gameState.players.forEach(other => {
      if (other.id === player.id || other.isSpectator) return;

      // Closest point on the dash segment to this opponent
      const t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1,
        ((other.x - startX) * segDx + (other.y - startY) * segDy) / segLenSq
      ));
      const closestX = startX + t * segDx;
      const closestY = startY + t * segDy;
      const dx = other.x - closestX;
      const dy = other.y - closestY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < player.radius + other.radius + 20) {
        this.damagePlayer(player, other, 30);
      }
    });

    // Stop nearby projectiles from tracking, they continue in straight line
    const now = Date.now();
    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const dx = proj.x - player.x;
      const dy = proj.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ABILITY_RANGE) {
        proj.trackingDisabledUntil = now + 3000;
      }
    }
  }

  protected executePierce(player: Player) {
    const angle = player.facingAngle;
    const projectileId = `proj_${player.id}_${Date.now()}`;

    this.projectiles.push({
      id: projectileId,
      ownerId: player.id,
      x: player.x + Math.cos(angle) * (player.radius + MISSILE_RADIUS + 5),
      y: player.y + Math.sin(angle) * (player.radius + MISSILE_RADIUS + 5),
      angle: angle,
      speed: PROJECTILE_SPEED * (player.supercharged ? 1.3 : 1),
      damage: 30,
      spawnTime: Date.now(),
      lifespan: MISSILE_LIFESPAN,
      radius: MISSILE_RADIUS,
      color: player.color,
      trackingDisabledUntil: 0
    });

    this.broadcast({
      type: 'ABILITY_EFFECT',
      payload: {
        playerId: player.id,
        ability: 'MISSILE_LAUNCH',
        projectileId,
        x: player.x,
        y: player.y,
        angle: angle
      }
    });
  }

  protected updateProjectiles() {
    const now = Date.now();
    const destroyed = new Set<number>();

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      if (destroyed.has(i)) continue;
      const age = now - proj.spawnTime;

      if (age >= proj.lifespan) {
        this.explodeProjectile(proj);
        destroyed.add(i);
        continue;
      }

      const trackingEnabled = now >= proj.trackingDisabledUntil;
      let closestEnemy: Player | null = null;
      let closestDist = Infinity;
      const lockOnCone = 45 * (Math.PI / 180);

      if (trackingEnabled) this.gameState.players.forEach(other => {
        if (other.id === proj.ownerId || other.isSpectator) return;
        const dx = other.x - proj.x;
        const dy = other.y - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angleToTarget = Math.atan2(dy, dx);
        let angleDiff = angleToTarget - proj.angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        if (Math.abs(angleDiff) > lockOnCone) return;
        if (dist < closestDist) {
          closestDist = dist;
          closestEnemy = other;
        }
      });

      if (closestEnemy) {
        const targetAngle = Math.atan2(closestEnemy.y - proj.y, closestEnemy.x - proj.x);
        let angleDiff = targetAngle - proj.angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (angleDiff > MISSILE_TURN_RATE) {
          proj.angle += MISSILE_TURN_RATE;
        } else if (angleDiff < -MISSILE_TURN_RATE) {
          proj.angle -= MISSILE_TURN_RATE;
        } else {
          proj.angle = targetAngle;
        }
      }

      let effectiveSpeed = proj.speed;
      let inAura = false;
      this.gameState.players.forEach(p => {
        if (p.isSpectator || !p.supercharged || p.characterShape !== 'square' || p.id === proj.ownerId) return;
        const dx = proj.x - p.x;
        const dy = proj.y - p.y;
        if (dx * dx + dy * dy < SQUARE_AURA_RADIUS * SQUARE_AURA_RADIUS) {
          effectiveSpeed *= SQUARE_AURA_MISSILE_SLOW;
          inAura = true;
        }
      });
      if (inAura) {
        const tickMs = (1 / TICK_RATE) * 1000;
        proj.spawnTime += tickMs * (1 - SQUARE_AURA_TIMER_SLOW);
      }
      proj.x += Math.cos(proj.angle) * effectiveSpeed;
      proj.y += Math.sin(proj.angle) * effectiveSpeed;

      if (proj.x < 0 || proj.x > WORLD_SIZE || proj.y < 0 || proj.y > WORLD_SIZE) {
        this.explodeProjectile(proj);
        destroyed.add(i);
        continue;
      }

      let hit = false;
      this.gameState.players.forEach(other => {
        if (hit || other.id === proj.ownerId || other.isSpectator) return;
        const dx = other.x - proj.x;
        const dy = other.y - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < other.radius + proj.radius) {
          hit = true;
          const owner = this.gameState.players.get(proj.ownerId);
          if (owner) {
            this.damagePlayer(owner, other, proj.damage);
          }
          this.explodeProjectile(proj);
          destroyed.add(i);
        }
      });

      if (destroyed.has(i)) continue;

      for (let j = i + 1; j < this.projectiles.length; j++) {
        if (destroyed.has(j)) continue;
        const other = this.projectiles[j];
        
        // Skip collision only if both are from same owner AND both have tracking enabled
        // Allow collision if one is coming back (tracking disabled)
        const now = Date.now();
        const projHasTracking = proj.trackingDisabledUntil <= now;
        const otherHasTracking = other.trackingDisabledUntil <= now;
        if (proj.ownerId === other.ownerId && projHasTracking && otherHasTracking) continue;
        
        const dx = other.x - proj.x;
        const dy = other.y - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < proj.radius + other.radius) {
          this.explodeProjectile(proj);
          this.explodeProjectile(other);
          destroyed.add(i);
          destroyed.add(j);
          break;
        }
      }
    }

    if (destroyed.size > 0) {
      const indices = Array.from(destroyed).sort((a, b) => b - a);
      for (const idx of indices) {
        this.projectiles.splice(idx, 1);
      }
    }
  }

  protected explodeProjectile(proj: Projectile) {
    this.broadcast({
      type: 'ABILITY_EFFECT',
      payload: {
        ability: 'MISSILE_EXPLODE',
        projectileId: proj.id,
        x: proj.x,
        y: proj.y
      }
    });
  }

  protected executePush(player: Player) {
    const pushForce = 35;
    this.gameState.players.forEach(other => {
      if (other.id === player.id || other.isSpectator) return;
      
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < ABILITY_RANGE && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const distRatio = 1 - (dist / ABILITY_RANGE);
        const force = pushForce * (0.5 + distRatio * 0.5);
        other.knockbackVelocity.x += nx * force;
        other.knockbackVelocity.y += ny * force;
        this.damagePlayer(player, other, 20);
      }
    });

    const now = Date.now();
    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const dx = proj.x - player.x;
      const dy = proj.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < ABILITY_RANGE && dist > 0) {
        const pushAngle = Math.atan2(dy, dx);
        proj.angle = pushAngle;
        proj.ownerId = player.id;
        proj.color = player.color;
        proj.trackingDisabledUntil = now + 400;
        proj.spawnTime = now;
      }
    }
  }

  protected executeStunWave(player: Player) {
    const now = Date.now();
    this.gameState.players.forEach(other => {
      if (other.id === player.id || other.isSpectator) return;
      
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < ABILITY_RANGE) {
        const distRatio = dist / ABILITY_RANGE;
        const stunDuration = Math.floor(STUN_DURATION * (1.5 - distRatio));
        other.isStunned = true;
        other.stunEndTime = now + stunDuration;
        other.stunAttackerId = player.id;
        other.lastStunDamageTime = now;
        other.velocity = { x: 0, y: 0 };
        this.damagePlayer(player, other, 20);
      }
    });

    const toDetonate: number[] = [];
    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      const dx = proj.x - player.x;
      const dy = proj.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ABILITY_RANGE) {
        this.explodeProjectile(proj);
        toDetonate.push(i);
      }
    }
    for (let i = toDetonate.length - 1; i >= 0; i--) {
      this.projectiles.splice(toDetonate[i], 1);
    }
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
    const isBot = this.botIds.has(playerId);
    const player = this.gameState.players.get(playerId);
    if (player && !isBot) {
      log(`Player ${player.name} (${playerId}) ${reason} from room ${this.id}. Room total: ${this.getHumanPlayerCount() - 1}`, 'room');
    }
    this.gameState.players.delete(playerId);
    this.clients.delete(playerId);

    this.broadcast({
      type: 'PLAYER_LEFT',
      payload: { playerId }
    });

    if (!isBot && this.clients.size === 0 && this.botsActive) {
      this.deactivateBots();
    }
  }

  protected update() {
    const dt = 1 / TICK_RATE;
    const now = Date.now();

    this.updateBots();

    this.gameState.players.forEach(player => {
      if (player.isSpectator) return;
      
      if (player.isStunned && now >= player.stunEndTime) {
        player.isStunned = false;
        player.stunAttackerId = null;
        player.velocity = { x: 0, y: 0 };
        player.inputVector = { x: 0, y: 0 };
      }
      if (player.isStunned) {
        if (now - player.lastStunDamageTime >= 1000) {
          player.lastStunDamageTime = now;
          const attacker = player.stunAttackerId ? this.gameState.players.get(player.stunAttackerId) : null;
          this.damagePlayer(attacker || null, player, 7);
        }
        return;
      }
      
      const { inputVector } = player;
      const length = Math.sqrt(inputVector.x * inputVector.x + inputVector.y * inputVector.y);
      
      if (length > 0) {
        const speedFactor = Math.max(0.5, 1 - (player.radius / 200));
        let speed = MAX_SPEED * speedFactor * (player.supercharged ? 1.3 : 1);
        this.gameState.players.forEach(p => {
          if (p.isSpectator || !p.supercharged || p.characterShape !== 'square' || p.id === player.id) return;
          const dx = player.x - p.x;
          const dy = player.y - p.y;
          if (dx * dx + dy * dy < SQUARE_AURA_RADIUS * SQUARE_AURA_RADIUS) {
            speed *= SQUARE_AURA_PLAYER_SLOW;
          }
        });
        
        player.velocity.x = (inputVector.x / length) * speed;
        player.velocity.y = (inputVector.y / length) * speed;
      } else {
        player.velocity.x = 0;
        player.velocity.y = 0;
      }

      const timeScale = dt * 60;
      player.x += player.velocity.x * timeScale;
      player.y += player.velocity.y * timeScale;
      
      if (player.knockbackVelocity.x !== 0 || player.knockbackVelocity.y !== 0) {
        player.x += player.knockbackVelocity.x * timeScale;
        player.y += player.knockbackVelocity.y * timeScale;
        player.knockbackVelocity.x *= 0.88;
        player.knockbackVelocity.y *= 0.88;
        if (Math.abs(player.knockbackVelocity.x) < 0.1 && Math.abs(player.knockbackVelocity.y) < 0.1) {
          player.knockbackVelocity.x = 0;
          player.knockbackVelocity.y = 0;
        }
      }

      player.x = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.x));
      player.y = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.y));
    });

    this.gameState.players.forEach(player => {
      if (player.isSpectator) return;
      
      for (let i = this.gameState.pickups.length - 1; i >= 0; i--) {
        const pickup = this.gameState.pickups[i];
        const dx = player.x - pickup.x;
        const dy = player.y - pickup.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < player.radius + pickup.radius + 8) {
          const collectedType = pickup.type;
          this.collectedPickupIds.push(pickup.id);
          this.gameState.pickups.splice(i, 1);
          
          if (collectedType === 'HP') {
            this.healPlayer(player, pickup.value);
            const ws = this.clients.get(player.id);
            if (ws) {
              this.send(ws, {
                type: 'HEAL',
                payload: { playerId: player.id, amount: pickup.value, currentHp: player.hp, x: player.x, y: player.y }
              });
            }
          } else {
            this.chargePlayer(player, pickup.value);
          }
          
          this.spawnPickupOfType(collectedType);
        }
      }
    });
  }

  protected handleElimination(attacker: Player | null, victim: Player) {
    const victimWs = this.clients.get(victim.id);
    if (victimWs) {
      this.send(victimWs, {
        type: 'ELIMINATED',
        payload: {
          killerName: attacker ? attacker.name : 'Environment',
          score: victim.score,
          balance: victim.balance
        }
      });
    }

    if (attacker) {
      attacker.kills++;
      log(`${attacker.name} got kill #${attacker.kills} (shape=${attacker.characterShape}, training=${this.trainingMode}, supercharged=${attacker.supercharged})`, 'room');
      if (attacker.kills >= 2 && !attacker.supercharged) {
        attacker.supercharged = true;
        log(`${attacker.name} activated ELITE MODE!`, 'room');
      }
      const attackerWs = this.clients.get(attacker.id);
      if (attackerWs) {
        this.send(attackerWs, {
          type: 'KILL',
          payload: { victimName: victim.name }
        });
      }
    }

    log(`${attacker ? attacker.name : 'Environment'} eliminated ${victim.name} in room ${this.id}`, 'room');

    if (this.dummyIds.has(victim.id)) {
      for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 40;
        this.gameState.pickups.push({
          id: `pickup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          x: victim.x + Math.cos(angle) * dist,
          y: victim.y + Math.sin(angle) * dist,
          type: 'CHARGE',
          value: CHARGE_PICKUP_VALUE
        });
      }
      this.respawnDummy(victim.id);
      return;
    }

    if (this.botIds.has(victim.id)) {
      this.respawnBot(victim.id);
      return;
    }

    this.gameState.players.delete(victim.id);
    this.clients.delete(victim.id);
  }

  protected damagePlayer(attacker: Player | null, victim: Player, baseDamage: number) {
    if (attacker && attacker.id === victim.id) return;

    let damage = baseDamage;
    
    if (attacker) {
      const comboKey = `${attacker.id}->${victim.id}`;
      const now = Date.now();
      const combo = this.comboTrackers.get(comboKey);
      
      if (combo && now - combo.lastHitTime < 1000) {
        combo.hits++;
        combo.lastHitTime = now;
        damage = Math.floor(baseDamage * (1 + 0.1 * (combo.hits - 1)));
      } else {
        this.comboTrackers.set(comboKey, { hits: 1, lastHitTime: now });
      }
    }
    
    // Elite mode bonuses: 1.2× damage dealt, 1.5× score earned
    if (attacker?.supercharged) {
      damage = Math.round(damage * 1.2);
    }

    victim.hp -= damage;
    victim.lastCombatTime = Date.now();
    if (attacker) {
      attacker.lastCombatTime = Date.now();
      attacker.score += attacker.supercharged ? Math.round(damage * 1.5) : damage;
    }
    
    const victimWs = this.clients.get(victim.id);
    if (victimWs) {
      this.send(victimWs, {
        type: 'DAMAGE',
        payload: { targetId: victim.id, damage, currentHp: victim.hp, attackerId: attacker?.id }
      });
    }
    
    if (attacker && attacker.id !== victim.id) {
      const attackerWs = this.clients.get(attacker.id);
      if (attackerWs && attackerWs !== victimWs) {
        this.send(attackerWs, {
          type: 'DAMAGE',
          payload: { targetId: victim.id, damage, currentHp: victim.hp, attackerId: attacker.id, victimX: victim.x, victimY: victim.y }
        });
      }
    }
    
    this.updatePlayerRadius(victim);
    
    if (victim.hp <= 0) {
      this.handleElimination(attacker, victim);
    }
  }

  protected healPlayer(player: Player, amount: number) {
    player.hp = Math.min(player.maxHp, player.hp + amount);
    this.updatePlayerRadius(player);
  }

  protected chargePlayer(player: Player, amount: number) {
    player.charge = Math.min(player.maxCharge, player.charge + amount);
  }

  protected useCharge(player: Player, amount: number): boolean {
    if (player.charge < amount) return false;
    player.charge -= amount;
    return true;
  }

  protected updatePlayerRadius(player: Player) {
    player.radius = INITIAL_RADIUS + Math.sqrt(Math.max(1, player.hp)) * 2.25;
  }

  protected broadcastState() {
    const playersArray: any[] = [];
    this.gameState.players.forEach(p => {
      playersArray.push({
        id: p.id,
        name: p.name,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        r: Math.round(p.radius * 10) / 10,
        color: p.color,
        s: p.score,
        hp: Math.round(p.hp),
        mh: p.maxHp,
        ch: Math.round(p.charge),
        mc: p.maxCharge,
        cs: p.characterShape,
        fa: Math.round(p.facingAngle * 100) / 100,
        st: p.isStunned ? 1 : 0,
        sp: p.isSpectator ? 1 : 0,
        b: this.botIds.has(p.id) ? 1 : 0,
        sc: p.supercharged ? 1 : 0
      });
    });

    const statePayload: any = { players: playersArray };
    if (this.projectiles.length > 0) {
      const pArr = new Array(this.projectiles.length);
      for (let i = 0; i < this.projectiles.length; i++) {
        const p = this.projectiles[i];
        pArr[i] = [
          Math.round(p.x),
          Math.round(p.y),
          Math.round(p.angle * 100) / 100,
          p.radius,
          p.color
        ];
      }
      statePayload.p = pArr;
    }

    const stateMessage: ServerMessage = {
      type: 'STATE',
      payload: statePayload
    };

    this.broadcast(stateMessage);

    if (this.spawnedPickups.length > 0 || this.collectedPickupIds.length > 0) {
      const deltaMessage: ServerMessage = {
        type: 'PICKUP_DELTA',
        payload: {
          spawned: this.spawnedPickups,
          collected: this.collectedPickupIds
        }
      };
      this.broadcast(deltaMessage);
      this.spawnedPickups = [];
      this.collectedPickupIds = [];
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
  private lobbyPlayers: Map<string, { ws: WebSocket; name: string; walletAddress?: string; playerColor?: string; characterShape?: CharacterShape }> = new Map();

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

  async addPlayer(playerId: string, ws: WebSocket, payload: { name: string; walletAddress?: string; playerColor?: string; characterShape?: CharacterShape }): Promise<boolean> {
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
      playerColor: payload.playerColor,
      characterShape: payload.characterShape
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
        prizePool: TOTAL_PRIZE_POOL
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
    this.prizePool = TOTAL_PRIZE_POOL;

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
    this.prizePool = TOTAL_PRIZE_POOL;

    // Reset pickups
    this.gameState.pickups = [];
    this.initPickups();

    // Create players from lobby
    const defaultColors = ['#D40046', '#00CC7A', '#00A3CC', '#A300CC', '#CCCC00', '#FF69B4', '#00FFFF'];
    
    this.lobbyPlayers.forEach((data, playerId) => {
      const player: Player = {
        id: playerId,
        name: data.name || 'Anonymous',
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        radius: INITIAL_RADIUS,
        color: data.playerColor || defaultColors[Math.floor(Math.random() * defaultColors.length)],
        score: 0,
        hp: INITIAL_HP,
        maxHp: MAX_HP,
        charge: INITIAL_CHARGE,
        maxCharge: MAX_CHARGE,
        characterShape: data.characterShape || 'circle',
        velocity: { x: 0, y: 0 },
        knockbackVelocity: { x: 0, y: 0 },
        walletAddress: data.walletAddress,
        balance: ENTRY_FEE,
        lastCombatTime: 0,
        inputVector: { x: 0, y: 0 },
        isSpectator: false,
        isStunned: false,
        stunEndTime: 0,
        stunAttackerId: null,
        lastStunDamageTime: 0,
        facingAngle: 0,
        lastAbilityTime: 0,
        kills: 0,
        supercharged: false
      };

      // Set initial radius based on HP
      this.updatePlayerRadius(player);

      this.gameState.players.set(playerId, player);
      this.clients.set(playerId, data.ws);

      // Send game start message
      this.send(data.ws, {
        type: 'JOINED',
        payload: { 
          playerId, 
          player, 
          roomId: this.id, 
          pickups: this.gameState.pickups,
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
    
    // Reset pickups
    this.gameState.pickups = [];
    this.initPickups();

    log(`Stake room ${this.id} reset for next round`, 'room');
  }

  handleInput(playerId: string, payload: { x: number; y: number; facingAngle?: number }) {
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

  protected handleElimination(attacker: Player | null, victim: Player) {
    // Convert victim to spectator (no player-to-player money transfer)
    victim.isSpectator = true;
    victim.inputVector = { x: 0, y: 0 };
    victim.velocity = { x: 0, y: 0 };

    const victimWs = this.clients.get(victim.id);
    if (victimWs) {
      this.send(victimWs, {
        type: 'ELIMINATED',
        payload: {
          killerName: attacker ? attacker.name : 'Environment',
          score: victim.score,
          isSpectating: true,
          timeRemaining: Math.max(0, ROUND_DURATION - (Date.now() - this.roundStartTime))
        }
      });
    }

    if (attacker) {
      attacker.kills++;
      if (attacker.kills >= 2 && !attacker.supercharged) {
        attacker.supercharged = true;
      }
    }

    log(`${attacker ? attacker.name : 'Environment'} eliminated ${victim.name} in stake room ${this.id} - victim now spectating`, 'room');
    
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
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      r: Math.round(p.radius * 10) / 10,
      color: p.color,
      s: p.score,
      hp: Math.round(p.hp),
      mh: p.maxHp,
      ch: Math.round(p.charge),
      mc: p.maxCharge,
      cs: p.characterShape,
      fa: Math.round(p.facingAngle * 100) / 100,
      st: p.isStunned ? 1 : 0,
      sp: p.isSpectator ? 1 : 0,
      b: this.botIds.has(p.id) ? 1 : 0,
      sc: p.supercharged ? 1 : 0
    }));

    const timeRemaining = Math.max(0, ROUND_DURATION - (Date.now() - this.roundStartTime));

    const stakePayload: any = {
      players: playersArray,
      roundState: this.roundState,
      timeRemaining,
      prizePool: this.prizePool
    };
    if (this.projectiles.length > 0) {
      const pArr = new Array(this.projectiles.length);
      for (let i = 0; i < this.projectiles.length; i++) {
        const p = this.projectiles[i];
        pArr[i] = [
          Math.round(p.x),
          Math.round(p.y),
          Math.round(p.angle * 100) / 100,
          p.radius,
          p.color
        ];
      }
      stakePayload.p = pArr;
    }

    const stateMessage: ServerMessage = {
      type: 'STATE',
      payload: stakePayload
    };

    this.broadcast(stateMessage);

    if (this.spawnedPickups.length > 0 || this.collectedPickupIds.length > 0) {
      const deltaMessage: ServerMessage = {
        type: 'PICKUP_DELTA',
        payload: {
          spawned: this.spawnedPickups,
          collected: this.collectedPickupIds
        }
      };
      this.broadcast(deltaMessage);
      this.spawnedPickups = [];
      this.collectedPickupIds = [];
    }
  }

  private broadcastRoundStatus() {
    const status = {
      roundState: this.roundState,
      playerCount: this.lobbyPlayers.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      prizePool: TOTAL_PRIZE_POOL,
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
  private ipConnections: Map<string, number> = new Map();
  private playerMessageCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private trainingModeEnabled: boolean = false;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ 
      server: httpServer, 
      path: '/ws',
    });
    
    this.createRoom(false);
    this.createStakeRoom();

    balanceService.releaseAllOrphanedLocks().then(() => {
      log('Orphaned lock cleanup completed on startup', 'room');
    }).catch(err => {
      log(`Orphaned lock cleanup error: ${err.message}`, 'error');
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() 
        || req.socket.remoteAddress || 'unknown';
      
      const currentConns = this.ipConnections.get(ip) || 0;
      if (currentConns >= WS_MAX_CONNECTIONS_PER_IP) {
        log(`Rejected WS connection from ${ip}: too many connections (${currentConns})`, 'security');
        ws.close(1008, 'Too many connections');
        return;
      }
      this.ipConnections.set(ip, currentConns + 1);

      const playerId = `player-${Math.random().toString(36).substr(2, 9)}-${Date.now().toString(36)}`;
      
      ws.on('message', (data) => {
        const raw = data.toString();
        if (raw.length > MAX_WS_MESSAGE_SIZE) {
          log(`Oversized message from ${playerId} (${raw.length} bytes)`, 'security');
          return;
        }

        const now = Date.now();
        const flood = this.playerMessageCounts.get(playerId) || { count: 0, windowStart: now };
        if (now - flood.windowStart > WS_FLOOD_WINDOW_MS) {
          flood.count = 0;
          flood.windowStart = now;
        }
        flood.count++;
        this.playerMessageCounts.set(playerId, flood);

        if (flood.count > WS_FLOOD_MAX_MESSAGES) {
          log(`Flood detected from ${playerId} (${flood.count} msgs/sec)`, 'security');
          ws.close(1008, 'Message flood detected');
          return;
        }

        try {
          const message: ClientMessage = JSON.parse(raw);
          if (!message || typeof message.type !== 'string') {
            return;
          }
          this.handleMessage(playerId, ws, message);
        } catch (e) {
          log(`Invalid message from ${playerId}`, 'ws');
        }
      });

      ws.on('close', () => {
        const conns = this.ipConnections.get(ip) || 1;
        if (conns <= 1) {
          this.ipConnections.delete(ip);
        } else {
          this.ipConnections.set(ip, conns - 1);
        }
        this.playerMessageCounts.delete(playerId);
        this.handleDisconnect(playerId);
      });

      ws.on('error', (err) => {
        log(`WebSocket error for ${playerId}`, 'ws');
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
      case 'ABILITY':
        this.handleAbilityMessage(playerId, message.payload);
        break;
      case 'LEAVE':
        this.handleLeave(playerId);
        break;
    }
  }

  private handleAbilityMessage(playerId: string, payload: { abilityType: AbilityType; held?: boolean }) {
    const room = this.getRoom(playerId);
    if (room) {
      room.handleAbility(playerId, payload.abilityType, payload.held);
    }
  }

  private validateJoinPayload(payload: any): { valid: boolean; error?: string; sanitized?: { name: string; isStakeMode: boolean; walletAddress?: string; playerColor: string; characterShape: CharacterShape } } {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Invalid payload' };
    }

    if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      return { valid: false, error: 'Name is required' };
    }

    const name = payload.name.trim().substring(0, MAX_NAME_LENGTH);
    if (containsProfanity(name)) {
      return { valid: false, error: 'Inappropriate name detected' };
    }

    const characterShape: CharacterShape = VALID_SHAPES.includes(payload.characterShape) 
      ? payload.characterShape : 'circle';

    const playerColor = VALID_COLORS.includes(payload.playerColor) 
      ? payload.playerColor : VALID_COLORS[0];

    const isStakeMode = payload.isStakeMode === true;

    const walletAddress = typeof payload.walletAddress === 'string' && payload.walletAddress.length <= 64
      ? payload.walletAddress : undefined;

    return { valid: true, sanitized: { name, isStakeMode, walletAddress, playerColor, characterShape } };
  }

  private handleJoin(playerId: string, ws: WebSocket, payload: { name: string; isStakeMode?: boolean; walletAddress?: string; playerColor?: string; characterShape?: CharacterShape }) {
    const validation = this.validateJoinPayload(payload);
    if (!validation.valid || !validation.sanitized) {
      ws.send(JSON.stringify({ type: 'ERROR', payload: { message: validation.error || 'Invalid join request' } }));
      return;
    }

    const sanitized = validation.sanitized;
    const room = this.findAvailableRoom(sanitized.isStakeMode);
    
    if (!room) {
      ws.send(JSON.stringify({ 
        type: 'ERROR', 
        payload: { message: 'All rooms are full. Please try again later.' } 
      }));
      return;
    }

    const added = room.addPlayer(playerId, ws, sanitized);
    if (added) {
      this.playerToRoom.set(playerId, room.id);
      this.playerStakeMode.set(playerId, sanitized.isStakeMode);
      log(`Player ${sanitized.name} (${playerId}) matched to ${room.id} (${sanitized.isStakeMode ? 'stake' : 'free'}). Total players: ${this.getTotalPlayerCount()}`, 'ws');
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

  private handleInput(playerId: string, payload: { x: number; y: number; facingAngle?: number }) {
    if (!payload || typeof payload.x !== 'number' || typeof payload.y !== 'number' 
        || !isFinite(payload.x) || !isFinite(payload.y)) {
      return;
    }
    const x = Math.max(-1, Math.min(1, payload.x));
    const y = Math.max(-1, Math.min(1, payload.y));
    const facingAngle = (typeof payload.facingAngle === 'number' && isFinite(payload.facingAngle)) 
      ? payload.facingAngle : undefined;
    const room = this.getRoom(playerId);
    room?.handleInput(playerId, { x, y, facingAngle });
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

  enableTrainingMode() {
    for (const room of this.freeRooms.values()) {
      room.enableTrainingMode();
    }
    this.trainingModeEnabled = true;
    log('Training mode enabled globally', 'room');
  }

  disableTrainingMode() {
    for (const room of this.freeRooms.values()) {
      room.disableTrainingMode();
    }
    this.trainingModeEnabled = false;
    log('Training mode disabled globally', 'room');
  }

  isTrainingMode(): boolean {
    return this.trainingModeEnabled;
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
