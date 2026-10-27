# Milestones

Checkpoints: M1, M3, M5c, M6.

| Milestone | Status |
|---|---|
| Setup | done |
| M1 Flight + terrain | done - phone tested OK (60 fps High, low heat) |
| M2 Spell, orbs, enemy, music layer 1 | done |
| M3 Castle, archers, rivals, win, chapters 1-2, offline | done - awaiting phone test (checkpoint) |
| M4 Four wizards + balance | done |
| M5a Chapters 3-4 | done |
| M5b Chapters 5-6 | done - awaiting phone test |
| M5c Polish, hub, accessibility, stress test | done - awaiting phone test (checkpoint) |
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

### M3 follow-up (phone feedback, 2026-10-26)
- Max mana: pool caps at 200; bigger upgrades are paid via the castle bank. New **Deposit** button (hold near your castle) moves mana into the bank; HUD shows what you still need.
- Castles restyled in Arabian architecture (onion domes, balconied towers/minarets, pointed merlons, arched windows) with warmer sandstone colours.
- Guided aim: wider, smarter auto-target cone plus light homing. Tests: 106 passing.

### M3 follow-up 2 (phone feedback, 2026-10-26)
- Terrain buttons moved next to the fire button (with the new weapon-upgrade button); they cost 8 mana and can be turned off in Settings.
- **Weapon upgrade:** 3 tiers per wizard attack (Fireball -> Blazing Fireball -> Inferno Orb), bought with personal mana; tier pips on the cast button.
- **Bounties:** wizard kill = 130 mana; castle tier knocked off = 70 + 30 x tier; castle destroyed = 320 (overflow goes to the castle bank).
- **Dying:** all personal mana is lost (drops as orbs) and 30% of the castle bank.
- **Palace win:** tier-5 castle + chapter mana target wins outright (HUD shows progress). Match length in autopilot sims: 9-13 min.
- **Evil genies:** ranged monsters (curse bolts, can be shot down by archers), 45 mana each.
- Tests: 124 passing. Bundle: 181 KB gzip JS (budget 300).

