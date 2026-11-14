import { describe, it, expect } from 'vitest';
import { handleGet, handlePost } from '../src/handlers.js';
import type { Env, ScoreEntry } from '../src/types.js';

function makeKv(initial: ScoreEntry[] = []): KVNamespace {
  let stored = JSON.stringify(initial);
  return {
    async get(_key: string, _opts: { type: 'json' }): Promise<unknown> {
      return JSON.parse(stored);
    },
    async put(_key: string, value: string): Promise<void> {
      stored = value;
    },
  } as unknown as KVNamespace;
}

function makeRateLimiter(allow = true): RateLimitApi {
  return {
    async limit(_opts: { key: string }) {
      return { success: allow };
    },
  } as unknown as RateLimitApi;
}

function makeEnv(initial: ScoreEntry[] = [], allow = true): Env {
  return {
    KV: makeKv(initial),
    RATE_LIMITER: makeRateLimiter(allow),
    ALLOWED_ORIGIN: 'https://example.com',
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://worker/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { alias: 'Player1', score: 42, timestamp: '2026-11-13T10:00:00Z' };

describe('handleGet', () => {
  it('returns 200 with empty scores array when no entries', async () => {
    const response = await handleGet(new Request('http://worker/scores'), makeEnv());
    expect(response.status).toBe(200);
    const json = await response.json() as { scores: ScoreEntry[] };
    expect(json.scores).toEqual([]);
  });

  it('returns top 10 entries only', async () => {
    const entries: ScoreEntry[] = Array.from({ length: 15 }, (_, i) => ({
      alias: `P${i}`,
      score: 100 - i,
      timestamp: '2026-01-01T00:00:00Z',
    }));
    const response = await handleGet(new Request('http://worker/scores'), makeEnv(entries));
    const json = await response.json() as { scores: ScoreEntry[] };
    expect(json.scores).toHaveLength(10);
  });

  it('returns Content-Type application/json', async () => {
    const response = await handleGet(new Request('http://worker/scores'), makeEnv());
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns fewer than 10 when fewer entries exist', async () => {
    const entries: ScoreEntry[] = [{ alias: 'Solo', score: 5, timestamp: '2026-01-01T00:00:00Z' }];
    const response = await handleGet(new Request('http://worker/scores'), makeEnv(entries));
    const json = await response.json() as { scores: ScoreEntry[] };
    expect(json.scores).toHaveLength(1);
  });
});

describe('handlePost', () => {
  it('returns 201 on valid submission', async () => {
    const response = await handlePost(postRequest(VALID_BODY), makeEnv());
    expect(response.status).toBe(201);
  });

  it('returns 400 on missing alias', async () => {
    const { alias: _a, ...noAlias } = VALID_BODY;
    const response = await handlePost(postRequest(noAlias), makeEnv());
    expect(response.status).toBe(400);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('alias is required');
  });

  it('returns 400 on invalid score', async () => {
    const response = await handlePost(postRequest({ ...VALID_BODY, score: -1 }), makeEnv());
    expect(response.status).toBe(400);
  });

  it('returns 400 on invalid timestamp', async () => {
    const response = await handlePost(
      postRequest({ ...VALID_BODY, timestamp: 'bad' }),
      makeEnv(),
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    const request = new Request('http://worker/scores', {
      method: 'POST',
      body: 'not json',
    });
    const response = await handlePost(request, makeEnv());
    expect(response.status).toBe(400);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Invalid JSON');
  });

  it('returns 429 when rate limited', async () => {
    const response = await handlePost(postRequest(VALID_BODY), makeEnv([], false));
    expect(response.status).toBe(429);
  });
});
