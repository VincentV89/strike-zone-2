import type { Mesh } from 'three';

import type { EntityId, Vec3 } from '../renderer-core/types.js';

export type { EntityId, Vec3 };

export type BotFSMState = 'idle' | 'patrol' | 'chase' | 'engage' | 'dead';

/** Read-only snapshot exposed to external consumers (RoundSystem, GameEngine). */
export interface BotState {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly rotation: number;
  readonly health: number;
  readonly state: BotFSMState;
}

/** Caller-provided per-tick player snapshot. BotSystem never writes to this. */
export interface PlayerState {
  readonly position: Vec3;
  readonly health: number;
  readonly alive: boolean;
}

/** Duck-typed renderer surface consumed by BotSystem. */
export interface BotRendererAdapter {
  getBotHitboxMesh(botId: EntityId): Mesh;
  hideBotMesh(botId: EntityId): void;
  showBotMesh(botId: EntityId): void;
}

/** Duck-typed combat surface consumed by BotSystem. */
export interface CombatAdapter {
  initCombatant(entityId: EntityId, health: number, ammo: number): void;
  registerHitbox(entityId: EntityId, mesh: Mesh): void;
  unregisterHitbox(entityId: EntityId): void;
  fire(origin: Vec3, direction: Vec3, shooterId: EntityId, damage: number): unknown;
}

/** Mutable internal bot entity — never exposed outside bot-system. */
export interface BotAgent {
  id: EntityId;
  position: Vec3;
  rotation: number;
  health: number;
  state: BotFSMState;
  idleAccumMs: number;
  targetWaypointNodeId: string | null;
  lastKnownPlayerPos: Vec3;
  reactionThresholdMs: number;
  reactionAccumMs: number;
  fireIntervalMs: number;
  fireAccumMs: number;
}
