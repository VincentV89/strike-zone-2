import type { Object3D, BufferGeometry, Material, Group } from 'three';
import type {
  MapId,
  MapSystemState,
  MapDefinitionJSON,
  ColliderVolume,
  SpawnManifest,
  WaypointGraph,
  SceneAdapter,
  GltfLoaderFn,
  GltfLoadResult,
  MapGeometryNode,
} from './types.js';
import {
  MapNotFoundError,
  MalformedMapError,
  MapStateError,
  MapNotLoadedError,
} from './types.js';
import { buildWaypointGraph } from './waypoint-graph.js';

const VALID_MAP_IDS: ReadonlySet<MapId> = new Set<MapId>(['dust', 'compound']);
const MAX_BOT_COUNT = 8;
const TRIANGLE_BUDGET = 50_000;
const COLLIDER_BUDGET = 500;

async function defaultGltfLoader(url: string): Promise<GltfLoadResult> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  return loader.loadAsync(url);
}

export class MapSystem {
  private _state: MapSystemState = 'idle';
  private _waypointGraph: WaypointGraph | null = null;
  private _colliders: readonly ColliderVolume[] = [];
  private _spawnPoints: SpawnManifest | null = null;
  private _geometryNodes: MapGeometryNode[] = [];

  constructor(
    private readonly renderer: SceneAdapter,
    private readonly baseUrl: string = '',
    private readonly gltfLoader: GltfLoaderFn = defaultGltfLoader,
  ) {}

  get state(): MapSystemState {
    return this._state;
  }

  async load(mapId: string): Promise<void> {
    if (!VALID_MAP_IDS.has(mapId as MapId)) {
      throw new MapNotFoundError(mapId);
    }
    if (this._state === 'loading' || this._state === 'unloading') {
      throw new MapStateError(this._state, 'load');
    }
    if (this._state === 'loaded') {
      this.unload();
    }

    this._state = 'loading';
    let loadedScene: Group | null = null;

    try {
      // Fetch and parse definition
      const definitionUrl = `${this.baseUrl}/maps/${mapId}/definition.json`;
      const response = await fetch(definitionUrl);
      if (!response.ok) {
        throw new MalformedMapError(
          `failed to fetch map definition "${mapId}": HTTP ${response.status}`,
        );
      }
      const rawDef = (await response.json()) as MapDefinitionJSON;

      // Build domain structures from raw JSON
      const waypointGraph = buildWaypointGraph(rawDef.waypoints);

      const colliders: ColliderVolume[] = rawDef.colliders.map((c) => ({
        min: { x: c.min.x, y: c.min.y, z: c.min.z },
        max: { x: c.max.x, y: c.max.y, z: c.max.z },
      }));

      if (rawDef.spawnPoints.player.length < 1) {
        throw new MalformedMapError('map has no player spawn points');
      }
      if (rawDef.spawnPoints.bots.length < MAX_BOT_COUNT) {
        throw new MalformedMapError(
          `insufficient bot spawn points: ${rawDef.spawnPoints.bots.length} (requires ${MAX_BOT_COUNT})`,
        );
      }

      const spawnPoints: SpawnManifest = Object.freeze({
        player: Object.freeze(
          rawDef.spawnPoints.player.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        ),
        bots: Object.freeze(
          rawDef.spawnPoints.bots.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        ),
      });

      // Load geometry
      const geomUrl = `${this.baseUrl}/maps/${mapId}/geometry.glb`;
      const gltf = await this.gltfLoader(geomUrl);
      loadedScene = gltf.scene;

      // Collect all geometries and materials from the scene for future disposal
      const geos: BufferGeometry[] = [];
      const mats: Material[] = [];

      gltf.scene.traverse((object: Object3D) => {
        const mesh = object as unknown as {
          isMesh?: boolean;
          geometry?: BufferGeometry;
          material?: Material | Material[];
        };
        if (!mesh.isMesh) return;
        if (mesh.geometry) geos.push(mesh.geometry);
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mats.push(...mesh.material);
          } else {
            mats.push(mesh.material);
          }
        }
      });

      const geometryNodes: MapGeometryNode[] = [
        { object3D: gltf.scene, geometries: geos, materials: mats },
      ];

      // Performance budget warnings — advisory only, never block gameplay
      let totalTriangles = 0;
      for (const geo of geos) {
        if (geo.index) {
          totalTriangles += geo.index.count / 3;
        } else {
          const posAttr = geo.attributes['position'];
          if (posAttr) {
            totalTriangles += (posAttr as { count: number }).count / 3;
          }
        }
      }
      if (totalTriangles > TRIANGLE_BUDGET) {
        console.warn(
          `map-system: map "${mapId}" has ${Math.round(totalTriangles)} triangles (budget: ${TRIANGLE_BUDGET})`,
        );
      }
      if (colliders.length > COLLIDER_BUDGET) {
        console.warn(
          `map-system: map "${mapId}" has ${colliders.length} colliders (budget: ${COLLIDER_BUDGET})`,
        );
      }

      // Add geometry to renderer scene
      this.renderer.addToScene(gltf.scene);

      // Commit all state atomically
      this._waypointGraph = waypointGraph;
      this._colliders = Object.freeze(colliders);
      this._spawnPoints = spawnPoints;
      this._geometryNodes = geometryNodes;
      this._state = 'loaded';
    } catch (err) {
      // If scene was already added, remove it to prevent leaks
      if (loadedScene !== null) {
        this.renderer.removeFromScene(loadedScene);
      }
      this._state = 'idle';
      throw err;
    }
  }

  unload(): void {
    if (this._state !== 'loaded') {
      throw new MapStateError(this._state, 'unload');
    }

    this._state = 'unloading';

    for (const node of this._geometryNodes) {
      this.renderer.removeFromScene(node.object3D);
      for (const geo of node.geometries) {
        geo.dispose();
      }
      for (const mat of node.materials) {
        mat.dispose();
      }
    }

    this._colliders = [];
    this._waypointGraph = null;
    this._spawnPoints = null;
    this._geometryNodes = [];
    this._state = 'idle';
  }

  getWaypointGraph(): WaypointGraph {
    if (this._state !== 'loaded' || this._waypointGraph === null) {
      throw new MapNotLoadedError('getWaypointGraph');
    }
    return this._waypointGraph;
  }

  getColliders(): readonly ColliderVolume[] {
    if (this._state !== 'loaded') {
      throw new MapNotLoadedError('getColliders');
    }
    return this._colliders;
  }

  getSpawnPoints(): SpawnManifest {
    if (this._state !== 'loaded' || this._spawnPoints === null) {
      throw new MapNotLoadedError('getSpawnPoints');
    }
    return this._spawnPoints;
  }
}
