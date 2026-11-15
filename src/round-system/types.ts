import type { PlayerState } from '../player-system/types.js';
import type { BotState, BotFSMState } from '../bot-system/types.js';

export type { PlayerState, BotState, BotFSMState };

export type RoundPhase = 'pre-match' | 'in-round' | 'round-end';

export type RoundOutcome = 'win' | 'lose' | null;

import type { MenuMatchConfig } from '../game-engine/types.js';

/** Round-level view of the engine MatchConfig: duration in ms instead of seconds. */
export type MatchConfig = MenuMatchConfig & {
  /** Countdown length in ms. Defaults to 180_000 (3 min) if omitted or <= 0. */
  roundDurationMs?: number;
};

export interface RoundState {
  readonly phase: RoundPhase;
  /** Milliseconds remaining; non-negative. */
  readonly timeRemaining: number;
  /** null until round-end. */
  readonly outcome: RoundOutcome;
  /** Cumulative bot eliminations this round. */
  readonly kills: number;
  /** Locked at round-end; 0 during pre-match and in-round. */
  readonly score: number;
}
