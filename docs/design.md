# Design

Full design for **Flying Tapestries of Arabia**. (CLAUDE.md holds only rules; this is the long form.)

## Pitch
Fly a woven tapestry over deformable open-world terrain in a golden-hour Arabian fantasy. Gather mana from creatures, structures and orbs; spend it on castle upgrades and spells; beat rival wizards to a chapter's target share of the world's mana (or be the last castle standing). Solo, or online 2-player doubles co-op.

## Characters
Four wizards, all in an Arabian style: men wear wrapped turbans with a jewel, women wear headscarves draped over the shoulders; robes and sashes in element colours. The jewel on the headwear differs in shape per element (flame / drop / block / ring) so colour is never the only cue. Rivals and castle archers reuse the same builder with their own looks.

## Core loop
Fly -> kill creatures / destroy enemy structures / absorb orbs -> mana -> upgrade castle (archers, walls, income) and cast spells -> capture the target mana share. The castle is base and respawn point.

## Flight (M1, implemented)
Momentum flight: steer (turn rate with inertia, slower when fast), throttle (brake <- cruise -> boost), velocity chases heading with limited grip (drift), a spring holds altitude above the highest nearby ground (look-ahead) plus boost lift. Hard clearance floor. Data: `src/data/flight.json`.

## Terrain (M1, implemented)
Pure function `baseHeight(params, x, z)` (domain-warped ridged dunes + swell + detail + oasis basins) plus a capped list of deltas (bump / crater). 64-unit chunks, three LODs with skirts, props merged into chunk geometry, baked vertex lighting. Params per chapter in `chapters/chapterN.json`. Delta policy: cap 256, merge-nearest-old compaction, monotonic ids, `compactionEpoch` for renderers.

## Mana sources
- **Mana orbs**: ambient clusters that spawn around you; creatures drop them when killed. Absorbed by flying close (magnet pull).
- **Mana wells** (M2): glowing wells that appear at random, last about 2 minutes and hold a finite reserve. Hover beside one to drain it into your pool. A light beam marks it from afar and a HUD arrow points the way.
- **Wild animals** (planned, M3 with chapter creature sets): neutral herds per chapter that flee when you approach; hunting them yields mana. Distinct from hostile creatures (dust sprites etc.).
- Kills of hostile creatures, and (from M3) destroying enemy structures.

## Match rules
- Target mana share per chapter (lower with more rivals), 10-15 min matches.
- Comeback: from `comeback.startMinute` trailing castles get an income bonus; at `suddenDeathMinute` the target share drops to `suddenDeathShare`.
- Difficulty Easy/Normal/Hard scales rival aggression, enemy health, mana income.

## Castle tiers and archers (M3, implemented)
~5 tiers in one table; visible growth, instanced archers with LOD, branches at certain tiers (more archers / tougher walls / faster mana). Archers target creatures and incoming rival projectiles, never the player. A destroyed castle drops a tier (unless last standing). Rivals use the same table.

## Wizards (M4, implemented)
Every wizard has a **primary attack with 3 tiers** (bought with personal mana: 90 then 180) and one **signature spell**. All numbers live in `src/data/spells.json`; `scripts/solve-balance.ts` derives damage and mana cost from the design so each tier lands on the budget in `src/data/balance.json`.

| Wizard | Primary (tier 1 / 2 / 3) | Signature | Identity |
|---|---|---|---|
| **Fire** (Rashid) | Fireball / Blazing Fireball / Inferno Orb: area burst + burn over time | **Firestorm**: a burning zone for 5 s | Area and damage over time |
| **Water** (Yasmin) | Frost Chain / Glacial Chain / Absolute Zero: chains to 2-3 more targets, slows, tier 3 freezes | **Frost Nova**: damage + slow in a ring around you | Crowd control |
| **Earth** (Tariq) | Boulder / Granite Boulder / Quake Boulder: slow heavy shot, big crater, strong vs structures, tier 3 aftershock | **Stone Wall**: raises a row of terrain that blocks shots | Siege and terrain |
| **Air** (Farah) | Lightning Bolt / Storm Bolt / Thunder Arc: very fast, long range, tier 3 arcs to a second target | **Gale Dash**: speed burst that also breaks freezes and slows | Range and mobility |

