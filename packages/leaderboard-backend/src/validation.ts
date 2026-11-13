import type { ScoreEntry } from './types.js';

export type ValidationResult =
  | { ok: true; value: ScoreEntry }
  | { ok: false; error: string };

export function validateSubmitRequest(body: unknown): ValidationResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid JSON' };
  }

  const req = body as Record<string, unknown>;

  if (req['alias'] === undefined || req['alias'] === null) {
    return { ok: false, error: 'alias is required' };
  }
  if (typeof req['alias'] !== 'string') {
    return { ok: false, error: 'alias must be 1–20 characters' };
  }
  const alias = req['alias'].trim();
  if (alias.length < 1 || alias.length > 20) {
    return { ok: false, error: 'alias must be 1–20 characters' };
  }

  if (req['score'] === undefined || req['score'] === null) {
    return { ok: false, error: 'score is required' };
  }
  if (
    typeof req['score'] !== 'number' ||
    !isFinite(req['score']) ||
    req['score'] < 0 ||
    Math.floor(req['score']) !== req['score']
  ) {
    return { ok: false, error: 'score must be a non-negative integer' };
  }

  if (req['timestamp'] === undefined || req['timestamp'] === null) {
    return { ok: false, error: 'timestamp is required' };
  }
  if (typeof req['timestamp'] !== 'string') {
    return { ok: false, error: 'timestamp must be a valid ISO 8601 date string' };
  }
  if (isNaN(Date.parse(req['timestamp']))) {
    return { ok: false, error: 'timestamp must be a valid ISO 8601 date string' };
  }

  return {
    ok: true,
    value: { alias, score: req['score'], timestamp: req['timestamp'] },
  };
}
