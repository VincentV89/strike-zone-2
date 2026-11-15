import { describe, it, expect, vi } from 'vitest';
import { parseTestHooks } from '../test-hooks.js';
import { installDebugBridge } from '../debug-bridge.js';
import { DEBUG_GLOBAL } from '../types.js';

describe('parseTestHooks', () => {
  it('returns inert defaults when no hook params are present', () => {
    const warn = vi.fn();
    expect(parseTestHooks('', warn)).toEqual({ roundSecs: null, botHealth: null, debug: false, active: false });
    expect(parseTestHooks('?foo=bar', warn).active).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('parses roundSecs, botHealth and debug=1', () => {
    const hooks = parseTestHooks('?roundSecs=5&botHealth=1&debug=1', vi.fn());
    expect(hooks).toEqual({ roundSecs: 5, botHealth: 1, debug: true, active: true });
    expect(Object.isFrozen(hooks)).toBe(true);
  });

  it.each([
    ['roundSecs=-1'],
    ['roundSecs=0'],
    ['roundSecs=1.5'],
    ['roundSecs=abc'],
    ['roundSecs=3601'],
    ['roundSecs='],
    ['botHealth=0'],
    ['botHealth=1001'],
    ['botHealth=1e3'],
  ])('ignores invalid value %s with a warning and keeps defaults', (query) => {
    const warn = vi.fn();
    const hooks = parseTestHooks(`?${query}`, warn);
    expect(hooks.roundSecs).toBeNull();
    expect(hooks.botHealth).toBeNull();
    expect(hooks.active).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignoring test hook'));
  });

  it('accepts the range bounds', () => {
    expect(parseTestHooks('?roundSecs=1&botHealth=1000', vi.fn())).toMatchObject({ roundSecs: 1, botHealth: 1000 });
    expect(parseTestHooks('?roundSecs=3600', vi.fn()).roundSecs).toBe(3600);
  });

  it('only debug=1 enables the debug hook', () => {
    const warn = vi.fn();
    expect(parseTestHooks('?debug=true', warn)).toMatchObject({ debug: false, active: false });
    expect(warn).toHaveBeenCalled();
  });

  it('an invalid hook does not cancel a valid one', () => {
    const hooks = parseTestHooks('?roundSecs=-1&botHealth=2', vi.fn());
    expect(hooks).toMatchObject({ roundSecs: null, botHealth: 2, active: true });
  });
});

describe('installDebugBridge', () => {
  const hooks = parseTestHooks('?debug=1', vi.fn());

  it('exposes a fresh frozen snapshot on every read', () => {
    const target: Record<string, unknown> = {};
    let kills = 0;
    installDebugBridge(target, hooks, () => ({ kills }));
    const first = target[DEBUG_GLOBAL] as { kills: number; hooks: unknown };
    kills = 3;
    const second = target[DEBUG_GLOBAL] as { kills: number };
    expect(first.kills).toBe(0);
    expect(second.kills).toBe(3);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.hooks).toEqual(hooks);
  });

  it('is read-only: assignment throws in strict mode and the property cannot be redefined', () => {
    const target: Record<string, unknown> = {};
    installDebugBridge(target, hooks, () => ({ v: 1 }));
    expect(() => {
      target[DEBUG_GLOBAL] = 'hacked';
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(target, DEBUG_GLOBAL, { value: 1 })).toThrow(TypeError);
    expect((target[DEBUG_GLOBAL] as { v: number }).v).toBe(1);
  });

  it('refuses to install twice', () => {
    const target = {};
    installDebugBridge(target, hooks, () => ({}));
    expect(() => installDebugBridge(target, hooks, () => ({}))).toThrow(/already defined/);
  });
});
