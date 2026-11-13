import type { Object3D, BufferGeometry, Material, Group } from 'three';

export type { Vec3 } from '../renderer-core/types.js';

export type MapId = 'dust' | 'compound';
export type MapSystemState = 'idle' | 'loading' | 'loaded' | 'unloading';

// Raw JSON shapes from definition.json (transient; discarded after hydration)
export interface RawAABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}
export interface RawWaypointNode {
  id: string;
  position: { x: number; y: number; z: number };
  neighbors: string[];
}
export interface MapDefinitionJSON {
  id: MapId;
  displayName: string;
  colliders: RawAABB[];
  waypoints: RawWaypointNode[];
  spawnPoints: {
    player: Array<{ x: number; y: number; z: number }>;
    bots: Array<{ x: number; y: number; z: number }>;
  };
  geometryUrl?: string;
  triangleCount?: number;
}

// Domain types

export interface WaypointNode {
  readonly id: string;
  readonly position: { x: number; y: number; z: number };
  readonly neighbors: readonly WaypointNode[];
}

export interface WaypointGraph {
  readonly nodes: ReadonlyMap<string, WaypointNode>;
  findNearest(pos: { x: number; y: number; z: number }): WaypointNode;
}

export interface ColliderVolume {
  readonly min: { x: number; y: number; z: number };
  readonly max: { x: number; y: number; z: number };
}

export interface SpawnManifest {
  readonly player: ReadonlyArray<{ x: number; y: number; z: number }>;
  readonly bots: ReadonlyArray<{ x: number; y: number; z: number }>;
}

// Renderer dependency — duck-typed to avoid tight coupling with renderer-core
export interface SceneAdapter {
  addToScene(object: Object3D): void;
  removeFromScene(object: Object3D): void;
}

// GLTF loader abstraction — injected so tests can supply a mock
export interface GltfLoadResult {
  scene: Group;
}
export type GltfLoaderFn = (url: string) => Promise<GltfLoadResult>;

// Internal disposal tracking — not exported from index
export interface MapGeometryNode {
  object3D: Object3D;
  geometries: BufferGeometry[];
  materials: Material[];
}

// Errors

export class MapNotFoundError extends Error {
  constructor(readonly mapId: string) {
    super(`Unknown map id: "${mapId}". Valid ids are "dust" and "compound"`);
    this.name = 'MapNotFoundError';
  }
}

export class MalformedMapError extends Error {
  constructor(reason: string) {
    super(`Malformed map definition: ${reason}`);
    this.name = 'MalformedMapError';
  }
}

export class MapStateError extends Error {
  constructor(
    readonly currentState: MapSystemState,
    readonly attemptedOperation: string,
  ) {
    super(`Cannot call "${attemptedOperation}" while map state is "${currentState}"`);
    this.name = 'MapStateError';
  }
}

export class MapNotLoadedError extends Error {
  constructor(method: string) {
    super(`Cannot call "${method}": no map is currently loaded`);
    this.name = 'MapNotLoadedError';
  }
}
