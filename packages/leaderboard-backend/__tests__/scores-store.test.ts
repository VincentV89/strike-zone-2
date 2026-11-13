import { describe, it, expect } from 'vitest';
import { ScoresStore } from '../src/scores-store.js';
import type { ScoreEntry } from '../src/types.js';

function makeKv(initial: ScoreEntry[] | null = null) {
  let stored: string | null = initial === null ? null : JSON.stringify(initial);
  return {
    async get(_key: string, _opts: { type: 'json' }): Promise<unknown> {
      return stored === null ? null : JSON.parse(stored);
    },
    async put(_key: string, value: string): Promise<void> {
      stored = value;
    },
    getStored(): ScoreEntry[] | null {
      return stored === null ? null : (JSON.parse(stored) as ScoreEntry[]);
    },
  };
}

type MockKv = ReturnType<typeof makeKv>;

function store(kv: MockKv): ScoresStore {
  return new ScoresStore(kv as unknown as KVNamespace);
}

const TS = '2026-01-01T00:00:00Z';
const TS2 = '2026-01-02T00:00:00Z';

describe('ScoresStore.readAll', () => {
  it('returns empty array when KV is absent', async () => {
    expect(await store(makeKv()).readAll()).toEqual([]);
  });

  it('returns stored entries', async () => {
    const entries: ScoreEntry[] = [{ alias: 'Alice', score: 10, timestamp: TS }];
    expect(await store(makeKv(entries)).readAll()).toEqual(entries);
  });

  it('filters out entries missing required fields', async () => {
    const kv = makeKv([
      { alias: 'Alice', score: 10, timestamp: TS },
      { alias: 'Bad' } as unknown as ScoreEntry,
    ]);
    expect(await store(kv).readAll()).toHaveLength(1);
  });

  it('filters out non-object elements', async () => {
    const kv = makeKv([
      { alias: 'Alice', score: 10, timestamp: TS },
      42 as unknown as ScoreEntry,
    ]);
    expect(await store(kv).readAll()).toHaveLength(1);
  });
});

describe('ScoresStore.insert', () => {
  it('inserts into empty store', async () => {
    const kv = makeKv();
    const entry: ScoreEntry = { alias: 'Alice', score: 5, timestamp: TS };
    await store(kv).insert(entry);
    expect(kv.getStored()).toEqual([entry]);
  });

  it('sorts entries by score descending', async () => {
    const kv = makeKv([{ alias: 'Low', score: 2, timestamp: TS }]);
    await store(kv).insert({ alias: 'High', score: 10, timestamp: TS });
    const stored = kv.getStored()!;
    expect(stored[0]!.alias).toBe('High');
    expect(stored[1]!.alias).toBe('Low');
  });

  it('breaks score ties by timestamp ascending', async () => {
    const kv = makeKv();
    const s = store(kv);
    await s.insert({ alias: 'Later', score: 5, timestamp: TS2 });
    await s.insert({ alias: 'Earlier', score: 5, timestamp: TS });
    expect(kv.getStored()![0]!.alias).toBe('Earlier');
  });

  it('trims to 1000 entries maximum', async () => {
    const entries: ScoreEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      alias: `P${i}`,
      score: 1000 - i,
      timestamp: TS,
    }));
    const kv = makeKv(entries);
    await store(kv).insert({ alias: 'NewHigh', score: 9999, timestamp: TS });
    const stored = kv.getStored()!;
    expect(stored).toHaveLength(1000);
    expect(stored[0]!.alias).toBe('NewHigh');
  });

  it('lowest-score entry is evicted when cap exceeded', async () => {
    const entries: ScoreEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      alias: `P${i}`,
      score: i + 1,
      timestamp: TS,
    }));
    const kv = makeKv(entries);
    await store(kv).insert({ alias: 'Mid', score: 500, timestamp: TS });
    const stored = kv.getStored()!;
    expect(stored.find(e => e.alias === 'P0')).toBeUndefined();
  });
});
