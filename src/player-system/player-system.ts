import { BoxGeometry, Mesh } from 'three';

import type { CombatSystem } from '../combat-system/combat-system.js';
import type { RendererInstance } from '../renderer-core/renderer.js';
import type { Vec3, Vec4 } from '../renderer-core/types.js';
import type { InputState } from '../input-handler/types.js';

import {
  PLAYER_ENTITY_ID,
  MAX_HEALTH,
  MAX_AMMO,
  DAMAGE_PER_SHOT,
  MOVE_SPEED,
  JUMP_VELOCITY,
  GRAVITY,
  EYE_HEIGHT,
  PLAYER_H,
  HALF_W,
  MOUSE_SENSITIVITY,
  PITCH_MIN_RAD,
  PITCH_MAX_RAD,
  DELTA_CAP_S,
  type ColliderVolume,
  type PlayerState,
} from './types.js';

function sanitiseDelta(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

export class PlayerSystem {
  // ── private physics state ──────────────────────────────────────────────────
  private position: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private onGround = true;
  private prevOnGround = true;
  private health = MAX_HEALTH;
  private ammo = MAX_AMMO;
  private isAlive = false;
  private colliders: ColliderVolume[] = [];

  // created once at construction; world position updated each frame
  private readonly hitboxMesh: Mesh;

  constructor(
    private readonly combat: CombatSystem,
    private readonly renderer: RendererInstance,
  ) {
    this.hitboxMesh = new Mesh(new BoxGeometry(HALF_W * 2, PLAYER_H, HALF_W * 2));
  }

  spawn(spawnPoint: Vec3, colliders: ColliderVolume[]): void {
    this.position = { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z };
    this.yaw = 0;
    this.pitch = 0;
    this.verticalVelocity = 0;
    this.onGround = true;
    this.prevOnGround = true;
    this.health = MAX_HEALTH;
    this.ammo = MAX_AMMO;
    this.isAlive = true;
    this.colliders = colliders;

    this._syncHitboxMesh();
    this.combat.registerHitbox(PLAYER_ENTITY_ID, this.hitboxMesh);
    this.renderer.setCamera(this._eyePosition(), this._cameraQuaternion());
  }

  update(deltaMs: number, input: InputState): void {
    if (!this.isAlive) return;

    const dt = Math.min(sanitiseDelta(deltaMs) / 1000, DELTA_CAP_S);

    this._applyMouseLook(
      sanitiseDelta(input.mouseDeltaX),
      sanitiseDelta(input.mouseDeltaY),
    );

    const intent = this._computeHorizontalIntent(input);
    this._handleJumpAndGravity(dt, input.jump);

    const displacement: Vec3 = {
      x: intent.x * dt,
      y: this.verticalVelocity * dt,
      z: intent.z * dt,
    };

    const { resolved, grounded } = this._sweepAABB(displacement);
    this.position = {
      x: this.position.x + resolved.x,
      y: this.position.y + resolved.y,
      z: this.position.z + resolved.z,
    };

    this.prevOnGround = this.onGround;
    this.onGround = grounded;
    if (grounded) this.verticalVelocity = 0;

    this._syncHitboxMesh();
    this.renderer.setCamera(this._eyePosition(), this._cameraQuaternion());

    if (input.shoot && this.ammo > 0) {
      this._fireWeapon();
    }
  }

  takeDamage(amount: number, _sourceId: string): void {
    if (!this.isAlive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) {
      this.isAlive = false;
      this.combat.unregisterHitbox(PLAYER_ENTITY_ID);
    }
  }

  getState(): Readonly<PlayerState> {
    return Object.freeze({
      health: this.health,
      ammo: this.ammo,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: { x: this.pitch, y: this.yaw },
      isAlive: this.isAlive,
    });
  }

  reset(): void {
    this.combat.unregisterHitbox(PLAYER_ENTITY_ID);
    this.health = MAX_HEALTH;
    this.ammo = MAX_AMMO;
    this.isAlive = true;
    this.verticalVelocity = 0;
    this.onGround = true;
    this.prevOnGround = true;
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private _applyMouseLook(dx: number, dy: number): void {
    this.yaw = (this.yaw + dx * MOUSE_SENSITIVITY) % (2 * Math.PI);
    this.pitch = Math.max(
      PITCH_MIN_RAD,
      Math.min(PITCH_MAX_RAD, this.pitch - dy * MOUSE_SENSITIVITY),
    );
  }

  private _computeHorizontalIntent(input: InputState): Vec3 {
    const fwd = input.forward ? 1 : 0;
    const bwd = input.back ? 1 : 0;
    const rt = input.right ? 1 : 0;
    const lt = input.left ? 1 : 0;

    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const ix = forwardX * (fwd - bwd) + rightX * (rt - lt);
    const iz = forwardZ * (fwd - bwd) + rightZ * (rt - lt);

    const len = Math.sqrt(ix * ix + iz * iz);
    if (len > 1e-6) {
      return { x: (ix / len) * MOVE_SPEED, y: 0, z: (iz / len) * MOVE_SPEED };
    }
    return { x: 0, y: 0, z: 0 };
  }

  private _handleJumpAndGravity(dt: number, jumpPressed: boolean): void {
    // Reset onGround before sweep — restored by Y-axis floor collision
    this.onGround = false;

    if (jumpPressed && this.prevOnGround) {
      this.verticalVelocity = JUMP_VELOCITY;
    }

    this.verticalVelocity -= GRAVITY * dt;
  }

  private _sweepAABB(d: Vec3): { resolved: Vec3; grounded: boolean } {
    let px = this.position.x;
    let py = this.position.y;
    let pz = this.position.z;
    let grounded = false;

    // X pass
    px += d.x;
    for (const c of this.colliders) {
      if (this._overlapsAABB(px, py, pz, c)) {
        px = d.x > 0 ? c.min.x - HALF_W : c.max.x + HALF_W;
      }
    }

    // Y pass
    py += d.y;
    for (const c of this.colliders) {
      if (this._overlapsAABB(px, py, pz, c)) {
        if (d.y < 0) {
          py = c.max.y;
          grounded = true;
        } else {
          py = c.min.y - PLAYER_H;
        }
        this.verticalVelocity = 0;
      }
    }

    // Z pass
    pz += d.z;
    for (const c of this.colliders) {
      if (this._overlapsAABB(px, py, pz, c)) {
        pz = d.z > 0 ? c.min.z - HALF_W : c.max.z + HALF_W;
      }
    }

    return {
      resolved: { x: px - this.position.x, y: py - this.position.y, z: pz - this.position.z },
      grounded,
    };
  }

  private _overlapsAABB(px: number, py: number, pz: number, c: ColliderVolume): boolean {
    const minX = px - HALF_W;
    const maxX = px + HALF_W;
    const minY = py;
    const maxY = py + PLAYER_H;
    const minZ = pz - HALF_W;
    const maxZ = pz + HALF_W;
    return (
      minX < c.max.x && maxX > c.min.x &&
      minY < c.max.y && maxY > c.min.y &&
      minZ < c.max.z && maxZ > c.min.z
    );
  }

  private _fireWeapon(): void {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);

    const origin = this._eyePosition();
    const dirLen = Math.sqrt(
      (-sy * cp) ** 2 + sp ** 2 + (-cy * cp) ** 2,
    );
    const dir: Vec3 = {
      x: (-sy * cp) / dirLen,
      y: sp / dirLen,
      z: (-cy * cp) / dirLen,
    };

    this.combat.fire(origin, dir, PLAYER_ENTITY_ID, DAMAGE_PER_SHOT);
    this.ammo = Math.max(0, this.ammo - 1);
  }

  private _eyePosition(): Vec3 {
    return { x: this.position.x, y: this.position.y + EYE_HEIGHT, z: this.position.z };
  }

  private _cameraQuaternion(): Vec4 {
    // Q = Qy(yaw) * Qx(pitch)
    const hy = this.yaw / 2;
    const hp = this.pitch / 2;
    const cy = Math.cos(hy);
    const sy = Math.sin(hy);
    const cp = Math.cos(hp);
    const sp = Math.sin(hp);
    return {
      x: cy * sp,
      y: sy * cp,
      z: -sy * sp,
      w: cy * cp,
    };
  }

  private _syncHitboxMesh(): void {
    // Center of AABB is at half-height above feet position
    this.hitboxMesh.position.set(
      this.position.x,
      this.position.y + PLAYER_H / 2,
      this.position.z,
    );
    this.hitboxMesh.updateMatrixWorld(true);
  }
}
