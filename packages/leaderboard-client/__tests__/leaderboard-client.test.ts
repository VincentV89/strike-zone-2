import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LeaderboardClient } from '../src/leaderboard-client.js';
import type { ScoreEntry } from '../src/types.js';

const BASE_URL = 'https://scores.test.workers.dev';

function makeClient(overrides?: { timeoutMs?: number }) {
  return new LeaderboardClient({ baseUrl: BASE_URL, ...overrides });
}

function mockFetch(response: Partial<Response> & { jsonData?: unknown }) {
  const { jsonData, ...rest } = response;
  return vi.fn().mockResolvedValue({
    ok: rest.ok ?? true,
    status: rest.status ?? 200,
    json: jsonData !== undefined ? vi.fn().mockResolvedValue(jsonData) : vi.fn().mockRejectedValue(new Error('no json')),
    ...rest,
  });
}

const SAMPLE_ENTRIES: ScoreEntry[] = [
  { alias: 'Alice', score: 300, timestamp: '2026-11-13T10:00:00.000Z' },
  { alias: 'Bob', score: 200, timestamp: '2026-11-13T09:00:00.000Z' },
];

describe('LeaderboardClient — getTopScores', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ ok: true, status: 200, jsonData: { scores: SAMPLE_ENTRIES } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed ScoreEntry array on 200 OK', async () => {
    const client = makeClient();
    const result = await client.getTopScores();
    expect(result).toEqual(SAMPLE_ENTRIES);
  });

  it('returns [] when response is not ok', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500 }));
    const client = makeClient();
    const result = await client.getTopScores();
    expect(result).toEqual([]);
  });

  it('returns [] on network error (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const client = makeClient();
    const result = await client.getTopScores();
    expect(result).toEqual([]);
  });

  it('returns [] on timeout (AbortError)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const client = makeClient({ timeoutMs: 1 });
    const result = await client.getTopScores();
    expect(result).toEqual([]);
  });

  it('calls GET /scores with correct URL', async () => {
    const spy = mockFetch({ ok: true, status: 200, jsonData: { scores: [] } });
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    await client.getTopScores();
    expect(spy).toHaveBeenCalledWith(
      `${BASE_URL}/scores`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('LeaderboardClient — submitScore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns { success: true } on 201 Created', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true, status: 201 }));
    const client = makeClient();
    const result = await client.submitScore('Alice', 42);
    expect(result).toEqual({ success: true });
  });

  it('rejects empty alias before network call', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    const result = await client.submitScore('   ', 10);
    expect(result).toEqual({ success: false, error: 'Alias required' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects alias longer than 20 characters', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    const result = await client.submitScore('A'.repeat(21), 10);
    expect(result).toEqual({ success: false, error: 'Alias too long (max 20 characters)' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects negative score', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    const result = await client.submitScore('Alice', -1);
    expect(result).toEqual({ success: false, error: 'Invalid score' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects non-integer score', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    const result = await client.submitScore('Alice', 1.5);
    expect(result).toEqual({ success: false, error: 'Invalid score' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects NaN score', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    const result = await client.submitScore('Alice', NaN);
    expect(result).toEqual({ success: false, error: 'Invalid score' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns backend error message on 400 Bad Request', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 400, jsonData: { error: 'Score out of range' } }));
    const client = makeClient();
    const result = await client.submitScore('Alice', 0);
    expect(result).toEqual({ success: false, error: 'Score out of range' });
  });

  it('returns rate-limit message on 429', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 429 }));
    const client = makeClient();
    const result = await client.submitScore('Alice', 42);
    expect(result).toEqual({ success: false, error: 'Too many submissions — please wait' });
  });

  it('returns network error message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const client = makeClient();
    const result = await client.submitScore('Alice', 42);
    expect(result).toEqual({ success: false, error: 'Network error — score not saved' });
  });

  it('trims whitespace from alias before submission', async () => {
    const spy = mockFetch({ ok: true, status: 201 });
    vi.stubGlobal('fetch', spy);
    const client = makeClient();
    await client.submitScore('  Alice  ', 42);
    const call = spy.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as { alias: string };
    expect(body.alias).toBe('Alice');
  });

  it('includes a fresh ISO 8601 timestamp in POST body', async () => {
    const spy = mockFetch({ ok: true, status: 201 });
    vi.stubGlobal('fetch', spy);
    const before = new Date().toISOString();
    const client = makeClient();
    await client.submitScore('Alice', 42);
    const after = new Date().toISOString();
    const call = spy.mock.calls[0];
    const body = JSON.parse((call?.[1] as RequestInit).body as string) as { timestamp: string };
    expect(body.timestamp >= before).toBe(true);
    expect(body.timestamp <= after).toBe(true);
  });

  it('allows concurrent getTopScores and submitScore calls independently', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true, status: 201, jsonData: { scores: SAMPLE_ENTRIES } }));
    const client = makeClient();
    const [scores, submit] = await Promise.all([
      client.getTopScores(),
      client.submitScore('Alice', 42),
    ]);
    expect(Array.isArray(scores)).toBe(true);
    expect(submit).toEqual({ success: true });
  });
});
