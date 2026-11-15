/**
 * Integration test: composes the REAL engine, map, player, combat, bot, round
 * and UI systems with the real public/maps definitions. Only the WebGL
 * renderer, the GLB loader and raw input are stubbed. This is the contract
 * drift the per-module unit tests (all mocks) could not catch: map ids,
 * player combat registration, kill/damage propagation and bot mesh sync.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';

import { GameEngine } from '../game-engine.js';
import { MapSystem } from '../../map-system/map-system.js';
import { CombatSystem } from '../../combat-system/combat-system.js';
import { PlayerSystem } from '../../player-system/player-system.js';
import { BotSystem } from '../../bot-system/bot-system.js';
import { RoundSystem } from '../../round-system/round-system.js';
import { UISystem } from '../../ui-system/ui-system.js';
import { createUITemplate } from '../../ui-system/template.js';
import type { InputState } from '../../input-handler/types.js';
import type { MapId } from '../../map-system/types.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../public');
const FRAME_MS = 16;

function makeRendererStub() {
  return {
    init: vi.fn(),
    tick: vi.fn(),
    setCamera: vi.fn(),
    addToScene: vi.fn(),
    removeFromScene: vi.fn(),
    resize: vi.fn(),
  };
}

function makeInputStub() {
  const state: InputState = {
    forward: false, back: false, left: false, right: false,
    jump: false, shoot: false, reload: false, mouseDeltaX: 0, mouseDeltaY: 0,
  };
  return {
    state,
    init: vi.fn(),
    getState: vi.fn(() => ({ ...state })),
  };
}

/** Serves /maps/<id>/definition.json from the real public/ folder. */
function realMapFetch(url: string): Promise<Response> {
  const path = join(PUBLIC_DIR, url.replace(/^\//, ''));
  const body = readFileSync(path, 'utf-8');
  return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function screen(container: HTMLElement): string | null {
  return container.querySelector('.screen.active')?.getAttribute('data-screen') ?? null;
}

function hud(container: HTMLElement, key: string): string {
  return container.querySelector(`[data-hud="${key}"]`)!.textContent ?? '';
}

describe('match flow integration (real subsystems, real map data)', () => {
  let rafQueue: FrameRequestCallback[];
  let now: number;
  let container: HTMLElement;
  let canvas: HTMLCanvasElement;
  let input: ReturnType<typeof makeInputStub>;
  let combat: CombatSystem;
  let player: PlayerSystem;
  let bots: BotSystem;
  let round: RoundSystem;
  let engine: GameEngine;

  function build(botHealth?: number): void {
    const renderer = makeRendererStub();
    input = makeInputStub();
    combat = new CombatSystem();
    const map = new MapSystem(renderer, '', async () => ({ scene: new Group() }));
    player = new PlayerSystem(combat, renderer as never);
    bots = new BotSystem(botHealth !== undefined ? { maxHealth: botHealth } : {});
    round = new RoundSystem();
    engine = new GameEngine(
      renderer as never, input as never, map, combat, player, bots, round, new UISystem(),
    );
  }

  /** Runs queued animation frames until `until` is true or maxFrames elapse. */
  function runFrames(maxFrames: number, until: () => boolean = () => false): number {
    for (let i = 0; i < maxFrames; i++) {
      if (until()) return i;
      const cb = rafQueue.shift();
      if (!cb) return i;
      now += FRAME_MS;
      cb(now);
    }
    return maxFrames;
  }

  async function startMatch(mapId: MapId, botCount: number): Promise<void> {
    await engine.start({ mapId, botCount, roundDurationSecs: 180 });
  }

  beforeEach(async () => {
    rafQueue = [];
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
      rafQueue = [];
    });
    vi.stubGlobal('fetch', vi.fn(realMapFetch));
    if (!('exitPointerLock' in document)) {
      Object.defineProperty(document, 'exitPointerLock', { value: () => {}, configurable: true });
    }

    container = document.createElement('div');
    container.innerHTML = createUITemplate();
    document.body.appendChild(container);
    canvas = document.createElement('canvas');

    build();
    await engine.init(canvas, container);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([['dust'], ['compound']] as Array<[MapId]>)(
    'starts a match on %s with the real map definition (D-01, D-02)',
    async (mapId) => {
      await startMatch(mapId, 3);
      expect(engine.state).toBe('in-round');
      expect(screen(container)).toBe('hud');
      expect(hud(container, 'health')).toBe('100');
      expect(hud(container, 'ammo')).toBe('30');
      expect(hud(container, 'timer')).toBe('03:00');
    },
  );

  it('player shots kill the bot ahead: kills = 1, bot dead everywhere, Victory (D-03, D-05, D-06)', async () => {
    await startMatch('dust', 1);
    input.state.shoot = true;

    runFrames(120, () => engine.state === 'round-end');

    expect(engine.state).toBe('round-end');
    expect(round.getState()).toMatchObject({ outcome: 'win', kills: 1 });
    expect(bots.getAllStates()[0]!.state).toBe('dead');
    expect(combat.isEliminated('bot-1')).toBe(true);
    expect(screen(container)).toBe('end-round');
    expect(container.querySelector('[data-testid="outcome-display"]')!.textContent).toBe('Victory!');
    // Score formula: kills × 100 + secondsLeft × 10
    const { score, timeRemaining } = round.getState();
    expect(score).toBe(100 + Math.floor(timeRemaining / 1000) * 10);
  });

  it('fire rate: holding fire for 1 s of frames spends 8 rounds, not 60 (D-07)', async () => {
    // Bot far off-axis so shots miss and the round keeps going
    build(1000);
    await engine.init(canvas, container);
    await startMatch('compound', 1);
    input.state.shoot = true;
    runFrames(Math.round(1000 / FRAME_MS));
    expect(30 - player.getState().ammo).toBeLessThanOrEqual(9);
    expect(30 - player.getState().ammo).toBeGreaterThanOrEqual(7);
  });

  it('bot hits reduce HUD health by 20 and five hits end the round as Defeated (D-04)', async () => {
    await startMatch('dust', 1);
    runFrames(1);
    const p = player.getState().position;
    const origin = { x: p.x, y: 1.7, z: p.z + 5 };
    const towardPlayer = { x: 0, y: 0, z: -1 };

    combat.fire(origin, towardPlayer, 'bot-1', 20, (id) => id === 'player');
    runFrames(1);
    expect(player.getState().health).toBe(80);
    expect(combat.getHealth('player')).toBe(80);
    expect(hud(container, 'health')).toBe('80');

    for (let i = 0; i < 4; i++) combat.fire(origin, towardPlayer, 'bot-1', 20, (id) => id === 'player');
    runFrames(2);

    expect(player.getState().isAlive).toBe(false);
    expect(engine.state).toBe('round-end');
    expect(container.querySelector('[data-testid="outcome-display"]')!.textContent).toBe('Defeated');
  });

  it('three consecutive rounds keep only the player and current bots registered (D-09)', async () => {
    for (let roundNo = 0; roundNo < 3; roundNo++) {
      if (roundNo === 0) {
        await startMatch('dust', 2);
      } else {
        engine.onUIAction({ type: 'play-again' });
        await vi.waitFor(() => expect(engine.state).toBe('in-round'));
      }
      expect(screen(container)).toBe('hud');
      expect(combat.getCombatantIds().sort()).toEqual(['bot-1', 'bot-2', 'player']);
      expect(hud(container, 'kills')).toBe('0');
      expect(hud(container, 'ammo')).toBe('30');

      // End the round by player death
      combat.applyDamage('player', 100);
      player.takeDamage(100, 'test');
      runFrames(2);
      expect(engine.state).toBe('round-end');
    }
  });

  it('bot meshes follow bot positions while bots patrol (D-06)', async () => {
    const addSpy = vi.fn();
    const renderer = makeRendererStub();
    renderer.addToScene = addSpy;
    input = makeInputStub();
    combat = new CombatSystem();
    const map = new MapSystem(renderer, '', async () => ({ scene: new Group() }));
    player = new PlayerSystem(combat, renderer as never);
    bots = new BotSystem();
    round = new RoundSystem();
    engine = new GameEngine(renderer as never, input as never, map, combat, player, bots, round, new UISystem());
    await engine.init(canvas, container);
    await startMatch('compound', 2);

    runFrames(90); // past idle, into patrol

    const meshes = addSpy.mock.calls
      .map(([obj]) => obj as { userData: Record<string, unknown>; position: { x: number; y: number; z: number } })
      .filter((o) => o.userData['isHitbox'] === true);
    expect(meshes).toHaveLength(2);
    for (const bot of bots.getAllStates()) {
      const mesh = meshes.find((m) => m.userData['entityId'] === bot.id)!;
      expect(mesh.position.x).toBeCloseTo(bot.position.x);
      expect(mesh.position.z).toBeCloseTo(bot.position.z);
    }
  });
});
