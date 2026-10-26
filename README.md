# Flying Tapestries of Arabia

A modern 3D open-world flying and spellcasting game for Android phones, inspired by the classic magic-carpet genre. Fly a woven tapestry over golden dunes and oases, gather mana, grow a sandstone castle and duel rival wizards. All art, names and music are original and generated procedurally.

> **Status:** early development. Milestone 1 (flight over deformable procedural terrain) is playable. See [docs/milestones.md](docs/milestones.md).

## How to play (current build)
- **Left thumb**: touch and drag anywhere on the left half of the screen. Left/right steers, up boosts, down brakes. Let go to cruise.
- **Right buttons**: *Crater* digs a bowl in the ground ahead, *Mound* raises a hill. (Stand-ins for the earth spells coming in later milestones.)
- **Pause** (top corner) opens settings: graphics quality, battery saver (30 fps), left-handed layout, tilt steering, vibration, debug overlay.
- Desktop (dev only): WASD/arrows to fly, `C` crater, `V` mound.

Best played on an Android phone in Chrome, landscape.

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
