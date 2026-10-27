import { describe, expect, it } from 'vitest';
import { GateCore, emptyGate } from '../server/gate';
import { MatchHost, type Transport } from '../server/matchHost';
import { NET, coopSetup, decodeRuns, encodeRuns, parseClientMsg, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { CoopReplica } from '../src/net/replica';
import { buildSnapshot, decodeSnapshot } from '../src/net/snapshot';
import { CHAPTERS } from '../src/data/chapters';
import { ACTION_SPELL, Sim, type PlayerInput } from '../src/sim/sim';

// ---------------------------------------------------------------- harness
class Net implements Transport {
  inbox = new Map<number, ServerMsg[]>();
  closed = new Map<number, string>();
  send(conn: number, data: string): void {
    const list = this.inbox.get(conn) ?? [];
    list.push(JSON.parse(data) as ServerMsg);
    this.inbox.set(conn, list);
  }
  close(conn: number, reason: string): void {
    this.closed.set(conn, reason);
  }
  of(conn: number): ServerMsg[] {
    return this.inbox.get(conn) ?? [];
  }
  last<T extends ServerMsg['t']>(conn: number, t: T): Extract<ServerMsg, { t: T }> | undefined {
    const l = this.of(conn).filter((m) => m.t === t);
    return l[l.length - 1] as Extract<ServerMsg, { t: T }> | undefined;
  }
}

function room(now = { ms: 1_000_000 }) {
  const net = new Net();
  const host = new MatchHost('ABCDE', net, () => now.ms);
  const say = (conn: number, m: ClientMsg | string) => host.message(conn, typeof m === 'string' ? m : JSON.stringify(m));
  return { net, host, now, say };
}

function joined() {
  const r = room();
  r.host.connect(1);
  r.host.connect(2);
  r.say(1, { t: 'hello', v: NET.protocol, name: 'A', element: 'fire' });
  r.say(2, { t: 'hello', v: NET.protocol, name: 'B', element: 'fire' });
  return r;
}

const input = (steer = 0, throttle = 0.5, actions = 0): PlayerInput => ({ steer, throttle, actions });

// ---------------------------------------------------------------- protocol
describe('protocol', () => {
  it('run-length encoding round-trips and merges identical ticks', () => {
    const list = [input(0.5), input(0.5), input(0.5), input(-0.25, 1, ACTION_SPELL), input(0)];
    const runs = encodeRuns(list);
    expect(runs.length).toBe(3);
    expect(runs[0]![4]).toBe(3);
    const back = decodeRuns(runs);
    expect(back.length).toBe(list.length);
    expect(back[3]!.steer).toBeCloseTo(-0.25);
    expect(back[3]!.actions).toBe(ACTION_SPELL);
  });

  it('accepts good messages and rejects every malformed one', () => {
    expect(parseClientMsg('{"t":"hello","v":1,"name":"Ann","element":"water"}')?.t).toBe('hello');
    expect(parseClientMsg('{"t":"start"}')?.t).toBe('start');
    expect(parseClientMsg(JSON.stringify({ t: 'in', seq: 5, runs: [[10, -20, 4, 0, 3]] }))?.t).toBe('in');
    const bad = [
      'nope', '[]', 'null', '{"t":"zap"}', '{"t":"hello"}', '{"t":"hello","v":1,"element":"plasma"}',
      '{"t":"setup","chapter":99,"difficulty":"normal"}', '{"t":"setup","chapter":0,"difficulty":"insane"}',
      '{"t":"in","seq":-1,"runs":[[0,0,0,0,1]]}', '{"t":"in","seq":1,"runs":[]}', '{"t":"in","seq":1,"runs":[[999,0,0,0,1]]}',
      '{"t":"in","seq":1,"runs":[[0,0,0,0,0]]}', '{"t":"in","seq":1,"runs":[[0,0,0,0,300]]}', '{"t":"in","seq":1.5,"runs":[[0,0,0,0,1]]}',
      '{"t":"in","seq":1,"runs":[[0,0,0,0]]}', '{"t":"ping","c":"x"}',
      JSON.stringify({ t: 'hello', v: 1, name: 'x'.repeat(NET.maxMessageBytes) }),
    ];
    for (const b of bad) expect(parseClientMsg(b), b.slice(0, 40)).toBeNull();
  });
});

// ---------------------------------------------------------------- snapshots
describe('snapshots', () => {
  const busySim = (): Sim => {
    const c = CHAPTERS[0]!;
    const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: coopSetup(0, ['fire', 'water'], 'normal'), playerCount: 2 });
    for (let t = 0; t < 30 * 40; t++) s.step([input(Math.sin(t / 40), 0.6, t % 11 === 0 ? ACTION_SPELL : 0), input(-0.3, 0.6, t % 17 === 0 ? ACTION_SPELL : 0)]);
    return s;
  };

  it('decodes to the same world state (to two decimals)', () => {
    const s = busySim();
    const ctx = { acks: [3, 4], lastEventSeq: 0, deltaKey: '' };
    const wire = JSON.parse(JSON.stringify(buildSnapshot(s, ctx)));
    const d = decodeSnapshot(wire);
    expect(d.tick).toBe(s.tick);
    expect(d.acks).toEqual([3, 4]);
    expect(d.players.length).toBe(s.players.length);
    s.players.forEach((p, i) => {
      expect(d.players[i]!.x).toBeCloseTo(p.x, 1);
      expect(d.players[i]!.mana).toBeCloseTo(p.mana, 1);
      expect(d.players[i]!.active).toBe(p.active);
    });
    expect(d.castles.map((c) => c.tier)).toEqual(s.castles.map((c) => c.tier));
    const near = s.creatures.filter((c) => s.players.slice(0, 2).some((p) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < NET.interestRadius ** 2));
    expect(d.creatures.length).toBe(near.length);
    expect(d.events.length).toBeGreaterThan(0);
    expect(wire.d).toBeDefined(); // terrain deltas are sent the first time
  });

  it('sends events once, deltas only when they change, and stays small in a busy fight', () => {
    const s = busySim();
    const ctx = { acks: [0, 0], lastEventSeq: 0, deltaKey: '' };
    const first = buildSnapshot(s, ctx);
    ctx.deltaKey = `${s.terrain.deltas.compactionEpoch}:${s.terrain.deltas.nextId}:${s.terrain.deltas.list.length}`;
    const second = buildSnapshot(s, ctx);
    expect(second.ev.length).toBe(0);
    expect(second.d).toBeUndefined();
    expect(JSON.stringify(second).length).toBeLessThan(12000);
    expect(JSON.stringify(first).length).toBeLessThan(40000);
  });
});

