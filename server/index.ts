// Worker entry. Static files (the game itself) never reach this code: they come straight from the asset
// store. Only /api/* and /ws/* run it (see wrangler.jsonc `run_worker_first`).
//   POST /api/room   -> { code }   asks the Gate for a new room code (rate limited, budgeted)
//   GET  /ws/:code   -> WebSocket  to that room's Durable Object (only for codes the Gate issued)
export { MatchRoom } from './room';
export { Gate } from './gateObject';
import { NET } from '../src/net/protocol';

const CODE_RE = new RegExp(`^[${NET.roomCodeAlphabet}]{${NET.roomCodeLength}}$`);

function json(body: unknown, status = 200, request?: Request): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  // The downloadable single-file game is opened from the device (Origin "null"): let it read the answer.
  if (request?.headers.get('Origin') === 'null') headers['access-control-allow-origin'] = 'null';
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Same-origin only: another website must not be able to drive our rooms from a visitor's browser.
 * Exception: the downloadable single-file game (a local file) sends Origin "null"; it is allowed, and the same rate
 * limits, room codes and budgets apply to it as to everyone else.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return true; // non-browser clients (tests, curl) send none
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function ipHash(request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fta:${ip}`));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const gate = env.GATE.get(env.GATE.idFromName('gate'));

    if (url.pathname === '/api/room' && request.method === 'POST') {
      if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403, request);
      const res = await gate.fetch('https://gate/issue', { method: 'POST', body: JSON.stringify({ ip: await ipHash(request) }) });
      const body = (await res.json()) as { ok: boolean; code: string };
      return json(body.ok ? { code: body.code } : { error: body.code }, body.ok ? 200 : body.code === 'rate_limited' ? 429 : 503, request);
    }

    if (url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
      const code = url.pathname.slice(4).toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
      const ok = await gate.fetch('https://gate/check', { method: 'POST', body: JSON.stringify({ code }) });
      if (!((await ok.json()) as { ok: boolean }).ok) return json({ error: 'no_such_room' }, 404);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }

    if (url.pathname === '/api/health') return json({ ok: true });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
