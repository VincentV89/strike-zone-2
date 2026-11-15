import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { APP_ORIGIN, APP_PORT, WEBGL_ARGS, WORKER_ORIGIN, WORKER_PORT } from './e2e/env';

const isCI = !!process.env['CI'];

// A fresh local KV store per run so the leaderboard starts empty. Set once in
// the main process; Playwright workers inherit the environment.
process.env['SZ2_E2E_KV_DIR'] ??= mkdtempSync(join(tmpdir(), 'sz2-e2e-kv-'));
const kvDir = process.env['SZ2_E2E_KV_DIR'];

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Software WebGL is CPU-heavy; two workers keep frame times sane on CI runners.
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: APP_ORIGIN,
    viewport: { width: 800, height: 450 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: [...WEBGL_ARGS] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 450 } },
    },
  ],
  webServer: [
    {
      // Real leaderboard Worker on local workerd + local KV; no Cloudflare credentials.
      command:
        `npx wrangler dev --local --ip 127.0.0.1 --port ${WORKER_PORT} ` +
        `--persist-to "${kvDir}" --var ALLOWED_ORIGIN:${APP_ORIGIN} --show-interactive-dev-session=false`,
      cwd: 'packages/leaderboard-backend',
      url: `${WORKER_ORIGIN}/scores`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { WRANGLER_SEND_METRICS: 'false' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // The real production build, pointed at the local Worker.
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
      url: APP_ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_LEADERBOARD_URL: WORKER_ORIGIN },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