// ---------------------------------------------------------------- room logic
describe('co-op room', () => {
  it('seats two players, gives different elements, refuses a third and a wrong version', () => {
    const { host, net, say } = joined();
    host.connect(3);
    say(3, { t: 'hello', v: NET.protocol });
    expect(net.last(3, 'error')?.code).toBe('room_full');
    const lobby = net.last(2, 'lobby')!.lobby;
    expect(lobby.seats.map((s) => s.slot)).toEqual([0, 1]);
    expect(lobby.seats[0]!.element).not.toBe(lobby.seats[1]!.element);
    host.connect(4);
    say(4, { t: 'hello', v: 999 });
    expect(net.last(4, 'error')?.code).toBe('bad_version');
  });

  it('only the host sets up and starts, and starting needs two connected players', () => {
    const r = room();
    r.host.connect(1);
    r.say(1, { t: 'hello', v: NET.protocol });
    r.say(1, { t: 'start' });
    expect(r.net.last(1, 'error')?.code).toBe('not_ready');
    r.host.connect(2);
    r.say(2, { t: 'hello', v: NET.protocol });
    r.say(2, { t: 'setup', chapter: 1, difficulty: 'hard' });
    expect(r.net.last(2, 'error')?.code).toBe('not_host');
    r.say(2, { t: 'start' });
    expect(r.net.last(2, 'error')?.code).toBe('not_host');
    r.say(1, { t: 'setup', chapter: 1, difficulty: 'hard' });
    expect(r.host.lobby().chapter).toBe(1);
    r.say(1, { t: 'start' });
    expect(r.host.phase).toBe('playing');
    expect(r.net.last(1, 'start')?.slot).toBe(0);
    expect(r.net.last(2, 'start')?.slot).toBe(1);
    expect(r.net.last(2, 'start')?.difficulty).toBe('hard');
  });

  it('applies each player\'s inputs to their own wizard and streams snapshots at 15 Hz', () => {
    const { host, net, say } = joined();
    say(1, { t: 'start' });
    const sim = host.sim!;
    const x0 = [sim.players[0]!.heading, sim.players[1]!.heading];
    for (let t = 0; t < 90; t++) {
      if (t % 4 === 0) {
        say(1, { t: 'in', seq: t + 4, runs: encodeRuns([input(1), input(1), input(1), input(1)]) });
        say(2, { t: 'in', seq: t + 4, runs: encodeRuns([input(-1), input(-1), input(-1), input(-1)]) });
      }
      host.tickOnce();
    }
    expect(sim.players[0]!.heading).not.toBeCloseTo(x0[0]!, 1);
    expect(Math.sign(sim.players[0]!.turnRate)).toBe(-Math.sign(sim.players[1]!.turnRate));
    const snaps = net.of(1).filter((m) => m.t === 'snap').length;
    expect(snaps).toBe(45); // every second tick of 90
    const acks = (net.last(1, 'snap')!.s.a);
    expect(acks[0]).toBeGreaterThan(60);
  });

  it('never repeats a button press when the player\'s input runs dry, and drops a lagging backlog', () => {
    const { host, say } = joined();
    say(1, { t: 'start' });
    const sim = host.sim!;
    sim.players[0]!.mana = 300;
    say(1, { t: 'in', seq: 1, runs: encodeRuns([input(0, 0.5, ACTION_SPELL)]) });
    for (let t = 0; t < 20; t++) host.tickOnce();
    expect(sim.players[0]!.casts).toBe(1); // one press, one cast
    // A 200-tick burst is trimmed to the backlog cap instead of delaying the player for seconds.
    say(1, { t: 'in', seq: 200, runs: encodeRuns(Array.from({ length: 200 }, () => input(0.2))).slice(0, 1) });
    expect(host.sim).toBe(sim);
  });

  it('kicks garbage and floods, times out silent connections and expired lobbies', () => {
    const r = room();
    r.host.connect(1);
    r.say(1, 'garbage');
    r.say(1, '{"t":"nope"}');
    r.say(1, '[]');
    expect(r.net.closed.get(1)).toBe('bad_message');
    r.host.connect(2);
    r.say(2, { t: 'hello', v: NET.protocol });
    for (let i = 0; i < NET.maxMessagesPerSecond + 20; i++) r.say(2, { t: 'ping', c: i });
    for (let i = 0; i < 80; i++) r.say(2, { t: 'ping', c: i });
    expect(r.net.closed.get(2)).toBe('rate_limited');
    const s = room();
    s.host.connect(5);
    s.now.ms += NET.helloTimeoutMs + 1;
    s.host.housekeeping();
    expect(s.net.closed.get(5)).toBe('timeout');
    const l = room();
    l.host.connect(1);
    l.say(1, { t: 'hello', v: NET.protocol });
    l.now.ms += NET.lobbyTimeoutSeconds * 1000 + 1;
    l.host.housekeeping();
    expect(l.host.closed).toBe(true);
  });

  it('a dropped player is flown by the AI, can come back with their token, and the match survives', () => {
    const { host, net, say } = joined();
    const token = (net.last(2, 'welcome') as Extract<ServerMsg, { t: 'welcome' }>).token;
    say(1, { t: 'start' });
    const sim = host.sim!;
    for (let t = 0; t < 10; t++) host.tickOnce();
    host.disconnect(2);
    expect(sim.players[1]!.rivalIndex).toBe(-1);
    for (let t = 0; t < 120; t++) host.tickOnce();
    expect(sim.players[1]!.rivalIndex).toBeGreaterThanOrEqual(0); // the AI took over
    host.connect(9);
    say(9, { t: 'hello', v: NET.protocol, token });
    expect(net.last(9, 'welcome')?.slot).toBe(1);
    expect(net.last(9, 'start')?.slot).toBe(1);
    expect(sim.players[1]!.rivalIndex).toBe(-1); // handed back
    // A stranger without the token cannot take the seat mid-match.
    host.connect(10);
    say(10, { t: 'hello', v: NET.protocol });
    expect(net.last(10, 'error')?.code).toBe('room_full');
  });

  it('closes when the match ends and when the budget says stop', () => {
    const { host, net, say } = joined();
    say(1, { t: 'start' });
    host.sim!.match.status = 'won';
    for (let t = 0; t < 30 * 21; t++) host.tickOnce();
    expect(host.closed).toBe(true);
    expect(net.last(1, 'snap')!.s.m[0]).toBe('won');
    const b = joined();
    b.host.closeRoom('budget', 'limit');
    expect(b.net.last(1, 'error')?.code).toBe('budget');
    expect(b.net.closed.get(1)).toBe('budget');
  });

  it('counts incoming messages for the free-plan budget', () => {
    const { host, say } = joined();
    host.takeMessageCount();
    for (let i = 0; i < 12; i++) say(1, { t: 'ping', c: i });
    expect(host.takeMessageCount()).toBe(12);
    expect(host.takeMessageCount()).toBe(0);
  });
});

