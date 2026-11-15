import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';

import { RendererInstance } from '../renderer-core/renderer.js';
import { InputHandler } from '../input-handler/input-handler.js';
import { MapSystem } from '../map-system/map-system.js';
import { CombatSystem, type CombatHitEvent } from '../combat-system/combat-system.js';
import { PlayerSystem } from '../player-system/player-system.js';
import { PLAYER_ENTITY_ID } from '../player-system/types.js';
import { BotSystem, BOT_HALF_WIDTH, BOT_HEIGHT } from '../bot-system/bot-system.js';
import { RoundSystem } from '../round-system/round-system.js';
import { UISystem } from '../ui-system/ui-system.js';

import type { EntityId, Vec3 } from '../renderer-core/types.js';
import type { UIAction } from '../ui-system/types.js';
import type { BotRendererAdapter, BotState } from '../bot-system/types.js';
import type { ColliderVolume } from '../map-system/types.js';
import {
  EngineState,
  IllegalStateError,
  MatchConfig,
  MenuMatchConfig,
  ValidationError,
  type EngineDebugSnapshot,
  type GameEngineOptions,
} from './types.js';

/** Duck-typed interface for leaderboard I/O — avoids a cross-rootDir import. */
export interface LeaderboardService {
  /** Top scores, or null when the leaderboard could not be reached. */
  getTopScores(): Promise<Array<{ alias: string; score: number; timestamp: string }> | null>;
  submitScore(alias: string, score: number): Promise<{ success: boolean; error?: string }>;
}

const DELTA_CAP_MS = 100;
const PERF_WARN_THRESHOLD_MS = 16;
const PERF_WARN_CONSECUTIVE = 3;
const DEFAULT_ROUND_DURATION_SECS = 180;
const PRACTICE_SUBMIT_ERROR = 'Practice round, score not submitted';
const BOT_COLOR = 0xc0392b;

/** Manages Three.js hitbox meshes for all bots in a single round. */
class BotMeshManager implements BotRendererAdapter {
  private readonly meshes = new Map<EntityId, Mesh>();

  constructor(private readonly renderer: RendererInstance) {}

  getBotHitboxMesh(botId: EntityId): Mesh {
    let mesh = this.meshes.get(botId);
    if (!mesh) {
      const geo = new BoxGeometry(BOT_HALF_WIDTH * 2, BOT_HEIGHT, BOT_HALF_WIDTH * 2);
      mesh = new Mesh(geo, new MeshLambertMaterial({ color: BOT_COLOR }));
      mesh.userData['isHitbox'] = true;
      mesh.userData['entityId'] = botId;
      this.renderer.addToScene(mesh);
      this.meshes.set(botId, mesh);
    }
    return mesh;
  }

  hideBotMesh(botId: EntityId): void {
    const m = this.meshes.get(botId);
    if (m) m.visible = false;
  }

  showBotMesh(botId: EntityId): void {
    const m = this.meshes.get(botId);
    if (m) m.visible = true;
  }

  /** Moves each live bot's mesh (and therefore its hitbox) to the bot's position. */
  sync(states: readonly BotState[]): void {
    for (const bot of states) {
      const mesh = this.meshes.get(bot.id);
      if (!mesh) continue;
      if (bot.state === 'dead') {
        mesh.visible = false;
        continue;
      }
      // Bot position is at its feet; the box is centred half a body above.
      mesh.position.set(bot.position.x, bot.position.y + BOT_HEIGHT / 2, bot.position.z);
      mesh.rotation.y = bot.rotation;
      mesh.updateMatrixWorld(true);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.renderer.removeFromScene(mesh);
    }
    this.meshes.clear();
  }
}

