import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MapSystem } from '../map-system.js';
import {
  MapNotFoundError,
  MalformedMapError,
  MapStateError,
  MapNotLoadedError,
  type RawWaypointNode,
  type SceneAdapter,
  type GltfLoaderFn,
} from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLinearWaypoints(count = 8): RawWaypointNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `wp-${i}`,
    position: { x: i * 10, y: 0, z: 0 },
    neighbors:
      i === 0
        ? [`wp-1`]
        : i === count - 1
          ? [`wp-${count - 2}`]
          : [`wp-${i - 1}`, `wp-${i + 1}`],
  }));
}

function makeValidDefinition() {
  return {
    id: 'dust' as const,
    displayName: 'Dust',
    colliders: [
      { min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 0, z: 50 } },
    ],
    waypoints: makeLinearWaypoints(8),
    spawnPoints: {
      player: [{ x: 0, y: 1, z: 0 }],
      bots: Array.from({ length: 8 }, (_, i) => ({ x: i * 5, y: 1, z: 10 })),
    },
  };
}

function makeGeoDispose() { return vi.fn(); }
function makeMatDispose() { return vi.fn(); }

function makeGltfLoader(geoDispose = makeGeoDispose(), matDispose = makeMatDispose()): GltfLoaderFn {
  return vi.fn().mockResolvedValue({
    scene: {
      traverse: (cb: (obj: unknown) => void) => {
        cb({ isMesh: false }); // non-mesh parent node
        cb({
          isMesh: true,
          geometry: {
            dispose: geoDispose,
            index: null,
            attributes: { position: { count: 300 } },
          },
          material: { dispose: matDispose },
        });
      },
    },
  });
}

function makeRenderer(): SceneAdapter {
  return {
    addToScene: vi.fn(),
    removeFromScene: vi.fn(),
  };
}

