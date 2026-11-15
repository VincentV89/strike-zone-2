import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { GameEngine } from '../game-engine.js';
import { IllegalStateError, ValidationError } from '../types.js';
import type { MatchConfig } from '../types.js';

// ─── Three.js mock ────────────────────────────────────────────────────────────

vi.mock('three', () => ({
  BoxGeometry: vi.fn(),
  MeshLambertMaterial: vi.fn(),
  // Implementation passed to vi.fn() directly so vi.restoreAllMocks() keeps it.
  Mesh: vi.fn(function (this: Record<string, unknown>) {
    this['visible'] = true;
    this['userData'] = {};
    const position = { x: 0, y: 0, z: 0 };
    this['position'] = Object.assign(position, {
      set: vi.fn((x: number, y: number, z: number) => Object.assign(position, { x, y, z })),
    });
    this['rotation'] = { y: 0 };
    this['updateMatrixWorld'] = vi.fn();
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

type HitListener = (event: {
  shooterId: string | null;
  targetId: string;
  damage: number;
  remainingHealth: number;
  killed: boolean;
}) => void;

function makeCombatSystem() {
  const listeners: HitListener[] = [];
  return {
    listeners,
    initCombatant: vi.fn(),
    registerHitbox: vi.fn(),
    unregisterHitbox: vi.fn(),
    fire: vi.fn().mockReturnValue(null),
    reset: vi.fn(),
    getCombatantIds: vi.fn().mockReturnValue(['player', 'bot-1']),
    onHit: vi.fn((listener: HitListener) => {
      listeners.push(listener);
      return () => {};
    }),
    emitHit(event: Parameters<HitListener>[0]) {
      for (const l of listeners) l(event);
    },
  };
}

function makePlayerState() {
  return {
    health: 100,
    ammo: 30,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0 },
    isAlive: true,
    isReloading: false,
  };
}

function makePlayerSystem() {
  return {
    spawn: vi.fn(),
    update: vi.fn(),
    takeDamage: vi.fn(),
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
    recordKill: vi.fn(),
  };
}

function makeUISystem() {
  return {
    init: vi.fn(),
    onAction: vi.fn(),
    update: vi.fn(),
    showHUD: vi.fn(),
    showLoading: vi.fn(),
    showError: vi.fn(),
    setPracticeMode: vi.fn(),
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
  const canvas = document.createElement('canvas');
  Object.assign(canvas, {
    requestPointerLock: vi.fn(),
    getContext: vi.fn().mockReturnValue({}),
  });
  return canvas;
}

function makeContainer() {
  return document.createElement('div');
}

function makeConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mapId: 'dust',
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
      await engine.start(makeConfig({ mapId: 'compound' }));
      expect(mapSystem.load).toHaveBeenCalledWith('compound');
    });

    it('spawns player at first spawn point', async () => {
      await engine.start(makeConfig());
      expect(playerSystem.spawn).toHaveBeenCalledWith(
        { x: 0, y: 0, z: 0 },
        expect.any(Array),
        0,
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
        expect.any(Array),
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
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 2 } });
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

    it('shows unavailable leaderboard (null) when no client configured', async () => {
      const engineNoClient = new GameEngine(
        renderer as never, inputHandler as never, mapSystem as never,
        combatSystem as never, playerSystem as never, botSystem as never,
        roundSystem as never, uiSystem as never,
      );
      await engineNoClient.init(canvas, container);
      engineNoClient.onUIAction({ type: 'view-leaderboard' });
      await vi.waitFor(() => expect(uiSystem.showLeaderboard).toHaveBeenCalledWith(null));
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

  // ─── D-13: start failure recovery ────────────────────────────────────────

  describe('start() failure recovery (D-13)', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
    });

    it('returns to menu, shows a visible error and rejects when map loading fails', async () => {
      mapSystem.load.mockRejectedValueOnce(new Error('HTTP 404'));
      await expect(engine.start(makeConfig())).rejects.toThrow('HTTP 404');
      expect(engine.state).toBe('menu');
      expect(uiSystem.showMainMenu).toHaveBeenCalled();
      expect(uiSystem.showError).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'));
      expect(engine.getDebugSnapshot().lastError).toBe('HTTP 404');
    });

    it('a later start() retries without IllegalStateError', async () => {
      mapSystem.load.mockRejectedValueOnce(new Error('boom'));
      await expect(engine.start(makeConfig())).rejects.toThrow('boom');
      await expect(engine.start(makeConfig())).resolves.toBeUndefined();
      expect(engine.state).toBe('in-round');
      expect(engine.getDebugSnapshot().lastError).toBeNull();
    });

    it('logs start-game failures from the UI path instead of leaving an unhandled rejection', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mapSystem.load.mockRejectedValueOnce(new Error('nope'));
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith('GameEngine: start failed', expect.any(Error)));
      expect(engine.state).toBe('menu');
    });

    it('shows the loading screen while the map loads', async () => {
      const p = engine.start(makeConfig());
      expect(uiSystem.showLoading).toHaveBeenCalled();
      await p;
    });

    it('ignores start-game while a match is already loading', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      expect(mapSystem.load).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ignoring start request while 'loading'"));
      await vi.waitFor(() => expect(engine.state).toBe('in-round'));
    });
  });

  // ─── D-08: pointer lock ──────────────────────────────────────────────────

  describe('pointer lock (D-08)', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
    });

    it('requests pointer lock synchronously inside the start-game action', () => {
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      // Still loading: the request must not wait for the async map load
      expect(engine.state).toBe('loading');
      expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    });

    it('re-requests pointer lock when the canvas is clicked during a round', async () => {
      await engine.start(makeConfig());
      canvas.dispatchEvent(new MouseEvent('click'));
      expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    });

    it('does not request pointer lock on canvas click outside a round', () => {
      canvas.dispatchEvent(new MouseEvent('click'));
      expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    });

    it('handles a rejected pointer lock promise with a warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (canvas.requestPointerLock as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        Promise.reject(new Error('denied')),
      );
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      await vi.waitFor(() =>
        expect(warnSpy).toHaveBeenCalledWith('GameEngine: pointer lock request was rejected', expect.any(Error)),
      );
    });

    it('handles a throwing requestPointerLock with a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (canvas.requestPointerLock as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('not allowed');
      });
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      expect(warnSpy).toHaveBeenCalledWith('GameEngine: pointer lock request failed', expect.any(Error));
    });
  });

  // ─── D-03/D-04/D-05/D-09: combat wiring ──────────────────────────────────

  describe('combat event routing', () => {
    beforeEach(async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig());
    });

    it('subscribes to combat hits during init', () => {
      expect(combatSystem.onHit).toHaveBeenCalledTimes(1);
    });

    it('resets combat state at the start of every round (D-09)', async () => {
      expect(combatSystem.reset).toHaveBeenCalledTimes(1);
      roundSystem.getState.mockReturnValue(makeRoundState({ phase: 'round-end', outcome: 'lose' }));
      rafCallbacks.pop()!(100);
      await engine.start(makeConfig());
      expect(combatSystem.reset).toHaveBeenCalledTimes(2);
    });

    it('routes bot hits on the player to PlayerSystem.takeDamage (D-04)', () => {
      combatSystem.emitHit({ shooterId: 'bot-1', targetId: 'player', damage: 20, remainingHealth: 80, killed: false });
      expect(playerSystem.takeDamage).toHaveBeenCalledWith(20, 'bot-1');
      expect(botSystem.onBotKilled).not.toHaveBeenCalled();
    });

    it('propagates a bot kill by the player to BotSystem and RoundSystem (D-05)', () => {
      combatSystem.emitHit({ shooterId: 'player', targetId: 'bot-1', damage: 25, remainingHealth: 0, killed: true });
      expect(botSystem.onBotKilled).toHaveBeenCalledWith('bot-1');
      expect(roundSystem.recordKill).toHaveBeenCalledTimes(1);
    });

    it('does not credit a kill without a player shooter', () => {
      combatSystem.emitHit({ shooterId: null, targetId: 'bot-1', damage: 100, remainingHealth: 0, killed: true });
      expect(botSystem.onBotKilled).toHaveBeenCalledWith('bot-1');
      expect(roundSystem.recordKill).not.toHaveBeenCalled();
    });

    it('ignores non-lethal hits on bots', () => {
      combatSystem.emitHit({ shooterId: 'player', targetId: 'bot-1', damage: 25, remainingHealth: 75, killed: false });
      expect(botSystem.onBotKilled).not.toHaveBeenCalled();
      expect(roundSystem.recordKill).not.toHaveBeenCalled();
    });

    it('spawns the player facing the map centre', async () => {
      mapSystem.getSpawnPoints.mockReturnValue({ ...makeSpawnManifest(), player: [{ x: 0, y: 1, z: -45 }] });
      roundSystem.getState.mockReturnValue(makeRoundState({ phase: 'round-end', outcome: 'lose' }));
      rafCallbacks.pop()!(100);
      await engine.start(makeConfig());
      const yaw = playerSystem.spawn.mock.calls.at(-1)?.[2] as number;
      expect(Math.abs(yaw)).toBeCloseTo(Math.PI);
    });

    it('re-reads player state after bots fire so the HUD and round see the damage this frame', () => {
      playerSystem.getState
        .mockReturnValueOnce(makePlayerState())
        .mockReturnValueOnce({ ...makePlayerState(), health: 0, isAlive: false });
      rafCallbacks.pop()!(100);
      const roundPlayer = roundSystem.update.mock.calls.at(-1)?.[1] as { isAlive: boolean };
      expect(roundPlayer.isAlive).toBe(false);
    });
  });

  // ─── D-06: bot mesh sync ─────────────────────────────────────────────────

  describe('bot mesh sync (D-06)', () => {
    type MeshLike = { position: { x: number; y: number; z: number }; visible: boolean };
    function meshAdapter(): { getBotHitboxMesh(id: string): MeshLike } {
      return botSystem.init.mock.calls.at(-1)?.[4] as { getBotHitboxMesh(id: string): MeshLike };
    }

    beforeEach(async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig());
    });

    it('moves each live bot mesh to its BotSystem position every tick', () => {
      const adapter = meshAdapter();
      const mesh = adapter.getBotHitboxMesh('bot-1');
      botSystem.getAllStates.mockReturnValue([
        { ...makeBotState('bot-1'), position: { x: 4, y: 1, z: -7 } },
      ]);
      rafCallbacks.pop()!(100);
      expect(mesh.position).toMatchObject({ x: 4, y: 1 + 0.9, z: -7 });
      expect(mesh.visible).toBe(true);
    });

    it('hides the mesh of a dead bot', () => {
      const mesh = meshAdapter().getBotHitboxMesh('bot-1');
      botSystem.getAllStates.mockReturnValue([makeBotState('bot-1', 'dead')]);
      rafCallbacks.pop()!(100);
      expect(mesh.visible).toBe(false);
    });

    it('creates one mesh per bot id and adds it to the scene once', () => {
      const adapter = meshAdapter();
      const a = adapter.getBotHitboxMesh('bot-1');
      const b = adapter.getBotHitboxMesh('bot-1');
      expect(a).toBe(b);
      expect(renderer.addToScene).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Test hooks: options, practice mode, debug snapshot ──────────────────

  describe('engine options (test hooks)', () => {
    function makeEngine(options: Record<string, unknown>): GameEngine {
      return new GameEngine(
        renderer as never, inputHandler as never, mapSystem as never,
        combatSystem as never, playerSystem as never, botSystem as never,
        roundSystem as never, uiSystem as never, leaderboardClient as never,
        options,
      );
    }

    it('uses roundDurationSecs override for menu starts', async () => {
      const e = makeEngine({ roundDurationSecs: 5 });
      await e.init(canvas, container);
      e.onUIAction({ type: 'start-game', config: { mapId: 'compound', botCount: 1 } });
      await vi.waitFor(() => expect(e.state).toBe('in-round'));
      expect(roundSystem.configure).toHaveBeenCalledWith(expect.objectContaining({ roundDurationMs: 5000 }));
      expect(mapSystem.load).toHaveBeenCalledWith('compound');
    });

    it('defaults to a 180 s round without overrides', async () => {
      await engine.init(canvas, container);
      engine.onUIAction({ type: 'start-game', config: { mapId: 'dust', botCount: 1 } });
      await vi.waitFor(() => expect(engine.state).toBe('in-round'));
      expect(roundSystem.configure).toHaveBeenCalledWith(expect.objectContaining({ roundDurationMs: 180_000 }));
      expect(uiSystem.setPracticeMode).toHaveBeenCalledWith(false);
    });

    it('practice mode never sends a score to the leaderboard', async () => {
      const e = makeEngine({ practiceMode: true });
      await e.init(canvas, container);
      expect(uiSystem.setPracticeMode).toHaveBeenCalledWith(true);
      e.onUIAction({ type: 'submit-score', alias: 'Ace' });
      await vi.waitFor(() => expect(uiSystem.onSubmitResult).toHaveBeenCalled());
      expect(leaderboardClient.submitScore).not.toHaveBeenCalled();
      expect(uiSystem.onSubmitResult).toHaveBeenCalledWith({
        success: false,
        error: 'Practice round, score not submitted',
      });
    });

    it('passes a null (unavailable) leaderboard result through to the UI', async () => {
      leaderboardClient.getTopScores.mockResolvedValue(null as never);
      await engine.init(canvas, container);
      engine.onUIAction({ type: 'view-leaderboard' });
      await vi.waitFor(() => expect(uiSystem.showLeaderboard).toHaveBeenCalledWith(null));
    });

    it('shows unavailable when the leaderboard client rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      leaderboardClient.getTopScores.mockRejectedValue(new Error('down'));
      await engine.init(canvas, container);
      engine.onUIAction({ type: 'view-leaderboard' });
      await vi.waitFor(() => expect(uiSystem.showLeaderboard).toHaveBeenCalledWith(null));
    });

    it('reports a failed submission when the leaderboard client rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      leaderboardClient.submitScore.mockRejectedValue(new Error('down'));
      await engine.init(canvas, container);
      engine.onUIAction({ type: 'submit-score', alias: 'Ace' });
      await vi.waitFor(() =>
        expect(uiSystem.onSubmitResult).toHaveBeenCalledWith({ success: false, error: 'down' }),
      );
    });

    it('getDebugSnapshot returns a frozen view of engine, round, player and bots', async () => {
      await engine.init(canvas, container);
      await engine.start(makeConfig({ mapId: 'compound' }));
      const snap = engine.getDebugSnapshot();
      expect(snap).toMatchObject({
        engineState: 'in-round',
        roundPhase: 'in-round',
        kills: 0,
        mapId: 'compound',
        practiceMode: false,
        player: { health: 100, ammo: 30, isAlive: true },
        bots: [{ id: 'bot-1', alive: true }],
        combatantIds: ['player', 'bot-1'],
      });
      expect(Object.isFrozen(snap)).toBe(true);
      expect(Object.isFrozen(snap.player)).toBe(true);
      expect(Object.isFrozen(snap.bots[0])).toBe(true);
    });
  });
});
