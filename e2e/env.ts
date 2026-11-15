/** Shared E2E constants (imported by playwright.config.ts and specs). */
export const APP_PORT = 4173;
export const WORKER_PORT = 8787;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
export const WORKER_ORIGIN = `http://127.0.0.1:${WORKER_PORT}`;

/** Chromium flags for a software WebGL2 path (SwiftShader via ANGLE) in headless mode. */
export const WEBGL_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
] as const;
