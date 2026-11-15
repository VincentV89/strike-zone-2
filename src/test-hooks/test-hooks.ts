import {
  BOT_HEALTH_RANGE,
  ROUND_SECS_RANGE,
  type IntRange,
  type TestHooks,
} from './types.js';

type Warn = (message: string) => void;

function parseBoundedInt(
  params: URLSearchParams,
  name: string,
  range: IntRange,
  warn: Warn,
): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  const value = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < range.min || value > range.max) {
    warn(
      `Strike Zone 2: ignoring test hook ${name}=${JSON.stringify(raw)} ` +
        `(expected an integer from ${range.min} to ${range.max})`,
    );
    return null;
  }
  return value;
}

/**
 * Reads test hooks from a location.search string. Invalid values are ignored
 * (with a warning) so defaults apply; nothing changes when no hook is present.
 */
export function parseTestHooks(search: string, warn: Warn = console.warn): TestHooks {
  const params = new URLSearchParams(search);
  const roundSecs = parseBoundedInt(params, 'roundSecs', ROUND_SECS_RANGE, warn);
  const botHealth = parseBoundedInt(params, 'botHealth', BOT_HEALTH_RANGE, warn);

  const debugRaw = params.get('debug');
  const debug = debugRaw === '1';
  if (debugRaw !== null && !debug) {
    warn(`Strike Zone 2: ignoring test hook debug=${JSON.stringify(debugRaw)} (only debug=1 is supported)`);
  }

  return Object.freeze({
    roundSecs,
    botHealth,
    debug,
    active: roundSecs !== null || botHealth !== null || debug,
  });
}
