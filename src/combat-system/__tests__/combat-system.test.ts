import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mesh } from 'three';

import { CombatSystem } from '../combat-system.js';

// ─── Shared mock functions (vi.hoisted runs before vi.mock factories) ────────

const { mockIntersectObjects, mockRaycasterSet } = vi.hoisted(() => ({
  mockIntersectObjects: vi.fn().mockReturnValue([]),
  mockRaycasterSet: vi.fn(),
}));

vi.mock('three', () => ({
  Raycaster: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['set'] = mockRaycasterSet;
    this['intersectObjects'] = mockIntersectObjects;
  }),
  Vector3: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['x'] = 0;
    this['y'] = 0;
    this['z'] = 0;
    this['set'] = vi.fn().mockImplementation(function (
      this: Record<string, unknown>,
      x: number,
      y: number,
      z: number,
    ) {
      this['x'] = x;
      this['y'] = y;
      this['z'] = z;
      return this;
    });
    this['normalize'] = vi.fn().mockImplementation(function (this: unknown) {
      return this;
    });
  }),
  Mesh: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['userData'] = {};
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMesh(): Mesh {
  return { userData: {} } as unknown as Mesh;
}

function makeHit(mesh: Mesh, entityId: string, distance = 10, health?: number) {
  void health;
  return {
    object: mesh,
    point: { x: 1, y: 2, z: 3 },
    face: { normal: { x: 0, y: 1, z: 0 } },
    distance,
  };
}

