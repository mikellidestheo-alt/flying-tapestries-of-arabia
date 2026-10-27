# Plan - Flying Tapestries of Arabia

Short working plan. The milestone list and status live in `docs/milestones.md`; design in `docs/design.md`; choices in `docs/decisions.md`.

## What gets built, in order
1. **Setup**: Vite + TypeScript + Three.js, vitest, eslint, Cloudflare Workers static-assets config, service-worker stub, six chapter config files + validation test.
2. **M1** (checkpoint): flying tapestry over chunked, deformable procedural terrain. Deterministic fixed-step sim (`src/sim`) separate from rendering (`src/render`). Touch controls, left-handed mode, fullscreen, wake lock, adaptive quality governor, battery saver, debug overlay, seeded terrain tests.
3. **M2** one spell, mana orbs, one enemy, first procedural music layer.
4. **M3** (checkpoint) castle tiers + archers, rival AI, win/comeback, chapter system, difficulty, tutorial, save, chapters 1-2, offline service worker.
5. **M4** four wizards, spell table, balance script, AI-vs-AI test.
6. **M5a, M5b** (done) chapters 3-6; see "RESUME HERE" at the end of `docs/milestones.md`. **M5c** (next, checkpoint) VFX, adaptive music, menus, hub, accessibility, stress test.
7. **M6** (checkpoint) 2-player co-op on a Durable Object, free-plan research first.

## Assumptions
- Target is Android Chrome, landscape; keyboard is a dev convenience.
- Sim runs at a fixed 30 Hz; render interpolates. The same sim code will run inside the Durable Object.
- Terrain is a pure function of (seed, chapter terrain params) + a capped list of deformation deltas. No terrain textures; lighting is baked into vertex colours (MeshBasicMaterial) to stay cheap.
- Sim code avoids `Math.random`, `Math.sin/cos/pow/exp/log`, wall-clock time (enforced by an ESLint rule scoped to `src/sim`).
- Free Cloudflare plan only. Hosting: Workers with static assets, deployed by Cloudflare's Git integration (no GitHub Actions, no API tokens).
- Branch: this session develops on `claude/elegant-franklin-d9ap5u`; getting to `main` is a user decision (see decisions log).
