export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  shoot: boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
}

export type Vec2 = { x: number; y: number };

/** Physical key codes (KeyboardEvent.code) for layout-independent WASD on non-QWERTY keyboards. */
export const KEY_BINDINGS = {
  forward:  'KeyW',
  backward: 'KeyS',
  left:     'KeyA',
  right:    'KeyD',
  jump:     'Space',
} as const satisfies Record<string, string>;

export const MOUSE_BUTTON_PRIMARY = 0;
