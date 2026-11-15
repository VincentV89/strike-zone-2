import { RendererInstance } from './renderer-core/renderer.js';
import { InputHandler } from './input-handler/input-handler.js';
import { MapSystem } from './map-system/map-system.js';
import { CombatSystem } from './combat-system/combat-system.js';
import { PlayerSystem } from './player-system/player-system.js';
import { BotSystem } from './bot-system/bot-system.js';
import { RoundSystem } from './round-system/round-system.js';
import { UISystem } from './ui-system/ui-system.js';
import { createUITemplate } from './ui-system/template.js';
import { renderFatalError } from './ui-system/fatal-error.js';
import { GameEngine, type LeaderboardService } from './game-engine/game-engine.js';
import { parseTestHooks } from './test-hooks/test-hooks.js';
import { installDebugBridge } from './test-hooks/debug-bridge.js';

// LEADERBOARD_URL is replaced at build time by the bundler (e.g. Vite VITE_LEADERBOARD_URL).
// At runtime without a bundler, falls back to empty string (leaderboard disabled).
declare const __LEADERBOARD_URL__: string | undefined;
const LEADERBOARD_URL: string =
  typeof __LEADERBOARD_URL__ !== 'undefined' ? __LEADERBOARD_URL__ : '';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiContainer = document.getElementById('ui-container') as HTMLElement | null;

  if (!canvas || !uiContainer) {
    throw new Error('required DOM elements #game-canvas and #ui-container not found');
  }

  // Test hooks are inert unless their query params are present (see README).
  const hooks = parseTestHooks(window.location.search);

  // Inject UI HTML structure
  uiContainer.innerHTML = createUITemplate();

  // Compose all subsystems
  const renderer = new RendererInstance();
  const inputHandler = new InputHandler();
  const combatSystem = new CombatSystem();
  const mapSystem = new MapSystem(renderer);
  const playerSystem = new PlayerSystem(combatSystem, renderer);
  const botSystem = new BotSystem(hooks.botHealth !== null ? { maxHealth: hooks.botHealth } : {});
  const roundSystem = new RoundSystem();
  const uiSystem = new UISystem();

  let leaderboardService: LeaderboardService | null = null;
  if (LEADERBOARD_URL) {
    // Dynamically import leaderboard-client to avoid a hard compile-time dep from src/
    const { LeaderboardClient } = await import('../packages/leaderboard-client/src/leaderboard-client.js');
    leaderboardService = new LeaderboardClient({ baseUrl: LEADERBOARD_URL });
  }

  const engine = new GameEngine(
    renderer,
    inputHandler,
    mapSystem,
    combatSystem,
    playerSystem,
    botSystem,
    roundSystem,
    uiSystem,
    leaderboardService,
    {
      roundDurationSecs: hooks.roundSecs ?? undefined,
      practiceMode: hooks.active,
    },
  );

  await engine.init(canvas, uiContainer);

  if (hooks.debug) {
    installDebugBridge(window, hooks, () => engine.getDebugSnapshot());
  }

  // Handle window resize
  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });
}

main().catch((err) => {
  console.error('Strike Zone 2: fatal error during startup', err);
  renderFatalError(document, describeError(err));
});
