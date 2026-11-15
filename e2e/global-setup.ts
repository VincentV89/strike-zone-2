import { chromium } from '@playwright/test';

import { WEBGL_ARGS } from './env';

/**
 * Fails fast with a clear message when headless Chromium cannot create a
 * WebGL2 context, instead of letting every spec time out on a blank canvas.
 */
export default async function globalSetup(): Promise<void> {
  let browser;
  try {
    browser = await chromium.launch({ args: [...WEBGL_ARGS] });
  } catch (err) {
    throw new Error(
      'E2E setup: could not launch Chromium. Run `npx playwright install --with-deps chromium` ' +
        `(set PLAYWRIGHT_BROWSERS_PATH to install outside the repo). Cause: ${String(err)}`,
    );
  }
  try {
    const page = await browser.newPage();
    const webgl = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl ? String(gl.getParameter(gl.VERSION)) : null;
    });
    if (!webgl) {
      throw new Error(
        'E2E setup: WebGL2 is unavailable in headless Chromium with SwiftShader flags ' +
          `(${WEBGL_ARGS.join(' ')}). The game cannot render, so the suite will not run.`,
      );
    }
  } finally {
    await browser.close();
  }
}
