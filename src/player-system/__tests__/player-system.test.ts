import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PlayerSystem } from '../player-system.js';
import {
  MAX_HEALTH,
  MAX_AMMO,
  DAMAGE_PER_SHOT,
  PLAYER_ENTITY_ID,
  DELTA_CAP_S,
  PITCH_MIN_RAD,
  PITCH_MAX_RAD,
  MOVE_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  EYE_HEIGHT,
  PLAYER_H,
  HALF_W,
} from '../types.js';
import type { ColliderVolume } from '../types.js';
import type { InputState } from '../../input-handler/types.js';

// ─── Mock Three.js ────────────────────────────────────────────────────────────

vi.mock('three', () => {
  const makeVec3 = () => ({
    x: 0, y: 0, z: 0,
    set: vi.fn().mockImplementation(function (this: Record<string, number>, x: number, y: number, z: number) {
      this['x'] = x; this['y'] = y; this['z'] = z;
      return this;
    }),
  });

  return {
    BoxGeometry: vi.fn(),
    Mesh: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this['position'] = makeVec3();
      this['updateMatrixWorld'] = vi.fn();
    }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCombat() {
  return {
    registerHitbox: vi.fn(),
    unregisterHitbox: vi.fn(),
    fire: vi.fn().mockReturnValue(null),
    initCombatant: vi.fn(),
  };
}

function makeRenderer() {
  return {
    setCamera: vi.fn(),
  };
}

function makeInput(overrides: Partial<InputState> = {}): InputState {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    shoot: false,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    ...overrides,
  };
}

const SPAWN = { x: 0, y: 0, z: 0 };
const NO_COLLIDERS: ColliderVolume[] = [];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlayerSystem', () => {
  let combat: ReturnType<typeof makeCombat>;
  let renderer: ReturnType<typeof makeRenderer>;
  let ps: PlayerSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    combat = makeCombat();
    renderer = makeRenderer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ps = new PlayerSystem(combat as any, renderer as any);
  });

  // ── spawn() ───────────────────────────────────────────────────────────────

  describe('spawn()', () => {
    it('initialises health to MAX_HEALTH and ammo to MAX_AMMO', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      const s = ps.getState();
      expect(s.health).toBe(MAX_HEALTH);
      expect(s.ammo).toBe(MAX_AMMO);
    });

    it('sets isAlive to true', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      expect(ps.getState().isAlive).toBe(true);
    });

    it('sets position to spawn point', () => {
      ps.spawn({ x: 5, y: 2, z: -3 }, NO_COLLIDERS);
      const p = ps.getState().position;
      expect(p).toEqual({ x: 5, y: 2, z: -3 });
    });

    it('resets yaw and pitch to 0', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      const r = ps.getState().rotation;
      expect(r.x).toBe(0);
      expect(r.y).toBe(0);
    });

    it('registers hitbox with combat system', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      expect(combat.registerHitbox).toHaveBeenCalledWith(PLAYER_ENTITY_ID, expect.anything());
    });

    it('calls renderer.setCamera with eye-height offset', () => {
      ps.spawn({ x: 0, y: 0, z: 0 }, NO_COLLIDERS);
      expect(renderer.setCamera).toHaveBeenCalledWith(
        expect.objectContaining({ y: EYE_HEIGHT }),
        expect.anything(),
      );
    });
  });

  // ── update() — dead gate ──────────────────────────────────────────────────

  describe('update() — dead gate', () => {
    it('exits immediately when player is dead (no camera call)', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(MAX_HEALTH, 'bot-1');  // kill player
      renderer.setCamera.mockClear();

      ps.update(16, makeInput());

      expect(renderer.setCamera).not.toHaveBeenCalled();
    });

    it('does not change position when dead', () => {
      ps.spawn({ x: 1, y: 0, z: 1 }, NO_COLLIDERS);
      ps.takeDamage(MAX_HEALTH, 'bot-1');

      ps.update(16, makeInput({ forward: true }));

      expect(ps.getState().position).toEqual({ x: 1, y: 0, z: 1 });
    });
  });

  // ── update() — delta cap ──────────────────────────────────────────────────

  describe('update() — delta cap', () => {
    it('caps delta at DELTA_CAP_S to prevent tunnelling', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      // Large stall — 10 seconds
      ps.update(10_000, makeInput({ forward: true }));
      const pos = ps.getState().position;
      // Max displacement = MOVE_SPEED * DELTA_CAP_S
      const maxDisp = MOVE_SPEED * DELTA_CAP_S;
      const dist = Math.sqrt(pos.x ** 2 + pos.z ** 2);
      expect(dist).toBeLessThanOrEqual(maxDisp + 1e-6);
    });

    it('sanitises NaN deltaMs as 0', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      expect(() => ps.update(NaN, makeInput())).not.toThrow();
    });
  });

  // ── update() — mouse look ─────────────────────────────────────────────────

  describe('update() — mouse look', () => {
    it('right mouse movement increases yaw', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ mouseDeltaX: 100 }));
      expect(ps.getState().rotation.y).toBeGreaterThan(0);
    });

    it('downward mouse movement decreases pitch (screen-down convention)', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ mouseDeltaY: 100 }));
      expect(ps.getState().rotation.x).toBeLessThan(0);
    });

    it('pitch is clamped to PITCH_MIN_RAD', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      // Large downward movement
      ps.update(16, makeInput({ mouseDeltaY: 1_000_000 }));
      expect(ps.getState().rotation.x).toBeGreaterThanOrEqual(PITCH_MIN_RAD);
    });

    it('pitch is clamped to PITCH_MAX_RAD', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ mouseDeltaY: -1_000_000 }));
      expect(ps.getState().rotation.x).toBeLessThanOrEqual(PITCH_MAX_RAD);
    });

    it('sanitises NaN mouse delta without throwing', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      expect(() => ps.update(16, makeInput({ mouseDeltaX: NaN, mouseDeltaY: NaN }))).not.toThrow();
    });
  });

  // ── update() — movement ───────────────────────────────────────────────────

  describe('update() — movement', () => {
    it('forward key moves player in negative Z when yaw=0', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(100, makeInput({ forward: true }));
      expect(ps.getState().position.z).toBeLessThan(0);
    });

    it('diagonal movement speed does not exceed MOVE_SPEED', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(1000, makeInput({ forward: true, right: true }));
      const p = ps.getState().position;
      // horizontal distance in one capped frame = MOVE_SPEED * DELTA_CAP_S
      const dist = Math.sqrt(p.x ** 2 + p.z ** 2);
      expect(dist).toBeLessThanOrEqual(MOVE_SPEED * DELTA_CAP_S + 1e-6);
    });

    it('no movement input results in no position change (excluding gravity)', () => {
      ps.spawn({ x: 0, y: 0, z: 0 }, NO_COLLIDERS);
      const before = { ...ps.getState().position };
      ps.update(16, makeInput());
      const after = ps.getState().position;
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.z).toBeCloseTo(before.z, 5);
    });
  });

  // ── update() — jump and gravity ───────────────────────────────────────────

  describe('update() — jump and gravity', () => {
    it('jump impulse only fires when on ground', () => {
      ps.spawn({ x: 0, y: 0, z: 0 }, NO_COLLIDERS);
      // First frame: on ground, jump pressed → position moves up then falls
      ps.update(16, makeInput({ jump: true }));
      // After impulse, y should be positive (upward motion)
      const y1 = ps.getState().position.y;
      expect(y1).toBeGreaterThan(0);
    });

    it('gravity pulls player down when airborne', () => {
      ps.spawn({ x: 0, y: 10, z: 0 }, NO_COLLIDERS);
      ps.update(100, makeInput());
      ps.update(100, makeInput());
      // Should have fallen from y=10
      expect(ps.getState().position.y).toBeLessThan(10);
    });

    it('floor collision stops downward movement and sets grounded', () => {
      // Position the player just above a floor collider
      const floor: ColliderVolume = { min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } };
      ps.spawn({ x: 0, y: 0.1, z: 0 }, [floor]);
      // Apply several frames of gravity until grounded
      for (let i = 0; i < 10; i++) {
        ps.update(50, makeInput());
      }
      expect(ps.getState().position.y).toBeGreaterThanOrEqual(0);
    });
  });

  // ── update() — AABB collision ─────────────────────────────────────────────

  describe('update() — AABB collision', () => {
    // Floor collider prevents player from falling below the wall's Y extent
    const FLOOR: ColliderVolume = { min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } };

    it('X-axis wall stops player in X direction', () => {
      const wall: ColliderVolume = {
        min: { x: 1, y: -10, z: -10 },
        max: { x: 2, y: 10, z: 10 },
      };
      ps.spawn({ x: 0, y: 0, z: 0 }, [FLOOR, wall]);
      for (let i = 0; i < 20; i++) {
        ps.update(100, makeInput({ right: true }));
      }
      expect(ps.getState().position.x + HALF_W).toBeLessThanOrEqual(wall.min.x + 1e-3);
    });

    it('Z-axis wall stops player in Z direction', () => {
      const wall: ColliderVolume = {
        min: { x: -10, y: -10, z: -2 },
        max: { x: 10, y: 10, z: -1 },
      };
      ps.spawn({ x: 0, y: 0, z: 0 }, [FLOOR, wall]);
      for (let i = 0; i < 20; i++) {
        ps.update(100, makeInput({ back: true }));
      }
      expect(ps.getState().position.z - HALF_W).toBeGreaterThanOrEqual(wall.max.z - 1e-3);
    });

    it('ceiling collision stops upward movement', () => {
      const ceiling: ColliderVolume = {
        min: { x: -10, y: 2, z: -10 },
        max: { x: 10, y: 3, z: 10 },
      };
      ps.spawn({ x: 0, y: 0, z: 0 }, [ceiling]);
      ps.update(16, makeInput({ jump: true }));
      for (let i = 0; i < 5; i++) {
        ps.update(50, makeInput());
      }
      // Player top (y + PLAYER_H) must not exceed ceiling bottom
      expect(ps.getState().position.y + PLAYER_H).toBeLessThanOrEqual(ceiling.min.y + 1e-3);
    });
  });

  // ── update() — weapon fire ────────────────────────────────────────────────

  describe('update() — weapon fire', () => {
    const FLOOR: ColliderVolume = { min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 0, z: 100 } };

    it('calls combat.fire when shoot pressed and ammo > 0', () => {
      ps.spawn(SPAWN, [FLOOR]);
      ps.update(16, makeInput({ shoot: true }));
      expect(combat.fire).toHaveBeenCalledWith(
        expect.objectContaining({ y: expect.closeTo(EYE_HEIGHT, 2) }),
        expect.objectContaining({ x: expect.any(Number) }),
        PLAYER_ENTITY_ID,
        DAMAGE_PER_SHOT,
      );
    });

    it('decrements ammo by 1 on each shot', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ shoot: true }));
      expect(ps.getState().ammo).toBe(MAX_AMMO - 1);
    });

    it('does not call combat.fire when ammo is 0', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      // Drain ammo
      for (let i = 0; i < MAX_AMMO; i++) {
        ps.update(16, makeInput({ shoot: true }));
      }
      combat.fire.mockClear();
      ps.update(16, makeInput({ shoot: true }));
      expect(combat.fire).not.toHaveBeenCalled();
    });

    it('ammo does not go below 0', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      for (let i = 0; i < MAX_AMMO + 10; i++) {
        ps.update(16, makeInput({ shoot: true }));
      }
      expect(ps.getState().ammo).toBe(0);
    });

    it('fire direction is a unit vector', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ shoot: true }));
      const dir = combat.fire.mock.calls[0]?.[1] as { x: number; y: number; z: number };
      const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  // ── takeDamage() ──────────────────────────────────────────────────────────

  describe('takeDamage()', () => {
    it('reduces health by given amount', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(25, 'bot-1');
      expect(ps.getState().health).toBe(75);
    });

    it('health clamps to 0 on lethal damage (overkill absorbed)', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(9999, 'bot-1');
      expect(ps.getState().health).toBe(0);
    });

    it('health == 0 sets isAlive to false', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(MAX_HEALTH, 'bot-1');
      expect(ps.getState().isAlive).toBe(false);
    });

    it('unregisters hitbox on death', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      combat.unregisterHitbox.mockClear();
      ps.takeDamage(MAX_HEALTH, 'bot-1');
      expect(combat.unregisterHitbox).toHaveBeenCalledWith(PLAYER_ENTITY_ID);
    });

    it('post-mortem damage is ignored (dead gate)', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(MAX_HEALTH, 'bot-1');  // kill
      ps.takeDamage(999, 'bot-2');          // should be ignored
      expect(ps.getState().health).toBe(0);
      expect(ps.getState().isAlive).toBe(false);
    });

    it('health stays non-negative after multiple partial hits', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(30, 'bot-1');
      ps.takeDamage(30, 'bot-1');
      ps.takeDamage(30, 'bot-1');
      ps.takeDamage(30, 'bot-1');
      expect(ps.getState().health).toBe(0);
    });
  });

  // ── getState() ────────────────────────────────────────────────────────────

  describe('getState()', () => {
    it('returns a frozen object (immutable snapshot)', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      const state = ps.getState();
      expect(Object.isFrozen(state)).toBe(true);
    });

    it('position is a copy — mutating it does not corrupt internal state', () => {
      ps.spawn({ x: 1, y: 2, z: 3 }, NO_COLLIDERS);
      const state = ps.getState() as { position: { x: number; y: number; z: number }; isAlive: boolean; health: number; ammo: number; rotation: { x: number; y: number } };
      // Attempt mutation on the position copy (TypeScript would prevent this in strict mode
      // but runtime guard is what matters)
      try { state.position.x = 999; } catch { /* frozen */ }
      expect(ps.getState().position.x).toBe(1);
    });

    it('reports correct state after partial damage', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(40, 'bot-1');
      const s = ps.getState();
      expect(s.health).toBe(60);
      expect(s.isAlive).toBe(true);
    });
  });

  // ── reset() ───────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('restores health to MAX_HEALTH', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(50, 'bot-1');
      ps.reset();
      expect(ps.getState().health).toBe(MAX_HEALTH);
    });

    it('restores ammo to MAX_AMMO', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ shoot: true }));
      ps.reset();
      expect(ps.getState().ammo).toBe(MAX_AMMO);
    });

    it('sets isAlive to true', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.takeDamage(MAX_HEALTH, 'bot-1');
      ps.reset();
      expect(ps.getState().isAlive).toBe(true);
    });

    it('unregisters hitbox to prevent duplicate registration on next spawn', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      combat.unregisterHitbox.mockClear();
      ps.reset();
      expect(combat.unregisterHitbox).toHaveBeenCalledWith(PLAYER_ENTITY_ID);
    });

    it('spawn after reset re-registers hitbox', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.reset();
      combat.registerHitbox.mockClear();
      ps.spawn(SPAWN, NO_COLLIDERS);
      expect(combat.registerHitbox).toHaveBeenCalledWith(PLAYER_ENTITY_ID, expect.anything());
    });
  });

  // ── camera sync ───────────────────────────────────────────────────────────

  describe('camera synchronisation', () => {
    it('setCamera is called every update frame (unconditional)', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      renderer.setCamera.mockClear();
      ps.update(16, makeInput());
      ps.update(16, makeInput());
      expect(renderer.setCamera).toHaveBeenCalledTimes(2);
    });

    it('camera y position is position.y + EYE_HEIGHT', () => {
      ps.spawn({ x: 0, y: 5, z: 0 }, NO_COLLIDERS);
      ps.update(16, makeInput());
      const camPos = renderer.setCamera.mock.calls[0]?.[0] as { y: number };
      expect(camPos?.y).toBeCloseTo(5 + EYE_HEIGHT, 5);
    });

    it('camera quaternion has unit length', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      ps.update(16, makeInput({ mouseDeltaX: 50, mouseDeltaY: -30 }));
      const q = renderer.setCamera.mock.calls[0]?.[1] as { x: number; y: number; z: number; w: number };
      const len = Math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2);
      expect(len).toBeCloseTo(1, 5);
    });
  });

  // ── hitbox sync ───────────────────────────────────────────────────────────

  describe('hitbox mesh synchronisation', () => {
    it('hitbox mesh position is updated on each update frame', () => {
      ps.spawn(SPAWN, NO_COLLIDERS);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mesh = (ps as any).hitboxMesh as { position: { set: ReturnType<typeof vi.fn> }; updateMatrixWorld: ReturnType<typeof vi.fn> };
      mesh.position.set.mockClear();
      ps.update(100, makeInput({ forward: true }));
      expect(mesh.position.set).toHaveBeenCalled();
      expect(mesh.updateMatrixWorld).toHaveBeenCalled();
    });

    it('hitbox center is at position.y + PLAYER_H/2', () => {
      ps.spawn({ x: 0, y: 0, z: 0 }, NO_COLLIDERS);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mesh = (ps as any).hitboxMesh as { position: { set: ReturnType<typeof vi.fn> } };
      const call = mesh.position.set.mock.calls[0] as [number, number, number];
      expect(call[1]).toBeCloseTo(PLAYER_H / 2, 5);
    });
  });

  // ── constants ─────────────────────────────────────────────────────────────

  describe('constants sanity', () => {
    it('PLAYER_H exceeds EYE_HEIGHT (camera stays inside the capsule)', () => {
      expect(PLAYER_H).toBeGreaterThan(EYE_HEIGHT);
    });

    it('GRAVITY is a positive finite number', () => {
      expect(GRAVITY).toBeGreaterThan(0);
      expect(Number.isFinite(GRAVITY)).toBe(true);
    });

    it('JUMP_VELOCITY is positive', () => {
      expect(JUMP_VELOCITY).toBeGreaterThan(0);
    });
  });
});
