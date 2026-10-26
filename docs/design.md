# Design

Full design for **Flying Tapestries of Arabia**. (CLAUDE.md holds only rules; this is the long form.)

## Pitch
Fly a woven tapestry over deformable open-world terrain in a golden-hour Arabian fantasy. Gather mana from creatures, structures and orbs; spend it on castle upgrades and spells; beat rival wizards to a chapter's target share of the world's mana (or be the last castle standing). Solo, or online 2-player doubles co-op.

## Core loop
Fly -> kill creatures / destroy enemy structures / absorb orbs -> mana -> upgrade castle (archers, walls, income) and cast spells -> capture the target mana share. The castle is base and respawn point.

## Flight (M1, implemented)
Momentum flight: steer (turn rate with inertia, slower when fast), throttle (brake <- cruise -> boost), velocity chases heading with limited grip (drift), a spring holds altitude above the highest nearby ground (look-ahead) plus boost lift. Hard clearance floor. Data: `src/data/flight.json`.

## Terrain (M1, implemented)
Pure function `baseHeight(params, x, z)` (domain-warped ridged dunes + swell + detail + oasis basins) plus a capped list of deltas (bump / crater). 64-unit chunks, three LODs with skirts, props merged into chunk geometry, baked vertex lighting. Params per chapter in `chapters/chapterN.json`. Delta policy: cap 256, merge-nearest-old compaction, monotonic ids, `compactionEpoch` for renderers.

## Match rules
- Target mana share per chapter (lower with more rivals), 10-15 min matches.
- Comeback: from `comeback.startMinute` trailing castles get an income bonus; at `suddenDeathMinute` the target share drops to `suddenDeathShare`.
- Difficulty Easy/Normal/Hard scales rival aggression, enemy health, mana income.

## Castle tiers and archers (M3)
~5 tiers in one table; visible growth, instanced archers with LOD, branches at certain tiers (more archers / tougher walls / faster mana). Archers target creatures and incoming rival projectiles, never the player. A destroyed castle drops a tier (unless last standing). Rivals use the same table.

## Wizards (M4)
Fire (burst + burn), Water (chain, freeze, slow), Earth (walls, quakes, structures), Air (fast long-range lightning, mobility). One spell table; a balance script keeps DPS/efficiency within 5% of budget and AI-vs-AI win rates within 10%.

## Chapters
1 Oasis Dawn (1 rival) | 2 Rooftops of the Spice Bazaar (1) | 3 Canyons of Rose Stone (2) | 4 Pearl Harbour by Moonlight (2) | 5 The Sunken Sand City (3) | 6 The Sultan's Sky Palace (3). Rival elements: those the player(s) did not choose first; extras duplicate.

## Music and audio (M2+)
Procedural Web Audio: oud-like pluck, ney-like flute, darbuka, drone. Maqam scales (Hijaz, Bayati, Nahawand), maqsum/saidi/baladi rhythms. Adaptive calm/combat layers; synthesized per-element SFX; OGG drop-in per chapter.

## Controls
Left floating stick (or optional tilt) steers/throttles; right-side buttons cast; separate pause button; left-handed mirror; landscape lock, fullscreen on first tap, wake lock, safe areas, haptics.

## Co-op (M6)
One Durable Object per match, WebSocket, authoritative sim at 30 Hz, snapshots 15-20 Hz, interpolation + local prediction. Room code + link; reject third player; combos (Water+Fire steam, Air+Fire fire tornado, Earth walls channel Water); difficulty director (~1.6x). Abuse protection and free-plan budget in the M6 report.

## Accessibility
Element colours are colour-blind-safe AND each has a distinct icon/shape; reduced-flashing option; readable text sizes. (M1 buttons already differ in shape: round Crater, rounded-square Mound.)
