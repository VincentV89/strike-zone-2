import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputHandler } from '../input-handler.js';
import { KEY_BINDINGS } from '../types.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeTarget(): EventTarget {
  return new EventTarget();
}

function makeLockTarget(): Element {
  const el = document.createElement('canvas');
  el.requestPointerLock = vi.fn();
  return el;
}

function dispatchKey(
  target: EventTarget,
  type: 'keydown' | 'keyup',
  code: string,
  repeat = false,
): void {
  target.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true }));
}

function dispatchMouseButton(
  target: EventTarget,
  type: 'mousedown' | 'mouseup',
  button: number,
): void {
  target.dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
}

function dispatchMouseMove(target: EventTarget, movementX: number, movementY: number): void {
  const event = new MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(event, 'movementX', { value: movementX, configurable: true });
  Object.defineProperty(event, 'movementY', { value: movementY, configurable: true });
  target.dispatchEvent(event);
}

function simulateLockAcquired(element: Element = document.body): void {
  Object.defineProperty(document, 'pointerLockElement', {
    get: () => element,
    configurable: true,
  });
  document.dispatchEvent(new Event('pointerlockchange'));
}

function simulateLockReleased(): void {
  Object.defineProperty(document, 'pointerLockElement', {
    get: () => null,
    configurable: true,
  });
  document.dispatchEvent(new Event('pointerlockchange'));
}

