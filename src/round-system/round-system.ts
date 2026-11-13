import type { BotState, MatchConfig, PlayerState, RoundOutcome, RoundPhase, RoundState } from './types.js';

export const DEFAULT_ROUND_DURATION_MS = 180_000;

export class RoundSystem {
  private phase: RoundPhase = 'pre-match';
  private config: MatchConfig | null = null;
  private timeRemaining: number = 0;
  private kills: number = 0;
  private score: number = 0;
  private outcome: RoundOutcome = null;

  // ─── RULE-RS-021: default to 180_000 if not provided or <= 0 ─────────────
  private effectiveDurationMs(): number {
    const d = this.config?.roundDurationMs;
    return d && d > 0 ? d : DEFAULT_ROUND_DURATION_MS;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** RULE-RS-001: only valid in pre-match; throws on misuse. */
  configure(config: MatchConfig): void {
    if (this.phase !== 'pre-match') {
      throw new Error(`configure() called in phase '${this.phase}'; only valid in 'pre-match'`);
    }
    this.config = config;
  }

  /** RULE-RS-002: transitions pre-match → in-round; no-ops in other phases. */
  start(): void {
    if (this.phase !== 'pre-match') return;
    this.timeRemaining = this.effectiveDurationMs();
    this.kills = 0;
    this.score = 0;
    this.outcome = null;
    this.phase = 'in-round';
  }

  /**
   * RULE-RS-003: no-op outside in-round.
   * State snapshots are injected by GameEngine — RoundSystem holds no direct refs.
   */
  update(deltaMs: number, playerState: PlayerState, botStates: BotState[]): void {
    if (this.phase !== 'in-round') return;

    // 1. Tick timer
    this.timeRemaining = Math.max(0, this.timeRemaining - deltaMs);

    // 2. RULE-RS-010/011: win takes priority over all simultaneous conditions
    if (botStates.every((b) => b.state === 'dead')) {
      this.score = this.calculateScore(this.kills, this.timeRemaining);
      this.outcome = 'win';
      this.phase = 'round-end';
      return;
    }

    // 3. RULE-RS-012: player death → lose
    if (!playerState.isAlive) {
      this.score = this.calculateScore(this.kills, 0);
      this.outcome = 'lose';
      this.phase = 'round-end';
      return;
    }

    // 4. RULE-RS-013: timer expiry with bots alive → lose
    if (this.timeRemaining <= 0) {
      this.score = this.calculateScore(this.kills, 0);
      this.outcome = 'lose';
      this.phase = 'round-end';
    }
  }

  /** INV-RS-005: returns a read-only shallow copy. */
  getState(): Readonly<RoundState> {
    return {
      phase: this.phase,
      timeRemaining: this.timeRemaining,
      outcome: this.outcome,
      kills: this.kills,
      score: this.score,
    };
  }

  /** RULE-RS-004: valid from any phase; preserves config (RULE-RS-022). */
  reset(): void {
    this.phase = 'pre-match';
    this.timeRemaining = 0;
    this.kills = 0;
    this.score = 0;
    this.outcome = null;
    // config intentionally preserved
  }

  /**
   * Called by GameEngine on bot elimination event.
   * RULE-RS-015: silently discarded outside in-round.
   */
  recordKill(): void {
    if (this.phase !== 'in-round') return;
    this.kills += 1;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /** RULE-RS-030/031: kills × 100 + time bonus (win only). */
  private calculateScore(kills: number, timeRemainingMs: number): number {
    return kills * 100 + Math.floor(timeRemainingMs / 1000) * 10;
  }
}
