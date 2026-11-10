# Strike Zone 2 — Project Plan

> A browser-based, Counter-Strike-style tactical first-person shooter.
> This document is a **plan only** — no game code is included yet. It defines
> scope, architecture, technology choices, and a phased roadmap so that
> implementation can proceed in small, reviewable PRs.

---

## 1. Vision

Two teams — **Attackers** (plant the bomb) and **Defenders** (stop/defuse it) —
fight short, round-based matches on a compact map. Death lasts until the end of
the round, money earned between rounds buys weapons and utility, and the first
team to win a set number of rounds takes the match.

Design pillars (borrowed from the Counter-Strike formula):

1. **Precision over chaos** — high lethality, headshots matter, movement
   inaccuracy punishes run-and-gun.
2. **Rounds and economy** — every round is a fresh tactical puzzle shaped by
   what each team can afford.
3. **Readable maps** — three-lane layout, two bomb sites, clear sight lines.
4. **Instant to play** — runs in a modern browser, no install.

## 2. Scope

### MVP (must have)
- First-person movement: walk, run, crouch, jump, gravity, collision.
- Hitscan weapons: 1 pistol, 1 rifle, knife. Recoil pattern, spread, reload, ammo.
- Health/armor, damage falloff, headshot multiplier.
- One small map with two bomb sites (A/B) and spawn zones.
- Round loop: freeze time → live → bomb plant/defuse or elimination → round end.
- Economy: start money, kill reward, round win/loss bonus, buy menu during freeze time.
- Bots (simple AI) so the game is playable solo.
- HUD: crosshair, health/armor, ammo, money, round timer, score, kill feed.
- Settings: mouse sensitivity, FOV, volume, keybinds.

### Post-MVP (should have)
- Online multiplayer (authoritative server, up to 5v5).
- More weapons (SMG, AWP-style sniper, shotgun) and utility (HE, flashbang, smoke).
- Second map, spectator mode after death, scoreboard with K/D/A.
- Positional audio (footsteps, gunshots) as a core gameplay cue.

### Out of scope (for now)
- Ranked matchmaking, accounts, persistence, cosmetics/skins, anti-cheat beyond
  server authority, mobile/touch controls.

## 3. Technology choices

| Concern            | Choice                                   | Rationale |
|--------------------|------------------------------------------|-----------|
| Language           | TypeScript (strict)                      | Shared types between client and server. |
| Rendering          | Three.js                                 | Mature WebGL renderer, large ecosystem, glTF loading. |
| Physics/collision  | Rapier (`@dimforge/rapier3d-compat`)     | WASM, deterministic, fast character controller + raycasts. |
| Build/dev server   | Vite                                     | Fast HMR, simple TS + asset pipeline. |
| Networking         | WebSocket (`ws`) on Node.js; binary messages | Simple to host; upgrade path to WebRTC/WebTransport later. |
| Audio              | Web Audio API (`PannerNode`)             | Native positional audio. |
| Maps/assets        | glTF 2.0 authored in Blender             | Standard, compact, Three.js-native. |
| Tests              | Vitest (unit) + Playwright (smoke)       | Fast, Vite-native. |
| Lint/format        | ESLint + Prettier                        | Standard. |
| Task runner        | `mise` tasks (`build`, `lint`, `test`, `dev`) | Matches the repo's CI tooling expectations. |

> Decision note: a browser stack was chosen because the repo is empty and it
> gives the lowest barrier to play/test. If a native engine is preferred
> (Godot 4 / Unity / Unreal), sections 4–6 still apply conceptually; only
> section 3 and the repo layout would change.

## 4. Architecture

### 4.1 Repository layout (monorepo, npm workspaces)

```
strike-zone-2/
├─ packages/
│  ├─ shared/      # Pure TS: game rules, weapon data, protocol, math. No DOM.
│  ├─ client/      # Vite app: rendering, input, HUD, audio, prediction.
│  └─ server/      # Node: authoritative simulation, rooms, bots.
├─ assets/         # Source .blend files, textures, sounds (Git LFS)
├─ docs/           # This plan, design docs, protocol spec
└─ mise.toml       # build / lint / test / dev tasks
```

### 4.2 Simulation model

- **Fixed-tick simulation** in `shared` (64 Hz), decoupled from render rate.
- Entity-component style data: `Transform`, `Velocity`, `Health`, `Weapon`,
  `Team`, `Inventory`, `BotBrain`. Plain arrays/maps — no heavy ECS library
  needed at this scale.
- Systems run in a fixed order each tick:
  `input → movement → weapons/hits → bomb → round/economy → cleanup`.
- The same `shared` simulation runs:
  - **Offline**: inside the client (single-player vs bots).
  - **Online**: on the server (authoritative), with client-side prediction.

### 4.3 Networking (post-MVP, designed for from day one)

- Client sends **input commands** (buttons + view angles + tick number) only.
- Server is authoritative; broadcasts **snapshots** at 32 Hz (delta-compressed).
- Client: **prediction + reconciliation** for the local player; **interpolation**
  (~100 ms buffer) for remote players.
- **Lag compensation**: server rewinds hitboxes to the shooter's view time
  (capped at ~200 ms) when resolving hitscan.
- Protocol defined once in `shared/protocol.ts` with versioning.

### 4.4 Rendering

- Low-poly, stylised art to keep scope achievable.
- Baked lightmaps for the map; one directional shadow light.
- Separate viewmodel scene/camera for the first-person weapon (no clipping).
- Muzzle flash, tracers, bullet decals (pooled), simple impact particles.

