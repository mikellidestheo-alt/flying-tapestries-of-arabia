# Milestones

Checkpoints: M1, M3, M5c, M6.

| Milestone | Status |
|---|---|
| Setup | done |
| M1 Flight + terrain | done - awaiting phone test (checkpoint) |
| M2 Spell, orbs, enemy, music layer 1 | not started |
| M3 Castle, archers, rivals, win, chapters 1-2, offline | not started |
| M4 Four wizards + balance | not started |
| M5a Chapters 3-4 | not started |
| M5b Chapters 5-6 | not started |
| M5c Polish, hub, accessibility, stress test | not started |
| M6 Co-op | not started |

## Per-milestone records
(filled in as each milestone completes: bundle size, test results, phone test checklist)

### Setup + M1 (2026-10-26)
**Built:** Vite/TS/Three.js project; deterministic 30 Hz sim (`src/sim`) with flight, seeded terrain, capped deltas, deterministic spawn; six chapter configs + validation; chunked LOD terrain with skirts, baked lighting, instanced-free merged props (palms/rocks); gradient sky; water (shader / flat fallback); procedural tapestry + wizard + blob shadow; chase camera; floating left stick, left-handed mode, tilt (experimental), keyboard; fullscreen, landscape lock, wake lock, safe areas, haptics; quality presets + auto-pick + adaptive governor; battery saver (30 fps); debug overlay; localStorage save with try/catch; no-cache service-worker stub; Workers static-assets config.

**Tests:** 40 passing (terrain determinism x all chapters, golden checksum, chunk continuity, deltas cap/compaction, flight, chapter validation, rival elements, save robustness, governor).

**Bundle size (production):** JS 577 KB raw / **148.8 KB gzip**, CSS 4.9 KB / 1.6 KB gz, total ~151 KB gzip (budget 300 KB JS gzip). No texture files.

**Headless sanity run (software GL, not representative of phone speed):** ~40 draw calls, ~17-22k triangles, 80-100 chunks on Medium; no console errors.

**Known gaps / next:** real post-process bloom (M5c, High only); no wizards/spells/enemies yet (M2); service worker does not cache yet (M3); stress test arrives at M5c.

**Phone test checklist (M1):**
1. Open the live link in Chrome on the phone. Tap "Tap to fly": it should go fullscreen and landscape.
2. Drag on the left half: steer left/right, up = boost, down = brake. Release = cruise. Turning should feel smooth with a little drift.
3. Tap Crater / Mound on the right: terrain ahead dents/rises. Buzz on tap (Settings -> Vibration).
4. Fly low over dunes and the lake: you should hover above ground, never clip into it.
5. Pause (top-right) -> Settings: switch quality, Battery saver, Left-handed (layout should mirror), Debug overlay. Note FPS in each quality level.
6. Leave it flying ~2 minutes: frame rate should stay steady; note if the phone gets warm or the governor shows scale dropping (debug overlay "scale").
7. Screen should not dim while playing (wake lock).
