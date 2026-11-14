import { BoxGeometry, Mesh } from 'three';

import { RendererInstance } from '../renderer-core/renderer.js';
import { InputHandler } from '../input-handler/input-handler.js';
import { MapSystem } from '../map-system/map-system.js';
import { CombatSystem } from '../combat-system/combat-system.js';
import { PlayerSystem } from '../player-system/player-system.js';
import { BotSystem } from '../bot-system/bot-system.js';
import { RoundSystem } from '../round-system/round-system.js';
import { UISystem } from '../ui-system/ui-system.js';

import type { EntityId } from '../renderer-core/types.js';
import type { UIAction } from '../ui-system/types.js';
import type { BotRendererAdapter } from '../bot-system/types.js';
import type { ColliderVolume } from '../map-system/types.js';
import { EngineState, IllegalStateError, MatchConfig, ValidationError } from './types.js';

/** Duck-typed interface for leaderboard I/O — avoids a cross-rootDir import. */
export interface LeaderboardService {
  getTopScores(): Promise<Array<{ alias: string; score: number; timestamp: string }>>;
  submitScore(alias: string, score: number): Promise<{ success: boolean; error?: string }>;
}

const DELTA_CAP_MS = 100;
const PERF_WARN_THRESHOLD_MS = 16;
const PERF_WARN_CONSECUTIVE = 3;
const DEFAULT_ROUND_DURATION_SECS = 180;

/** Manages Three.js hitbox meshes for all bots in a single round. */
class BotMeshManager implements BotRendererAdapter {
  private readonly meshes = new Map<EntityId, Mesh>();

  constructor(private readonly renderer: RendererInstance) {}

  getBotHitboxMesh(botId: EntityId): Mesh {
    let mesh = this.meshes.get(botId);
    if (!mesh) {
      const geo = new BoxGeometry(0.6, 1.8, 0.6);
      mesh = new Mesh(geo);
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

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.renderer.removeFromScene(mesh);
    }
    this.meshes.clear();
  }
}

export class GameEngine {
  private engineState: EngineState = 'uninitialized';
  private rafHandle: number | null = null;
  private lastFrameTimestamp = 0;
  private lastConfig: MatchConfig | null = null;
  private slowFrameCount = 0;
  private canvas: HTMLCanvasElement | null = null;
  private botMeshManager: BotMeshManager | null = null;

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
  ) {}

  /** Initialises all subsystems. Must complete before start() is called. */
  async init(canvas: HTMLCanvasElement, uiContainer: HTMLElement): Promise<void> {
    this.canvas = canvas;
    this.renderer.init(canvas);
    this.inputHandler.init();
    this.uiSystem.init(uiContainer);
    this.uiSystem.onAction((action) => this.onUIAction(action));
    this.engineState = 'menu';
  }

  /** Loads a map, spawns subsystems, and begins the 60fps tick loop. */
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

    await this.mapSystem.load(config.mapId);

    const spawnManifest = this.mapSystem.getSpawnPoints();
    const colliders = this.mapSystem.getColliders() as unknown as ColliderVolume[];
    const waypointGraph = this.mapSystem.getWaypointGraph();

    // Reset and configure round
    this.roundSystem.reset();
    this.roundSystem.configure({
      mapId: config.mapId,
      botCount: config.botCount,
      roundDurationMs: config.roundDurationSecs * 1000,
    });

    // Spawn player at first spawn point
    const playerSpawn = spawnManifest.player[0]!;
    this.playerSystem.spawn(playerSpawn, colliders);

    // Dispose previous round's bot meshes and create new ones
    this.botMeshManager?.dispose();
    this.botMeshManager = new BotMeshManager(this.renderer);

    this.botSystem.init(
      config.botCount,
      waypointGraph,
      spawnManifest.bots.slice(0, config.botCount),
      this.combatSystem,
      this.botMeshManager,
    );

    this.roundSystem.start();
    this.uiSystem.showHUD();
    this.canvas?.requestPointerLock?.();

    this.lastConfig = Object.freeze({ ...config });
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
        this.start(this._adaptUIConfig(action.config)).catch((err) => {
          console.error('GameEngine: start failed', err);
        });
        break;

      case 'play-again':
        if (this.lastConfig) {
          this.start(this.lastConfig).catch((err) => {
            console.error('GameEngine: play-again failed', err);
          });
        }
        break;

      case 'submit-score': {
        const score = this.roundSystem.getState().score;
        this._handleSubmitScore(action.alias, score).catch(() => {});
        break;
      }

      case 'view-leaderboard':
        this._handleViewLeaderboard().catch(() => {});
        break;

      default:
        console.warn('GameEngine: unrecognised UIAction', (action as { type: string }).type);
    }
  }

  get state(): EngineState {
    return this.engineState;
  }

  private _adaptUIConfig(config: { mapId: 'map-a' | 'map-b'; botCount: number }): MatchConfig {
    return {
      mapId: config.mapId,
      botCount: config.botCount,
      roundDurationSecs: DEFAULT_ROUND_DURATION_SECS,
    };
  }

  private _scheduleLoop(): void {
    this.rafHandle = requestAnimationFrame((timestamp) => this._tick(timestamp));
  }

  private _tick(timestamp: number): void {
    if (this.engineState !== 'in-round') return;

    const rawDelta = timestamp - this.lastFrameTimestamp;
    // rule-ge-06: cap delta at DELTA_CAP_MS to prevent spiral-of-death
    const deltaMs = Math.min(rawDelta, DELTA_CAP_MS);
    this.lastFrameTimestamp = timestamp;

    // 1. Input
    const inputState = this.inputHandler.getState();

    // 2. Player movement
    this.playerSystem.update(deltaMs, inputState);
    const playerState = this.playerSystem.getState();

    // 3. Bot AI
    this.botSystem.update(deltaMs, {
      position: playerState.position,
      health: playerState.health,
      alive: playerState.isAlive,
    });
    const botStates = this.botSystem.getAllStates();

    // 4. Round evaluation (combat events are resolved inline during fire() calls)
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
    if (!this.leaderboardClient) {
      this.uiSystem.onSubmitResult({ success: false, error: 'Leaderboard not configured' });
      return;
    }
    const result = await this.leaderboardClient.submitScore(alias, score);
    this.uiSystem.onSubmitResult(result);
  }

  private async _handleViewLeaderboard(): Promise<void> {
    if (!this.leaderboardClient) {
      this.uiSystem.showLeaderboard([]);
      return;
    }
    const entries = await this.leaderboardClient.getTopScores();
    this.uiSystem.showLeaderboard(entries);
  }
}
