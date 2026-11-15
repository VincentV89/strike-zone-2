import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every spec fails on an uncaught page error or an unexpected console.error.
 * A test that expects a specific error (for example a forced 404) adds a
 * pattern with `allowConsoleError(/.../)`.
 */
type GuardFixtures = {
  allowConsoleError: (pattern: RegExp) => void;
  consoleGuard: void;
};

export const test = base.extend<GuardFixtures & { _allowList: RegExp[] }>({
  _allowList: async ({}, use) => {
    await use([]);
  },
  allowConsoleError: async ({ _allowList }, use) => {
    await use((pattern: RegExp) => {
      _allowList.push(pattern);
    });
  },
  consoleGuard: [
    async ({ page, _allowList }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (_allowList.some((re) => re.test(text))) return;
        problems.push(`console.error: ${text}`);
      });
      await use();
      expect(problems, 'uncaught page errors / unexpected console.error').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect, type Page };
