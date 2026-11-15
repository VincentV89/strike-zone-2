import { DEBUG_GLOBAL, type TestHooks } from './types.js';

/**
 * Defines a read-only global (window.__SZ_DEBUG__) whose every read returns a
 * fresh frozen snapshot from `read`. It has no setter and is not configurable,
 * so page scripts cannot replace it or change game state through it.
 */
export function installDebugBridge<T extends object>(
  target: object,
  hooks: TestHooks,
  read: () => T,
): void {
  if (Object.prototype.hasOwnProperty.call(target, DEBUG_GLOBAL)) {
    throw new Error(`${DEBUG_GLOBAL} is already defined`);
  }
  const frozenHooks = Object.freeze({ ...hooks });
  Object.defineProperty(target, DEBUG_GLOBAL, {
    get: () => Object.freeze({ ...read(), hooks: frozenHooks }),
    enumerable: false,
    configurable: false,
  });
}
