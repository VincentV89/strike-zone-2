import type { RoundState, RoundOutcome } from '../round-system/types.js';
import type { PlayerState } from '../player-system/types.js';

export type { RoundState, RoundOutcome, PlayerState };

/** Leaderboard entry — mirrors LeaderboardClient.ScoreEntry. */
export interface ScoreEntry {
  alias: string;
  score: number;
  timestamp: string;
}

export type ScreenId = 'main-menu' | 'hud' | 'end-round' | 'leaderboard';

export interface MatchConfig {
  mapId: 'map-a' | 'map-b';
  botCount: number;
}

export interface UIState {
  readonly playerState: PlayerState;
  readonly roundState: RoundState;
}

export type UIAction =
  | { type: 'start-game'; config: MatchConfig }
  | { type: 'play-again' }
  | { type: 'submit-score'; alias: string }
  | { type: 'view-leaderboard' };

export type ActionHandler = (action: UIAction) => void;

export type SubmitResultState = 'idle' | 'loading' | 'ok' | 'error';

export interface UISystemState {
  currentScreen: ScreenId;
  pendingAlias: string;
  leaderboardLoading: boolean;
  submitResult: SubmitResultState;
}
