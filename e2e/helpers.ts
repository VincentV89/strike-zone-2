import { expect, type Page } from '@playwright/test';

export type MapId = 'dust' | 'compound';

/** Shape of window.__SZ_DEBUG__ (see src/game-engine/types.ts EngineDebugSnapshot). */
export interface DebugSnapshot {
  engineState: string;
  roundPhase: string;
  timeRemainingMs: number;
  outcome: 'win' | 'lose' | null;
  kills: number;
  score: number;
  mapId: MapId | null;
  practiceMode: boolean;
  lastError: string | null;
  player: { health: number; ammo: number; isAlive: boolean; isReloading: boolean; position: { x: number; y: number; z: number } };
  bots: Array<{ id: string; alive: boolean; state: string; health: number; position: { x: number; y: number; z: number } }>;
  combatantIds: string[];
  hooks: { roundSecs: number | null; botHealth: number | null; debug: boolean; active: boolean };
}

export const screen = (page: Page, id: string) => page.locator(`[data-screen="${id}"]`);
export const byTestId = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
export const hud = (page: Page, key: string) => page.locator(`[data-hud="${key}"]`);

export async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(screen(page, 'main-menu')).toHaveClass(/active/);
}

/**
 * Selects the map and bot count on the menu, activates Play and waits for the HUD.
 * Uses keyboard activation (Enter) so the mouse never moves: Chromium can report
 * the cursor's earlier travel as one large movement when pointer lock engages,
 * which would turn the camera away from the spawn heading.
 */
export async function startMatch(page: Page, map: MapId, bots = 3): Promise<void> {
  await byTestId(page, 'map-selector').selectOption(map);
  const display = byTestId(page, 'bot-count-display');
  for (let i = 0; i < 8; i++) {
    const current = Number(await display.textContent());
    if (current === bots) break;
    await byTestId(page, current < bots ? 'bot-inc-button' : 'bot-dec-button').press('Enter');
  }
  await expect(display).toHaveText(String(bots));
  await byTestId(page, 'play-button').press('Enter');
  await expect(screen(page, 'hud')).toHaveClass(/active/, { timeout: 10_000 });
}

export async function readDebug(page: Page): Promise<DebugSnapshot> {
  const snap = await page.evaluate(() => (window as unknown as { __SZ_DEBUG__?: unknown }).__SZ_DEBUG__);
  if (!snap) throw new Error('window.__SZ_DEBUG__ is not defined — open the page with ?debug=1');
  return snap as DebugSnapshot;
}

/** Parses the HUD MM:SS timer into seconds. */
export async function timerSeconds(page: Page): Promise<number> {
  const text = (await hud(page, 'timer').textContent()) ?? '';
  const m = /^(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`unexpected timer text "${text}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Presses and holds the primary mouse button where the pointer already is.
 * The pointer is not moved: once pointer lock is granted, any mouse movement
 * turns the camera and would spoil the spawn-facing aim the win specs rely on.
 */
export async function holdFire(page: Page): Promise<void> {
  await page.mouse.down();
}

export async function releaseFire(page: Page): Promise<void> {
  await page.mouse.up();
}

/** Counts requestPointerLock calls on the canvas (installed before page scripts run). */
export async function trackPointerLockRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __plCalls: number };
    w.__plCalls = 0;
    const original = HTMLCanvasElement.prototype.requestPointerLock;
    HTMLCanvasElement.prototype.requestPointerLock = function (this: HTMLCanvasElement, ...args: unknown[]) {
      w.__plCalls += 1;
      return (original as (...a: unknown[]) => unknown).apply(this, args) as ReturnType<typeof original>;
    } as typeof original;
  });
}

export async function pointerLockRequests(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __plCalls: number }).__plCalls);
}

/** Records whether a screen ever becomes active from now on. */
export async function watchScreenActivation(page: Page, id: string): Promise<void> {
  await page.evaluate((screenId) => {
    const el = document.querySelector(`[data-screen="${screenId}"]`)!;
    const w = window as unknown as Record<string, boolean>;
    w[`__seen_${screenId}`] = false;
    new MutationObserver(() => {
      if (el.classList.contains('active')) w[`__seen_${screenId}`] = true;
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }, id);
}

export async function screenWasActivated(page: Page, id: string): Promise<boolean> {
  return page.evaluate((screenId) => (window as unknown as Record<string, boolean>)[`__seen_${screenId}`] === true, id);
}