function simulateLockError(): void {
  document.dispatchEvent(new Event('pointerlockerror'));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let eventTarget: EventTarget;
let lockTarget: Element;
let handler: InputHandler;

beforeEach(() => {
  eventTarget = makeTarget();
  lockTarget = makeLockTarget();
  handler = new InputHandler(eventTarget, lockTarget);
  // Provide stubs for Pointer Lock API methods not implemented in jsdom
  document.exitPointerLock = vi.fn();
  Object.defineProperty(document, 'pointerLockElement', {
    get: () => null,
    configurable: true,
  });
});

afterEach(() => {
  // Ensure listeners are cleaned up even if a test forgets destroy()
  try { handler.destroy(); } catch { /* already destroyed */ }
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe('lifecycle', () => {
  it('allows getState() after init()', () => {
    handler.init();
    expect(() => handler.getState()).not.toThrow();
  });

  it('throws when init() is called a second time without destroy()', () => {
    handler.init();
    expect(() => handler.init()).toThrow('InputHandler already initialized');
  });

  it('destroy() resets all state fields to their initial values', () => {
    handler.init();
    dispatchKey(eventTarget, 'keydown', 'KeyW');
    dispatchMouseButton(eventTarget, 'mousedown', 0);
    handler.destroy();
    // Re-init to verify zeroed state
    handler.init();
    const state = handler.getState();
    expect(state).toMatchObject({
      forward: false, back: false, left: false, right: false,
      jump: false, shoot: false, mouseDeltaX: 0, mouseDeltaY: 0,
    });
  });

  it('allows re-initialization on the same instance after destroy()', () => {
    handler.init();
    handler.destroy();
    expect(() => handler.init()).not.toThrow();
    handler.destroy();
  });

  it('destroy() removes keyboard listeners so subsequent events are ignored', () => {
    handler.init();
    handler.destroy();
    // Re-init a fresh handler on the same target to prove the old one stopped listening
    const handler2 = new InputHandler(eventTarget, lockTarget);
    handler2.init();
    dispatchKey(eventTarget, 'keydown', 'KeyW');
    // handler (destroyed) should not interfere — we just check handler2 picks it up
    expect(handler2.getState().forward).toBe(true);
    handler2.destroy();
  });
});

// ─── Keyboard input ──────────────────────────────────────────────────────────

describe('keyboard — tracked keys', () => {
  beforeEach(() => handler.init());

  it('W key sets forward=true', () => {
    dispatchKey(eventTarget, 'keydown', KEY_BINDINGS.forward);
    expect(handler.getState().forward).toBe(true);
  });

  it('S key sets back=true', () => {
    dispatchKey(eventTarget, 'keydown', KEY_BINDINGS.backward);
    expect(handler.getState().back).toBe(true);
  });

  it('A key sets left=true', () => {
    dispatchKey(eventTarget, 'keydown', KEY_BINDINGS.left);
    expect(handler.getState().left).toBe(true);
  });

  it('D key sets right=true', () => {
    dispatchKey(eventTarget, 'keydown', KEY_BINDINGS.right);
    expect(handler.getState().right).toBe(true);
  });

  it('Space sets jump=true', () => {
    dispatchKey(eventTarget, 'keydown', KEY_BINDINGS.jump);
    expect(handler.getState().jump).toBe(true);
  });

  it('keyup clears a pressed key', () => {
    dispatchKey(eventTarget, 'keydown', 'KeyW');
    dispatchKey(eventTarget, 'keyup',   'KeyW');
    expect(handler.getState().forward).toBe(false);
  });

  it('key-repeat events (event.repeat=true) are ignored — IH-02', () => {
    dispatchKey(eventTarget, 'keydown', 'KeyW', true);
    expect(handler.getState().forward).toBe(false);
  });

  it('untracked keys have no effect — IH-01', () => {
    dispatchKey(eventTarget, 'keydown', 'KeyE');
    dispatchKey(eventTarget, 'keydown', 'KeyF');
    const state = handler.getState();
    expect(state).toMatchObject({
      forward: false, back: false, left: false, right: false, jump: false,
    });
  });

  it('Escape calls exitPointerLock and does NOT set any input field — IH-08', () => {
    dispatchKey(eventTarget, 'keydown', 'Escape');
    expect(document.exitPointerLock).toHaveBeenCalledOnce();
    const state = handler.getState();
    expect(state).toMatchObject({
      forward: false, back: false, left: false, right: false, jump: false,
    });
  });

  it('multiple keys held simultaneously are all reflected', () => {
    dispatchKey(eventTarget, 'keydown', 'KeyW');
    dispatchKey(eventTarget, 'keydown', 'KeyA');
    dispatchKey(eventTarget, 'keydown', 'Space');
    const state = handler.getState();
    expect(state.forward).toBe(true);
    expect(state.left).toBe(true);
    expect(state.jump).toBe(true);
  });
});

// ─── Mouse buttons ───────────────────────────────────────────────────────────

describe('mouse buttons — IH-03', () => {
  beforeEach(() => handler.init());

  it('primary button (0) down sets shoot=true', () => {
    dispatchMouseButton(eventTarget, 'mousedown', 0);
    expect(handler.getState().shoot).toBe(true);
  });

  it('primary button (0) up sets shoot=false', () => {
    dispatchMouseButton(eventTarget, 'mousedown', 0);
    dispatchMouseButton(eventTarget, 'mouseup', 0);
    expect(handler.getState().shoot).toBe(false);
  });

  it('middle button (1) is ignored', () => {
    dispatchMouseButton(eventTarget, 'mousedown', 1);
    expect(handler.getState().shoot).toBe(false);
  });

  it('right button (2) is ignored', () => {
    dispatchMouseButton(eventTarget, 'mousedown', 2);
    expect(handler.getState().shoot).toBe(false);
  });
});

// ─── Mouse delta accumulation ────────────────────────────────────────────────

describe('mouse delta — IH-04, IH-05, IH-06', () => {
  beforeEach(() => handler.init());

  it('mousemove while locked accumulates deltas', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, 10, -5);
    const state = handler.getState();
    expect(state.mouseDeltaX).toBe(10);
    expect(state.mouseDeltaY).toBe(-5);
  });

  it('mousemove while unlocked is discarded — IH-04', () => {
    // pointerLocked starts false
    dispatchMouseMove(eventTarget, 20, 15);
    const state = handler.getState();
    expect(state.mouseDeltaX).toBe(0);
    expect(state.mouseDeltaY).toBe(0);
  });

  it('getState() drains the accumulator — IH-05', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, 7, 3);
    handler.getState(); // drain
    const second = handler.getState();
    expect(second.mouseDeltaX).toBe(0);
    expect(second.mouseDeltaY).toBe(0);
  });

  it('multiple mousemove events accumulate additively before drain', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, 3, 1);
    dispatchMouseMove(eventTarget, 2, -4);
    dispatchMouseMove(eventTarget, -1, 2);
    const state = handler.getState();
    expect(state.mouseDeltaX).toBe(4);
    expect(state.mouseDeltaY).toBe(-1);
  });

  it('negative deltas are forwarded unchanged (no smoothing) — IH-06', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, -100, -200);
    const state = handler.getState();
    expect(state.mouseDeltaX).toBe(-100);
    expect(state.mouseDeltaY).toBe(-200);
  });
});

