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

## Things that would cost money (we avoid them)
Nothing in M1 needs a paid plan. Static asset requests are free and unlimited. The co-op Durable Object (M6) uses the free SQLite-backed Durable Objects; limits are checked and reported before M6 is built.
