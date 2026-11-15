/** Parsed query-param test hooks. Every field is inert unless its param is present and valid. */
export interface TestHooks {
  /** ?roundSecs=N — round length override in whole seconds. */
  readonly roundSecs: number | null;
  /** ?botHealth=N — starting health per bot. */
  readonly botHealth: number | null;
  /** ?debug=1 — exposes window.__SZ_DEBUG__. */
  readonly debug: boolean;
  /** True when any hook above is in effect; the round is then a practice round. */
  readonly active: boolean;
}

export interface IntRange {
  readonly min: number;
  readonly max: number;
}

export const ROUND_SECS_RANGE: IntRange = Object.freeze({ min: 1, max: 3600 });
export const BOT_HEALTH_RANGE: IntRange = Object.freeze({ min: 1, max: 1000 });

/** Global property name for the read-only debug snapshot. */
export const DEBUG_GLOBAL = '__SZ_DEBUG__';
