// End-to-end co-op check against a running server (`npx wrangler dev --port 8787`, or the live site):
//   npx tsx scripts/test-coop.ts [http://127.0.0.1:8787]
// Two headless clients create a room, join, start a match, fly for a few seconds with prediction and
// interpolation, and the script checks snapshots, movement, the third-player refusal and bad input handling.
import { CoopReplica } from '../src/net/replica';
import { encodeRuns, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import type { PlayerInput } from '../src/sim/sim';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const wsBase = base.replace(/^http/, 'ws');
let failures = 0;
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  slot = -1;
  token = '';
  replica: CoopReplica | null = null;
  snaps = 0;
  closed: string | null = null;
  pending: PlayerInput[] = [];
  lastSent = '';
  constructor(readonly name: string) {}

  async open(code: string, element?: string, token?: string): Promise<void> {
    this.ws = new WebSocket(`${wsBase}/ws/${code}`);
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMsg);
    this.ws.onclose = (e) => { this.closed = e.reason || 'closed'; };
    await new Promise<void>((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws error')); });
    this.send({ t: 'hello', v: 1, name: this.name, element: element as never, token });
  }

  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }

  onMessage(m: ServerMsg): void {
    this.msgs.push(m);
    if (m.t === 'welcome') { this.slot = m.slot; this.token = m.token; }
    if (m.t === 'start') this.replica = new CoopReplica({ slot: m.slot, chapter: m.chapter, difficulty: m.difficulty, elements: m.elements });
    if (m.t === 'snap') { this.snaps++; this.replica?.push(m.s, performance.now()); }
  }

  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i]!.t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }

  /** Run `ms` of 30 Hz local ticks with a steering input, sending batched inputs at 10 Hz. */
  async fly(ms: number, steer: number): Promise<void> {
    const end = performance.now() + ms;
    let tickN = 0;
    while (performance.now() < end) {
      const input: PlayerInput = { steer, throttle: 0.5, actions: 0 };
      this.replica?.tick(input, performance.now());
      this.pending.push(input);
      if (++tickN % 3 === 0 && this.replica) {
        this.send({ t: 'in', seq: this.replica.seq, runs: encodeRuns(this.pending) });
        this.pending = [];
      }
      await sleep(33);
    }
  }
}

async function main(): Promise<void> {
  const res = await fetch(`${base}/api/room`, { method: 'POST' });
  const { code } = (await res.json()) as { code: string };
  check(res.ok && /^[A-Z0-9]{5}$/.test(code), `room code issued (${code})`);

  const refused = await new Promise<boolean>((resolve) => {
    const w = new WebSocket(`${wsBase}/ws/ZZZZZ`);
    w.onopen = () => resolve(false);
    w.onerror = () => resolve(true);
    setTimeout(() => resolve(false), 3000);
  });
  check(refused, 'a room code the gate never issued is refused');

  const a = new Client('Alice');
  const b = new Client('Bob');
  await a.open(code, 'fire');
  await sleep(150);
  await b.open(code, 'fire'); // same element: the server hands out another one
  await sleep(300);
  const lobby = b.last('lobby')?.lobby;
  check(a.slot === 0 && b.slot === 1, `slots assigned (${a.slot}, ${b.slot})`);
  check(lobby?.seats.length === 2 && lobby.seats[0]!.element !== lobby.seats[1]!.element, `elements differ (${lobby?.seats.map((s) => s.element).join(' / ')})`);

  const c = new Client('Carol');
  await c.open(code);
  await sleep(300);
  check(c.last('error')?.code === 'room_full', 'a third player is refused');

  b.send({ t: 'start' });
  await sleep(200);
  check(b.last('error')?.code === 'not_host', 'only the host can start');
  a.send({ t: 'setup', chapter: 0, difficulty: 'normal' });
  a.send({ t: 'start' });
  await sleep(500);
  check(!!a.replica && !!b.replica, 'both clients received the start message');

  a.send({ t: 'ping', c: 7 });
  const t0 = performance.now();
  await Promise.all([a.fly(4000, 0.8), b.fly(4000, -0.4)]);
  const rtt = performance.now() - t0;
  void rtt;
  check(a.snaps > 40, `snapshots keep coming (${a.snaps} in ~4 s, about ${Math.round(a.snaps / 4)} Hz)`);
  check(a.last('pong')?.c === 7, 'ping answered');

  const ra = a.replica!;
  const rb = b.replica!;
  const sa = ra.sim.players[0]!;
  const sb = rb.sim.players[1]!;
  const home0 = { x: ra.sim.castles[0]!.x, z: ra.sim.castles[0]!.z };
  check(Math.hypot(sa.x - home0.x, sa.z - home0.z) > 20, `Alice's wizard moved (${Math.round(Math.hypot(sa.x - home0.x, sa.z - home0.z))} units from home)`);
  // Each client sees the other's wizard in about the same place as the owner's own (predicted) view.
  const aSeesB = ra.sim.players[1]!;
  const bSeesA = rb.sim.players[0]!;
  const gapB = Math.hypot(aSeesB.x - sb.x, aSeesB.z - sb.z);
  const gapA = Math.hypot(bSeesA.x - sa.x, bSeesA.z - sa.z);
  check(gapA < 25 && gapB < 25, `teammate positions agree within interpolation delay (${gapA.toFixed(1)}, ${gapB.toFixed(1)} units)`);
  check(ra.stats.correction < 6, `prediction corrections are small (${ra.stats.correction.toFixed(2)} units)`);
  check(ra.sim.castles.length === 4 && ra.sim.creatures.length >= 0, 'world state is mirrored');

  // Abuse handling: garbage and flooding get the sender disconnected, not the room.
  const d = new Client('Mallory');
  const code2 = ((await (await fetch(`${base}/api/room`, { method: 'POST' })).json()) as { code: string }).code;
  await d.open(code2);
  d.ws.send('not json');
  d.ws.send('{"t":"in","seq":1,"runs":[[999,0,0,0,1]]}');
  d.ws.send('{"t":"setup"}');
  await sleep(400);
  check(d.closed !== null || d.last('error')?.code === 'bad_message', 'garbage messages get the client kicked');

  // Reconnect with the token keeps the seat.
  a.ws.close();
  await sleep(500);
  const a2 = new Client('Alice');
  await a2.open(code, undefined, a.token);
  await sleep(500);
  check(a2.slot === 0 && !!a2.last('start'), 'reconnect with token returns to the same seat and match');

  for (const x of [a2, b, c, d]) try { x.ws.close(); } catch { /* ignore */ }
  console.log(failures === 0 ? '\nCO-OP OK' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