### 4.5 Bots

- Navmesh generated from the map (e.g. `recast-navigation-js`).
- Finite-state machine: `Buy → Rotate/Go to site → Hold angle → Engage →
  Plant/Defuse → Retreat`.
- Engage uses line-of-sight raycast, reaction delay, and aim error scaled by
  difficulty.

## 5. Gameplay specification (initial numbers, to be tuned)

| Parameter              | Value |
|------------------------|-------|
| Run speed / walk / crouch | 250 / 130 / 85 units·s⁻¹ |
| Max health / armor     | 100 / 100 |
| Round time / freeze time | 1:55 / 15 s |
| Bomb timer / defuse    | 40 s / 10 s (5 s with kit) |
| Match length           | First to 13 rounds (MR24); sides swap at 12 |
| Start money / cap      | $800 / $16,000 |
| Kill reward            | $300 (rifle), $300 (pistol), $1,500 (knife) |
| Round win              | $3,250 (elimination/defuse), $3,500 (bomb exploded) |
| Loss bonus             | $1,400 → +$500 per consecutive loss, max $3,400 |

Starter weapons (data-driven in `shared/weapons.ts`):

| Weapon | Price | Damage | Headshot × | Fire rate (RPM) | Mag |
|--------|-------|--------|-----------|-----------------|-----|
| Pistol | free  | 35     | 4.0       | 400 (semi)      | 12  |
| Rifle  | $2,700| 36     | 4.0       | 600 (auto)      | 30  |
| Knife  | free  | 40/65  | 1.0       | —               | —   |

Accuracy model: `spread = base + movementPenalty(speed) + recoilIndex * k`;
recoil follows a fixed per-weapon pattern with recovery over time.

## 6. Map: "Depot" (MVP)

- Three lanes (Long A, Mid, B Tunnels) connecting Attacker spawn to two sites.
- Defender spawn close to the midpoint between A and B for rotations.
- Target size: ~30-second run spawn-to-site for Attackers, ~10 s for Defenders.
- Blockout first (greybox in Blender), playtest with bots, then art pass.

## 7. Roadmap

Each milestone is a set of small PRs; each must keep `mise run build`,
`mise run lint`, and `mise run test` green.

| # | Milestone | Deliverables | Exit criteria |
|---|-----------|--------------|---------------|
| M0 | **Scaffolding** | npm workspaces, Vite client, TS strict, ESLint/Prettier, Vitest, `mise.toml` tasks, CI workflow | `mise run build/lint/test` pass in CI |
| M1 | **Movement sandbox** | Three.js scene, pointer-lock FPS camera, Rapier character controller, greybox room | Walk/run/crouch/jump smoothly at 60+ FPS |
| M2 | **Shooting** | Hitscan raycasts, hitboxes (head/body/legs), weapon data, recoil/spread, reload, viewmodel, HUD ammo/health | Can kill static target dummies; unit tests for damage/spread |
| M3 | **Round & economy** | Teams, spawns, freeze time, round timer, win conditions, money, buy menu | Full round loop works vs dummies; economy unit tests |
| M4 | **Bomb** | Plant zones, plant/defuse actions & timers, defuse kit | Both bomb outcomes end round correctly |
| M5 | **Map "Depot"** | Greybox → glTF map, collision mesh, spawn points, navmesh | Map playable end-to-end |
| M6 | **Bots** | Navmesh pathing, FSM, aim model, difficulty levels | 5v5 offline match playable start to finish |
| M7 | **Polish (MVP release)** | Audio, settings menu, kill feed, scoreboard, performance pass | MVP scope in §2 complete; Playwright smoke test |
| M8 | **Multiplayer** | Node server, rooms, prediction/reconciliation, interpolation, lag compensation | 10 players on LAN/VPS at ≤100 ms with no desync |
| M9 | **Content** | Grenades, more weapons, second map, spectator | Post-MVP scope in §2 complete |

## 8. Testing strategy

- **Unit (Vitest)** in `shared`: damage/armor math, economy rules, round state
  machine, recoil patterns, protocol encode/decode round-trips.
- **Deterministic simulation tests**: feed scripted inputs, assert resulting
  state (enables replay and netcode regression tests).
- **Smoke (Playwright)**: game boots, menu → match loads, no console errors.
- **Performance budget**: 60 FPS on integrated GPU at 1080p; < 5 MB initial
  download excluding map; server tick < 2 ms for 10 players.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Netcode complexity | Design simulation in `shared` deterministic from M1; build offline first, network in M8. |
| "Feel" of movement/shooting | Data-driven tunables + a debug overlay for live tweaking; playtest each milestone. |
| Art/asset scope creep | Stylised low-poly, single map until MVP ships. |
| Browser input limits (pointer lock, Esc) | Use `pointerlockchange` handling and rebindable keys; avoid Esc-dependent actions. |
| Cheating in multiplayer | Server authority, server-side hit validation, never trust client state. |
| IP/trademark | Original name, map, and assets — "inspired by", not a clone of, Counter-Strike. |

## 10. Open questions

1. Browser (Three.js) vs native engine (Godot/Unity/Unreal)? This plan assumes browser.
2. Is online multiplayer required for the first release, or is bots-only acceptable?
3. Art direction: stylised low-poly (assumed) or realistic?
4. Target hosting for the game server (Fly.io, AWS, self-hosted)?
