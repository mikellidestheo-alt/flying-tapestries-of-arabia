# Deploying to Cloudflare (Workers Builds, free plan)

One Cloudflare **Worker with static assets** serves the game. Cloudflare's built-in Git integration ("Workers Builds") builds and deploys on every push to `main`. No GitHub Actions, no API tokens.

## One-time setup (Cloudflare dashboard)
1. Sign in at https://dash.cloudflare.com (free account is fine).
2. Left menu: **Workers & Pages** -> **Create application** -> **Import a repository** (the "Connect to Git" option on the Workers tab).
3. Connect your GitHub account when asked, choose **only** the repository `flying-tapestries-of-arabia` (you can limit access to this single repo), then **Next**.
4. Settings screen:
   - **Project / Worker name:** `flying-tapestries-of-arabia` (must match `name` in `wrangler.jsonc`).
   - **Production branch:** `main`.
   - **Root directory:** `/` (leave default).
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (the default).
   - Leave "Non-production branch deploy command" as the default (`npx wrangler versions upload`).
   - No environment variables are needed.
5. Click **Save and Deploy**. The first build takes about a minute.
6. Open the project -> **Settings -> Domains & Routes** (or the project overview) to see the live URL. It has the form `https://flying-tapestries-of-arabia.<your-account-subdomain>.workers.dev`.

## Day to day
Push to `main` -> Cloudflare builds and deploys automatically. Build logs: project -> **Deployments / Builds**.

## Co-op backend (M6)
`wrangler.jsonc` now has `main: server/index.ts`, two SQLite-backed Durable Objects (`MatchRoom`, `Gate`, migration `v1` with `new_sqlite_classes`, free plan) and `assets.run_worker_first: ["/api/*", "/ws/*"]`. The same Cloudflare Git integration deploys it: no new settings, no secrets, no API tokens. Static files and solo play never invoke the Worker.

- **Local development:** terminal 1 `npm run dev:server` (wrangler dev on port 8787), terminal 2 `npm run dev` (Vite proxies `/api` and `/ws`). Open the game twice (two browser profiles or a phone on the same Wi-Fi at `http://<computer-ip>:5173`), tap Co-op, create a room, join with the code.
- **Check the server end to end:** `npm run test:coop` against `dev:server` (or `npx tsx scripts/test-coop.ts https://<your-worker>.workers.dev` against the live site).
- **After changing `wrangler.jsonc`:** `npx wrangler types server/worker-configuration.d.ts` (the generated file is checked in so typecheck needs no network).
- **First deploy after M6:** Workers Builds runs `npx wrangler deploy`, which also creates the Durable Object classes from the migration. Nothing to click.

## Free-plan budget (checked in M6 against Cloudflare's current docs)
| Limit (free plan, per day, resets 00:00 UTC) | Value | How co-op stays inside it |
|---|---|---|
| Durable Object requests (HTTP, RPC, **incoming WebSocket messages**, alarms) | 100,000 | Each player sends one tiny run-length-encoded input message every 4 ticks (7.5/s). The Gate counts every message (conservatively 1 each; docs mention a 20:1 ratio for WebSocket messages that I could not confirm: set `gate.messageWeight` in `src/data/net.json` to 0.05 once the dashboard confirms it). New rooms stop at 70,000 counted messages, running rooms are wound down at 90,000. |
| Durable Object duration | 13,000 GB-s (128 MB per object) | A running match is about 0.125 GB x seconds: a 12 minute match is about 90 GB-s, so over 140 matches/day. Lobbies use the hibernation API. Matches are capped at 30 minutes, lobbies at 10, idle players are dropped after 45 s. |
| SQLite rows written / read | 100,000 / 5,000,000 | Only the tiny Gate state (and a lobby record) are stored: a handful of writes per match. |
| Worker requests | 100,000 | Only `/api/*` and `/ws/*` reach the Worker: a few per match. Static files are free. |
| CPU | 10 ms per HTTP request; DO 30 s per message | A sim tick costs 0.3-0.7 ms; the 30 Hz loop uses about 2% of a core. |
Bandwidth is not metered; snapshots average about 5-6 KB at 15 Hz (about 85 KB/s down per player, 0.7 Mbit/s).

## Abuse protection (the live URL is public)
- Room codes come only from the Gate (5 characters from an unambiguous alphabet, 7,200 s lifetime). A WebSocket for a code the Gate did not issue is refused before any room object exists.
- `POST /api/room` is limited to 6 rooms per hour per IP (hashed with SHA-256, never stored raw) and 80 rooms per day for the whole site; both refuse politely.
- Same-origin check on `/api/room` and `/ws/*` (browsers cannot be driven from another website).
- Every client message is parsed strictly (size <= 2 KB, ranges, enums); 3 bad messages or more than 30 messages per second get the sender kicked. Two players per room, a third is refused; a started match refuses strangers (only the seat's token can reconnect).
- Time limits everywhere: hello within 10 s, lobby 10 min, match 30 min, idle 45 s.
- No accounts, no personal data, no secrets anywhere in the repo.

## Things that would cost money (we avoid them)
Everything above is on the free plan. If the daily budget is ever too small for your friends, the options are Workers Paid ($5/month, 1M+ requests) or raising `messageWeight` accuracy once the real billing ratio is confirmed; neither is done without asking.