Statuses: burn (damage over time), slow (speed multiplier), freeze (can't move, steer or cast; only Gale Dash breaks it). Fast bolts are swept in sub-steps so they never skip a target.

### Balance model (`src/sim/balance.ts`, enforced by `tests/balance.test.ts`)
- **Effective damage per cast** = direct damage (with an area bonus) + burn at 70% uptime + chain jumps at 50% hit chance + aftershock + the damage-equivalent value of slow/freeze. **DPS** = that x casts per second; **efficiency** = that / mana cost.
- Budget per tier: DPS 80 / 118 / 165 and efficiency 2.9 / 3.3 / 3.7. Every wizard's every tier must be within **5%** of both.
- Utility is visible too: time to kill a creature and time to destroy a structure per wizard (Earth is the structure-breaker, nobody is locked out); signature spells share a looser budget (6.5 value/s, 20%).
- Archers stay a support role: at most 60% of the budgeted DPS and 75% of the weakest wizard's raw single-target DPS at every tier and branch pick.
- **AI-vs-AI test** (`tests/winrate.test.ts`): 48 deterministic matches in a Latin-square design (each element in each faction slot, every chapter, two AI personality sets). Each element must win within 10 percentage points of fair (25%).
- Co-op combos (steam, fire tornado, earth channel) are defined in the spell table now and implemented in M6.

## Chapters
1 Oasis Dawn | 2 Rooftops of the Spice Bazaar | 3 Canyons of Rose Stone | 4 Pearl Harbour by Moonlight | 5 The Sunken Sand City | 6 The Sultan's Sky Palace. Every chapter is a four-player match (you + 3 rivals). Rival elements: those the player(s) did not choose first; extras duplicate.

## Music and audio (M2+)
Procedural Web Audio: oud-like pluck, ney-like flute, darbuka, drone. Maqam scales (Hijaz, Bayati, Nahawand), maqsum/saidi/baladi rhythms. Adaptive calm/combat layers (M5c: a threat estimate drives driving ghost notes, off-beat teks, a running oud line and heavy dums; the calm line is untouched); synthesized per-element SFX; OGG drop-in per chapter.

## Controls
Left floating stick (or optional tilt) steers/throttles; right-side buttons cast; separate pause button; left-handed mirror; landscape lock, fullscreen on first tap, wake lock, safe areas, haptics.

## Co-op (M6, implemented)
Two players, one castle, one team (faction 0) against the three rival wizards. One Durable Object per match (`server/room.ts`, logic in `server/matchHost.ts`) runs the same `src/sim` at 30 Hz. Clients send run-length-encoded inputs (every 4 ticks) and receive snapshots every 2 ticks (15 Hz, interest-filtered to 420 units around the team). **Client**: `src/net/replica.ts` keeps a local `Sim` that the renderer/HUD/audio use unchanged: your wizard is *predicted* (flight code shared with the server, re-based on every snapshot and replayed over unacknowledged inputs), everything else is *interpolated* ~4 ticks in the past, scalars come straight from the newest snapshot, events are released when their tick is reached. **Rooms**: Create room -> 5-character code + invite link (`?room=CODE`); the guest gets a different element automatically if they picked the same; the host picks chapter and difficulty and starts. **Drop-outs**: the AI flies a disconnected wizard after 3 s and hands it back when the player reconnects with their seat token (45 s idle kick, 60 s grace). **Combos** (`src/sim/combos.ts`, between different elements on the team only): Water bolt through a teammate's Firestorm = Steam Cloud (damage + slow); Air bolt through it = roaming Fire Tornado; Water bolt along a teammate's Stone Wall = chains twice as far. **Difficulty director**: co-op worlds hold 1.6x the hostile creatures (and 1.25x HP), nudged between 0.8x and 1.25x of that every 30 s by how the team's mana share compares with a fair share. Protocol, budgets and abuse protection: `docs/deploy.md`.

## Accessibility (M5c)
Element colours are colour-blind-safe AND each has a distinct icon/shape; faction banners differ in shape and there is an optional colour-blind faction palette. Settings: reduced flashing, text size (3 steps), high contrast, reduced motion. (M1 buttons already differ in shape: round Crater, rounded-square Mound.)

## Rival AI (M3)
Rivals pick a goal every ~0.3 s from candidates scored by personality weights (aggression, greed, defense, hunt, upgrade eagerness) and the chapter's AI level: nearest orbs, mana wells, hostile creatures, nests, enemy wizards, defending their castle, raiding enemy castles (more tempting as the match goes on), returning home to heal or upgrade. They steer and cast through the same `PlayerInput` path as humans. Difficulty scales rival aggression, accuracy, HP and income.

## Chapter 2 city (M3)
`terrain.city` in the chapter JSON defines districts: a noise mask flattens terrain to a plateau and a grid of deterministic buildings (heights, domes, canopies) fills it, leaving alleys. Buildings are part of the shared sim surface so flying and shots respect rooftops.

## Offline (M3)
`public/sw.js` is processed at build time (precache list + content hash). Run `node scripts/test-offline.cjs <url> <playwright path>` against `npm run preview` to verify offline play locally.