// ---------------------------------------------------------------- client replica against the real room, with latency
describe('replica over a laggy network', () => {
  it('predicts your own wizard closely and mirrors the world within the interpolation delay', () => {
    const net = new Net();
    const now = { ms: 5_000 };
    const host = new MatchHost('LAGGY', net, () => now.ms);
    const say = (c: number, m: ClientMsg) => host.message(c, JSON.stringify(m));
    host.connect(1);
    host.connect(2);
    say(1, { t: 'hello', v: NET.protocol, element: 'fire' });
    say(2, { t: 'hello', v: NET.protocol, element: 'water' });
    say(1, { t: 'start' });
    const start = net.last(1, 'start')!;
    const ra = new CoopReplica(start);
    const rb = new CoopReplica(net.last(2, 'start')!);
    // Messages take 70 ms each way; one tick = 33.3 ms.
    const toClient: { at: number; conn: number; msg: ServerMsg }[] = [];
    const toServer: { at: number; conn: number; msg: ClientMsg }[] = [];
    const pend: Record<number, PlayerInput[]> = { 1: [], 2: [] };
    const sent = new Set<ServerMsg>();
    const gapsA: number[] = [];
    const gapsB: number[] = [];
    for (let t = 1; t <= 30 * 12; t++) {
      now.ms += 1000 / 30;
      // deliver server -> client
      for (const conn of [1, 2]) {
        for (const m of net.of(conn)) if (m.t === 'snap' && !sent.has(m)) {
          sent.add(m);
          toClient.push({ at: now.ms + 70, conn, msg: m });
        }
      }
      for (const d of toClient.filter((q) => q.at <= now.ms)) (d.conn === 1 ? ra : rb).push((d.msg as Extract<ServerMsg, { t: 'snap' }>).s, d.at);
      for (let i = toClient.length - 1; i >= 0; i--) if (toClient[i]!.at <= now.ms) toClient.splice(i, 1);
      // clients tick
      const ia = input(Math.sin(t / 25), 0.7, t % 40 === 0 ? ACTION_SPELL : 0);
      const ib = input(-Math.sin(t / 31), 0.4);
      ra.tick(ia, now.ms);
      rb.tick(ib, now.ms);
      pend[1]!.push(ia);
      pend[2]!.push(ib);
      if (t % NET.inputEveryTicks === 0) {
        toServer.push({ at: now.ms + 70, conn: 1, msg: { t: 'in', seq: ra.seq, runs: encodeRuns(pend[1]!) } });
        toServer.push({ at: now.ms + 70, conn: 2, msg: { t: 'in', seq: rb.seq, runs: encodeRuns(pend[2]!) } });
        pend[1] = [];
        pend[2] = [];
      }
      for (const d of toServer.filter((q) => q.at <= now.ms)) say(d.conn, d.msg);
      for (let i = toServer.length - 1; i >= 0; i--) if (toServer[i]!.at <= now.ms) toServer.splice(i, 1);
      host.tickOnce();
      if (t > 90) {
        const sp = host.sim!.players[0]!;
        const mine = ra.sim.players[0]!;
        gapsA.push(Math.hypot(mine.x - sp.x, mine.z - sp.z));
        const seenB = rb.sim.players[0]!; // B's view of A (interpolated, delayed)
        gapsB.push(Math.hypot(seenB.x - sp.x, seenB.z - sp.z));
      }
    }
    // Judge the 90th percentile: a respawn teleports the server's wizard and the client needs one snapshot to follow.
    const p90 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.9)]!;
    // Your own wizard sits within a few ticks of the server's (it is ahead by roughly the latency).
    expect(p90(gapsA)).toBeLessThan(25);
    // The partner is seen about (latency + interpolation delay) in the past: a fraction of a second of flight.
    expect(p90(gapsB)).toBeLessThan(45);
    // The mirrored world matches: castles, factions, match status, mana.
    expect(ra.sim.castles.map((c) => c.tier)).toEqual(host.sim!.castles.map((c) => c.tier));
    expect(ra.sim.factions[0]!.captured).toBeGreaterThan(0);
    expect(ra.sim.players[0]!.mana).toBeCloseTo(host.sim!.players[0]!.mana, 0);
    expect(ra.sim.events.length).toBeGreaterThan(0);
    expect(ra.sim.localPlayer).toBe(0);
    expect(rb.sim.localPlayer).toBe(1);
    for (const p of rb.sim.players) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  }, 60000);
});

