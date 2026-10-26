# Milestones

Checkpoints: M1, M3, M5c, M6.

| Milestone | Status |
|---|---|
| Setup | done |
| M1 Flight + terrain | done - phone tested OK (60 fps High, low heat) |
| M2 Spell, orbs, enemy, music layer 1 | done |
| M3 Castle, archers, rivals, win, chapters 1-2, offline | done - awaiting phone test (checkpoint) |
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

### M1 phone result (user report)
Works well: 60 fps on High for 2 minutes, very little heat. Feedback applied: Arabian wizards (turbans / headscarves), efficiency double-check, wells + wild animals noted for the final game.

### Efficiency double-check (after M1)
Fixed: terrain planner re-sorted ~225 candidates every frame (now only on chunk-border crossing / terrain change / queued work); per-vertex `Color.clone()` garbage in chunk builds; per-frame Vector3 allocation; per-tick player array allocation; `devicemotion` listener firing ~60/s even with tilt off (now attached only while tilt is on); start/pause screens redrew at 60 fps (now 2 Hz). Measured in Node: sim tick 0.009 ms, high-detail chunk height grid 0.76 ms. Scene cost: ~57 draw calls, 35k tris (High, with entities). The debug overlay now shows `cpu` ms (JS time per frame) so you can see main-thread cost on the phone.

### M2 (2026-10-26): spell, orbs, enemy, music layer 1
**Built:** Fireball (data-driven spell table, aim assist with target leading, burn DoT, scorch crater delta); mana pool + HUD (HP, mana, spell button with cooldown ring); mana orbs (ambient spawns + creature drops, magnet pull); Dust Sprite enemy (wander / chase / attack, burn, drops orbs); **mana wells** (random temporary reserves, beam, HUD arrow, drain by hovering); player damage, knock-out and respawn with mana penalty; bounded event log feeding VFX, audio and HUD; one-draw-call glow layer + capped particle pool; instanced creatures; four Arabian wizards; procedural music (oud pluck, ney flute, darbuka maqsum/saidi/baladi, drone, maqam scales, OGG drop-in hook); synthesized SFX; music/SFX sliders + mute; reduced-flashing wiring.
**Tests:** 64 passing (adds world/combat/determinism with all entity systems, music planner, perf guards).
**Bundle:** JS 627 KB raw / **160 KB gzip** (budget 300); total ~164 KB gzip.
**Notes:** non-fire wizards throw Fireballs until M4. Combat music layer + adaptive layers are M5c.
**Phone checklist (M2):** (1) Tap to fly: you should hear the drone, drum and oud within a second. (2) Press the flame button: whoosh, bolt, impact boom, scorch crater. (3) Fly at the glowing blue orbs: chimes rise in pitch as you chain them. (4) Dust sprites spawn around you; shoot them (aim assist helps), they drop orbs. If one touches you it hurts and the screen flashes red. (5) After ~20 s a mana well appears: follow the arrow, hover beside the beam and watch mana fill. (6) Settings: change the wizard (turbans/headscarves), try music/effects sliders and mute. (7) Check FPS and warmth with the debug overlay on (see the `cpu` figure).

### M3 (2026-10-26): castles, archers, rivals, win rules, chapters 1-2, offline
**Built:** five-tier castle table with visible growth (towers, domes, minarets, banners; each faction's banner differs in colour AND shape) and three upgrade branches (archers / walls / income) at tiers 3 and 5; instanced turbaned archers with distance LOD and arrow tracers; rival wizard AI (aggressive / greedy / defensive) driving the same flight and spell code as the player, with castles, upgrades, raids and healing; mana-share win condition with comeback bonus, sudden death and last-castle-standing; hostile nests that spawn guard sprites; wild animals (Desert Oryx) as a neutral mana source; chapter 1 (Oasis Dawn) and chapter 2 (Rooftops of the Spice Bazaar, a rooftop city with buildings in the shared sim); difficulty Easy/Normal/Hard; chapter select menu; HUD (share bar, compass, upgrade + branch picker, castle info, enemy castle HP); skippable tutorial; victory/defeat screens with stings; local save (unlocks, cleared chapters, wizard, difficulty, settings); real **offline service worker**.
**Tests:** 101 passing (adds castle tiers/upgrades/branches/damage, archers, win/comeback/sudden death, difficulty, rival AI full-match runs and determinism, city determinism and rooftop flight, tutorial, wild animals, perf guards). A 4-wizard match tick costs ~0.09 ms.
**Bundle:** JS 673 KB raw / **176 KB gzip** (budget 300); total ~181 KB gzip.
**Balance simulation (autopilot vs rival, Normal):** matches end at 12-14 min via sudden death (chapters 1-3), 15-18 min in chapter 5; early wins are impossible before minute 6. A skilled human should win earlier by gathering mana faster than the AI.
**Known gaps / next:** rivals fight each other only when they meet (more raiding comes with chapter tuning in M5a/b); non-fire wizards still throw Fireballs (M4); combat music layer, bloom, stress test (M5c); co-op (M6).
**Phone checklist (M3):**
1. Open the live link. Tap "Tap to begin", pick **Oasis Dawn**, Normal, a wizard, then Play. Tutorial prompts appear at the bottom; try Skip too.
2. Share bar (top) shows everyone's share of mana and the goal marker; compass shows your castle (gold) and the rival's (red, numbered); blue diamonds are mana wells.
3. Fly home to your castle, tap **Upgrade**; at tier 3 choose a path. Watch the castle grow and archers appear on the walls. Let a Dust Sprite near the castle and watch archer tracers.
4. Hunt an Oryx (cream, long horns, flees) for mana; destroy a nest (obelisk) for a mana burst.
5. Fly to the rival castle and shoot it; its HP bar appears. It drops a tier when its walls fall. Try to win by share, by sudden death, or by eliminating the rival.
6. Win once to unlock **Rooftops of the Spice Bazaar**: fly low over the roofs; shots burst on rooftops.
7. **Offline test:** with the game loaded once online, switch on airplane mode, fully close Chrome, reopen the link: the game should still load and play. (Tip: open Chrome menu > "Add to Home screen" for a fullscreen app icon.)
8. Check FPS and warmth on High in both chapters with the debug overlay (chapter 2 draws more triangles: about 60-70k).
