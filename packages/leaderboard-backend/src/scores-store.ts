import type { ScoreEntry } from './types.js';

const KV_KEY = 'scores:all';
const MAX_STORED = 1000;

export class ScoresStore {
  constructor(private readonly kv: KVNamespace) {}

  async readAll(): Promise<ScoreEntry[]> {
    const raw = await this.kv.get(KV_KEY, { type: 'json' });
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidEntry);
  }

  async insert(entry: ScoreEntry): Promise<void> {
    const existing = await this.readAll();
    existing.push(entry);
    existing.sort(compareEntries);
    if (existing.length > MAX_STORED) {
      existing.splice(MAX_STORED);
    }
    await this.kv.put(KV_KEY, JSON.stringify(existing));
  }
}

function compareEntries(a: ScoreEntry, b: ScoreEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  return Date.parse(a.timestamp) - Date.parse(b.timestamp);
}

function isValidEntry(entry: unknown): entry is ScoreEntry {
  if (entry === null || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e['alias'] === 'string' &&
    typeof e['score'] === 'number' &&
    typeof e['timestamp'] === 'string'
  );
}
