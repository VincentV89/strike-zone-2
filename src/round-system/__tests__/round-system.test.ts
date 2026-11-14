import { describe, it, expect, beforeEach } from 'vitest';
import { RoundSystem, DEFAULT_ROUND_DURATION_MS } from '../round-system.js';
import type { MatchConfig } from '../types.js';
import type { PlayerState } from '../../player-system/types.js';
import type { BotState } from '../../bot-system/types.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<MatchConfig>): MatchConfig {
  return { mapId: 'map-alpha', botCount: 3, roundDurationMs: 10_000, ...overrides };
}

function makePlayer(overrides?: Partial<PlayerState>): PlayerState {
  return {
    health: 100,
    ammo: 30,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0 },
    isAlive: true,
    ...overrides,
  };
}

function makeBots(count: number, dead = false): BotState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bot-${i}`,
    position: { x: i * 2, y: 0, z: 0 },
    rotation: 0,
    health: dead ? 0 : 100,
    state: dead ? 'dead' : 'patrol',
  })) as BotState[];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RoundSystem', () => {
  let rs: RoundSystem;

  beforeEach(() => {
    rs = new RoundSystem();
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  it('starts in pre-match phase with zeroed state', () => {
    const s = rs.getState();
    expect(s.phase).toBe('pre-match');
    expect(s.timeRemaining).toBe(0);
    expect(s.outcome).toBeNull();
    expect(s.kills).toBe(0);
    expect(s.score).toBe(0);
  });

  // ─── configure() ─────────────────────────────────────────────────────────

  it('configure() stores config in pre-match', () => {
    rs.configure(makeConfig({ botCount: 5 }));
    // start() to verify config was stored (duration used)
    rs.start();
    expect(rs.getState().timeRemaining).toBe(10_000);
  });

  it('configure() throws when called during in-round (RULE-RS-001)', () => {
    rs.configure(makeConfig());
    rs.start();
    expect(() => rs.configure(makeConfig())).toThrow();
  });

  it('configure() throws when called during round-end (RULE-RS-001)', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.update(10_001, makePlayer(), makeBots(2)); // timer expires
    expect(rs.getState().phase).toBe('round-end');
    expect(() => rs.configure(makeConfig())).toThrow();
  });

  // ─── start() ─────────────────────────────────────────────────────────────

  it('start() transitions pre-match → in-round', () => {
    rs.configure(makeConfig());
    rs.start();
    expect(rs.getState().phase).toBe('in-round');
  });

  it('start() sets timeRemaining from config', () => {
    rs.configure(makeConfig({ roundDurationMs: 60_000 }));
    rs.start();
    expect(rs.getState().timeRemaining).toBe(60_000);
  });

  it('start() uses DEFAULT_ROUND_DURATION_MS when roundDurationMs not provided', () => {
    rs.configure(makeConfig({ roundDurationMs: undefined }));
    rs.start();
    expect(rs.getState().timeRemaining).toBe(DEFAULT_ROUND_DURATION_MS);
  });

  it('start() uses default duration when roundDurationMs <= 0', () => {
    rs.configure(makeConfig({ roundDurationMs: 0 }));
    rs.start();
    expect(rs.getState().timeRemaining).toBe(DEFAULT_ROUND_DURATION_MS);
  });

  it('start() resets kills and score from previous round', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.recordKill();
    rs.reset();
    rs.start();
    const s = rs.getState();
    expect(s.kills).toBe(0);
    expect(s.score).toBe(0);
  });

  it('start() no-ops when already in-round (RULE-RS-002)', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.update(1000, makePlayer(), makeBots(2));
    rs.start(); // should not reset timer
    expect(rs.getState().phase).toBe('in-round');
    expect(rs.getState().timeRemaining).toBe(9_000);
  });

  it('start() no-ops when in round-end (RULE-RS-002)', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.update(10_001, makePlayer(), makeBots(2));
    expect(rs.getState().phase).toBe('round-end');
    rs.start();
    expect(rs.getState().phase).toBe('round-end');
  });

  // ─── update() ────────────────────────────────────────────────────────────

  it('update() is a no-op in pre-match (RULE-RS-003)', () => {
    rs.update(5000, makePlayer(), makeBots(2));
    expect(rs.getState().phase).toBe('pre-match');
    expect(rs.getState().timeRemaining).toBe(0);
  });

  it('update() is a no-op in round-end (RULE-RS-003)', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.update(10_001, makePlayer(), makeBots(2)); // force lose via timer
    const stateBefore = rs.getState();
    rs.update(1000, makePlayer(), makeBots(2));
    expect(rs.getState().score).toBe(stateBefore.score);
  });

  it('update() decrements timer by deltaMs', () => {
    rs.configure(makeConfig({ roundDurationMs: 10_000 }));
    rs.start();
    rs.update(2500, makePlayer(), makeBots(2));
    expect(rs.getState().timeRemaining).toBe(7_500);
  });

  it('INV-RS-001: timeRemaining never goes below 0', () => {
    rs.configure(makeConfig({ roundDurationMs: 1_000 }));
    rs.start();
    rs.update(5_000, makePlayer(), makeBots(2));
    // round ends as lose, but timer should have been clamped to 0
    expect(rs.getState().timeRemaining).toBe(0);
  });

  // ─── Win condition ────────────────────────────────────────────────────────

  it('all bots dead → win (req-win-condition)', () => {
    rs.configure(makeConfig({ roundDurationMs: 30_000 }));
    rs.start();
    rs.update(5_000, makePlayer(), makeBots(3, true));
    const s = rs.getState();
    expect(s.phase).toBe('round-end');
    expect(s.outcome).toBe('win');
  });

  it('win takes priority over simultaneous timer expiry (RULE-RS-010)', () => {
    rs.configure(makeConfig({ roundDurationMs: 5_000 }));
    rs.start();
    // Timer will expire and all bots are dead on the same frame
    rs.update(5_000, makePlayer(), makeBots(2, true));
    expect(rs.getState().outcome).toBe('win');
  });

  it('win takes priority over simultaneous player death (RULE-RS-011)', () => {
    rs.configure(makeConfig({ roundDurationMs: 30_000 }));
    rs.start();
    rs.update(1_000, makePlayer({ isAlive: false }), makeBots(2, true));
    expect(rs.getState().outcome).toBe('win');
  });

  // ─── Lose conditions ──────────────────────────────────────────────────────

  it('player death → lose (RULE-RS-012)', () => {
    rs.configure(makeConfig({ roundDurationMs: 30_000 }));
    rs.start();
    rs.update(2_000, makePlayer({ isAlive: false }), makeBots(3));
    const s = rs.getState();
    expect(s.phase).toBe('round-end');
    expect(s.outcome).toBe('lose');
  });

  it('timer expiry with bots alive → lose (RULE-RS-013)', () => {
    rs.configure(makeConfig({ roundDurationMs: 5_000 }));
    rs.start();
    rs.update(5_001, makePlayer(), makeBots(2));
    expect(rs.getState().outcome).toBe('lose');
  });

  // ─── Score calculation ────────────────────────────────────────────────────

  it('win score = kills × 100 + floor(timeRemaining/1000) × 10 (RULE-RS-030/031)', () => {
    rs.configure(makeConfig({ roundDurationMs: 30_000 }));
    rs.start();
    rs.recordKill();
    rs.recordKill();
    rs.update(10_000, makePlayer(), makeBots(3, true)); // 20_000 ms remain
    const s = rs.getState();
    // 2 kills × 100 = 200, floor(20_000/1000) × 10 = 200
    expect(s.score).toBe(400);
  });

  it('lose (player death) score has no time bonus (RULE-RS-031)', () => {
    rs.configure(makeConfig({ roundDurationMs: 30_000 }));
    rs.start();
    rs.recordKill();
    rs.update(5_000, makePlayer({ isAlive: false }), makeBots(2));
    const s = rs.getState();
    // 1 kill × 100 = 100, no time bonus
    expect(s.score).toBe(100);
  });

  it('lose (timer expiry) score has no time bonus', () => {
    rs.configure(makeConfig({ roundDurationMs: 5_000 }));
    rs.start();
    rs.recordKill();
    rs.update(6_000, makePlayer(), makeBots(2));
    expect(rs.getState().score).toBe(100);
  });

  it('RULE-RS-032: 0 kills + lose = score of 0', () => {
    rs.configure(makeConfig({ roundDurationMs: 1_000 }));
    rs.start();
    rs.update(2_000, makePlayer(), makeBots(2));
    expect(rs.getState().score).toBe(0);
  });

  it('INV-RS-003: score is immutable after round-end', () => {
    rs.configure(makeConfig({ roundDurationMs: 5_000 }));
    rs.start();
    rs.update(6_000, makePlayer(), makeBots(2)); // lose
    const scoreLocked = rs.getState().score;
    rs.update(1_000, makePlayer(), makeBots(2)); // further updates
    expect(rs.getState().score).toBe(scoreLocked);
  });

  // ─── Kill tracking ────────────────────────────────────────────────────────

  it('recordKill() increments kills during in-round', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.recordKill();
    rs.recordKill();
    expect(rs.getState().kills).toBe(2);
  });

  it('recordKill() is a no-op outside in-round (RULE-RS-015)', () => {
    rs.recordKill(); // pre-match
    expect(rs.getState().kills).toBe(0);
  });

  it('recordKill() is a no-op after round-end (RULE-RS-015)', () => {
    rs.configure(makeConfig({ roundDurationMs: 1_000 }));
    rs.start();
    rs.update(2_000, makePlayer(), makeBots(2)); // lose
    rs.recordKill();
    expect(rs.getState().kills).toBe(0);
  });

  it('INV-RS-002: kills never negative', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.recordKill();
    expect(rs.getState().kills).toBeGreaterThanOrEqual(0);
  });

  // ─── reset() ─────────────────────────────────────────────────────────────

  it('reset() from pre-match clears state (RULE-RS-004)', () => {
    rs.configure(makeConfig());
    rs.reset();
    const s = rs.getState();
    expect(s.phase).toBe('pre-match');
    expect(s.kills).toBe(0);
  });

  it('reset() from in-round transitions to pre-match (RULE-RS-004)', () => {
    rs.configure(makeConfig());
    rs.start();
    rs.recordKill();
    rs.reset();
    const s = rs.getState();
    expect(s.phase).toBe('pre-match');
    expect(s.kills).toBe(0);
    expect(s.timeRemaining).toBe(0);
    expect(s.outcome).toBeNull();
  });

  it('reset() from round-end transitions to pre-match (RULE-RS-004)', () => {
    rs.configure(makeConfig({ roundDurationMs: 1_000 }));
    rs.start();
    rs.update(2_000, makePlayer(), makeBots(2));
    rs.reset();
    expect(rs.getState().phase).toBe('pre-match');
  });

  it('reset() preserves config for play-again flow (RULE-RS-022)', () => {
    const cfg = makeConfig({ botCount: 5, roundDurationMs: 20_000 });
    rs.configure(cfg);
    rs.reset();
    // Start again — should use preserved config duration
    rs.start();
    expect(rs.getState().timeRemaining).toBe(20_000);
  });

  it('reset() does not throw from any phase (RULE-RS-004)', () => {
    expect(() => rs.reset()).not.toThrow();
    rs.configure(makeConfig());
    rs.start();
    expect(() => rs.reset()).not.toThrow();
  });

  // ─── getState() immutability ──────────────────────────────────────────────

  it('INV-RS-005: getState returns a fresh snapshot each call', () => {
    rs.configure(makeConfig({ roundDurationMs: 10_000 }));
    rs.start();
    const s1 = rs.getState();
    rs.update(1_000, makePlayer(), makeBots(2));
    const s2 = rs.getState();
    expect(s1.timeRemaining).toBe(10_000);
    expect(s2.timeRemaining).toBe(9_000);
  });

  it('INV-RS-004: outcome is null during in-round', () => {
    rs.configure(makeConfig({ roundDurationMs: 30_000 }));
    rs.start();
    rs.update(1_000, makePlayer(), makeBots(2));
    expect(rs.getState().outcome).toBeNull();
  });

  // ─── Phase graph (RULE-RS-005) ────────────────────────────────────────────

  it('RULE-RS-005: pre-match → in-round → round-end → pre-match (via reset)', () => {
    rs.configure(makeConfig({ roundDurationMs: 1_000 }));
    expect(rs.getState().phase).toBe('pre-match');
    rs.start();
    expect(rs.getState().phase).toBe('in-round');
    rs.update(2_000, makePlayer(), makeBots(2));
    expect(rs.getState().phase).toBe('round-end');
    rs.reset();
    expect(rs.getState().phase).toBe('pre-match');
  });
});
