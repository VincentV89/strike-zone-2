import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { GameEngine } from '../game-engine.js';
import { IllegalStateError, ValidationError } from '../types.js';
import type { MatchConfig } from '../types.js';

// ─── Three.js mock ────────────────────────────────────────────────────────────

vi.mock('three', () => ({
  BoxGeometry: vi.fn(),
  Mesh: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['visible'] = true;
    this['userData'] = {};
  }),
}));

// ─── Subsystem factories ──────────────────────────────────────────────────────

function makeRenderer() {
  return {
    init: vi.fn(),
    tick: vi.fn(),
    setCamera: vi.fn(),
    addToScene: vi.fn(),
    removeFromScene: vi.fn(),
    raycast: vi.fn().mockReturnValue(null),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeInputHandler() {
  return {
    init: vi.fn(),
    getState: vi.fn().mockReturnValue({
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      shoot: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }),
    destroy: vi.fn(),
  };
}

function makeSpawnManifest() {
  return {
    player: [{ x: 0, y: 0, z: 0 }],
    bots: Array.from({ length: 8 }, (_, i) => ({ x: i * 2, y: 0, z: 5 })),
  };
}

function makeWaypointGraph() {
  return {
    nodes: new Map(),
    findNearest: vi.fn().mockReturnValue({ id: 'wp0', position: { x: 0, y: 0, z: 0 }, neighbors: [] }),
  };
}

function makeMapSystem() {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn(),
    getSpawnPoints: vi.fn().mockReturnValue(makeSpawnManifest()),
    getColliders: vi.fn().mockReturnValue([]),
    getWaypointGraph: vi.fn().mockReturnValue(makeWaypointGraph()),
    state: 'idle',
  };
}

function makeCombatSystem() {
  return {
    initCombatant: vi.fn(),
    registerHitbox: vi.fn(),
    unregisterHitbox: vi.fn(),
    fire: vi.fn().mockReturnValue(null),
  };
}

function makePlayerState() {
  return {
    health: 100,
    ammo: 30,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0 },
    isAlive: true,
  };
}

function makePlayerSystem() {
  return {
    spawn: vi.fn(),
    update: vi.fn(),
    getState: vi.fn().mockReturnValue(makePlayerState()),
  };
}

function makeBotState(id: string, state = 'patrol') {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    health: 100,
    state,
  };
}

function makeBotSystem() {
  return {
    init: vi.fn(),
    update: vi.fn(),
    getAllStates: vi.fn().mockReturnValue([makeBotState('bot-1')]),
    reset: vi.fn(),
    onBotKilled: vi.fn(),
  };
}

function makeRoundState(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'in-round',
    timeRemaining: 60_000,
    outcome: null,
    kills: 0,
    score: 0,
    ...overrides,
  };
}

function makeRoundSystem() {
  const state = makeRoundState();
  return {
    configure: vi.fn(),
    start: vi.fn(),
    update: vi.fn().mockImplementation(() => {}),
    getState: vi.fn().mockReturnValue(state),
    reset: vi.fn(),
  };
}

function makeUISystem() {
  return {
    init: vi.fn(),
    onAction: vi.fn(),
    update: vi.fn(),
    showHUD: vi.fn(),
    showMainMenu: vi.fn(),
    showEndRound: vi.fn(),
    showLeaderboard: vi.fn(),
    onSubmitResult: vi.fn(),
  };
}

function makeLeaderboardClient() {
  return {
    getTopScores: vi.fn().mockResolvedValue([]),
    submitScore: vi.fn().mockResolvedValue({ success: true }),
  };
}

function makeCanvas() {
  return {
    requestPointerLock: vi.fn(),
    getContext: vi.fn().mockReturnValue({}),
  } as unknown as HTMLCanvasElement;
}

function makeContainer() {
  return document.createElement('div');
}

function makeConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mapId: 'map-a',
    botCount: 3,
    roundDurationSecs: 60,
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('GameEngine', () => {
  let renderer: ReturnType<typeof makeRenderer>;
  let inputHandler: ReturnType<typeof makeInputHandler>;
  let mapSystem: ReturnType<typeof makeMapSystem>;
  let combatSystem: ReturnType<typeof makeCombatSystem>;
  let playerSystem: ReturnType<typeof makePlayerSystem>;
  let botSystem: ReturnType<typeof makeBotSystem>;
  let roundSystem: ReturnType<typeof makeRoundSystem>;
  let uiSystem: ReturnType<typeof makeUISystem>;
  let leaderboardClient: ReturnType<typeof makeLeaderboardClient>;
  let engine: GameEngine;
  let canvas: HTMLCanvasElement;
  let container: HTMLElement;

  let rafCallbacks: Array<FrameRequestCallback>;
  let rafHandle: number;

  beforeEach(() => {
    renderer = makeRenderer();
    inputHandler = makeInputHandler();
    mapSystem = makeMapSystem();
    combatSystem = makeCombatSystem();
    playerSystem = makePlayerSystem();
    botSystem = makeBotSystem();
    roundSystem = makeRoundSystem();
    uiSystem = makeUISystem();
    leaderboardClient = makeLeaderboardClient();
    canvas = makeCanvas();
    container = makeContainer();

    rafCallbacks = [];
    rafHandle = 0;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return ++rafHandle;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    // jsdom does not define exitPointerLock — add it so we can assert on it
    if (!('exitPointerLock' in document)) {
      Object.defineProperty(document, 'exitPointerLock', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      });
    } else {
      vi.spyOn(document, 'exitPointerLock').mockImplementation(() => {});
    }

    engine = new GameEngine(
      renderer as never,
      inputHandler as never,
      mapSystem as never,
      combatSystem as never,
      playerSystem as never,
      botSystem as never,
      roundSystem as never,
      uiSystem as never,
      leaderboardClient as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Lifecycle: init ─────────────────────────────────────────────────────

  describe('init()', () => {
    it('transitions state from uninitialized to menu', async () => {
      expect(engine.state).toBe('uninitialized');
      await engine.init(canvas, container);
      expect(engine.state).toBe('menu');
    });

    it('initialises renderer, inputHandler, and uiSystem', async () => {
      await engine.init(canvas, container);
      expect(renderer.init).toHaveBeenCalledWith(canvas);
      expect(inputHandler.init).toHaveBeenCalled();
      expect(uiSystem.init).toHaveBeenCalledWith(container);
    });

    it('registers onAction callback with uiSystem', async () => {
      await engine.init(canvas, container);
      expect(uiSystem.onAction).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ─── Lifecycle: start ────────────────────────────────────────────────────

  describe('start()', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
    });

    it('throws IllegalStateError when called in uninitialized state', async () => {
      const freshEngine = new GameEngine(
        renderer as never, inputHandler as never, mapSystem as never,
        combatSystem as never, playerSystem as never, botSystem as never,
        roundSystem as never, uiSystem as never,
      );
      await expect(freshEngine.start(makeConfig())).rejects.toBeInstanceOf(IllegalStateError);
    });

    it('throws ValidationError when botCount < 1', async () => {
      await expect(engine.start(makeConfig({ botCount: 0 }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError when roundDurationSecs <= 0', async () => {
      await expect(engine.start(makeConfig({ roundDurationSecs: 0 }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('transitions through loading to in-round', async () => {
      const startPromise = engine.start(makeConfig());
      // State is 'loading' during async map load
      expect(engine.state).toBe('loading');
      await startPromise;
      expect(engine.state).toBe('in-round');
    });

    it('calls mapSystem.load with the configured mapId', async () => {
      await engine.start(makeConfig({ mapId: 'map-b' }));
      expect(mapSystem.load).toHaveBeenCalledWith('map-b');
    });

    it('spawns player at first spawn point', async () => {
      await engine.start(makeConfig());
      expect(playerSystem.spawn).toHaveBeenCalledWith(
        { x: 0, y: 0, z: 0 },
        expect.any(Array),
      );
    });

    it('configures and starts round system', async () => {
      await engine.start(makeConfig({ roundDurationSecs: 90, botCount: 2 }));
      expect(roundSystem.reset).toHaveBeenCalled();
      expect(roundSystem.configure).toHaveBeenCalledWith(expect.objectContaining({
        roundDurationMs: 90_000,
        botCount: 2,
      }));
      expect(roundSystem.start).toHaveBeenCalled();
    });

    it('initialises bot system with correct count and spawn points', async () => {
      await engine.start(makeConfig({ botCount: 2 }));
      expect(botSystem.init).toHaveBeenCalledWith(
        2,
        expect.any(Object),
        expect.arrayContaining([expect.objectContaining({ x: expect.any(Number) })]),
        combatSystem,
        expect.any(Object),
      );
    });

    it('shows HUD on uiSystem after transition to in-round', async () => {
      await engine.start(makeConfig());
      expect(uiSystem.showHUD).toHaveBeenCalled();
    });

    it('schedules first RAF frame', async () => {
      await engine.start(makeConfig());
      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    });

    it('throws IllegalStateError when called while in-round', async () => {
      await engine.start(makeConfig());
      await expect(engine.start(makeConfig())).rejects.toBeInstanceOf(IllegalStateError);
    });
  });

  // ─── Lifecycle: stop ─────────────────────────────────────────────────────

  describe('stop()', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
    });

    it('no-ops in menu state', () => {
      expect(() => engine.stop()).not.toThrow();
      expect(engine.state).toBe('menu');
    });

    it('cancels RAF loop and transitions to menu from in-round', async () => {
      await engine.start(makeConfig());
      engine.stop();
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
      expect(engine.state).toBe('menu');
    });

    it('releases pointer lock', async () => {
      await engine.start(makeConfig());
      engine.stop();
      expect(document.exitPointerLock).toHaveBeenCalled();
    });

    it('shows main menu', async () => {
      await engine.start(makeConfig());
      engine.stop();
      expect(uiSystem.showMainMenu).toHaveBeenCalled();
    });
  });

  // ─── Game loop tick ───────────────────────────────────────────────────────

  describe('tick loop', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig());
    });

    function runOneTick(timestamp = 100): void {
      const cb = rafCallbacks.pop();
      cb!(timestamp);
    }

    it('calls inputHandler.getState each frame', () => {
      runOneTick();
      expect(inputHandler.getState).toHaveBeenCalled();
    });

    it('calls playerSystem.update with clamped deltaMs', () => {
      runOneTick(1000); // very large timestamp gap — will be clamped to 100ms
      expect(playerSystem.update).toHaveBeenCalledWith(expect.any(Number), expect.any(Object));
      const delta = (playerSystem.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number;
      expect(delta).toBeLessThanOrEqual(100);
    });

    it('calls botSystem.update with player position/health/alive', () => {
      playerSystem.getState.mockReturnValue({
        ...makePlayerState(),
        health: 75,
        isAlive: true,
        position: { x: 1, y: 0, z: 2 },
      });
      runOneTick();
      expect(botSystem.update).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ health: 75, alive: true }),
      );
    });

    it('calls roundSystem.update with player state and bot states', () => {
      runOneTick();
      expect(roundSystem.update).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Object),
        expect.any(Array),
      );
    });

    it('calls renderer.tick each frame', () => {
      runOneTick();
      expect(renderer.tick).toHaveBeenCalled();
    });

    it('calls uiSystem.update with current states', () => {
      runOneTick();
      expect(uiSystem.update).toHaveBeenCalledWith(expect.objectContaining({
        playerState: expect.any(Object),
        roundState: expect.any(Object),
      }));
    });

    it('schedules next RAF frame while in-round', () => {
      // Pop and run the existing callback; the tick should queue a new one
      const cb = rafCallbacks.pop()!;
      cb(100);
      expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
    });

    it('does not schedule next RAF when round ends', () => {
      roundSystem.getState.mockReturnValue(makeRoundState({ phase: 'round-end', outcome: 'win', score: 100 }));
      runOneTick();
      // After round-end tick, state changes but no further RAF is queued in this tick
      expect(engine.state).toBe('round-end');
    });
  });

  // ─── Round end ───────────────────────────────────────────────────────────

  describe('round end', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig());
    });

    function triggerRoundEnd(outcome: 'win' | 'lose', score = 42): void {
      roundSystem.getState.mockReturnValue(
        makeRoundState({ phase: 'round-end', outcome, score }),
      );
      const cb = rafCallbacks.pop()!;
      cb(100);
    }

    it('transitions to round-end state on win', () => {
      triggerRoundEnd('win');
      expect(engine.state).toBe('round-end');
    });

    it('calls uiSystem.showEndRound with outcome and score', () => {
      triggerRoundEnd('win', 150);
      expect(uiSystem.showEndRound).toHaveBeenCalledWith('win', 150);
    });

    it('releases pointer lock on round-end', () => {
      triggerRoundEnd('lose');
      expect(document.exitPointerLock).toHaveBeenCalled();
    });

    it('defaults outcome to lose when null', () => {
      roundSystem.getState.mockReturnValue(
        makeRoundState({ phase: 'round-end', outcome: null, score: 0 }),
      );
      const cb = rafCallbacks.pop()!;
      cb(100);
      expect(uiSystem.showEndRound).toHaveBeenCalledWith('lose', 0);
    });
  });

  // ─── onUIAction routing ───────────────────────────────────────────────────

  describe('onUIAction()', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
    });

    it('routes start-game to start()', async () => {
      engine.onUIAction({ type: 'start-game', config: { mapId: 'map-a', botCount: 2 } });
      await vi.waitFor(() => expect(engine.state).toBe('in-round'));
    });

    it('routes play-again to start() with lastConfig', async () => {
      await engine.start(makeConfig({ botCount: 4 }));
      engine.stop();
      engine.onUIAction({ type: 'play-again' });
      await vi.waitFor(() => expect(engine.state).toBe('in-round'));
      expect(mapSystem.load).toHaveBeenCalledTimes(2);
    });

    it('play-again is a no-op if no lastConfig', () => {
      engine.onUIAction({ type: 'play-again' });
      expect(mapSystem.load).not.toHaveBeenCalled();
    });

    it('routes submit-score to leaderboard client and calls onSubmitResult', async () => {
      await engine.start(makeConfig());
      roundSystem.getState.mockReturnValue(makeRoundState({ score: 50 }));
      engine.onUIAction({ type: 'submit-score', alias: 'Player1' });
      await vi.waitFor(() => expect(uiSystem.onSubmitResult).toHaveBeenCalled());
      expect(leaderboardClient.submitScore).toHaveBeenCalledWith('Player1', 50);
      expect(uiSystem.onSubmitResult).toHaveBeenCalledWith({ success: true });
    });

    it('routes view-leaderboard to leaderboard client and calls showLeaderboard', async () => {
      const entries = [{ alias: 'Top', score: 999, timestamp: '2026-01-01' }];
      leaderboardClient.getTopScores.mockResolvedValue(entries);
      engine.onUIAction({ type: 'view-leaderboard' });
      await vi.waitFor(() => expect(uiSystem.showLeaderboard).toHaveBeenCalled());
      expect(uiSystem.showLeaderboard).toHaveBeenCalledWith(entries);
    });

    it('shows empty leaderboard when no client configured', async () => {
      const engineNoClient = new GameEngine(
        renderer as never, inputHandler as never, mapSystem as never,
        combatSystem as never, playerSystem as never, botSystem as never,
        roundSystem as never, uiSystem as never,
      );
      await engineNoClient.init(canvas, container);
      engineNoClient.onUIAction({ type: 'view-leaderboard' });
      await vi.waitFor(() => expect(uiSystem.showLeaderboard).toHaveBeenCalledWith([]));
    });

    it('submit-score with no client calls onSubmitResult with error', async () => {
      const engineNoClient = new GameEngine(
        renderer as never, inputHandler as never, mapSystem as never,
        combatSystem as never, playerSystem as never, botSystem as never,
        roundSystem as never, uiSystem as never,
      );
      await engineNoClient.init(canvas, container);
      await engineNoClient.start(makeConfig());
      engineNoClient.onUIAction({ type: 'submit-score', alias: 'x' });
      await vi.waitFor(() => expect(uiSystem.onSubmitResult).toHaveBeenCalled());
      expect(uiSystem.onSubmitResult).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('silently ignores unrecognised action types', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      engine.onUIAction({ type: 'unknown-action' } as never);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unrecognised UIAction'),
        'unknown-action',
      );
    });
  });

  // ─── Delta capping ────────────────────────────────────────────────────────

  describe('delta time capping', () => {
    it('caps deltaMs at 100ms even when raw delta is much larger', async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig());

      // Simulate a 500ms gap (tab was hidden)
      const cb = rafCallbacks.pop()!;
      cb(500 + (performance.now() - 500)); // force huge raw delta

      const callArgs = (playerSystem.update as ReturnType<typeof vi.fn>).mock.calls[0] as [number, unknown];
      expect(callArgs[0]).toBeLessThanOrEqual(100);
    });
  });

  // ─── State guard: start from round-end ───────────────────────────────────

  describe('play-again via start() from round-end', () => {
    it('allows start() when in round-end state', async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig());

      // Force round-end
      roundSystem.getState.mockReturnValue(makeRoundState({ phase: 'round-end', outcome: 'win' }));
      const cb = rafCallbacks.pop()!;
      cb(100);
      expect(engine.state).toBe('round-end');

      // Now start again
      await expect(engine.start(makeConfig())).resolves.not.toThrow();
      expect(engine.state).toBe('in-round');
    });
  });
});
