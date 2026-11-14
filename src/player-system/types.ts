import type { Vec3 } from '../renderer-core/types.js';
export type { Vec3 } from '../renderer-core/types.js';

export type Vec2 = { x: number; y: number };

export interface PlayerState {
  readonly health: number;
  readonly ammo: number;
  readonly position: Vec3;
  readonly rotation: Vec2;
  readonly isAlive: boolean;
}

export interface ColliderVolume {
  readonly min: Vec3;
  readonly max: Vec3;
}

// ─── Compile-time constants ───────────────────────────────────────────────────

export const PLAYER_ENTITY_ID = 'player' as const;
export const MAX_HEALTH = 100;
export const MAX_AMMO = 30;
export const DAMAGE_PER_SHOT = 25;
export const MOVE_SPEED = 5.0;
export const JUMP_VELOCITY = 5.0;
export const GRAVITY = 9.8;
export const EYE_HEIGHT = 1.6;
export const PLAYER_H = 1.8;
export const HALF_W = 0.3;
export const MOUSE_SENSITIVITY = 0.002;
export const PITCH_MIN_RAD = -1.553;
export const PITCH_MAX_RAD = 1.553;
export const DELTA_CAP_S = 0.1;
