import { describe, it, expect } from 'vitest';
import { validateAlias, validateMatchConfig } from '../validation.js';

describe('validateAlias', () => {
  it('accepts a valid single-character alias', () => {
    expect(validateAlias('A')).toBe(true);
  });

  it('accepts a 20-character alias', () => {
    expect(validateAlias('A'.repeat(20))).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validateAlias('')).toBe(false);
  });

  it('rejects an alias longer than 20 characters', () => {
    expect(validateAlias('A'.repeat(21))).toBe(false);
  });

  it('rejects non-ASCII characters', () => {
    expect(validateAlias('héro')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(validateAlias('a\x00b')).toBe(false);
  });

  it('accepts alias with spaces and punctuation (printable ASCII)', () => {
    expect(validateAlias('Player_1!')).toBe(true);
  });
});

describe('validateMatchConfig', () => {
  it('accepts a valid config with map-a', () => {
    expect(validateMatchConfig({ mapId: 'map-a', botCount: 3 })).toBe(true);
  });

  it('accepts a valid config with map-b', () => {
    expect(validateMatchConfig({ mapId: 'map-b', botCount: 8 })).toBe(true);
  });

  it('rejects an unknown mapId', () => {
    expect(validateMatchConfig({ mapId: 'map-c' as 'map-a', botCount: 3 })).toBe(false);
  });

  it('rejects botCount of 0', () => {
    expect(validateMatchConfig({ mapId: 'map-a', botCount: 0 })).toBe(false);
  });

  it('rejects botCount of 9', () => {
    expect(validateMatchConfig({ mapId: 'map-a', botCount: 9 })).toBe(false);
  });

  it('rejects fractional botCount', () => {
    expect(validateMatchConfig({ mapId: 'map-a', botCount: 1.5 })).toBe(false);
  });

  it('rejects missing mapId', () => {
    expect(validateMatchConfig({ botCount: 3 })).toBe(false);
  });
});