/** Yaw (radians, 0 = facing -Z) that makes a player at `p` face the map centre. */
function yawTowardOrigin(p: Vec3): number {
  if (Math.abs(p.x) < 1e-6 && Math.abs(p.z) < 1e-6) return 0;
  return Math.atan2(p.x, p.z);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class GameEngine {
  private engineState: EngineState = 'uninitialized';
  private rafHandle: number | null = null;
  private lastFrameTimestamp = 0;
  private lastConfig: MatchConfig | null = null;
  private slowFrameCount = 0;
  private canvas: HTMLCanvasElement | null = null;
  private botMeshManager: BotMeshManager | null = null;
  private lastError: string | null = null;
  private readonly roundDurationSecs: number;
  private readonly practiceMode: boolean;

  constructor(
    private readonly renderer: RendererInstance,
    private readonly inputHandler: InputHandler,
    private readonly mapSystem: MapSystem,
    private readonly combatSystem: CombatSystem,
    private readonly playerSystem: PlayerSystem,
    private readonly botSystem: BotSystem,
    private readonly roundSystem: RoundSystem,
    private readonly uiSystem: UISystem,
    private readonly leaderboardClient: LeaderboardService | null = null,
    options: GameEngineOptions = {},
  ) {
    this.roundDurationSecs = options.roundDurationSecs ?? DEFAULT_ROUND_DURATION_SECS;
    this.practiceMode = options.practiceMode ?? false;
  }

  /** Initialises all subsystems. Must complete before start() is called. */
  async init(canvas: HTMLCanvasElement, uiContainer: HTMLElement): Promise<void> {
    this.canvas = canvas;
    this.renderer.init(canvas);
    this.inputHandler.init();
    this.uiSystem.init(uiContainer);
    this.uiSystem.setPracticeMode(this.practiceMode);
    this.uiSystem.onAction((action) => this.onUIAction(action));
    this.combatSystem.onHit((event) => this._onCombatHit(event));
    // D-08: clicking the canvas during a round re-acquires pointer lock after Esc.
    canvas.addEventListener('click', () => {
      if (this.engineState === 'in-round' && document.pointerLockElement !== canvas) {
        this._requestPointerLock();
      }
    });
    this.engineState = 'menu';
  }

  /**
   * Loads a map, spawns subsystems, and begins the 60fps tick loop.
   * On failure the engine returns to 'menu', the menu shows the error, and the
   * promise rejects so callers can log it. A later start() may retry.
   */
  async start(config: MatchConfig): Promise<void> {
    if (this.engineState !== 'menu' && this.engineState !== 'round-end') {
      throw new IllegalStateError(
        `start() called in state '${this.engineState}'; only valid in 'menu' or 'round-end'`,
      );
    }
    if (config.botCount < 1) {
      throw new ValidationError('botCount must be at least 1');
    }
    if (config.roundDurationSecs <= 0) {
      throw new ValidationError('roundDurationSecs must be > 0');
    }

    // Cancel any stale RAF chain (rule-ge-04)
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    this.engineState = 'loading';
    this.lastConfig = Object.freeze({ ...config });
    this.uiSystem.showLoading();

    try {
      await this._setupRound(config);
    } catch (err) {
      this.lastError = errorMessage(err);
      this.engineState = 'menu';
      document.exitPointerLock?.();
      this.uiSystem.showMainMenu();
      this.uiSystem.showError(`Could not start the match: ${this.lastError}`);
      throw err;
    }

    this.lastError = null;
    this.engineState = 'in-round';
    this.lastFrameTimestamp = performance.now();
    this.slowFrameCount = 0;

    this._scheduleLoop();
  }

  /** Halts the loop and returns to menu state. Safe to call from any active state. */
  stop(): void {
    if (this.engineState === 'uninitialized' || this.engineState === 'menu') return;

    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    document.exitPointerLock?.();
    this.engineState = 'menu';
    this.uiSystem.showMainMenu();
  }

  /** Routes UIAction events back from UISystem into the game lifecycle (rule-ge-14, rule-ge-15). */
  onUIAction(action: UIAction): void {
    switch (action.type) {
      case 'start-game':
        this._startFromUI(this._adaptUIConfig(action.config));
        break;

      case 'play-again':
        if (this.lastConfig) {
          this._startFromUI(this.lastConfig);
        }
        break;

      case 'submit-score': {
        const score = this.roundSystem.getState().score;
        this._handleSubmitScore(action.alias, score).catch((err) => {
          console.warn('GameEngine: submit-score failed', err);
          this.uiSystem.onSubmitResult({ success: false, error: errorMessage(err) });
        });
        break;
      }

      case 'view-leaderboard':
        this._handleViewLeaderboard().catch((err) => {
          console.warn('GameEngine: view-leaderboard failed', err);
          this.uiSystem.showLeaderboard(null);
        });
        break;

      default:
        console.warn('GameEngine: unrecognised UIAction', (action as { type: string }).type);
    }
  }

  get state(): EngineState {
    return this.engineState;
  }

  /** Read-only state snapshot for the ?debug=1 test hook. */
  getDebugSnapshot(): EngineDebugSnapshot {
    const round = this.roundSystem.getState();
    const player = this.playerSystem.getState();
    const bots = this.botSystem.getAllStates();
    return Object.freeze({
      engineState: this.engineState,
      roundPhase: round.phase,
      timeRemainingMs: round.timeRemaining,
      outcome: round.outcome,
      kills: round.kills,
      score: round.score,
      mapId: this.lastConfig?.mapId ?? null,
      practiceMode: this.practiceMode,
      lastError: this.lastError,
      player: Object.freeze({
        health: player.health,
        ammo: player.ammo,
        isAlive: player.isAlive,
        isReloading: player.isReloading,
        position: Object.freeze({ ...player.position }),
        rotation: Object.freeze({ ...player.rotation }),
      }),
      bots: Object.freeze(
        bots.map((b) =>
          Object.freeze({
            id: b.id,
            alive: b.state !== 'dead',
            state: b.state,
            health: b.health,
            position: Object.freeze({ ...b.position }),
          }),
        ),
      ),
      combatantIds: Object.freeze(this.combatSystem.getCombatantIds()),
    });
  }

  private _startFromUI(config: MatchConfig): void {
    if (this.engineState !== 'menu' && this.engineState !== 'round-end') {
      console.warn(`GameEngine: ignoring start request while '${this.engineState}'`);
      return;
    }
    // D-08: must run synchronously inside the click's user-activation window.
    this._requestPointerLock();
    this.start(config).catch((err) => {
      console.error('GameEngine: start failed', err);
    });
  }

  private async _setupRound(config: MatchConfig): Promise<void> {
    await this.mapSystem.load(config.mapId);

    const spawnManifest = this.mapSystem.getSpawnPoints();
    const colliders = this.mapSystem.getColliders() as unknown as ColliderVolume[];
    const waypointGraph = this.mapSystem.getWaypointGraph();

    // D-09: drop every combatant and hitbox from the previous round.
    this.combatSystem.reset();

    this.roundSystem.reset();
    this.roundSystem.configure({
      mapId: config.mapId,
      botCount: config.botCount,
      roundDurationMs: config.roundDurationSecs * 1000,
    });

    // Spawn player at first spawn point, facing the map centre (D-03: spawn registers the combatant).
    const playerSpawn = spawnManifest.player[0]!;
    this.playerSystem.spawn(playerSpawn, colliders, yawTowardOrigin(playerSpawn));

    // Dispose previous round's bot meshes and create new ones
    this.botMeshManager?.dispose();
    this.botMeshManager = new BotMeshManager(this.renderer);

    this.botSystem.init(
      config.botCount,
      waypointGraph,
      spawnManifest.bots.slice(0, config.botCount),
      this.combatSystem,
      this.botMeshManager,
      colliders,
    );
    this.botMeshManager.sync(this.botSystem.getAllStates());

    this.roundSystem.start();
    this.uiSystem.showHUD();
    // Prime the HUD so it shows this round's values before the first frame.
    this.uiSystem.update({
      playerState: this.playerSystem.getState(),
      roundState: this.roundSystem.getState(),
    });
  }

  /** D-04/D-05: CombatSystem resolved a hit — propagate it to the owning subsystems. */
  private _onCombatHit(event: CombatHitEvent): void {
    if (event.targetId === PLAYER_ENTITY_ID) {
      this.playerSystem.takeDamage(event.damage, event.shooterId ?? 'unknown');
      return;
    }
    if (!event.killed) return;
    this.botSystem.onBotKilled(event.targetId);
    if (event.shooterId === PLAYER_ENTITY_ID) {
      this.roundSystem.recordKill();
    }
  }

  private _requestPointerLock(): void {
    const target = this.canvas;
    if (!target || typeof target.requestPointerLock !== 'function') return;
    try {
      // Chromium returns a Promise; older browsers return undefined.
      const result = target.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((err: unknown) => {
          console.warn('GameEngine: pointer lock request was rejected', err);
        });
      }
    } catch (err) {
      console.warn('GameEngine: pointer lock request failed', err);
    }
  }

  private _adaptUIConfig(config: MenuMatchConfig): MatchConfig {
    return {
      mapId: config.mapId,
      botCount: config.botCount,
      roundDurationSecs: this.roundDurationSecs,
    };
  }

  private _scheduleLoop(): void {
    this.rafHandle = requestAnimationFrame((timestamp) => this._tick(timestamp));
  }

  private _tick(timestamp: number): void {
    if (this.engineState !== 'in-round') return;

    const rawDelta = timestamp - this.lastFrameTimestamp;
    // rule-ge-06: cap delta at DELTA_CAP_MS to prevent spiral-of-death
    const deltaMs = Math.max(0, Math.min(rawDelta, DELTA_CAP_MS));
    this.lastFrameTimestamp = timestamp;

    // 1. Input
    const inputState = this.inputHandler.getState();

    // 2. Player movement + shots (hits on bots resolve via _onCombatHit)
    this.playerSystem.update(deltaMs, inputState);
    const playerBeforeBots = this.playerSystem.getState();

    // 3. Bot AI (hits on the player resolve via _onCombatHit)
    this.botSystem.update(deltaMs, {
      position: playerBeforeBots.position,
      health: playerBeforeBots.health,
      alive: playerBeforeBots.isAlive,
    });
    const botStates = this.botSystem.getAllStates();
    this.botMeshManager?.sync(botStates);
    const playerState = this.playerSystem.getState();

    // 4. Round evaluation
    this.roundSystem.update(deltaMs, playerState, [...botStates]);
    const roundState = this.roundSystem.getState();

    // 5. Render
    this.renderer.tick(deltaMs);

    // 6. UI update
    this.uiSystem.update({ playerState, roundState });

    // rule-ge-16: warn on consecutive slow frames
    if (rawDelta > PERF_WARN_THRESHOLD_MS) {
      this.slowFrameCount++;
      if (this.slowFrameCount > PERF_WARN_CONSECUTIVE) {
        console.warn(
          `GameEngine: frame budget exceeded (${rawDelta.toFixed(1)}ms) for ${this.slowFrameCount} consecutive frames`,
        );
      }
    } else {
      this.slowFrameCount = 0;
    }

    // rule-ge-12: halt loop immediately on round-end
    if (roundState.phase === 'round-end') {
      this._onRoundEnd(roundState.outcome ?? 'lose');
    } else {
      this.rafHandle = requestAnimationFrame((ts) => this._tick(ts));
    }
  }

  private _onRoundEnd(outcome: 'win' | 'lose'): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    document.exitPointerLock?.();
    this.engineState = 'round-end';
    this.uiSystem.showEndRound(outcome, this.roundSystem.getState().score);
  }

  private async _handleSubmitScore(alias: string, score: number): Promise<void> {
    if (this.practiceMode) {
      this.uiSystem.onSubmitResult({ success: false, error: PRACTICE_SUBMIT_ERROR });
      return;
    }
    if (!this.leaderboardClient) {
      this.uiSystem.onSubmitResult({ success: false, error: 'Leaderboard not configured' });
      return;
    }
    const result = await this.leaderboardClient.submitScore(alias, score);
    this.uiSystem.onSubmitResult(result);
  }

  private async _handleViewLeaderboard(): Promise<void> {
    if (!this.leaderboardClient) {
      this.uiSystem.showLeaderboard(null);
      return;
    }
    const entries = await this.leaderboardClient.getTopScores();
    this.uiSystem.showLeaderboard(entries);
  }
}