const UNIT_DIR = { x: 0, y: 0, z: 1 };
const ORIGIN = { x: 0, y: 0, z: 0 };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CombatSystem', () => {
  let cs: CombatSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIntersectObjects.mockReturnValue([]);
    cs = new CombatSystem();
  });

  // ── initCombatant ──────────────────────────────────────────────────────

  describe('initCombatant()', () => {
    it('creates a combatant record with correct initial state', () => {
      cs.initCombatant('player', 100, 30);
      expect(cs.getHealth('player')).toBe(100);
      expect(cs.getAmmo('player')).toBe(30);
      expect(cs.isEliminated('player')).toBe(false);
    });

    it('overwrites an existing record (idempotent reset)', () => {
      cs.initCombatant('player', 100, 30);
      cs.applyDamage('player', 50);
      cs.initCombatant('player', 100, 30);
      expect(cs.getHealth('player')).toBe(100);
    });

    it('throws TypeError for empty entityId', () => {
      expect(() => cs.initCombatant('', 100, 30)).toThrow(TypeError);
    });
  });

  // ── registerHitbox / unregisterHitbox ─────────────────────────────────

  describe('registerHitbox() / unregisterHitbox()', () => {
    it('registered hitbox participates in raycasting (included in candidates)', () => {
      const mesh = makeMesh();
      cs.initCombatant('bot-1', 100, 999);
      cs.initCombatant('player', 100, 30);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(mesh, 'bot-1')]);

      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);

      const candidates: Mesh[] = mockIntersectObjects.mock.calls[0]![0] as Mesh[];
      expect(candidates).toContain(mesh);
    });

    it('unregistered hitbox is not in candidate list', () => {
      const mesh = makeMesh();
      cs.initCombatant('bot-1', 100, 999);
      cs.initCombatant('player', 100, 30);
      cs.registerHitbox('bot-1', mesh);
      cs.unregisterHitbox('bot-1');

      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);

      const candidates: Mesh[] = mockIntersectObjects.mock.calls[0]![0] as Mesh[];
      expect(candidates).not.toContain(mesh);
    });

    it('unregisterHitbox is a no-op for unknown entityId (no throw)', () => {
      expect(() => cs.unregisterHitbox('nobody')).not.toThrow();
    });

    it('throws TypeError for empty entityId on registerHitbox', () => {
      expect(() => cs.registerHitbox('', makeMesh())).toThrow(TypeError);
    });
  });

  // ── fire() ──────────────────────────────────────────────────────────────

  describe('fire()', () => {
    it('returns null when ammo is 0 (ammo gate)', () => {
      cs.initCombatant('player', 100, 0);
      const result = cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      expect(result).toBeNull();
    });

    it('does not decrement ammo when ammo is 0', () => {
      cs.initCombatant('player', 100, 0);
      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      expect(cs.getAmmo('player')).toBe(0);
    });

    it('does not call intersectObjects when ammo is 0', () => {
      cs.initCombatant('player', 100, 0);
      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      expect(mockIntersectObjects).not.toHaveBeenCalled();
    });

    it('returns null on miss and decrements ammo by 1', () => {
      cs.initCombatant('player', 100, 30);
      mockIntersectObjects.mockReturnValueOnce([]);
      const result = cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      expect(result).toBeNull();
      expect(cs.getAmmo('player')).toBe(29);
    });

    it('returns RaycastHit with correct entityId and position on hit', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(mesh, 'bot-1', 15)]);

      const hit = cs.fire(ORIGIN, UNIT_DIR, 'player', 10);

      expect(hit).not.toBeNull();
      expect(hit!.entityId).toBe('bot-1');
      expect(hit!.distance).toBe(15);
      expect(hit!.point).toEqual({ x: 1, y: 2, z: 3 });
      expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
    });

    it('applies damage to the hit entity', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(mesh, 'bot-1')]);

      cs.fire(ORIGIN, UNIT_DIR, 'player', 25);

      expect(cs.getHealth('bot-1')).toBe(75);
    });

    it('eliminates target when damage reduces health to 0', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 50, 999);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(mesh, 'bot-1')]);

      cs.fire(ORIGIN, UNIT_DIR, 'player', 50);

      expect(cs.isEliminated('bot-1')).toBe(true);
      expect(cs.getHealth('bot-1')).toBe(0);
    });

    it('atomically removes hitbox on elimination — dead entity is unhittable', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 50, 999);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(mesh, 'bot-1')]);
      cs.fire(ORIGIN, UNIT_DIR, 'player', 50);

      // Second shot — hitbox removed, so mesh not in candidates
      cs.fire(ORIGIN, UNIT_DIR, 'player', 50);
      const candidates: Mesh[] = mockIntersectObjects.mock.calls[1]![0] as Mesh[];
      expect(candidates).not.toContain(mesh);
    });

    it('health does not go below 0 (overkill absorbed)', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 20, 999);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(mesh, 'bot-1')]);

      cs.fire(ORIGIN, UNIT_DIR, 'player', 9999);

      expect(cs.getHealth('bot-1')).toBe(0);
    });

    it('excludes shooter own hitbox from candidates (no self-hit)', () => {
      const playerMesh = makeMesh();
      const botMesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('player', playerMesh);
      cs.registerHitbox('bot-1', botMesh);
      mockIntersectObjects.mockReturnValueOnce([]);

      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);

      const candidates: Mesh[] = mockIntersectObjects.mock.calls[0]![0] as Mesh[];
      expect(candidates).not.toContain(playerMesh);
      expect(candidates).toContain(botMesh);
    });

    it('throws Error when shooter is not initialized', () => {
      expect(() => cs.fire(ORIGIN, UNIT_DIR, 'ghost', 10)).toThrow(Error);
    });

    it('throws TypeError for empty shooterId', () => {
      expect(() => cs.fire(ORIGIN, UNIT_DIR, '', 10)).toThrow(TypeError);
    });

    it('throws TypeError for negative damage', () => {
      cs.initCombatant('player', 100, 30);
      expect(() => cs.fire(ORIGIN, UNIT_DIR, 'player', -1)).toThrow(TypeError);
    });

    it('throws TypeError for zero damage', () => {
      cs.initCombatant('player', 100, 30);
      expect(() => cs.fire(ORIGIN, UNIT_DIR, 'player', 0)).toThrow(TypeError);
    });

    it('throws RangeError for non-unit direction vector', () => {
      cs.initCombatant('player', 100, 30);
      expect(() => cs.fire(ORIGIN, { x: 2, y: 0, z: 0 }, 'player', 10)).toThrow(RangeError);
    });

    it('handles null face normal by returning zero vector', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('bot-1', mesh);
      mockIntersectObjects.mockReturnValueOnce([
        { object: mesh, point: { x: 0, y: 0, z: 0 }, face: null, distance: 5 },
      ]);

      const hit = cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      expect(hit?.normal).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('bot uses same fire() path as player (parity)', () => {
      const playerMesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 100, Number.MAX_SAFE_INTEGER);
      cs.registerHitbox('player', playerMesh);
      mockIntersectObjects.mockReturnValueOnce([makeHit(playerMesh, 'player')]);

      const hit = cs.fire(ORIGIN, UNIT_DIR, 'bot-1', 10);

      expect(hit).not.toBeNull();
      expect(hit!.entityId).toBe('player');
      expect(cs.getHealth('player')).toBe(90);
    });
  });

  // ── applyDamage() ───────────────────────────────────────────────────────

  describe('applyDamage()', () => {
    it('reduces health by the given amount', () => {
      cs.initCombatant('bot-1', 100, 999);
      cs.applyDamage('bot-1', 30);
      expect(cs.getHealth('bot-1')).toBe(70);
    });

    it('eliminates entity when damage depletes health', () => {
      const mesh = makeMesh();
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('bot-1', mesh);
      cs.applyDamage('bot-1', 100);
      expect(cs.isEliminated('bot-1')).toBe(true);
    });

    it('atomically removes hitbox on health reaching 0', () => {
      const mesh = makeMesh();
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('bot-1', mesh);
      cs.initCombatant('player', 100, 30);
      cs.applyDamage('bot-1', 100);

      // Now fire from player — bot-1 mesh should not be in candidates
      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      const candidates: Mesh[] = mockIntersectObjects.mock.calls[0]![0] as Mesh[];
      expect(candidates).not.toContain(mesh);
    });

    it('is a no-op when entity is already eliminated (guard)', () => {
      cs.initCombatant('bot-1', 100, 999);
      cs.applyDamage('bot-1', 100);
      cs.applyDamage('bot-1', 999);
      expect(cs.getHealth('bot-1')).toBe(0);
    });

    it('throws Error for unregistered entity', () => {
      expect(() => cs.applyDamage('ghost', 10)).toThrow(Error);
    });

    it('throws TypeError for negative damage', () => {
      cs.initCombatant('bot-1', 100, 999);
      expect(() => cs.applyDamage('bot-1', -5)).toThrow(TypeError);
    });
  });

  // ── isEliminated() ──────────────────────────────────────────────────────

  describe('isEliminated()', () => {
    it('returns false for alive combatant', () => {
      cs.initCombatant('player', 100, 30);
      expect(cs.isEliminated('player')).toBe(false);
    });

    it('returns true after health reaches 0', () => {
      cs.initCombatant('player', 100, 30);
      cs.applyDamage('player', 100);
      expect(cs.isEliminated('player')).toBe(true);
    });

    it('returns false for unregistered entity', () => {
      expect(cs.isEliminated('nobody')).toBe(false);
    });
  });

  // ── getHealth() / getAmmo() ─────────────────────────────────────────────

  describe('getHealth() / getAmmo()', () => {
    it('getHealth returns 0 for unknown entity', () => {
      expect(cs.getHealth('nobody')).toBe(0);
    });

    it('getAmmo returns 0 for unknown entity', () => {
      expect(cs.getAmmo('nobody')).toBe(0);
    });

    it('getAmmo decrements on each successful fire', () => {
      cs.initCombatant('player', 100, 3);
      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      expect(cs.getAmmo('player')).toBe(1);
    });
  });

  // ── reset() ─────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('clears all combatant records', () => {
      cs.initCombatant('player', 100, 30);
      cs.reset();
      expect(cs.getHealth('player')).toBe(0);
    });

    it('clears hitbox registry — previously registered mesh absent after reset', () => {
      const mesh = makeMesh();
      cs.initCombatant('player', 100, 30);
      cs.initCombatant('bot-1', 100, 999);
      cs.registerHitbox('bot-1', mesh);
      cs.reset();

      cs.initCombatant('player', 100, 30);
      cs.fire(ORIGIN, UNIT_DIR, 'player', 10);
      const candidates: Mesh[] = mockIntersectObjects.mock.calls[0]![0] as Mesh[];
      expect(candidates).not.toContain(mesh);
    });
  });

  // ── Security — prototype pollution ──────────────────────────────────────

  describe('Security — prototype pollution', () => {
    it('registerHitbox with __proto__ as entityId uses Map key safely (no prototype mutation)', () => {
      const mesh = makeMesh();
      expect(() => cs.registerHitbox('__proto__', mesh)).not.toThrow();
      // Object.prototype should not be mutated
      expect(({} as Record<string, unknown>)['__proto__']).not.toBe(mesh);
    });

    it('initCombatant with constructor key uses Map key safely', () => {
      expect(() => cs.initCombatant('constructor', 100, 30)).not.toThrow();
      expect(cs.getHealth('constructor')).toBe(100);
    });
  });
});