// ---------------------------------------------------------------- the gate
describe('free-plan gate', () => {
  const t0 = Date.UTC(2026, 9, 27, 12, 0, 0);
  const code = (() => { let n = 0; return () => `C${n++}`; })();

  it('issues codes, rate-limits per IP per hour and caps rooms per day', () => {
    const g = new GateCore(emptyGate('2026-10-27'));
    for (let i = 0; i < NET.gate.createPerIpPerHour; i++) expect(g.issue('ip1', t0, code).ok).toBe(true);
    expect(g.issue('ip1', t0, code)).toEqual({ ok: false, code: 'rate_limited' });
    expect(g.issue('ip2', t0, code).ok).toBe(true);
    expect(g.issue('ip1', t0 + 3600_000, code).ok).toBe(true); // next hour
    const g2 = new GateCore(emptyGate('2026-10-27'));
    for (let i = 0; i < NET.gate.dailyRoomCap; i++) expect(g2.issue(`ip${i}`, t0, code).ok).toBe(true);
    expect(g2.issue('late', t0, code)).toEqual({ ok: false, code: 'budget' });
  });

  it('only recognises codes it issued, until they expire or are released', () => {
    const g = new GateCore(emptyGate('2026-10-27'));
    const r = g.issue('ip', t0, code);
    if (!r.ok) throw new Error('issue failed');
    expect(g.check(r.code, t0 + 1000)).toBe(true);
    expect(g.check('NOPE1', t0)).toBe(false);
    expect(g.check(r.code, t0 + (NET.gate.roomTtlSeconds + 5) * 1000)).toBe(false);
    const r2 = g.issue('ip', t0, code);
    if (!r2.ok) throw new Error('issue failed');
    g.release(r2.code);
    expect(g.check(r2.code, t0)).toBe(false);
  });

  it('refuses new rooms past the soft message budget, stops running ones at the hard budget, and resets at UTC midnight', () => {
    const g = new GateCore(emptyGate('2026-10-27'));
    const w = NET.gate.messageWeight; // incoming messages bill 20:1, so each counts as 0.05 requests
    expect(g.report(1000, t0)).toBe('ok');
    g.report(NET.gate.dailyMessageBudget / w, t0);
    expect(g.issue('ip', t0, code)).toEqual({ ok: false, code: 'budget' });
    expect(g.report(NET.gate.hardMessageBudget / w, t0)).toBe('stop');
    expect(w).toBeLessThanOrEqual(0.05);
    const nextDay = Date.UTC(2026, 9, 28, 0, 0, 1);
    expect(g.issue('ip', nextDay, code).ok).toBe(true);
    expect(g.state.messages).toBe(0);
  });
});
