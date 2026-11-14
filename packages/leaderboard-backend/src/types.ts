export interface ScoreEntry {
  alias: string;
  score: number;
  timestamp: string;
}

export interface ScoreListResponse {
  scores: ScoreEntry[];
}

export interface ErrorResponse {
  error: string;
}

export interface Env {
  KV: KVNamespace;
  RATE_LIMITER: RateLimitApi;
  ALLOWED_ORIGIN: string;
}
