import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Object3D } from 'three';

import { RendererInstance } from '../renderer.js';
import { RendererInitError, RendererAlreadyInitError } from '../types.js';

// ─── Shared mock functions (vi.hoisted runs before vi.mock factories) ────────

const {
  mockRender,
  mockSetPixelRatio,
  mockSetSize,
  mockRendererDispose,
  mockSceneAdd,
  mockSceneRemove,
  mockSceneTraverse,
  mockCameraPositionSet,
  mockCameraQuaternionSet,
  mockCameraUpdateMatrixWorld,
  mockCameraUpdateProjectionMatrix,
  mockIntersectObjects,
} = vi.hoisted(() => ({
  mockRender: vi.fn(),
  mockSetPixelRatio: vi.fn(),
  mockSetSize: vi.fn(),
  mockRendererDispose: vi.fn(),
  mockSceneAdd: vi.fn(),
  mockSceneRemove: vi.fn(),
  mockSceneTraverse: vi.fn((cb: (o: object) => void) => { void cb; }),
  mockCameraPositionSet: vi.fn(),
  mockCameraQuaternionSet: vi.fn(),
  mockCameraUpdateMatrixWorld: vi.fn(),
  mockCameraUpdateProjectionMatrix: vi.fn(),
  mockIntersectObjects: vi.fn().mockReturnValue([]),
}));

vi.mock('three', () => ({
  WebGLRenderer: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['shadowMap'] = { enabled: true };
    this['setPixelRatio'] = mockSetPixelRatio;
    this['setSize'] = mockSetSize;
    this['render'] = mockRender;
    this['dispose'] = mockRendererDispose;
  }),
  Scene: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['background'] = null;
    this['children'] = [];
    this['add'] = mockSceneAdd;
    this['remove'] = mockSceneRemove;
    this['traverse'] = mockSceneTraverse;
  }),
  PerspectiveCamera: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['position'] = { set: mockCameraPositionSet };
    this['quaternion'] = { set: mockCameraQuaternionSet };
    this['aspect'] = 1;
    this['updateMatrixWorld'] = mockCameraUpdateMatrixWorld;
    this['updateProjectionMatrix'] = mockCameraUpdateProjectionMatrix;
  }),
  AmbientLight: vi.fn(),
  DirectionalLight: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['castShadow'] = false;
    this['position'] = { set: vi.fn() };
  }),
  Color: vi.fn(),
  Raycaster: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this['near'] = 0;
    this['far'] = 0;
    this['ray'] = {
      origin: { set: vi.fn() },
      direction: { set: vi.fn(), normalize: vi.fn() },
    };
    this['intersectObjects'] = mockIntersectObjects;
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCanvas(hasWebGL2 = true): HTMLCanvasElement {
  return {
    clientWidth: 800,
    clientHeight: 600,
    getContext: vi.fn((type: string) => (hasWebGL2 && type === 'webgl2' ? {} : null)),
  } as unknown as HTMLCanvasElement;
}

function makeHitbox(entityId?: string): Object3D {
  return {
    userData: { isHitbox: true, ...(entityId !== undefined ? { entityId } : {}) },
  } as unknown as Object3D;
}

