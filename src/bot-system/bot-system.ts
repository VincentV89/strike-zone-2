import type { WaypointGraph } from '../map-system/types.js';
import type { Vec3, EntityId } from '../renderer-core/types.js';
import type {
  BotAgent,
  BotFSMState,
  BotState,
  PlayerState,
  BotRendererAdapter,
  CombatAdapter,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_BOTS = 8;
export const BOT_MAX_HEALTH = 100;
export const BOT_DAMAGE = 20;
export const DETECTION_RANGE = 20.0;
export const ENGAGE_RANGE = 12.0;
export const CHASE_RANGE = 24.0;
export const HYSTERESIS_FACTOR = 1.5;
export const IDLE_DURATION_MS = 500;
export const IDLE_STAGGER_MS = 100;
export const MIN_REACTION_MS = 400;
export const MAX_REACTION_MS = 1200;
export const MIN_FIRE_INTERVAL_MS = 600;
export const MAX_FIRE_INTERVAL_MS = 1800;
export const BOT_PATROL_SPEED = 3.0;
export const BOT_CHASE_SPEED = 5.0;
export const WAYPOINT_ARRIVAL_THRESHOLD = 0.5;
export const BOT_EYE_OFFSET_Y = 1.6;
export const BOT_AIM_SPREAD_RADIANS = 0.05;

// ─── Internal helpers ─────────────────────────────────────────────────────────

let _entityIdCounter = 0;

function nextEntityId(): EntityId {
  return `bot-${++_entityIdCounter}`;
}

function uniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function distTo(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalizeVec3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function applyAimSpread(dir: Vec3, spreadRad: number): Vec3 {
  return normalizeVec3({
    x: dir.x + uniform(-spreadRad, spreadRad),
    y: dir.y + uniform(-spreadRad, spreadRad),
    z: dir.z + uniform(-spreadRad, spreadRad),
  });
}

function moveToward(bot: BotAgent, target: Vec3, speed: number, dtMs: number): void {
  const d = distTo(bot.position, target);
  if (d < 1e-6) return;
  const step = (speed * dtMs) / 1000;
  if (step >= d) {
    bot.position.x = target.x;
    bot.position.z = target.z;
  } else {
    const t = step / d;
    bot.position.x += (target.x - bot.position.x) * t;
    bot.position.z += (target.z - bot.position.z) * t;
  }
}

// ─── BotSystem ────────────────────────────────────────────────────────────────

export class BotSystem {
  private bots: BotAgent[] = [];
  private graph: WaypointGraph | null = null;
  private combatSystem: CombatAdapter | null = null;
  private renderer: BotRendererAdapter | null = null;

  /**
   * Initialise the bot system for a new round.
   * Must be called before update() or any other method.
   */
  init(
    count: number,
    waypointGraph: WaypointGraph,
    spawnPoints: readonly Vec3[],
    combatSystem: CombatAdapter,
    renderer: BotRendererAdapter,
  ): void {
    if (!Number.isInteger(count) || count < 1 || count > MAX_BOTS) {
      throw new RangeError(`Bot count must be between 1 and ${MAX_BOTS}, got ${count}`);
    }
    if (spawnPoints.length < count) {
      throw new RangeError(
        `Insufficient spawn points: need ${count}, got ${spawnPoints.length}`,
      );
    }

    this.graph = waypointGraph;
    this.combatSystem = combatSystem;
    this.renderer = renderer;
    this.bots = [];

    for (let i = 0; i < count; i++) {
      const sp = spawnPoints[i]!;
      const id = nextEntityId();
      const bot: BotAgent = {
        id,
        position: { x: sp.x, y: sp.y, z: sp.z },
        rotation: 0,
        health: BOT_MAX_HEALTH,
        state: 'idle',
        idleAccumMs: i * IDLE_STAGGER_MS,
        targetWaypointNodeId: null,
        lastKnownPlayerPos: { x: sp.x, y: sp.y, z: sp.z },
        reactionThresholdMs: 0,
        reactionAccumMs: 0,
        fireIntervalMs: uniform(MIN_FIRE_INTERVAL_MS, MAX_FIRE_INTERVAL_MS),
        fireAccumMs: 0,
      };
      // Bots use large ammo so CombatSystem never blocks their shots.
      combatSystem.initCombatant(id, BOT_MAX_HEALTH, Number.MAX_SAFE_INTEGER);
      const mesh = renderer.getBotHitboxMesh(id);
      combatSystem.registerHitbox(id, mesh);
      this.bots.push(bot);
    }
  }

  /** Called once per animation frame by the GameEngine. */
  update(deltaMs: number, playerState: PlayerState): void {
    if (!this.graph || !this.combatSystem || !this.renderer) return;
    for (const bot of this.bots) {
      if (bot.state === 'dead') continue;
      this._tickBot(bot, deltaMs, playerState);
    }
  }

  /** Returns read-only snapshots for each bot (stripped of internal timing fields). */
  getAllStates(): readonly BotState[] {
    return this.bots.map((b) => ({
      id: b.id,
      position: { x: b.position.x, y: b.position.y, z: b.position.z },
      rotation: b.rotation,
      health: b.health,
      state: b.state,
    }));
  }

  /**
   * Called by GameEngine when CombatSystem confirms a bot's health reached zero.
   * Transitions the bot to 'dead', unregisters hitbox, and hides mesh.
   */
  onBotKilled(botId: EntityId): void {
    const bot = this.bots.find((b) => b.id === botId);
    if (!bot || bot.state === 'dead') return;
    bot.state = 'dead';
    bot.health = 0;
    this.combatSystem!.unregisterHitbox(bot.id);
    this.renderer!.hideBotMesh(bot.id);
  }

  /**
   * Resets all bots for the next round (round-boundary only — satisfies req-bot-respawn-rule).
   * Reuses existing BotAgent instances to preserve EntityId stability.
   */
  reset(spawnPoints: readonly Vec3[]): void {
    if (spawnPoints.length < this.bots.length) {
      throw new RangeError(
        `Insufficient spawn points for reset: need ${this.bots.length}, got ${spawnPoints.length}`,
      );
    }
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i]!;
      const sp = spawnPoints[i]!;
      const wasDead = bot.state === 'dead';

      bot.position.x = sp.x;
      bot.position.y = sp.y;
      bot.position.z = sp.z;
      bot.rotation = 0;
      bot.health = BOT_MAX_HEALTH;
      bot.state = 'idle';
      bot.idleAccumMs = i * IDLE_STAGGER_MS;
      bot.reactionAccumMs = 0;
      bot.fireAccumMs = 0;
      bot.targetWaypointNodeId = null;

      if (wasDead) {
        const mesh = this.renderer!.getBotHitboxMesh(bot.id);
        this.combatSystem!.registerHitbox(bot.id, mesh);
        this.renderer!.showBotMesh(bot.id);
      }
    }
  }

  /** Returns true when every bot is eliminated — used by RoundSystem to check win condition. */
  allEliminated(): boolean {
    return this.bots.length > 0 && this.bots.every((b) => b.state === 'dead');
  }

  // ─── FSM tick dispatch ──────────────────────────────────────────────────────

  private _tickBot(bot: BotAgent, dt: number, player: PlayerState): void {
    switch (bot.state) {
      case 'idle':
        this._tickIdle(bot, dt);
        break;
      case 'patrol':
        this._tickPatrol(bot, dt, player);
        break;
      case 'chase':
        this._tickChase(bot, dt, player);
        break;
      case 'engage':
        this._tickEngage(bot, dt, player);
        break;
      case 'dead':
        break;
    }
  }

  private _tickIdle(bot: BotAgent, dt: number): void {
    bot.idleAccumMs += dt;
    if (bot.idleAccumMs >= IDLE_DURATION_MS) {
      this._transitionTo(bot, 'patrol');
    }
  }

  private _tickPatrol(bot: BotAgent, dt: number, player: PlayerState): void {
    if (distTo(bot.position, player.position) < DETECTION_RANGE) {
      bot.lastKnownPlayerPos = { x: player.position.x, y: player.position.y, z: player.position.z };
      this._transitionTo(bot, 'chase');
      return;
    }

    const graph = this.graph!;

    if (bot.targetWaypointNodeId === null) {
      bot.targetWaypointNodeId = graph.findNearest(bot.position).id;
    }

    const targetNode = graph.nodes.get(bot.targetWaypointNodeId);
    if (!targetNode) return;

    if (distTo(bot.position, targetNode.position) < WAYPOINT_ARRIVAL_THRESHOLD) {
      const arrivedId = bot.targetWaypointNodeId;
      const candidates = targetNode.neighbors.filter((n) => n.id !== arrivedId);
      const pool = candidates.length > 0 ? candidates : [...targetNode.neighbors];
      if (pool.length > 0) {
        bot.targetWaypointNodeId = pool[Math.floor(Math.random() * pool.length)]!.id;
      }
    }

    const currentTarget = graph.nodes.get(bot.targetWaypointNodeId);
    if (currentTarget) {
      moveToward(bot, currentTarget.position, BOT_PATROL_SPEED, dt);
    }
  }

  private _tickChase(bot: BotAgent, dt: number, player: PlayerState): void {
    if (player.alive) {
      bot.lastKnownPlayerPos = { x: player.position.x, y: player.position.y, z: player.position.z };
    }

    const d = distTo(bot.position, player.position);

    if (d < ENGAGE_RANGE) {
      this._transitionTo(bot, 'engage');
      return;
    }
    if (d > DETECTION_RANGE * HYSTERESIS_FACTOR) {
      this._transitionTo(bot, 'patrol');
      return;
    }

    const targetNode = this.graph!.findNearest(bot.lastKnownPlayerPos);
    moveToward(bot, targetNode.position, BOT_CHASE_SPEED, dt);
  }

  private _tickEngage(bot: BotAgent, dt: number, player: PlayerState): void {
    if (distTo(bot.position, player.position) > CHASE_RANGE) {
      this._transitionTo(bot, 'chase');
      return;
    }

    const dx = player.position.x - bot.position.x;
    const dz = player.position.z - bot.position.z;
    bot.rotation = Math.atan2(dx, dz);

    bot.reactionAccumMs += dt;
    if (bot.reactionAccumMs < bot.reactionThresholdMs) return;

    bot.fireAccumMs += dt;
    if (bot.fireAccumMs >= bot.fireIntervalMs) {
      bot.fireIntervalMs = uniform(MIN_FIRE_INTERVAL_MS, MAX_FIRE_INTERVAL_MS);
      bot.fireAccumMs = 0;
      this._fireBotShot(bot, player);
    }
  }

  private _fireBotShot(bot: BotAgent, player: PlayerState): void {
    const eyeOrigin: Vec3 = {
      x: bot.position.x,
      y: bot.position.y + BOT_EYE_OFFSET_Y,
      z: bot.position.z,
    };
    const rawDir: Vec3 = {
      x: player.position.x - eyeOrigin.x,
      y: player.position.y - eyeOrigin.y,
      z: player.position.z - eyeOrigin.z,
    };
    const perturbed = applyAimSpread(normalizeVec3(rawDir), BOT_AIM_SPREAD_RADIANS);
    this.combatSystem!.fire(eyeOrigin, perturbed, bot.id, BOT_DAMAGE);
  }

  private _transitionTo(bot: BotAgent, nextState: BotFSMState): void {
    bot.state = nextState;
    switch (nextState) {
      case 'patrol':
        bot.targetWaypointNodeId = null;
        break;
      case 'engage':
        bot.reactionThresholdMs = uniform(MIN_REACTION_MS, MAX_REACTION_MS);
        bot.reactionAccumMs = 0;
        bot.fireIntervalMs = uniform(MIN_FIRE_INTERVAL_MS, MAX_FIRE_INTERVAL_MS);
        bot.fireAccumMs = 0;
        break;
      default:
        break;
    }
  }
}