### M4 (2026-10-27): four wizards, spell table, balance, AI-vs-AI
**Built:** four wizard kits (primary attack x 3 tiers + signature) in one spell table; sim mechanics for chain, slow, freeze, burn on wizards, Firestorm zones, Frost Nova, Stone Wall (terrain deltas), Quake aftershock, Gale Dash, swept fast bolts; per-element projectile, impact, status and zone VFX; per-element synthesized SFX; distinct-shape icons (colour-blind safe); signature button; rival AI that uses each kit; co-op combos defined in the table (M6); balance model + solver + report (`npm run balance`).
**Four players every chapter** (changed from 1/1/2/2/3/3 at the user's request).
**Tests:** 162 passing + the win-rate test (balance per tier within 5%, utility ranges, kit mechanics, determinism with all four elements, AI-vs-AI win rates fire 20.8 / water 27.1 / earth 29.2 / air 22.9%).
**Bundle:** 186.9 KB gzip JS (budget 300 KB).
**Phone checklist (M4):** (1) Pick each wizard in the chapter menu and play a few minutes: do the four feel different? (2) Attack button + signature button beside it (cooldown ring). Fire: Firestorm where you aim. Water: Frost Nova slows everything near; chain bolts arc between enemies; tier 3 freezes. Earth: heavy boulders, Stone Wall raises a barrier ahead. Air: fast long-range bolts, Gale Dash speed burst (also breaks freezes). (3) Buy weapon tiers II and III. (4) Check the new sounds and effects, reduced-flashing option. (5) FPS / cpu / warmth readings with several effects on screen.

### M5a (2026-10-27): chapters 3 and 4 (Canyons of Rose Stone, Pearl Harbour by Moonlight)
**Built:** canyon terrain with flat floors and steep walls; rock needles and lighthouses as sim landmarks (fliers hover over them, shots burst on them); strata-banded cliffs; structure kits (`rose-tombs`: tomb facades and toppled columns; `moonlit-harbour`: piers, lanterns, dhows); lit beacons (lighthouse sweep, lantern glow, fake water reflections); night sky with stars and a moon; five new creatures (Canyon Wraith, Tide Djinn, Stone Bat, Rose Ibex, Night Gull) and their bolt colours; data-driven ambient beds (six recipes) wired into the audio facade. `playableChapters` is 4.
**Tests:** 174 passing in 17 files (adds terrain-m5a and m5a-content: creature types exist, ambient recipes exist, kit geometry finite and cheap per chunk, lighthouses give beacons, night chapters flag stars/moon).
**Bundle:** JS 726 KB raw / **197.7 KB gzip** (budget 300).
**Phone checklist (M5a):** (1) Play **Canyons of Rose Stone**: fly the canyon floors, between the needles, past tomb facades; listen for the echoing wind. Wraiths fire rose-coloured bolts, bats swarm, ibex flee for mana. (2) Play **Pearl Harbour by Moonlight**: look for stars and the moon, the lighthouse beam sweeping, lantern glows and their reflections on the water, dhows and piers; Tide Djinn fire teal bolts. (3) Compare FPS and warmth on High vs Medium in both chapters (debug overlay), and tell me if the sea or the needles cost frames.

### M5b (2026-10-27): chapters 5 and 6 (The Sunken Sand City, The Sultan's Sky Palace)
**Built:** all six chapters are now playable (`playableChapters` 6).
- **Chapter 5:** half-buried ruins. Broken towers (`ruin-tower` landmarks, in the sim so fliers hover over them and shots burst on them) plus the `buried-ruins` kit (colonnades, pointed arches, drowned mosque domes sunk in the dunes, fallen blocks). **Sandstorm** (`weather.sandstorm` in the chapter JSON, render only): slow gusts pull the fog in and out (all presets) and one full-screen triangle of drifting sand streaks (High/Medium, `weatherLayer` in `quality.json`).
- **Chapter 6:** sky islands over a **cloud sea**. Terrain reuses `canyon` with a wide carve so ~38% of the map is islands 30+ above `waterLevel`; the water plane becomes opaque billowing cloud (`palette.cloudSea`, shader on High/Medium, flat colour on Low; lanterns do not mirror in it). `spire` landmarks (gilded minarets), `sky-palace` kit (pavilions with onion roofs, arched bridges across the gaps, built eastward from their own chunk so neighbours never duplicate them).
- **Creatures:** Sand Wraith (ranged, slows), Ruin Golem (floating, 165 HP, slow melee), Dune Gazelle (neutral); Cloud Serpent (fast, fragile melee flier), Palace Guardian (ranged, gilded lance), Sunset Dove (neutral). New bolts `sand-bolt` and `guardian-bolt` in `solve-balance.ts`.
- Rocks are no longer placed deep below the water/cloud level (invisible anyway).
**Balance fix (found by the AI-vs-AI test):** with chapters 5-6 in, earth won 35% of matches. Simulations showed it collected ~10% more mana than the others in every chapter (area shots that one-shot clusters, which the DPS model undervalues). `balance.json` now has `elementPower` (earth 1.25): the model costs earth higher, so the solver gives the boulder ~20% less damage per hit at the same cooldown and mana (structure multiplier raised 1.6/1.7/1.8 -> 2.0/2.1/2.25 so earth is still the siege wizard). Lightning's hit radius 1.2 -> 1.7 (it was the smallest, and air under-collected). The budget, ttk and ttd tests are unchanged. Win rates over 48 matches: fire 25.0 / water 22.9 / earth 27.1 / air 25.0 %.
**Tests:** 187 passing in 18 files (new `tests/m5b.test.ts`: all six chapters validate, new creatures/bolts exist and have the right roles, kits registered and cheap per chunk, ruin towers, cloud sea land fraction, spires only on islands, no hidden rocks, gust function range, weather validation, castles/spawn on dry flat land and a finite 60 s four-player sim in both chapters).
**Bundle:** JS 740 KB raw / **196.5 KB gzip** (budget 300); total 202.2 KB gzip.
**Headless check (software GL, not representative of speed):** ch5 ~40k triangles / 69 draw calls, ch6 ~45k triangles / 66 draw calls on High; no console errors.
**Phone checklist (M5b):** (1) Play **The Sunken Sand City**: fly past the broken towers, columns, arches and half-buried domes; the screen should haze over and clear as gusts pass (sand streaks on High/Medium). Sand Wraiths slow you, Ruin Golems are slow and tough (60 mana), gazelles flee for mana. (2) Play **The Sultan's Sky Palace**: castles sit on islands above a pink cloud sea; look for gilded spires, pavilions, bridges, lanterns; Cloud Serpents dart at you, Palace Guardians fire golden lances, doves flee for mana. (3) Compare FPS and warmth on High vs Medium in both (debug overlay); tell me if the sand layer or the cloud shader costs frames (Low drops both). (4) Does earth still feel strong but not dominant? (it lost ~20% damage per boulder).

### Feedback round before M5c (2026-10-27)
- **Smaller maps:** `castleSiteDistance` 760 -> 440; nests 150-380 away (was 260-620); wells 110-260 away (was 150-380). Matches still run 7-11 min in autopilot sims.
- **More mana:** ambient orbs every 22 ticks (was 40), up to 48 near you (36), 5 each (4); orb cap 160; wells first at 12 s, every 23-40 s, up to 3 at once, 220 reserve, drawn at 40/s (was 160, 32).
- **Calmer enemies, more later:** hostile target is `2 x enemyDensity` per player (was 7). `enemyDensity` per chapter: 0.6 / 0.7 / 0.85 / 1.0 / 1.25 / 1.5; nest guards scale with it. Wild animals 3 per player (was 5). Chapter 1 peaks at about 5 hostile creatures, chapter 6 at about 12.
- **Castle damage releases mana:** every 20% of wall HP knocked off scatters orbs at the castle (25 + 10 x tier mana, paid from the castle's bank first) for whoever is attacking. Resets on upgrade or tier loss. Data: `castles.json` `damageRelease`; event `castleRelease` (toast, chime, burst).
- **Weapon animations per tier:** tier 2 adds orbiting satellites (embers / ice shards / rock chips / forked arcs), a denser trail and a shockwave ring on cast and impact; tier 3 adds a white-hot core, a halo, a wider satellite ring, a heavy trail and a double shockwave. Every element differs.

### M5c (2026-10-27): polish, adaptive music, bloom, hub, accessibility, stress test
**Built:**
- **Real bloom (High only):** `src/render/bloom.ts` (EffectComposer + UnrealBloomPass + OutputPass, 4x MSAA target, half-resolution bloom) is a separate lazily loaded chunk (offline precache includes it). The governor turns it off if render scale drops under 0.75. Our own shaders convert to linear while bloom is on (`colorspace.ts`), so colours match the non-bloom look. Low/Medium keep the sprite glow.
- **Adaptive music:** `intensity.ts` turns the situation (hostiles chasing, enemy wizards, enemy bolts near, castle hit lately, low HP) into a 0..1 intensity that rises quickly and fades slowly; `MusicPlanner.planCombat` layers driving ghost notes, off-beat teks, a running low oud line and heavy doubled dums with a quicker pulse; the calm line is untouched. Data in `music.json` `combat`.
- **Hub:** chapter cards show a sky/sand gradient from each chapter's palette, cleared state and best winning time, a lock; a detail strip lists rivals (with personality), enemies, mana animals and how busy the chapter is; header shows chapters cleared and matches won/played (saved in `progress`).
- **Accessibility:** text size (Normal/Large/Largest), high contrast, reduced motion (no boost zoom, no sand haze), colour-blind faction colours (Okabe-Ito; banner shapes already differ), reduced flashing now also thins bursts. Settings validate on load.
- **Stress test:** `tests/stress.test.ts` fills every pool to its cap, doubles enemy density and fights for 3 minutes in every chapter: counts stay under the caps, values finite, average tick under 1.5 ms, worst under 33 ms, and the run is deterministic. `scripts/stress-browser.cjs` drives the real renderer for every chapter x preset and prints draw calls, triangles, particles and heap growth.
**Tests:** 214 passing in 22 files (new: m5c-rules, adaptive-music, m5c-ui, stress). Win rates over 48 matches after the feedback changes: fire 22.9 / water 29.2 / earth 16.7 / air 31.3 %, all inside the 10-point tolerance.
**Bundle:** main JS 205.2 KB gzip total JS including the lazy bloom chunk (budget 300); total 211.2 KB gzip. Offline test passes.
**Headless stress run (software GL; frame times are not representative):** worst case with 40 creatures and 200 orbs: High 85-93 draw calls / 46-50k triangles, Medium 53-56 / 32-39k, Low 37-43 / 19-25k; JS heap flat (no growth over the runs); no console errors.
**Phone checklist (M5c):**
1. Settings -> Graphics: High. Fly at night (chapter 4) and cast: glow should bleed softly around bolts, lanterns and the lighthouse. Check FPS and warmth; if it hurts, the governor should drop resolution and bloom switches off under 0.75 scale. Compare with Medium.
2. Music: calm flying has the usual oud, ney and darbuka. Pick a fight (dust sprites, a rival): within a couple of seconds drums, off-beat ticks and a running oud line join in; they fade over ~10 s after the danger passes.
3. Chapter menu: gradient cards, best times after a win, detail strip, stats line. Try Settings -> Text size Largest and High contrast: everything readable, no clipped buttons?
4. Reduced motion: no zoom when boosting; chapter 5 has no sand haze.
5. Colour-blind colours: start a new match; faction colours change, banners still differ.
6. Castle: shoot an enemy castle: every 20% of its wall HP makes a burst of mana orbs; grab them. Do the maps now feel small enough, the mana plentiful, and the enemy counts calm in chapters 1-3?
7. Buy weapon tiers 2 and 3: the bolt, the cast flash and the impact should each look clearly different.

## RESUME HERE (written 2026-10-27, end of M5c)
**State:** M1-M5c done: six playable chapters, bloom, adaptive music, hub, accessibility, stress tests. `npm run check` exits 0 (214 tests, 205 KB gzip JS). **M5c is a CHECKPOINT: wait for the user's phone feedback (M3-M5c checklists: FPS and warmth per preset, bloom cost, map size, enemy counts, mana, weapon tiers) and apply it before starting M6 (co-op, CHECKPOINT).** M6 starts with free-plan research (Durable Objects SQLite, hibernatable WebSockets) before code; ask before anything that needs a paid plan.
**Tips:** dev server `(nohup npx vite --port 5173 >log 2>&1 &)`; never `pkill -f` with a pattern that matches your own command (use `[v]ite`). Headless screenshots: Playwright at `/opt/node-tools/node_modules/playwright` with `--use-gl=angle --use-angle=swiftshader`; dev hook `window.__game` (`changeSettings({quality:'high',qualityAuto:false},'quality')`, click `#startBtn`, then `startMatch(i)`; `sim.players[0]` to teleport/set `spellTier`). `npx vite-node script.ts` runs scratch TS against `src/` (terrain ASCII maps, win-rate diagnostics). The win-rate test is deterministic and takes ~3.5 min; if a content change tips it, measure per-element mana share at 6 minutes over several seeds before touching spells (earth was +10%).
