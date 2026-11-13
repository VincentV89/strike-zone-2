import { describe, it, expect } from 'vitest';
import { validateSubmitRequest } from '../src/validation.js';

const VALID = { alias: 'Player1', score: 42, timestamp: '2026-11-13T10:00:00Z' };

describe('validateSubmitRequest', () => {
  it('accepts a valid request', () => {
    const result = validateSubmitRequest(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(VALID);
  });

  it('trims alias whitespace', () => {
    const result = validateSubmitRequest({ ...VALID, alias: '  Trimmed  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.alias).toBe('Trimmed');
  });

  it('accepts score of zero', () => {
    expect(validateSubmitRequest({ ...VALID, score: 0 }).ok).toBe(true);
  });

  it('rejects null body', () => {
    expect(validateSubmitRequest(null)).toEqual({ ok: false, error: 'Invalid JSON' });
  });

  it('rejects array body', () => {
    expect(validateSubmitRequest([])).toEqual({ ok: false, error: 'Invalid JSON' });
  });

  it('rejects missing alias', () => {
    const { alias: _a, ...noAlias } = VALID;
    expect(validateSubmitRequest(noAlias)).toEqual({ ok: false, error: 'alias is required' });
  });

  it('rejects alias that trims to empty', () => {
    expect(validateSubmitRequest({ ...VALID, alias: '   ' })).toEqual({
      ok: false,
      error: 'alias must be 1–20 characters',
    });
  });

  it('rejects alias longer than 20 chars', () => {
    expect(validateSubmitRequest({ ...VALID, alias: 'a'.repeat(21) })).toEqual({
      ok: false,
      error: 'alias must be 1–20 characters',
    });
  });

  it('rejects missing score', () => {
    const { score: _s, ...noScore } = VALID;
    expect(validateSubmitRequest(noScore)).toEqual({ ok: false, error: 'score is required' });
  });

  it('rejects negative score', () => {
    expect(validateSubmitRequest({ ...VALID, score: -1 })).toEqual({
      ok: false,
      error: 'score must be a non-negative integer',
    });
  });

  it('rejects fractional score', () => {
    expect(validateSubmitRequest({ ...VALID, score: 3.5 })).toEqual({
      ok: false,
      error: 'score must be a non-negative integer',
    });
  });

  it('rejects string score', () => {
    expect(validateSubmitRequest({ ...VALID, score: '42' })).toEqual({
      ok: false,
      error: 'score must be a non-negative integer',
    });
  });

  it('rejects NaN score', () => {
    expect(validateSubmitRequest({ ...VALID, score: NaN })).toEqual({
      ok: false,
      error: 'score must be a non-negative integer',
    });
  });

  it('rejects missing timestamp', () => {
    const { timestamp: _t, ...noTs } = VALID;
    expect(validateSubmitRequest(noTs)).toEqual({ ok: false, error: 'timestamp is required' });
  });

  it('rejects invalid timestamp', () => {
    expect(validateSubmitRequest({ ...VALID, timestamp: 'not-a-date' })).toEqual({
      ok: false,
      error: 'timestamp must be a valid ISO 8601 date string',
    });
  });

  it('validates in field order: alias before score', () => {
    const { alias: _a, score: _s, ...noAliasNoScore } = VALID;
    const result = validateSubmitRequest(noAliasNoScore);
    expect(result).toEqual({ ok: false, error: 'alias is required' });
  });
});