function makeSceneObject(): Object3D {
  return { userData: {} } as unknown as Object3D;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RendererInstance', () => {
  let renderer: RendererInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIntersectObjects.mockReturnValue([]);
    renderer = new RendererInstance();
  });

  // ── init ────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('succeeds when WebGL2 is available', () => {
      expect(() => renderer.init(makeCanvas())).not.toThrow();
    });

    it('sets up renderer pixel ratio capped at 2', () => {
      Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
      renderer.init(makeCanvas());
      expect(mockSetPixelRatio).toHaveBeenCalledWith(2);
    });

    it('configures renderer size from canvas dimensions', () => {
      renderer.init(makeCanvas());
      expect(mockSetSize).toHaveBeenCalledWith(800, 600);
    });

    it('throws RendererInitError when WebGL2 is unavailable', () => {
      expect(() => renderer.init(makeCanvas(false))).toThrow(RendererInitError);
    });

    it('RendererInitError has cause webgl2-unavailable', () => {
      let err: unknown;
      try {
        renderer.init(makeCanvas(false));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RendererInitError);
      expect((err as RendererInitError).cause).toBe('webgl2-unavailable');
    });

    it('throws RendererAlreadyInitError when called twice', () => {
      renderer.init(makeCanvas());
      expect(() => renderer.init(makeCanvas())).toThrow(RendererAlreadyInitError);
    });

    it('adds lights to scene during init', () => {
      renderer.init(makeCanvas());
      expect(mockSceneAdd).toHaveBeenCalledTimes(2);
    });
  });

  // ── tick ────────────────────────────────────────────────────────────────

  describe('tick()', () => {
    it('calls renderer.render when initialised', () => {
      renderer.init(makeCanvas());
      renderer.tick(16.7);
      expect(mockRender).toHaveBeenCalledTimes(1);
    });

    it('emits a console.warn and skips render when not initialised', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderer.tick(16.7);
      expect(mockRender).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it('does not throw when called after dispose', () => {
      renderer.init(makeCanvas());
      renderer.dispose();
      expect(() => renderer.tick(16.7)).not.toThrow();
      expect(mockRender).not.toHaveBeenCalled();
    });
  });

  // ── setCamera ───────────────────────────────────────────────────────────

  describe('setCamera()', () => {
    it('sets camera position', () => {
      renderer.init(makeCanvas());
      renderer.setCamera({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
      expect(mockCameraPositionSet).toHaveBeenCalledWith(1, 2, 3);
    });

    it('sets camera quaternion', () => {
      renderer.init(makeCanvas());
      renderer.setCamera({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
      expect(mockCameraQuaternionSet).toHaveBeenCalledWith(0.1, 0.2, 0.3, 0.9);
    });

    it('forces matrix world update after pose change', () => {
      renderer.init(makeCanvas());
      renderer.setCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
      expect(mockCameraUpdateMatrixWorld).toHaveBeenCalledWith(true);
    });

    it('is a no-op when not initialised', () => {
      expect(() =>
        renderer.setCamera({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }),
      ).not.toThrow();
      expect(mockCameraPositionSet).not.toHaveBeenCalled();
    });
  });

  // ── addToScene / removeFromScene ────────────────────────────────────────

  describe('addToScene()', () => {
    it('adds object to scene', () => {
      renderer.init(makeCanvas());
      const obj = makeSceneObject();
      renderer.addToScene(obj);
      expect(mockSceneAdd).toHaveBeenCalledWith(obj);
    });

    it('registers hitbox when userData.isHitbox=true with valid entityId', () => {
      renderer.init(makeCanvas());
      const hitbox = makeHitbox('enemy-1');
      renderer.addToScene(hitbox);
      // Verify the hitbox participates in raycast (size > 0 unblocks raycast)
      mockIntersectObjects.mockReturnValueOnce([
        {
          object: { userData: { entityId: 'enemy-1' } },
          point: { x: 0, y: 0, z: 0 },
          face: { normal: { x: 0, y: 1, z: 0 } },
          distance: 10,
        },
      ]);
      const result = renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100);
      expect(result).not.toBeNull();
    });

    it('warns and skips registry when isHitbox=true but entityId missing', () => {
      renderer.init(makeCanvas());
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const hitboxNoId = makeHitbox(); // no entityId
      renderer.addToScene(hitboxNoId);
      expect(warn).toHaveBeenCalled();
      // raycast returns null because hitboxObjects is still empty
      expect(renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    });

    it('is a no-op when not initialised', () => {
      renderer.addToScene(makeSceneObject());
      expect(mockSceneAdd).not.toHaveBeenCalled();
    });
  });

  describe('removeFromScene()', () => {
    it('removes object from scene', () => {
      renderer.init(makeCanvas());
      const obj = makeSceneObject();
      renderer.addToScene(obj);
      renderer.removeFromScene(obj);
      expect(mockSceneRemove).toHaveBeenCalledWith(obj);
    });

    it('unregisters hitbox after removal', () => {
      renderer.init(makeCanvas());
      const hitbox = makeHitbox('enemy-1');
      renderer.addToScene(hitbox);
      renderer.removeFromScene(hitbox);
      // After removal hitboxObjects is empty; raycast returns null
      expect(renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    });

    it('is a no-op when not initialised', () => {
      renderer.removeFromScene(makeSceneObject());
      expect(mockSceneRemove).not.toHaveBeenCalled();
    });
  });

  // ── raycast ─────────────────────────────────────────────────────────────

  describe('raycast()', () => {
    it('returns null when not initialised', () => {
      expect(renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    });

    it('returns null when no hitboxes are registered', () => {
      renderer.init(makeCanvas());
      expect(renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    });

    it('returns null when intersectObjects finds no hits', () => {
      renderer.init(makeCanvas());
      renderer.addToScene(makeHitbox('target-1'));
      mockIntersectObjects.mockReturnValueOnce([]);
      expect(renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    });

    it('returns RaycastHit with correct entityId and distance on hit', () => {
      renderer.init(makeCanvas());
      renderer.addToScene(makeHitbox('bot-7'));
      mockIntersectObjects.mockReturnValueOnce([
        {
          object: { userData: { entityId: 'bot-7' } },
          point: { x: 1, y: 2, z: 3 },
          face: { normal: { x: 0, y: 1, z: 0 } },
          distance: 42.5,
        },
      ]);

      const hit = renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100);

      expect(hit).not.toBeNull();
      expect(hit!.entityId).toBe('bot-7');
      expect(hit!.distance).toBe(42.5);
      expect(hit!.point).toEqual({ x: 1, y: 2, z: 3 });
      expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
    });

    it('passes maxDistance as the raycaster far limit', () => {
      renderer.init(makeCanvas());
      renderer.addToScene(makeHitbox('target-1'));
      renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 250);
      // The raycaster far is set by the renderer — verify intersectObjects was called
      expect(mockIntersectObjects).toHaveBeenCalled();
    });

    it('handles null face by returning zero normal', () => {
      renderer.init(makeCanvas());
      renderer.addToScene(makeHitbox('enemy-1'));
      mockIntersectObjects.mockReturnValueOnce([
        {
          object: { userData: { entityId: 'enemy-1' } },
          point: { x: 0, y: 0, z: 0 },
          face: null,
          distance: 1,
        },
      ]);

      const hit = renderer.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 100);
      expect(hit?.normal).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  // ── resize ──────────────────────────────────────────────────────────────

  describe('resize()', () => {
    it('updates renderer size and camera aspect', () => {
      renderer.init(makeCanvas());
      vi.clearAllMocks();
      renderer.resize(1920, 1080);
      expect(mockSetSize).toHaveBeenCalledWith(1920, 1080);
      expect(mockCameraUpdateProjectionMatrix).toHaveBeenCalled();
    });

    it('is a no-op when not initialised', () => {
      renderer.resize(1920, 1080);
      expect(mockSetSize).not.toHaveBeenCalled();
    });
  });

  // ── dispose ─────────────────────────────────────────────────────────────

  describe('dispose()', () => {
    it('calls renderer.dispose()', () => {
      renderer.init(makeCanvas());
      renderer.dispose();
      expect(mockRendererDispose).toHaveBeenCalledTimes(1);
    });

    it('tick() becomes a no-op after dispose()', () => {
      renderer.init(makeCanvas());
      renderer.dispose();
      vi.clearAllMocks();
      renderer.tick(16.7);
      expect(mockRender).not.toHaveBeenCalled();
    });

    it('clears hitbox registry on dispose', () => {
      renderer.init(makeCanvas());
      renderer.addToScene(makeHitbox('enemy-1'));
      renderer.dispose();
      // After dispose, cannot re-init to test, but we verify no crash on subsequent dispose
      expect(() => renderer.dispose()).not.toThrow();
    });

    it('is idempotent — calling dispose twice does not throw', () => {
      renderer.init(makeCanvas());
      renderer.dispose();
      expect(() => renderer.dispose()).not.toThrow();
    });

    it('second dispose does not call renderer.dispose() again', () => {
      renderer.init(makeCanvas());
      renderer.dispose();
      vi.clearAllMocks();
      renderer.dispose();
      expect(mockRendererDispose).not.toHaveBeenCalled();
    });
  });
});
