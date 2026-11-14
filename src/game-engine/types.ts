export type EngineState =
  | 'uninitialized'
  | 'menu'
  | 'loading'
  | 'in-round'
  | 'round-end';

/** Game-engine-level match configuration. roundDurationSecs defaults to 180. */
export interface MatchConfig {
  mapId: 'map-a' | 'map-b';
  botCount: number;
  roundDurationSecs: number;
}

export class IllegalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalStateError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
