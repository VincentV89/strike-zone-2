export { BotSystem } from './bot-system.js';
export {
  MAX_BOTS,
  BOT_MAX_HEALTH,
  BOT_DAMAGE,
  DETECTION_RANGE,
  ENGAGE_RANGE,
  CHASE_RANGE,
  IDLE_DURATION_MS,
  MIN_REACTION_MS,
  MAX_REACTION_MS,
  MIN_FIRE_INTERVAL_MS,
  MAX_FIRE_INTERVAL_MS,
  BOT_PATROL_SPEED,
  BOT_CHASE_SPEED,
  BOT_AIM_SPREAD_RADIANS,
} from './bot-system.js';
export type {
  BotFSMState,
  BotState,
  PlayerState,
  BotRendererAdapter,
  CombatAdapter,
  EntityId,
  Vec3,
} from './types.js';
