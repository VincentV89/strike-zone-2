/** Immutable leaderboard entry returned by GET /scores. */
export interface ScoreEntry {
  alias: string;
  score: number;
  timestamp: string;
}

/** Wire body sent to POST /scores. Internal to LeaderboardClient — not exported. */
export interface SubmitScoreRequest {
  alias: string;
  score: number;
  timestamp: string;
}

/** Discriminated result returned by submitScore(). Never throws. */
export type SubmitResult =
  | { success: true }
  | { success: false; error: string };

/** Construction-time configuration for LeaderboardClient. */
export interface LeaderboardClientConfig {
  /** Cloudflare Worker origin, e.g. "https://scores.example.workers.dev" */
  baseUrl: string;
  /** Per-request timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
}
