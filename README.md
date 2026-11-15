# strike-zone-2

Browser FPS built with TypeScript, three.js and Vite. Static SPA on Cloudflare Pages with an optional Cloudflare Worker + KV leaderboard (`packages/leaderboard-backend`).

## Develop

```bash
npm install
npm run dev            # Vite dev server
npm run typecheck      # tsc --noEmit (src + leaderboard client)
npm run test:coverage  # Vitest unit + integration tests, 80% thresholds
npm run generate:maps  # rebuild public/maps/<id>/geometry.glb from definition.json
```

Set `VITE_LEADERBOARD_URL` (see `.env.example`) to enable the leaderboard. Without it the game runs offline.

Controls: WASD move, Space jump, mouse look (click the canvas to re-lock after Esc), left click fire (8 rounds/s), R reload (also automatic on empty).

## Maps

Map ids are `dust` and `compound` (`MAP_IDS` in `src/map-system/types.ts` is the single source of truth). Each `public/maps/<id>/` folder holds `definition.json` (colliders, waypoints, spawns) and a committed `geometry.glb` generated from the colliders by `scripts/generate-map-geometry.mjs`. Re-run `npm run generate:maps` after editing a definition. `src/map-system/__tests__/map-assets.test.ts` checks that every spawn and waypoint is outside colliders and every waypoint edge avoids obstacles.

## Test hooks

Query-param hooks work in every build and do nothing unless present:

| Param | Effect |
|---|---|
| `roundSecs=N` | Round length in seconds (1–3600) |
| `botHealth=N` | Starting health per bot (1–1000) |
| `debug=1` | Exposes a read-only `window.__SZ_DEBUG__` snapshot (engine state, round phase, timer, kills, score, player health/ammo/position, bot alive flags and positions, combatant ids) |

Invalid values are ignored with a console warning. When any hook is active the round is a practice round: score submission is disabled and the end screen shows "Practice round, score not submitted".

## End-to-end tests (Playwright)

```bash
npx playwright install --with-deps chromium   # once
npm run test:e2e
```

`playwright.config.ts` builds the app with `VITE_LEADERBOARD_URL` pointing at a local `wrangler dev` Worker (fresh local KV per run, no Cloudflare credentials), serves it with `vite preview` on `127.0.0.1:4173`, and drives headless Chromium with SwiftShader WebGL2. Any uncaught page error or unexpected `console.error` fails a test. Specs live in `e2e/`. Ports 4173 and 8787 must be free.

In CI the `e2e` job runs on every push and PR, uploads the HTML report and traces on failure, and `deploy` depends on it.

To keep browser binaries out of the repo, set `PLAYWRIGHT_BROWSERS_PATH` (for example `/tmp/pw-browsers`) for both the install and the test run.
