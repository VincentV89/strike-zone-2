import { test, expect } from './fixtures';
import {
  byTestId,
  holdFire,
  hud,
  openGame,
  pointerLockRequests,
  releaseFire,
  screen,
  startMatch,
  timerSeconds,
  trackPointerLockRequests,
  type MapId,
} from './helpers';

test.describe('smoke: menu, start, HUD, shoot (req-e2e-smoke-flow)', () => {
  test('menu offers Dust and Compound and no debug object without hooks', async ({ page }) => {
    await openGame(page);
    const options = byTestId(page, 'map-selector').locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAttribute('value', 'dust');
    await expect(options.nth(0)).toHaveText('Dust');
    await expect(options.nth(1)).toHaveAttribute('value', 'compound');
    await expect(options.nth(1)).toHaveText('Compound');
    expect(await page.evaluate(() => '__SZ_DEBUG__' in window)).toBe(false);
  });

  for (const map of ['dust', 'compound'] as MapId[]) {
    test(`starts a round on ${map}: HUD shows health, ammo, timer, kills and the timer runs`, async ({ page }) => {
      const glb = page.waitForResponse((r) => r.url().endsWith(`/maps/${map}/geometry.glb`));
      await openGame(page);
      await startMatch(page, map);
      expect((await glb).status()).toBe(200);

      await expect(hud(page, 'health')).toHaveText('100');
      await expect(hud(page, 'ammo')).toHaveText('30');
      await expect(hud(page, 'kills')).toHaveText('0');
      const t0 = await timerSeconds(page);
      expect(t0).toBeGreaterThanOrEqual(175);
      await expect.poll(() => timerSeconds(page), { timeout: 20_000 }).toBeLessThan(t0);
    });
  }

  // botHealth=1000 keeps the round alive: the spawn heading points at bot 1, so
  // unhooked shots would kill it and end the round mid-test.
  test('holding fire spends ammo at the fire rate and the loop keeps running (D-03, D-07)', async ({ page }) => {
    await openGame(page, '?botHealth=1000');
    await startMatch(page, 'compound', 1);
    const t0 = await timerSeconds(page);

    await holdFire(page);
    await expect.poll(async () => Number(await hud(page, 'ammo').textContent()), { timeout: 5_000 }).toBeLessThan(30);
    await page.waitForTimeout(1_000);
    await releaseFire(page);

    const ammoAfter = Number(await hud(page, 'ammo').textContent());
    // ~1.2 s at 8 rounds/s ≈ 10 rounds; a per-frame weapon would have emptied the magazine.
    expect(ammoAfter).toBeGreaterThan(0);
    expect(ammoAfter).toBeLessThan(30);
    await expect.poll(() => timerSeconds(page), { timeout: 20_000 }).toBeLessThan(t0);
    await expect(screen(page, 'hud')).toHaveClass(/active/);
  });

  test('R reloads the magazine', async ({ page }) => {
    await openGame(page, '?botHealth=1000');
    await startMatch(page, 'compound', 1);
    await holdFire(page);
    await expect.poll(async () => Number(await hud(page, 'ammo').textContent())).toBeLessThan(28);
    await releaseFire(page);
    await page.keyboard.press('KeyR');
    // 1.5 s of game time; slow software-GL frames stretch it on the wall clock.
    await expect(hud(page, 'ammo')).toHaveText('30', { timeout: 20_000 });
    await expect(hud(page, 'reloading')).toBeHidden();
  });

  test('Play requests pointer lock in the click, and a canvas click re-requests it (D-08)', async ({ page }) => {
    await trackPointerLockRequests(page);
    await openGame(page);
    await startMatch(page, 'dust', 1);
    expect(await pointerLockRequests(page)).toBe(1);

    // Simulate Esc having released the lock, then click the canvas.
    await page.evaluate(() => document.exitPointerLock());
    await page.locator('#game-canvas').click();
    await expect.poll(() => pointerLockRequests(page)).toBeGreaterThanOrEqual(2);
  });

  test('a failed map load shows an error on the menu and Play can retry (D-13)', async ({ page, allowConsoleError }) => {
    allowConsoleError(/GameEngine: start failed/);
    allowConsoleError(/Failed to load resource/);
    let fail = true;
    await page.route('**/maps/dust/geometry.glb', (route) =>
      fail ? route.fulfill({ status: 404, body: 'not found' }) : route.continue(),
    );

    await openGame(page);
    await byTestId(page, 'map-selector').selectOption('dust');
    await byTestId(page, 'play-button').click();
    await expect(byTestId(page, 'menu-error')).toContainText('Could not start the match', { timeout: 10_000 });
    await expect(screen(page, 'main-menu')).toHaveClass(/active/);

    fail = false;
    await byTestId(page, 'play-button').click();
    await expect(screen(page, 'hud')).toHaveClass(/active/, { timeout: 10_000 });
    await expect(byTestId(page, 'menu-error')).toHaveText('');
  });
});
