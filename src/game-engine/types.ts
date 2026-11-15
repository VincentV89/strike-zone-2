export type EngineState =
  | 'uninitialized'
  | 'menu'
  | 'loading'
  | 'in-round'
  | 'round-end';

import type { MapId } from '../map-system/types.js';

/**
 * The one match configuration shape. UI selects mapId + botCount
 * (MenuMatchConfig); the engine adds roundDurationSecs (default 180).
 */
export interface MatchConfig {
  mapId: MapId;
  botCount: number;
  roundDurationSecs: number;
}

/** What the main menu lets the player choose. */
export type MenuMatchConfig = Pick<MatchConfig, 'mapId' | 'botCount'>;

/** Optional engine behaviour overrides; set only by query-param test hooks. */
export interface GameEngineOptions {
  /** Overrides the default 180 s round length. */
  roundDurationSecs?: number;
  /** When true, score submission is disabled (any test hook is active). */
  practiceMode?: boolean;
}

/** Frozen snapshot exposed as window.__SZ_DEBUG__ when ?debug=1 is set. */
export interface EngineDebugSnapshot {
  readonly engineState: EngineState;
  readonly roundPhase: 'pre-match' | 'in-round' | 'round-end';
  readonly timeRemainingMs: number;
  readonly outcome: 'win' | 'lose' | null;
  readonly kills: number;
  readonly score: number;
  readonly mapId: MapId | null;
  readonly practiceMode: boolean;
  readonly lastError: string | null;
  readonly player: {
    readonly health: number;
    readonly ammo: number;
    readonly isAlive: boolean;
    readonly isReloading: boolean;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly rotation: { readonly x: number; readonly y: number };
  };
  readonly bots: ReadonlyArray<{
    readonly id: string;
    readonly alive: boolean;
    readonly state: string;
    readonly health: number;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
  }>;
  readonly combatantIds: readonly string[];
}

export class IllegalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalStateError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
