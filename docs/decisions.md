# Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-26 | Hosting: **Cloudflare Workers with static assets** (single project), not Pages. | Cloudflare now steers new projects to Workers; Pages is in maintenance mode. A Worker can serve the built site as static assets AND host the co-op Durable Object natively (Pages would need a separate Worker). Static asset requests are free and unlimited. |
| 2026-10-26 | Deploy through Cloudflare **Workers Builds** (Git integration); no GitHub Actions, no API tokens. | Required by brief; avoids secrets in a public repo. |
| 2026-10-26 | M1 `wrangler.jsonc` has **no `main`** (assets-only Worker). Worker + Durable Object added in M6. | Nothing to run server-side yet; keeps M1 a plain static site. |
| 2026-10-26 | TypeScript pinned to 5.9.x. | typescript-eslint supports `<6.1.0`. |
| 2026-10-26 | Sim tick rate 30 Hz, render interpolates. | Cheaper in the Durable Object, fits 15-20 Hz snapshots, smooth on phones. |
| 2026-10-26 | Sim bans `Math.sin/cos/atan2/pow/exp/log/random` and clocks via ESLint; own `dsin/dcos/datan2` in `src/sim/dmath.ts`. | Identical results on both phones and the server. `+ - * / sqrt` are IEEE-exact. |
| 2026-10-26 | Terrain lighting baked into vertex colours, `MeshBasicMaterial` + fog. No shadow maps, no terrain textures. | Cheapest possible shading on mobile GPUs. |
| 2026-10-26 | Terrain LOD seams hidden with skirts. | Simpler and cheaper than stitched LOD edges. |
| 2026-10-26 | Terrain deltas capped (256); on overflow the two nearest of the oldest deltas are merged, then the weakest dropped. Ids are monotonic; a `compactionEpoch` tells the renderer to rebuild everything. | Bounded sync payload for co-op; deterministic. |
| 2026-10-26 | M1 service worker is a no-cache stub (install/activate only, network passthrough). | Avoids stale builds on the phone while testing. Real offline caching lands in M3. |
| 2026-10-26 | Real post-process bloom deferred to M5c (High preset only). M1 uses additive glow sprites. | Per brief: fake glow on Low/Medium. |
| 2026-10-26 | Branch policy: develop on `claude/elegant-franklin-d9ap5u`; after build + tests pass, fast-forward `main` from it (the brief says to push to main on green). Cloudflare deploys `main`. | Brief: "Push to main only when the build and tests pass". |
| 2026-10-26 | Golden terrain checksum re-recorded after an intentional change to oasis blending (smoothstep 0..0.6). Rule: only update the golden when the terrain *algorithm* changes on purpose, never to hide platform drift. | The golden uses fixed params (not chapter data) so chapter tuning never trips it. |
