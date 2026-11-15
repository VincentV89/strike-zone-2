import { test, expect } from './fixtures';
import {
  byTestId,
  holdFire,
  hud,
  openGame,
  readDebug,
  releaseFire,
  screen,
  screenWasActivated,
  startMatch,
  timerSeconds,
  watchScreenActivation,
} from './helpers';

test.describe('round end flows and test hooks (req-e2e-round-end-flows, req-test-hooks)', () => {
  // Round time is game time: frames longer than 100 ms count as 100 ms, so on a
  // loaded runner with software WebGL a 3 s round can take much longer on the wall clock.
  test('?roundSecs=3 ends the round on timeout as Defeated, as a practice round with no POST', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/scores')) posts.push(r.url());
    });

    await openGame(page, '?roundSecs=3&debug=1');
    await startMatch(page, 'dust', 1);
    expect(await timerSeconds(page)).toBeLessThanOrEqual(3);

    await expect(screen(page, 'end-round')).toHaveClass(/active/, { timeout: 45_000 });
    await expect(byTestId(page, 'outcome-display')).toHaveText('Defeated');
    await expect(byTestId(page, 'practice-notice')).toBeVisible();
    await expect(byTestId(page, 'practice-notice')).toHaveText('Practice round, score not submitted');
    await expect(byTestId(page, 'submit-button')).toBeDisabled();
    await expect(byTestId(page, 'alias-input')).toBeDisabled();

    const snap = await readDebug(page);
    expect(snap).toMatchObject({ engineState: 'round-end', roundPhase: 'round-end', outcome: 'lose', practiceMode: true });
    expect(snap.hooks).toMatchObject({ roundSecs: 3, debug: true, active: true });
    expect(posts).toEqual([]);
  });

  test('invalid hook values are ignored and defaults apply', async ({ page }) => {
    await openGame(page, '?roundSecs=-1&botHealth=abc');
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__SZ_DEBUG__'])).toBeUndefined();
    await startMatch(page, 'dust', 1);
    expect(await timerSeconds(page)).toBeGreaterThanOrEqual(175);
  });

  test('?debug=1 exposes a read-only snapshot of engine, round, player and bots', async ({ page }) => {
    await openGame(page, '?debug=1');
    await startMatch(page, 'compound', 2);
    const snap = await readDebug(page);
    expect(snap).toMatchObject({ engineState: 'in-round', roundPhase: 'in-round', mapId: 'compound', kills: 0 });
    expect(snap.player).toMatchObject({ health: 100, ammo: 30, isAlive: true });
    expect(snap.bots).toHaveLength(2);
    expect(snap.bots.every((b) => b.alive)).toBe(true);

    const tamper = await page.evaluate(() => {
      'use strict';
      try {
        (window as unknown as Record<string, unknown>)['__SZ_DEBUG__'] = { kills: 99 };
        return 'assigned';
      } catch {
        return 'blocked';
      }
    });
    expect(tamper).toBe('blocked');
    expect((await readDebug(page)).kills).toBe(0);
  });

  test('bot meshes follow bot positions: positions in the snapshot change while bots patrol (D-06)', async ({ page }) => {
    await openGame(page, '?debug=1');
    await startMatch(page, 'compound', 3);
    const before = (await readDebug(page)).bots.map((b) => b.position);
    await expect
      .poll(async () => {
        const now = (await readDebug(page)).bots.map((b) => b.position);
        return now.some((p, i) => Math.hypot(p.x - before[i]!.x, p.z - before[i]!.z) > 0.5);
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('?botHealth=1: shooting the bot ahead wins the round with kills 1 (D-03, D-05, D-06)', async ({ page }) => {
    await openGame(page, '?botHealth=1&debug=1');
    await startMatch(page, 'dust', 1);
    // On Dust the player spawns facing the map centre and bot 1 spawns on that line.
    await holdFire(page);
    await expect(screen(page, 'end-round')).toHaveClass(/active/, { timeout: 45_000 });
    await releaseFire(page);

    await expect(byTestId(page, 'outcome-display')).toHaveText('Victory!');
    const snap = await readDebug(page);
    expect(snap.kills).toBe(1);
    expect(snap.outcome).toBe('win');
    expect(snap.bots[0]!.alive).toBe(false);
    // kills × 100 + secondsLeft × 10
    expect(snap.score).toBe(100 + Math.floor(snap.timeRemainingMs / 1000) * 10);
    await expect(byTestId(page, 'score-display')).toHaveText(String(snap.score));
  });

  test('bots damage the player until death ends the round as Defeated (D-04, D-11)', async ({ page }) => {
    // The player walks toward the nearest live bot (positions from __SZ_DEBUG__)
    // and stops within 6 m, so bots engage. On Dust the player spawns facing +Z:
    // W = +Z, S = -Z, A = +X, D = -X. Over 100 simulated rounds this kills the
    // player within 9–16 s of game time.
    test.setTimeout(150_000);
    await openGame(page, '?debug=1');
    await startMatch(page, 'dust', 8);

    const held = new Set<string>();
    const setKey = async (key: string, down: boolean): Promise<void> => {
      if (down && !held.has(key)) { await page.keyboard.down(key); held.add(key); }
      if (!down && held.has(key)) { await page.keyboard.up(key); held.delete(key); }
    };

    let tookDamage = false;
    const deadline = Date.now() + 130_000;
    for (;;) {
      const snap = await readDebug(page);
      if (snap.player.health < 100 && !tookDamage) {
        tookDamage = true;
        expect(snap.player.health % 20).toBe(0); // bot damage is 20 per hit
      }
      if (snap.engineState === 'round-end' || Date.now() > deadline) break;
      const p = snap.player.position;
      let best = { dx: 0, dz: 0, d: Infinity };
      for (const b of snap.bots.filter((x) => x.alive)) {
        const dx = b.position.x - p.x;
        const dz = b.position.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < best.d) best = { dx, dz, d };
      }
      const go = best.d > 6;
      await setKey('KeyA', go && best.dx > 2);
      await setKey('KeyD', go && best.dx < -2);
      await setKey('KeyW', go && best.dz > 2);
      await setKey('KeyS', go && best.dz < -2);
      await page.waitForTimeout(250);
    }
    for (const key of [...held]) await setKey(key, false);

    await expect(screen(page, 'end-round')).toHaveClass(/active/);
    await expect(byTestId(page, 'outcome-display')).toHaveText('Defeated');
    const snap = await readDebug(page);
    expect(tookDamage).toBe(true);
    expect(snap.player.health).toBe(0);
    expect(snap.player.isAlive).toBe(false);
    expect(snap.outcome).toBe('lose');
  });

  test('Play Again goes straight to a fresh round without showing the menu (D-09)', async ({ page }) => {
    test.setTimeout(150_000);
    await openGame(page, '?roundSecs=2&debug=1');
    await startMatch(page, 'dust', 2);

    for (let roundNo = 0; roundNo < 3; roundNo++) {
      await expect(screen(page, 'end-round')).toHaveClass(/active/, { timeout: 45_000 });
      await watchScreenActivation(page, 'main-menu');
      await byTestId(page, 'play-again-button').click();
      await expect(screen(page, 'hud')).toHaveClass(/active/, { timeout: 10_000 });
      expect(await screenWasActivated(page, 'main-menu')).toBe(false);

      await expect(hud(page, 'health')).toHaveText('100');
      await expect(hud(page, 'ammo')).toHaveText('30');
      await expect(hud(page, 'kills')).toHaveText('0');
      const snap = await readDebug(page);
      expect([...snap.combatantIds].sort()).toEqual(['bot-1', 'bot-2', 'player']);
    }
  });
});
