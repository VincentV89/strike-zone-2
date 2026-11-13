import { type InputState, KEY_BINDINGS, MOUSE_BUTTON_PRIMARY } from './types.js';

const TRACKED_KEYS: ReadonlySet<string> = new Set(Object.values(KEY_BINDINGS));

export class InputHandler {
  private pressedKeys = new Set<string>();
  private accumulator = { x: 0, y: 0 };
  private mouseButtonDown = false;
  private pointerLocked = false;
  private initialized = false;
  private readonly eventTarget: EventTarget;
  private readonly lockTarget: Element;
  private boundHandlers: Partial<Record<string, EventListener>> = {};

  constructor(
    eventTarget: EventTarget = document,
    lockTarget: Element = document.body,
  ) {
    this.eventTarget = eventTarget;
    this.lockTarget = lockTarget;
  }

  init(): void {
    if (this.initialized) {
      throw new Error('InputHandler already initialized');
    }
    this.boundHandlers = {
      keydown:          this.onKeyDown.bind(this),
      keyup:            this.onKeyUp.bind(this),
      mousemove:        this.onMouseMove.bind(this),
      mousedown:        this.onMouseDown.bind(this),
      mouseup:          this.onMouseUp.bind(this),
      pointerlockchange: this.onPointerLockChange.bind(this),
      pointerlockerror:  this.onPointerLockError.bind(this),
    };
    this.eventTarget.addEventListener('keydown',   this.boundHandlers['keydown']!);
    this.eventTarget.addEventListener('keyup',     this.boundHandlers['keyup']!);
    this.eventTarget.addEventListener('mousemove', this.boundHandlers['mousemove']!);
    this.eventTarget.addEventListener('mousedown', this.boundHandlers['mousedown']!);
    this.eventTarget.addEventListener('mouseup',   this.boundHandlers['mouseup']!);
    document.addEventListener('pointerlockchange', this.boundHandlers['pointerlockchange']!);
    document.addEventListener('pointerlockerror',  this.boundHandlers['pointerlockerror']!);
    this.initialized = true;
  }

  destroy(): void {
    this.eventTarget.removeEventListener('keydown',   this.boundHandlers['keydown']!);
    this.eventTarget.removeEventListener('keyup',     this.boundHandlers['keyup']!);
    this.eventTarget.removeEventListener('mousemove', this.boundHandlers['mousemove']!);
    this.eventTarget.removeEventListener('mousedown', this.boundHandlers['mousedown']!);
    this.eventTarget.removeEventListener('mouseup',   this.boundHandlers['mouseup']!);
    document.removeEventListener('pointerlockchange', this.boundHandlers['pointerlockchange']!);
    document.removeEventListener('pointerlockerror',  this.boundHandlers['pointerlockerror']!);
    this.pressedKeys.clear();
    this.accumulator = { x: 0, y: 0 };
    this.mouseButtonDown = false;
    this.pointerLocked = false;
    this.initialized = false;
    this.boundHandlers = {};
  }

  /**
   * Returns an immutable snapshot of current input state and drains the mouse
   * delta accumulator. Must be called exactly once per game tick by GameEngine.
   */
  getState(): Readonly<InputState> {
    const state: InputState = {
      forward:     this.pressedKeys.has(KEY_BINDINGS.forward),
      back:        this.pressedKeys.has(KEY_BINDINGS.backward),
      left:        this.pressedKeys.has(KEY_BINDINGS.left),
      right:       this.pressedKeys.has(KEY_BINDINGS.right),
      jump:        this.pressedKeys.has(KEY_BINDINGS.jump),
      shoot:       this.mouseButtonDown,
      mouseDeltaX: this.accumulator.x,
      mouseDeltaY: this.accumulator.y,
    };
    this.accumulator.x = 0;
    this.accumulator.y = 0;
    return state;
  }

  requestPointerLock(): void {
    this.lockTarget.requestPointerLock();
  }

  releasePointerLock(): void {
    document.exitPointerLock();
  }

  private onKeyDown(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.releasePointerLock();
      return;
    }
    if (TRACKED_KEYS.has(e.code)) {
      this.pressedKeys.add(e.code);
    }
  }

  private onKeyUp(event: Event): void {
    const e = event as KeyboardEvent;
    if (TRACKED_KEYS.has(e.code)) {
      this.pressedKeys.delete(e.code);
    }
  }

  private onMouseMove(event: Event): void {
    if (!this.pointerLocked) return;
    const e = event as MouseEvent;
    this.accumulator.x += e.movementX;
    this.accumulator.y += e.movementY;
  }

  private onMouseDown(event: Event): void {
    const e = event as MouseEvent;
    if (e.button === MOUSE_BUTTON_PRIMARY) {
      this.mouseButtonDown = true;
    }
  }

  private onMouseUp(event: Event): void {
    const e = event as MouseEvent;
    if (e.button === MOUSE_BUTTON_PRIMARY) {
      this.mouseButtonDown = false;
    }
  }

  private onPointerLockChange(): void {
    if (document.pointerLockElement !== null) {
      this.pointerLocked = true;
    } else {
      this.pointerLocked = false;
      this.accumulator = { x: 0, y: 0 };
    }
  }

  private onPointerLockError(): void {
    this.pointerLocked = false;
  }
}
