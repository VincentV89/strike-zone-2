import type { MatchConfig } from './types.js';

/** Accepts printable ASCII (U+0020–U+007E), 1–20 chars. */
export function validateAlias(alias: string): boolean {
  return (
    alias.length >= 1 &&
    alias.length <= 20 &&
    /^[\x20-\x7E]+$/.test(alias)
  );
}

export function validateMatchConfig(
  config: Partial<MatchConfig>,
): config is MatchConfig {
  return (
    (config.mapId === 'map-a' || config.mapId === 'map-b') &&
    typeof config.botCount === 'number' &&
    Number.isInteger(config.botCount) &&
    config.botCount >= 1 &&
    config.botCount <= 8
  );
}
