# Flying Tapestries of Arabia

A modern 3D open-world flying and spellcasting game for Android phones, inspired by the classic magic-carpet genre. Fly a woven tapestry over golden dunes and oases, gather mana, grow a sandstone castle and duel rival wizards. All art, names and music are original and generated procedurally.

> **Status:** early development. Milestone 3 is playable: two chapters, castles with archers, rival wizards, offline play. See [docs/milestones.md](docs/milestones.md).

## How to play (current build)
- **Goal:** capture the chapter's target share of all the mana (shown on the bar at the top) before the rival wizard does, or knock out every rival castle. Matches run about 10-14 minutes.
- **Left thumb**: touch and drag anywhere on the left half. Left/right steers, up boosts, down brakes. Let go to cruise.
- **Flame button** (right): throw a Fireball. It auto-aims a little at nearby targets.
- **Gather mana**: fly into blue orbs, hover beside a glowing **mana well**, hunt wild **oryx**, destroy sprite **nests**, defeat creatures.
- **Upgrade button** (appears near your castle): spend mana to grow your castle: more archers, stronger walls, more income. Your own mana pool holds at most 200, so for the bigger upgrades hold **Deposit** near the castle to move mana into the castle bank (the bank can hold 900 and also fills slowly by itself).
- **Pause** (top corner): settings (graphics quality, battery saver, left-handed layout, tilt steering, volume, difficulty lives in the chapter menu).
- Desktop (dev only): WASD/arrows to fly, Space fireball, U upgrade.

Best played on an Android phone in Chrome, landscape. Works offline after the first load.

## Run locally
```bash
npm install
npm run dev        # dev server (also reachable from your phone on the same Wi-Fi)
npm run check      # typecheck + lint + tests + production build
npm run size       # bundle size report (after a build)
```

## Tech
Three.js + TypeScript + Vite. A deterministic fixed-step simulation (`src/sim`) is kept strictly apart from rendering (`src/render`) so the same code can later run inside a Cloudflare Durable Object for online co-op. Hosted on Cloudflare Workers (static assets). See [CLAUDE.md](CLAUDE.md) for conventions and [docs/design.md](docs/design.md) for the full design.

## Credits
- Built with [Claude Code](https://claude.com/claude-code).
- [Three.js](https://threejs.org/) (MIT) for 3D rendering, [Vite](https://vitejs.dev/) (MIT), [Vitest](https://vitest.dev/) (MIT).
- No third-party art, audio or fonts are used; everything is generated in code.

## License
[MIT](LICENSE)
