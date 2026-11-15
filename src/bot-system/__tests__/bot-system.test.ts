import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mesh } from 'three';

import {
  BotSystem,
  MAX_BOTS,
  BOT_MAX_HEALTH,
  IDLE_DURATION_MS,
  BOT_AIM_HEIGHT,
  BOT_EYE_OFFSET_Y,
  BOT_HALF_WIDTH,
} from '../bot-system.js';
import type { BotRendererAdapter, CombatAdapter, PlayerState } from '../types.js';
import type { Vec3 } from '../../renderer-core/types.js';
import type { ColliderVolume, WaypointGraph, WaypointNode } from '../../map-system/types.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeMesh(): Mesh {
  return {} as unknown as Mesh;
}

function makeVec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

function makePlayer(overrides?: Partial<PlayerState>): PlayerState {
  return { position: makeVec3(100, 0, 100), health: 100, alive: true, ...overrides };
}

function makeWaypointNode(id: string, pos: Vec3, neighborIds: string[] = []): WaypointNode {
  return {
    id,
    position: pos,
    neighbors: [],  // resolved below by makeWaypointGraph
  };
}

function makeWaypointGraph(nodeCount = 4): WaypointGraph {
  const nodeList: WaypointNode[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `wp${i}`,
    position: makeVec3(i * 2, 0, 0),
    neighbors: [] as WaypointNode[],
  }));

  // Link as a simple chain: wp0 ↔ wp1 ↔ wp2 ↔ ...
  for (let i = 0; i < nodeList.length; i++) {
    const prev = i > 0 ? nodeList[i - 1] : null;
    const next = i < nodeList.length - 1 ? nodeList[i + 1] : null;
    (nodeList[i]!.neighbors as WaypointNode[]).push(
      ...[prev, next].filter((n): n is WaypointNode => n !== null),
    );
  }

  const nodesMap = new Map<string, WaypointNode>(nodeList.map((n) => [n.id, n]));

  return {
    nodes: nodesMap,
    findNearest(pos: Vec3): WaypointNode {
      let nearest = nodeList[0]!;
      let minDist = Infinity;
      for (const node of nodeList) {
        const dx = node.position.x - pos.x;
        const dz = node.position.z - pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < minDist) {
          minDist = d;
          nearest = node;
        }
      }
      return nearest;
    },
  };
}

function makeCombatAdapter(): CombatAdapter {
  return {
    initCombatant: vi.fn(),
    registerHitbox: vi.fn(),
    unregisterHitbox: vi.fn(),
    fire: vi.fn().mockReturnValue(null),
  };
}

function makeRendererAdapter(): BotRendererAdapter {
  return {
    getBotHitboxMesh: vi.fn().mockReturnValue(makeMesh()),
    hideBotMesh: vi.fn(),
    showBotMesh: vi.fn(),
  };
}

