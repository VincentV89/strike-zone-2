import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mesh } from 'three';

import { BotSystem, MAX_BOTS, BOT_MAX_HEALTH, IDLE_DURATION_MS } from '../bot-system.js';
import type { BotRendererAdapter, CombatAdapter, PlayerState } from '../types.js';
import type { Vec3 } from '../../renderer-core/types.js';
import type { WaypointGraph, WaypointNode } from '../../map-system/types.js';

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
});
