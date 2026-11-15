import { test, expect } from './fixtures';
import { WORKER_ORIGIN } from './env';
import { byTestId, holdFire, openGame, releaseFire, screen, startMatch } from './helpers';

/**
 * Runs against the local `wrangler dev` Worker started by playwright.config.ts
 * with an empty KV store. Serial: the empty-state check must run before the
 * one real submission.
 */
test.describe.configure({ mode: 'serial' });

test.describe('leaderboard against the local Worker (req-e2e-leaderboard, D-14)', () => {
  test('an empty KV namespace shows "No scores yet."', async ({ page }) => {
    await openGame(page, '?roundSecs=1');
    await startMatch(page, 'dust', 1);
    await expect(screen(page, 'end-round')).toHaveClass(/active/, { timeout: 45_000 });

    const get = page.waitForResponse((r) => r.url() === `${WORKER_ORIGIN}/scores` && r.request().method() === 'GET');
    await byTestId(page, 'view-leaderboard-button').click();
    expect((await get).status()).toBe(200);
    await expect(screen(page, 'leaderboard')).toHaveClass(/active/);
    await expect(byTestId(page, 'leaderboard-status')).toHaveText('No scores yet.');
    await expect(byTestId(page, 'leaderboard-row')).toHaveCount(0);
  });

  test('an unreachable Worker shows "Leaderboard unavailable."', async ({ page, allowConsoleError }) => {
    allowConsoleError(/Failed to load resource|ERR_FAILED|net::/);
    await page.route(`${WORKER_ORIGIN}/scores`, (route) => route.abort('connectionrefused'));
    await openGame(page, '?roundSecs=1');
    await startMatch(page, 'dust', 1);
    await expect(screen(page, 'end-round')).toHaveClass(/active/, { timeout: 45_000 });

    await byTestId(page, 'view-leaderboard-button').click();
    await expect(byTestId(page, 'leaderboard-status')).toHaveText('Leaderboard unavailable.');
  });

  test('an unhooked round can submit a valid alias, which then appears on the leaderboard', async ({ page }) => {
    // A full unhooked round can last up to 180 s if the opening shots miss.
    test.setTimeout(240_000);
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().startsWith(`${WORKER_ORIGIN}/scores`)) posts.push(r.url());
    });

    await openGame(page);
    await startMatch(page, 'dust', 1);
    // The player spawns facing bot 1; four hits (25 damage each) win the round quickly.
    await holdFire(page);
    await expect(screen(page, 'end-round')).toHaveClass(/active/, { timeout: 200_000 });
    await releaseFire(page);
    await expect(byTestId(page, 'practice-notice')).toBeHidden();
    const score = Number(await byTestId(page, 'score-display').textContent());
    expect(score).toBeGreaterThanOrEqual(0);

    // Invalid aliases are rejected client-side without a request.
    await byTestId(page, 'alias-input').fill('');
    await byTestId(page, 'submit-button').click();
    await expect(byTestId(page, 'alias-error')).toContainText('Alias must be 1–20 printable ASCII characters');

    await byTestId(page, 'alias-input').fill('Ünïcødé✓');
    await byTestId(page, 'submit-button').click();
    await expect(byTestId(page, 'alias-error')).toContainText('Alias must be 1–20');

    await byTestId(page, 'alias-input').fill('x'.repeat(21));
    await expect(byTestId(page, 'alias-input')).toHaveValue('x'.repeat(20)); // maxlength caps input at 20
    expect(posts).toEqual([]);

    // Valid alias → 201 from the Worker → success status
    const alias = 'E2E-Ace';
    await byTestId(page, 'alias-input').fill(alias);
    const post = page.waitForResponse((r) => r.url() === `${WORKER_ORIGIN}/scores` && r.request().method() === 'POST');
    await byTestId(page, 'submit-button').click();
    expect((await post).status()).toBe(201);
    await expect(byTestId(page, 'submit-status')).toHaveText('Score submitted!');
    await expect(byTestId(page, 'submit-button')).toBeDisabled();
    expect(posts).toHaveLength(1);

    await byTestId(page, 'view-leaderboard-button').click();
    await expect(screen(page, 'leaderboard')).toHaveClass(/active/);
    const row = byTestId(page, 'leaderboard-row').filter({ hasText: alias });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(String(score));
  });
});