function makeSpawnPoints(count: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => makeVec3(i, 0, 0));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initSystem(
  botCount: number,
  options?: {
    combat?: CombatAdapter;
    renderer?: BotRendererAdapter;
    graph?: WaypointGraph;
  },
): {
  system: BotSystem;
  combat: CombatAdapter;
  renderer: BotRendererAdapter;
  graph: WaypointGraph;
} {
  const system = new BotSystem();
  const combat = options?.combat ?? makeCombatAdapter();
  const renderer = options?.renderer ?? makeRendererAdapter();
  const graph = options?.graph ?? makeWaypointGraph();
  system.init(botCount, graph, makeSpawnPoints(botCount), combat, renderer);
  return { system, combat, renderer, graph };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BotSystem', () => {
  // ── init() ──────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('creates the specified number of bots in idle state', () => {
      const { system } = initSystem(3);
      const states = system.getAllStates();
      expect(states).toHaveLength(3);
      expect(states.every((s) => s.state === 'idle')).toBe(true);
      expect(states.every((s) => s.health === BOT_MAX_HEALTH)).toBe(true);
    });

    it('throws RangeError when count < 1', () => {
      const system = new BotSystem();
      expect(() =>
        system.init(0, makeWaypointGraph(), makeSpawnPoints(1), makeCombatAdapter(), makeRendererAdapter()),
      ).toThrow(RangeError);
    });

    it('throws RangeError when count > MAX_BOTS', () => {
      const system = new BotSystem();
      expect(() =>
        system.init(
          MAX_BOTS + 1,
          makeWaypointGraph(),
          makeSpawnPoints(MAX_BOTS + 1),
          makeCombatAdapter(),
          makeRendererAdapter(),
        ),
      ).toThrow(RangeError);
    });

    it('throws RangeError when spawn points are insufficient', () => {
      const system = new BotSystem();
      expect(() =>
        system.init(3, makeWaypointGraph(), makeSpawnPoints(2), makeCombatAdapter(), makeRendererAdapter()),
      ).toThrow(RangeError);
    });

    it('registers a hitbox for each bot', () => {
      const combat = makeCombatAdapter();
      initSystem(2, { combat });
      expect(combat.registerHitbox).toHaveBeenCalledTimes(2);
    });

    it('staggers idle accumulator by IDLE_STAGGER_MS per bot index', () => {
      const { system } = initSystem(2);
      // Bot 0: idleAccumMs=0, Bot 1: idleAccumMs=100.
      // After 400ms: bot0 = 400 < 500 (still idle), bot1 = 500 >= 500 (→ patrol)
      system.update(400, makePlayer());
      const states = system.getAllStates();
      expect(states[0]?.state).toBe('idle');
      expect(states[1]?.state).toBe('patrol');
    });
  });

  // ── FSM transitions ──────────────────────────────────────────────────────────

  describe('idle → patrol', () => {
    it('transitions to patrol after IDLE_DURATION_MS ms have elapsed', () => {
      const { system } = initSystem(1);
      system.update(IDLE_DURATION_MS, makePlayer());
      expect(system.getAllStates()[0]?.state).toBe('patrol');
    });

    it('stays idle if not enough time has elapsed', () => {
      const { system } = initSystem(1);
      system.update(IDLE_DURATION_MS - 1, makePlayer());
      expect(system.getAllStates()[0]?.state).toBe('idle');
    });
  });

  describe('patrol → chase', () => {
    it('transitions to chase when player is within DETECTION_RANGE', () => {
      const { system } = initSystem(1);
      // Drive to patrol
      system.update(IDLE_DURATION_MS, makePlayer());
      // Player close by
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) }));
      expect(system.getAllStates()[0]?.state).toBe('chase');
    });

    it('stays in patrol when player is far away', () => {
      const { system } = initSystem(1);
      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(100, 0, 100) }));
      expect(system.getAllStates()[0]?.state).toBe('patrol');
    });
  });

  describe('chase → engage', () => {
    it('transitions to engage when player is within ENGAGE_RANGE', () => {
      const { system } = initSystem(1);
      system.update(IDLE_DURATION_MS, makePlayer());
      // Close player triggers patrol→chase in same tick
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) }));
      expect(system.getAllStates()[0]?.state).toBe('chase');
      // Even closer — within ENGAGE_RANGE (12u)
      system.update(16, makePlayer({ position: makeVec3(0, 0, 3) }));
      expect(system.getAllStates()[0]?.state).toBe('engage');
    });
  });

  describe('chase → patrol (hysteresis)', () => {
    it('transitions back to patrol when player moves beyond DETECTION_RANGE * HYSTERESIS_FACTOR', () => {
      const { system } = initSystem(1);
      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) })); // → chase
      // Player moves far away (> 20 * 1.5 = 30u)
      system.update(16, makePlayer({ position: makeVec3(0, 0, 35) }));
      expect(system.getAllStates()[0]?.state).toBe('patrol');
    });
  });

  describe('engage → chase', () => {
    it('transitions back to chase when player moves beyond CHASE_RANGE', () => {
      const { system } = initSystem(1);
      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) })); // → chase
      system.update(16, makePlayer({ position: makeVec3(0, 0, 3) })); // → engage
      // Player backs off beyond CHASE_RANGE (24u)
      system.update(16, makePlayer({ position: makeVec3(0, 0, 25) }));
      expect(system.getAllStates()[0]?.state).toBe('chase');
    });
  });

  // ── onBotKilled() ───────────────────────────────────────────────────────────

  describe('onBotKilled()', () => {
    it('transitions the named bot to dead state', () => {
      const { system } = initSystem(2);
      const id0 = system.getAllStates()[0]!.id;
      system.onBotKilled(id0);
      expect(system.getAllStates()[0]?.state).toBe('dead');
      expect(system.getAllStates()[0]?.health).toBe(0);
      expect(system.getAllStates()[1]?.state).toBe('idle');
    });

    it('unregisters hitbox and hides mesh on kill', () => {
      const combat = makeCombatAdapter();
      const renderer = makeRendererAdapter();
      const { system } = initSystem(1, { combat, renderer });
      const id = system.getAllStates()[0]!.id;
      system.onBotKilled(id);
      expect(combat.unregisterHitbox).toHaveBeenCalledWith(id);
      expect(renderer.hideBotMesh).toHaveBeenCalledWith(id);
    });

    it('is idempotent — second call does nothing', () => {
      const combat = makeCombatAdapter();
      const { system } = initSystem(1, { combat });
      const id = system.getAllStates()[0]!.id;
      system.onBotKilled(id);
      system.onBotKilled(id);
      expect(combat.unregisterHitbox).toHaveBeenCalledTimes(1);
    });

    it('ignores unknown bot ids', () => {
      const { system } = initSystem(1);
      expect(() => system.onBotKilled('nonexistent')).not.toThrow();
    });
  });

  // ── allEliminated() ──────────────────────────────────────────────────────────

  describe('allEliminated()', () => {
    it('returns false when any bot is alive', () => {
      const { system } = initSystem(2);
      const id0 = system.getAllStates()[0]!.id;
      system.onBotKilled(id0);
      expect(system.allEliminated()).toBe(false);
    });

    it('returns true when all bots are dead', () => {
      const { system } = initSystem(2);
      for (const { id } of system.getAllStates()) {
        system.onBotKilled(id);
      }
      expect(system.allEliminated()).toBe(true);
    });
  });

  // ── getAllStates() snapshot isolation ────────────────────────────────────────

  describe('getAllStates()', () => {
    it('returns an independent snapshot — mutating it does not affect bot state', () => {
      const { system } = initSystem(1);
      const states = system.getAllStates();
      (states[0] as { health: number }).health = 0;
      expect(system.getAllStates()[0]?.health).toBe(BOT_MAX_HEALTH);
    });
  });

  // ── reset() ──────────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('restores all bots to idle with full health', () => {
      const { system } = initSystem(2);
      for (const { id } of system.getAllStates()) system.onBotKilled(id);
      system.reset(makeSpawnPoints(2));
      const states = system.getAllStates();
      expect(states.every((s) => s.state === 'idle')).toBe(true);
      expect(states.every((s) => s.health === BOT_MAX_HEALTH)).toBe(true);
    });

    it('re-registers hitbox and shows mesh for previously dead bots', () => {
      const combat = makeCombatAdapter();
      const renderer = makeRendererAdapter();
      const { system } = initSystem(1, { combat, renderer });
      const id = system.getAllStates()[0]!.id;
      system.onBotKilled(id);
      vi.clearAllMocks();
      system.reset(makeSpawnPoints(1));
      expect(combat.registerHitbox).toHaveBeenCalledWith(id, expect.anything());
      expect(renderer.showBotMesh).toHaveBeenCalledWith(id);
    });

    it('does not re-register hitbox for bots that were still alive', () => {
      const combat = makeCombatAdapter();
      const { system } = initSystem(2, { combat });
      // Only kill bot 0
      const id0 = system.getAllStates()[0]!.id;
      system.onBotKilled(id0);
      vi.clearAllMocks();
      system.reset(makeSpawnPoints(2));
      // Only the dead bot (bot 0) should get re-registered
      expect(combat.registerHitbox).toHaveBeenCalledTimes(1);
    });

    it('throws RangeError when spawn points are insufficient', () => {
      const { system } = initSystem(3);
      expect(() => system.reset(makeSpawnPoints(2))).toThrow(RangeError);
    });

    it('preserves bot EntityIds across reset', () => {
      const { system } = initSystem(2);
      const idsBefore = system.getAllStates().map((s) => s.id);
      for (const { id } of system.getAllStates()) system.onBotKilled(id);
      system.reset(makeSpawnPoints(2));
      const idsAfter = system.getAllStates().map((s) => s.id);
      expect(idsAfter).toEqual(idsBefore);
    });
  });

  // ── Dead bot exclusion from update ──────────────────────────────────────────

  describe('update() with dead bots', () => {
    it('skips FSM logic for dead bots', () => {
      const { system } = initSystem(1);
      const id = system.getAllStates()[0]!.id;
      system.onBotKilled(id);
      // Tick with enough time to have caused a patrol→chase if alive
      system.update(IDLE_DURATION_MS * 10, makePlayer({ position: makeVec3(0, 0, 1) }));
      expect(system.getAllStates()[0]?.state).toBe('dead');
    });
  });

  // ── Engage reaction delay ────────────────────────────────────────────────────

  describe('engage reaction delay', () => {
    it('bot does not fire before reaction threshold elapses', () => {
      const combat = makeCombatAdapter();
      const { system } = initSystem(1, { combat });

      // Drive to engage state
      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) })); // → chase
      system.update(16, makePlayer({ position: makeVec3(0, 0, 3) })); // → engage

      vi.clearAllMocks();

      // Update with very short delta — reaction threshold is MIN_REACTION_MS (400ms)
      system.update(10, makePlayer({ position: makeVec3(0, 0, 3) }));
      expect(combat.fire).not.toHaveBeenCalled();
    });

    it('bot fires after reaction delay + fire interval have elapsed', () => {
      const combat = makeCombatAdapter();
      const { system } = initSystem(1, { combat });

      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) })); // → chase
      system.update(16, makePlayer({ position: makeVec3(0, 0, 3) })); // → engage

      vi.clearAllMocks();

      // 2000ms well exceeds MAX_REACTION_MS (1200) + MAX_FIRE_INTERVAL_MS (1800)
      system.update(4000, makePlayer({ position: makeVec3(0, 0, 3) }));
      expect(combat.fire).toHaveBeenCalled();
    });

    it('fire is called with bot id as shooterId', () => {
      const combat = makeCombatAdapter();
      const { system } = initSystem(1, { combat });
      const botId = system.getAllStates()[0]!.id;

      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) }));
      system.update(16, makePlayer({ position: makeVec3(0, 0, 3) }));
      system.update(4000, makePlayer({ position: makeVec3(0, 0, 3) }));

      if (vi.mocked(combat.fire).mock.calls.length > 0) {
        const [, , shooterId] = vi.mocked(combat.fire).mock.calls[0]!;
        expect(shooterId).toBe(botId);
      }
    });
  });

  // ── update() without init ────────────────────────────────────────────────────

  describe('update() before init()', () => {
    it('is a no-op and does not throw', () => {
      const system = new BotSystem();
      expect(() => system.update(16, makePlayer())).not.toThrow();
      expect(system.getAllStates()).toHaveLength(0);
    });
  });

  // ── D-09: per-round ids ──────────────────────────────────────────────────────

  describe('entity ids', () => {
    it('restart at bot-1 on every init so combatants do not accumulate across rounds', () => {
      const system = new BotSystem();
      const graph = makeWaypointGraph();
      system.init(2, graph, makeSpawnPoints(2), makeCombatAdapter(), makeRendererAdapter());
      system.init(2, graph, makeSpawnPoints(2), makeCombatAdapter(), makeRendererAdapter());
      expect(system.getAllStates().map((b) => b.id)).toEqual(['bot-1', 'bot-2']);
    });
  });

  // ── botHealth hook ─────────────────────────────────────────────────────────

  describe('maxHealth option', () => {
    it('sets each bot health and the combat record to the configured value', () => {
      const combat = makeCombatAdapter();
      const system = new BotSystem({ maxHealth: 1 });
      system.init(2, makeWaypointGraph(), makeSpawnPoints(2), combat, makeRendererAdapter());
      expect(system.getAllStates().every((b) => b.health === 1)).toBe(true);
      expect(combat.initCombatant).toHaveBeenCalledWith('bot-1', 1, expect.any(Number));
    });

    it('rejects a non-positive maxHealth', () => {
      expect(() => new BotSystem({ maxHealth: 0 })).toThrow(RangeError);
      expect(() => new BotSystem({ maxHealth: Number.NaN })).toThrow(RangeError);
    });
  });

  // ── D-11: colliders and aim ─────────────────────────────────────────────────

  describe('colliders and aim (D-11)', () => {
    it('does not walk into a collider between the bot and its waypoint', () => {
      // Bot at x=0 heading to wp1 at x=10; a wall spans x 4..6
      const wall: ColliderVolume = { min: { x: 4, y: 0, z: -5 }, max: { x: 6, y: 3, z: 5 } };
      const n0: WaypointNode = { id: 'wp0', position: makeVec3(0, 0, 0), neighbors: [] };
      const n1: WaypointNode = { id: 'wp1', position: makeVec3(10, 0, 0), neighbors: [] };
      (n0.neighbors as WaypointNode[]).push(n1);
      (n1.neighbors as WaypointNode[]).push(n0);
      const graph: WaypointGraph = {
        nodes: new Map([['wp0', n0], ['wp1', n1]]),
        findNearest: () => n0,
      };
      const system = new BotSystem();
      system.init(1, graph, [makeVec3(0, 0, 0)], makeCombatAdapter(), makeRendererAdapter(), [wall]);

      system.update(IDLE_DURATION_MS, makePlayer()); // idle → patrol
      for (let i = 0; i < 200; i++) system.update(50, makePlayer());

      const x = system.getAllStates()[0]!.position.x;
      expect(x + BOT_HALF_WIDTH).toBeLessThanOrEqual(wall.min.x);
      expect(x).toBeGreaterThan(3); // it did move up to the wall
    });

    it('aims at the player chest, not the feet, and only targets the player', () => {
      const combat = makeCombatAdapter();
      const { system } = initSystem(1, { combat });
      const target = makeVec3(0, 0, 3);
      system.update(IDLE_DURATION_MS, makePlayer());
      system.update(16, makePlayer({ position: makeVec3(0, 0, 5) }));
      system.update(16, makePlayer({ position: target }));
      system.update(4000, makePlayer({ position: target }));

      const call = vi.mocked(combat.fire).mock.calls[0]!;
      const [origin, dir, , , canHit] = call;
      // Eye 1.6 → chest 1.2 over 3 m gives dir.y ≈ -0.13 (± aim spread);
      // aiming at the feet (old behaviour) would give ≈ -0.47.
      expect(origin.y).toBeCloseTo(BOT_EYE_OFFSET_Y);
      expect(target.y + BOT_AIM_HEIGHT).toBeLessThan(origin.y);
      expect(dir.y).toBeLessThan(0);
      expect(dir.y).toBeGreaterThan(-0.25);
      expect(canHit).toBeTypeOf('function');
      expect(canHit!('player')).toBe(true);
      expect(canHit!('bot-2')).toBe(false);
    });
  });
});
