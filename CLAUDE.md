# CLAUDE.md - rules and conventions (short). Full design: [docs/design.md](docs/design.md)

Game: **Flying Tapestries of Arabia**, a 3D open-world flying/spellcasting game. Original title, art, names, music. Never reuse assets or names from existing games.

## Stack and platform
- Three.js + TypeScript (strict) + Vite. Vitest, ESLint. TypeScript pinned to 5.9.x (typescript-eslint limit).
- **Android Chrome, landscape only.** Touch is primary; keyboard/mouse is a dev convenience.
- Solo works fully offline once loaded (service worker precaches the build, injected by `vite.config.ts`; verify with `scripts/test-offline.cjs`). Co-op is online-only.
- Hosting: Cloudflare **Workers with static assets**, deployed by Cloudflare's Git integration. No GitHub Actions deploys, no API tokens.
- **Free Cloudflare plan only** (SQLite-backed Durable Objects, hibernatable WebSockets where possible). Ask before anything that needs a paid plan.

## Public repo, no secrets
The repo is PUBLIC. Never commit secrets, tokens or personal data. Assume anyone can find the live URL (see abuse protections in the design doc).

## Layout
`src/sim` deterministic sim (also runs in the Durable Object) | `src/render` Three.js | `src/input` | `src/ui` DOM UI | `src/audio` | `src/net` | `src/data` tunable data | `chapters/` one JSON per chapter | `server/` Worker + Durable Object (M6) | `tests/` | `docs/`.

## Rules
1. **Sim/render separation.** `src/sim` never imports render/UI/DOM. Rendering and UI never mutate gameplay state; input is sampled into a `PlayerInput` per tick. Fixed timestep (30 Hz). Same sim code runs solo in the browser and in the Durable Object.
2. **Seeded randomness.** In `src/sim`: no `Math.random`, `Date.now`, `performance.now`, and no `Math.sin/cos/atan2/pow/exp/log` (ESLint enforces). Use `src/sim/prng.ts`, `noise.ts`, `dmath.ts`. Terrain/props/chapters must be identical on both phones and the server.
3. **Data not code.** All tunable numbers live in data files: `src/data/*.json`, `chapters/*.json`, and (later) the spell table and castle-tier table. Adding or retuning a chapter must never touch engine code.
4. **One spell table** (`src/data/spells.json`: damage, mana cost, cooldown, area, duration, effects, co-op combos; balanced by `src/data/balance.json`) and **one castle-tier table** (cost, wall HP, archers, archer range/damage/rate, income, visual kit, branches). Balance tests read these.
5. **Terrain deformation** is stored as capped deltas (position, radius, amount); never mutate base terrain. Deltas are what get synced in co-op.
6. **Chapter configs** (`chapters/chapterN.json`) are validated by `tests/chapters.test.ts` (three rivals per chapter, personalities, palette, music scale...).
7. **Co-op is server-authoritative** (one Durable Object per match). Clients send inputs, receive snapshots at 15-20 Hz, interpolate and predict locally.
8. **Quality is local and visual only.** Presets and the adaptive governor never change the sim.
9. Tests: if one fails, fix the cause. Never weaken or delete a test to pass it.
10. Log every non-trivial choice in `docs/decisions.md`. Keep this file, `docs/plan.md`, `docs/milestones.md` current so a new session can resume.

## Performance budget (enforced)
- Almost no texture files: procedural terrain, vertex colours, gradient shaders, canvas-generated patterns.
- Instanced meshes for villagers, archers, orbs, projectiles, domes. Chunked terrain with LOD. Fog + sky gradient hide draw distance. Blob shadows, **no shadow maps**.
- Fake glow (additive sprites) on Low/Medium; real post-process bloom only on High (M5c). Cheap water fallback (Low). Sandstorm/fog: few large low-overdraw layers.
- Pixel ratio capped at 1.5; adaptive governor lowers render scale then view distance. Presets High/Medium/Low auto-picked on first launch. Battery saver = 30 fps.
- Hard caps on live entities. Sim caps are single constants in `src/data/sim.json` `caps` (same for every device, because quality never changes the sim). Per-preset caps in `src/data/quality.json` limit what is DRAWN and particles.
- Debug overlay (settings): FPS, frame time, entity counts, latency.
- JS bundle budget: <= 300 KB gzip (`npm run size`). Report size after every milestone.
- Benchmark: Snapdragon 7s Gen 4 class phone holds 30-60 fps. High-end reference: Pixel 10 Pro XL.

## Workflow
- Work autonomously through milestones M1..M6 in order; stop only at **checkpoints M1, M3, M5c, M6** or when the user must act outside the app. Stop and ask before changing the stack, milestone order, performance budget, or anything needing a paid plan.
- End of every milestone: `npm run check`, commit, push, record bundle size + test results + phone checklist in `docs/milestones.md`.
- Commit after each step. Push only when build and tests pass.
- Dev branch for the current session is given in the session instructions; see `docs/decisions.md` for branch policy.

## Commands
`npm run dev | build | check | test | test:fast | lint | typecheck | size | balance | balance:solve | dev:server | test:coop`
Co-op dev: `npm run dev:server` (wrangler dev on :8787) next to `npm run dev` (Vite proxies /api and /ws to it); `npm run test:coop` runs a two-client end-to-end check against it (the room-creation limit is 6/hour per IP: use `--persist-to` with a fresh dir to reset).
`test:fast` skips the ~1.5 min AI-vs-AI win-rate test. `balance` prints the wizard balance table; `balance:solve` regenerates `src/data/spells.json` damage/mana numbers from the design in `scripts/solve-balance.ts` (edit the design there, never hand-tune numbers in the JSON).
