import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';

import {
  RendererAlreadyInitError,
  RendererInitError,
  type EntityId,
  type RaycastHit,
  type Vec3,
  type Vec4,
} from './types.js';

interface MeshLike {
  geometry?: { dispose(): void };
  material?: { dispose(): void } | Array<{ dispose(): void }>;
}

export class RendererInstance {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private readonly hitboxObjects = new Set<Object3D>();
  private initialized = false;
  private frameCount = 0;

  init(canvas: HTMLCanvasElement): void {
    if (this.initialized) {
      throw new RendererAlreadyInitError();
    }

    const ctx = canvas.getContext('webgl2');
    if (ctx === null) {
      throw new RendererInitError('webgl2-unavailable');
    }

    this.renderer = new WebGLRenderer({ canvas, context: ctx, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.shadowMap.enabled = false;

    this.scene = new Scene();
    this.scene.background = new Color(0x000011);

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new PerspectiveCamera(75, aspect, 0.1, 500);

    const ambientLight = new AmbientLight(0xffffff, 0.6);
    const sunLight = new DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = false;
    this.scene.add(ambientLight);
    this.scene.add(sunLight);

    this.initialized = true;
  }

  tick(_deltaMs: number): void {
    if (!this.initialized) {
      console.warn('Renderer.tick called before init');
      return;
    }
    this.renderer!.render(this.scene!, this.camera!);
    this.frameCount++;
  }

  setCamera(position: Vec3, quaternion: Vec4): void {
    if (!this.initialized) return;
    this.camera!.position.set(position.x, position.y, position.z);
    this.camera!.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.camera!.updateMatrixWorld(true);
  }

  addToScene(object: Object3D): void {
    if (!this.initialized) return;
    this.scene!.add(object);
    if (object.userData['isHitbox'] === true) {
      const entityId = object.userData['entityId'];
      if (!entityId || typeof entityId !== 'string') {
        console.warn(
          'RendererInstance.addToScene: hitbox object missing entityId, skipping registry',
        );
        return;
      }
      this.hitboxObjects.add(object);
    }
  }

  removeFromScene(object: Object3D): void {
    if (!this.initialized) return;
    this.scene!.remove(object);
    this.hitboxObjects.delete(object);
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RaycastHit | null {
    if (!this.initialized || this.hitboxObjects.size === 0) return null;

    const raycaster = new Raycaster();
    raycaster.near = 0;
    raycaster.far = maxDistance;
    raycaster.ray.origin.set(origin.x, origin.y, origin.z);
    raycaster.ray.direction.set(direction.x, direction.y, direction.z);
    raycaster.ray.direction.normalize();

    const hits = raycaster.intersectObjects([...this.hitboxObjects], false);
    const hit = hits[0];
    if (!hit) return null;

    const faceNormal = hit.face?.normal ?? { x: 0, y: 0, z: 0 };
    return {
      entityId: hit.object.userData['entityId'] as EntityId,
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: faceNormal.x, y: faceNormal.y, z: faceNormal.z },
      distance: hit.distance,
    };
  }

  resize(width: number, height: number): void {
    if (!this.initialized) return;
    this.renderer!.setSize(width, height);
    this.camera!.aspect = width / height;
    this.camera!.updateProjectionMatrix();
  }

  dispose(): void {
    if (!this.initialized) return;

    this.scene!.traverse((object) => {
      const mesh = object as unknown as MeshLike;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => mat.dispose());
      } else {
        mesh.material?.dispose();
      }
    });

    this.renderer!.dispose();
    this.hitboxObjects.clear();
    this.initialized = false;
  }
}
