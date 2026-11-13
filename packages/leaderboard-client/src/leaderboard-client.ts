import type {
  LeaderboardClientConfig,
  ScoreEntry,
  SubmitResult,
  SubmitScoreRequest,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 5000;

export class LeaderboardClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: LeaderboardClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Fetches the top 10 leaderboard entries.
   * Returns [] on any error — never throws.
   */
  async getTopScores(): Promise<ScoreEntry[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/scores`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { scores: ScoreEntry[] };
      return Array.isArray(data.scores) ? data.scores : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Submits a score entry. Returns SubmitResult — never throws.
   * Validates alias and score before issuing the network request.
   */
  async submitScore(alias: string, score: number): Promise<SubmitResult> {
    const trimmedAlias = alias.trim();

    if (trimmedAlias.length === 0) {
      return { success: false, error: 'Alias required' };
    }

    if (trimmedAlias.length > 20) {
      return { success: false, error: 'Alias too long (max 20 characters)' };
    }

    if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0) {
      return { success: false, error: 'Invalid score' };
    }

    const body: SubmitScoreRequest = {
      alias: trimmedAlias,
      score,
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 201) {
        return { success: true };
      }

      if (response.status === 400) {
        try {
          const err = (await response.json()) as { error?: string };
          return {
            success: false,
            error: err.error ?? 'Submission rejected',
          };
        } catch {
          return { success: false, error: 'Submission rejected' };
        }
      }

      if (response.status === 429) {
        return { success: false, error: 'Too many submissions — please wait' };
      }

      return { success: false, error: 'Network error — score not saved' };
    } catch {
      return { success: false, error: 'Network error — score not saved' };
    } finally {
      clearTimeout(timer);
    }
  }
}