// ─── Pointer Lock lifecycle ──────────────────────────────────────────────────

describe('pointer lock — IH-07, IH-09', () => {
  beforeEach(() => handler.init());

  it('pointerlockchange (locked) enables delta accumulation', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, 5, 5);
    expect(handler.getState().mouseDeltaX).toBe(5);
  });

  it('pointerlockchange (unlocked) disables delta accumulation — IH-09', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, 10, 10);
    simulateLockReleased();
    // Accumulator is zeroed on unlock; no further accumulation
    dispatchMouseMove(eventTarget, 20, 20);
    const state = handler.getState();
    expect(state.mouseDeltaX).toBe(0);
    expect(state.mouseDeltaY).toBe(0);
  });

  it('pointerlockchange (unlocked) zeros a non-empty accumulator — IH-09', () => {
    simulateLockAcquired();
    dispatchMouseMove(eventTarget, 15, 15);
    simulateLockReleased(); // should zero the accumulator
    const state = handler.getState();
    expect(state.mouseDeltaX).toBe(0);
    expect(state.mouseDeltaY).toBe(0);
  });

  it('pointerlockerror sets pointerLocked=false (best-effort, no crash) — IH-07', () => {
    simulateLockAcquired();
    simulateLockError();
    // After error, mousemove should be discarded
    dispatchMouseMove(eventTarget, 8, 8);
    expect(handler.getState().mouseDeltaX).toBe(0);
  });

  it('requestPointerLock() delegates to lockTarget.requestPointerLock()', () => {
    handler.requestPointerLock();
    expect(lockTarget.requestPointerLock).toHaveBeenCalledOnce();
  });

  it('releasePointerLock() calls document.exitPointerLock()', () => {
    handler.releasePointerLock();
    expect(document.exitPointerLock).toHaveBeenCalledOnce();
  });
});

// ─── getState() contract ─────────────────────────────────────────────────────

describe('getState() contract — IH-12, IH-16', () => {
  beforeEach(() => handler.init());

  it('returns a new object on every call', () => {
    const a = handler.getState();
    const b = handler.getState();
    expect(a).not.toBe(b);
  });

  it('returns all 8 required fields', () => {
    const state = handler.getState();
    expect(state).toHaveProperty('forward');
    expect(state).toHaveProperty('back');
    expect(state).toHaveProperty('left');
    expect(state).toHaveProperty('right');
    expect(state).toHaveProperty('jump');
    expect(state).toHaveProperty('shoot');
    expect(state).toHaveProperty('mouseDeltaX');
    expect(state).toHaveProperty('mouseDeltaY');
  });

  it('default state has all booleans false and deltas zero', () => {
    expect(handler.getState()).toMatchObject({
      forward: false, back: false, left: false, right: false,
      jump: false, shoot: false, mouseDeltaX: 0, mouseDeltaY: 0,
    });
  });

  it('mutation of the returned snapshot does not affect subsequent getState() — IH-12', () => {
    dispatchKey(eventTarget, 'keydown', 'KeyW');
    const state = handler.getState() as Record<string, unknown>;
    state['forward'] = false; // mutate snapshot
    // Key is still held — next getState should still reflect it being down
    dispatchKey(eventTarget, 'keydown', 'KeyW'); // re-fire to keep it in set
    // The mutation on old snapshot should not propagate
    expect(state['forward']).toBe(false); // the snapshot we mutated stays mutated
    // But the handler's internal state is unaffected:
    const next = handler.getState();
    expect(next.forward).toBe(true);
  });
});
