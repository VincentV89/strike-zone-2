export type EntityId = string;

export type Vec3 = { x: number; y: number; z: number };
export type Vec4 = { x: number; y: number; z: number; w: number };

export interface RaycastHit {
  entityId: EntityId;
  point: Vec3;
  normal: Vec3;
  distance: number;
}

export class RendererInitError extends Error {
  override readonly cause: 'webgl2-unavailable' | 'canvas-invalid';

  constructor(cause: 'webgl2-unavailable' | 'canvas-invalid') {
    const msg =
      cause === 'webgl2-unavailable'
        ? 'WebGL2 is not available on this device or browser'
        : 'Canvas element is null or invalid';
    super(msg);
    this.name = 'RendererInitError';
    this.cause = cause;
  }
}

export class RendererAlreadyInitError extends Error {
  constructor() {
    super('Renderer is already initialised; call dispose() before re-initialising');
    this.name = 'RendererAlreadyInitError';
  }
}
