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
  FIRE_INTERVAL_MS,
  RELOAD_DURATION_MS,
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

const OVERLAP_EPSILON = 1e-6;

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
  private fireCooldownMs = 0;
  private reloadRemainingMs = 0;
  private colliders: ColliderVolume[] = [];

  // created once at construction; world position updated each frame
  private readonly hitboxMesh: Mesh;

  constructor(
    private readonly combat: CombatSystem,
    private readonly renderer: RendererInstance,
  ) {
    this.hitboxMesh = new Mesh(new BoxGeometry(HALF_W * 2, PLAYER_H, HALF_W * 2));
  }

  /**
   * Places the player for a new round and registers it with CombatSystem.
   * @param initialYaw radians; 0 faces -Z. The engine passes a yaw that faces the map centre.
   */
  spawn(spawnPoint: Vec3, colliders: ColliderVolume[], initialYaw = 0): void {
    this.position = { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z };
    this.yaw = Number.isFinite(initialYaw) ? initialYaw : 0;
    this.pitch = 0;
    this.verticalVelocity = 0;
    this.onGround = true;
    this.prevOnGround = true;
    this.health = MAX_HEALTH;
    this.ammo = MAX_AMMO;
    this.isAlive = true;
    this.fireCooldownMs = 0;
    this.reloadRemainingMs = 0;
    this.colliders = colliders;

    this._syncHitboxMesh();
    // Ammo is tracked here (magazine + reload); CombatSystem only needs the
    // shooter registered, so give it an effectively unlimited count.
    this.combat.initCombatant(PLAYER_ENTITY_ID, MAX_HEALTH, Number.MAX_SAFE_INTEGER);
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

    // Use the swept position as-is: re-adding deltas to the old position
    // introduced float error that left the player a hair inside the floor,
    // and the next X pass then shoved them out of the map.
    const { position, grounded } = this._sweepAABB(displacement);
    this.position = position;

    this.prevOnGround = this.onGround;
    this.onGround = grounded;
    if (grounded) this.verticalVelocity = 0;

    this._syncHitboxMesh();
    this.renderer.setCamera(this._eyePosition(), this._cameraQuaternion());

    this._updateWeapon(dt * 1000, input);
  }

  /** Starts a reload if one is useful. Returns true when a reload started. */
  reload(): boolean {
    if (!this.isAlive || this.reloadRemainingMs > 0 || this.ammo >= MAX_AMMO) return false;
    this.reloadRemainingMs = RELOAD_DURATION_MS;
    return true;
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
      isReloading: this.reloadRemainingMs > 0,
    });
  }

  reset(): void {
    this.combat.unregisterHitbox(PLAYER_ENTITY_ID);
    this.health = MAX_HEALTH;
    this.ammo = MAX_AMMO;
    this.isAlive = true;
    this.fireCooldownMs = 0;
    this.reloadRemainingMs = 0;
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

  private _sweepAABB(d: Vec3): { position: Vec3; grounded: boolean } {
    let px = this.position.x;
    let py = this.position.y;
    let pz = this.position.z;
    let grounded = false;

    // X pass (only resolves against colliders when actually moving on X)
    px += d.x;
    for (const c of d.x === 0 ? [] : this.colliders) {
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

    // Z pass (only resolves against colliders when actually moving on Z)
    pz += d.z;
    for (const c of d.z === 0 ? [] : this.colliders) {
      if (this._overlapsAABB(px, py, pz, c)) {
        pz = d.z > 0 ? c.min.z - HALF_W : c.max.z + HALF_W;
      }
    }

    return {
      position: { x: px, y: py, z: pz },
      grounded,
    };
  }

  private _overlapsAABB(px: number, py: number, pz: number, c: ColliderVolume): boolean {
    const minX = px - HALF_W;
    const maxX = px + HALF_W;
    // Small tolerance so standing exactly on a surface is not an overlap.
    const minY = py + OVERLAP_EPSILON;
    const maxY = py + PLAYER_H - OVERLAP_EPSILON;
    const minZ = pz - HALF_W;
    const maxZ = pz + HALF_W;
    return (
      minX < c.max.x && maxX > c.min.x &&
      minY < c.max.y && maxY > c.min.y &&
      minZ < c.max.z && maxZ > c.min.z
    );
  }

  private _updateWeapon(dtMs: number, input: InputState): void {
    this.fireCooldownMs = Math.max(0, this.fireCooldownMs - dtMs);

    if (this.reloadRemainingMs > 0) {
      this.reloadRemainingMs = Math.max(0, this.reloadRemainingMs - dtMs);
      if (this.reloadRemainingMs === 0) this.ammo = MAX_AMMO;
      return;
    }

    if (input.reload && this.reload()) return;

    if (input.shoot && this.ammo > 0 && this.fireCooldownMs === 0) {
      this._fireWeapon();
      this.fireCooldownMs = FIRE_INTERVAL_MS;
    }

    if (this.ammo === 0) this.reload();
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