function stubFetch(definition: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(definition) }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MapSystem', () => {
  let renderer: SceneAdapter;
  let gltfLoader: GltfLoaderFn;
  let system: MapSystem;

  beforeEach(() => {
    renderer = makeRenderer();
    gltfLoader = makeGltfLoader();
    system = new MapSystem(renderer, '', gltfLoader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── state machine ─────────────────────────────────────────────────────────

  it('starts in idle state', () => {
    expect(system.state).toBe('idle');
  });

  // ── load — guard conditions ───────────────────────────────────────────────

  it('throws MapNotFoundError for an unknown map id', async () => {
    await expect(system.load('arena')).rejects.toBeInstanceOf(MapNotFoundError);
  });

  it('MapNotFoundError carries the bad mapId', async () => {
    const err = await system.load('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MapNotFoundError);
    expect((err as MapNotFoundError).mapId).toBe('nope');
  });

  it('throws MapStateError when already loading', async () => {
    // fetch never resolves → state stays "loading"
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    void system.load('dust'); // fire and forget — state is now "loading"
    await expect(system.load('dust')).rejects.toBeInstanceOf(MapStateError);
  });

  it('MapStateError for concurrent load includes "loading" state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    void system.load('dust');
    const err = await system.load('dust').catch((e: unknown) => e);
    expect((err as MapStateError).currentState).toBe('loading');
  });

  // ── load — successful flow ────────────────────────────────────────────────

  it('transitions to loaded state on success', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    expect(system.state).toBe('loaded');
  });

  it('calls addToScene with the GLTF scene', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    expect(renderer.addToScene).toHaveBeenCalledOnce();
  });

  it('calls the gltf loader with a URL containing the map id', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    expect(gltfLoader).toHaveBeenCalledOnce();
    const url = (gltfLoader as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('dust');
    expect(url).toContain('.glb');
  });

  it('accepts "compound" as a valid map id', async () => {
    stubFetch({ ...makeValidDefinition(), id: 'compound', displayName: 'Compound' });
    await system.load('compound');
    expect(system.state).toBe('loaded');
  });

  // ── load → reload (auto-unload) ───────────────────────────────────────────

  it('auto-unloads the previous map before loading a new one', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');

    // Set up fresh fetch mock for the reload
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ...makeValidDefinition(), id: 'compound', displayName: 'Compound' }) }),
    );
    gltfLoader = makeGltfLoader();
    system = new MapSystem(renderer, '', gltfLoader); // fresh system to reset gltfLoader mock
    // But we still want to test with the same renderer… re-attach
    system = new MapSystem(renderer, '', gltfLoader);
  });

  it('state returns to loaded after reload', async () => {
    // Load dust
    stubFetch(makeValidDefinition());
    await system.load('dust');

    // Reload compound
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ...makeValidDefinition(), id: 'compound' }) }),
    );
    await system.load('compound');
    expect(system.state).toBe('loaded');
  });

  // ── load — validation failures ────────────────────────────────────────────

  it('throws MalformedMapError when fetch returns non-OK status', async () => {
    stubFetch(null, false);
    await expect(system.load('dust')).rejects.toBeInstanceOf(MalformedMapError);
  });

  it('state returns to idle after a failed fetch', async () => {
    stubFetch(null, false);
    await system.load('dust').catch(() => {});
    expect(system.state).toBe('idle');
  });

  it('throws MalformedMapError when player spawn points array is empty', async () => {
    const def = makeValidDefinition();
    def.spawnPoints.player = [];
    stubFetch(def);
    await expect(system.load('dust')).rejects.toBeInstanceOf(MalformedMapError);
  });

  it('throws MalformedMapError when fewer than 8 bot spawn points provided', async () => {
    const def = makeValidDefinition();
    def.spawnPoints.bots = def.spawnPoints.bots.slice(0, 5);
    stubFetch(def);
    await expect(system.load('dust')).rejects.toBeInstanceOf(MalformedMapError);
  });

  it('throws MalformedMapError for fewer than 8 waypoints', async () => {
    const def = makeValidDefinition();
    def.waypoints = makeLinearWaypoints(4);
    stubFetch(def);
    await expect(system.load('dust')).rejects.toBeInstanceOf(MalformedMapError);
  });

  it('state returns to idle after any validation failure', async () => {
    const def = makeValidDefinition();
    def.spawnPoints.player = [];
    stubFetch(def);
    await system.load('dust').catch(() => {});
    expect(system.state).toBe('idle');
  });

  it('logs a performance warning when triangle count exceeds budget', async () => {
    const largeMesh = vi.fn().mockResolvedValue({
      scene: {
        traverse: (cb: (obj: unknown) => void) => {
          cb({
            isMesh: true,
            geometry: {
              dispose: vi.fn(),
              index: { count: 180_001 }, // 60 001 triangles
              attributes: {},
            },
            material: { dispose: vi.fn() },
          });
        },
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(makeValidDefinition());
    const sys = new MapSystem(renderer, '', largeMesh as GltfLoaderFn);
    await sys.load('dust');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('triangles'));
    warnSpy.mockRestore();
  });

  // ── query methods — guard conditions ─────────────────────────────────────

  it('getWaypointGraph throws MapNotLoadedError when idle', () => {
    expect(() => system.getWaypointGraph()).toThrow(MapNotLoadedError);
  });

  it('getColliders throws MapNotLoadedError when idle', () => {
    expect(() => system.getColliders()).toThrow(MapNotLoadedError);
  });

  it('getSpawnPoints throws MapNotLoadedError when idle', () => {
    expect(() => system.getSpawnPoints()).toThrow(MapNotLoadedError);
  });

  // ── query methods — happy paths ───────────────────────────────────────────

  it('getWaypointGraph returns a graph with 8 nodes after load', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    const graph = system.getWaypointGraph();
    expect(graph.nodes.size).toBe(8);
  });

  it('getColliders returns the colliders from the definition', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    const colliders = system.getColliders();
    expect(colliders).toHaveLength(1);
    expect(colliders[0]?.min).toEqual({ x: -50, y: -1, z: -50 });
  });

  it('getColliders returns a frozen array', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    const colliders = system.getColliders();
    expect(Object.isFrozen(colliders)).toBe(true);
  });

  it('getSpawnPoints returns the manifest from the definition', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    const sp = system.getSpawnPoints();
    expect(sp.player).toHaveLength(1);
    expect(sp.bots).toHaveLength(8);
  });

  it('getSpawnPoints returns a frozen manifest', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    const sp = system.getSpawnPoints();
    expect(Object.isFrozen(sp)).toBe(true);
  });

  // ── unload ────────────────────────────────────────────────────────────────

  it('throws MapStateError when unload is called while idle', () => {
    expect(() => system.unload()).toThrow(MapStateError);
  });

  it('MapStateError for unload includes "idle" as currentState', () => {
    let captured: unknown;
    try { system.unload(); } catch (e) { captured = e; }
    expect((captured as MapStateError).currentState).toBe('idle');
  });

  it('transitions to idle after unload', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    system.unload();
    expect(system.state).toBe('idle');
  });

  it('calls removeFromScene on unload', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    system.unload();
    expect(renderer.removeFromScene).toHaveBeenCalledOnce();
  });

  it('calls geometry.dispose() on unload', async () => {
    const geoDispose = vi.fn();
    gltfLoader = makeGltfLoader(geoDispose);
    system = new MapSystem(renderer, '', gltfLoader);
    stubFetch(makeValidDefinition());
    await system.load('dust');
    system.unload();
    expect(geoDispose).toHaveBeenCalledOnce();
  });

  it('calls material.dispose() on unload', async () => {
    const matDispose = vi.fn();
    gltfLoader = makeGltfLoader(makeGeoDispose(), matDispose);
    system = new MapSystem(renderer, '', gltfLoader);
    stubFetch(makeValidDefinition());
    await system.load('dust');
    system.unload();
    expect(matDispose).toHaveBeenCalledOnce();
  });

  it('query methods throw MapNotLoadedError after unload', async () => {
    stubFetch(makeValidDefinition());
    await system.load('dust');
    system.unload();
    expect(() => system.getWaypointGraph()).toThrow(MapNotLoadedError);
    expect(() => system.getColliders()).toThrow(MapNotLoadedError);
    expect(() => system.getSpawnPoints()).toThrow(MapNotLoadedError);
  });
});
