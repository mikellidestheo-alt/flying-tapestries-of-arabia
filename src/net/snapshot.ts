// Snapshot encoding (server) and decoding (client). Everything is plain numbers/strings in positional
// arrays, rounded to 2 decimals, so a snapshot of a busy fight stays a few KB. Layouts are defined once
// here as key lists and used for both directions, so they cannot drift apart.
import type { Castle, Creature, Orb, Projectile, SimEvent, SimEventType, Structure, Well, Zone } from '../sim/entities';
import type { PlayerState, Sim } from '../sim/sim';
import type { TerrainDelta } from '../sim/deltas';
import type { SnapshotWire } from './protocol';
import { NET } from './protocol';

const q = (v: number): number => Math.round(v * 100) / 100;

type Rec = Record<string, unknown>;

/** Copy `keys` of `o` into a positional array (numbers rounded, booleans as 0/1). */
function pack(o: object, keys: readonly string[]): number[] {
  const r = o as Rec;
  return keys.map((k) => {
    const v = r[k];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return typeof v === 'number' ? q(v) : 0;
  });
}

function unpack(target: object, keys: readonly string[], arr: readonly (number | string)[], offset: number, bools: readonly string[] = []): void {
  const t = target as Rec;
  keys.forEach((k, i) => {
    const v = arr[offset + i] as number;
    t[k] = bools.includes(k) ? v === 1 : v;
  });
}

const PLAYER = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'heading', 'speed', 'turnRate', 'hp', 'mana', 'spellCd', 'invuln', 'kills', 'deaths', 'casts', 'drawing', 'active', 'spellTier', 'sigCd', 'burnTicks', 'burnDps', 'burnBy', 'slowTicks', 'slowMult', 'freezeTicks', 'boostTicks', 'boostMult', 'cooldown', 'lastHitBy', 'lastHitTick', 'rivalIndex'] as const;
const PLAYER_BOOL = ['active'];
const CASTLE = ['id', 'faction', 'x', 'y', 'z', 'tier', 'hp', 'maxHp', 'invuln', 'ruined', 'released', 'lastHit'] as const;
const CASTLE_BOOL = ['ruined'];
const CREATURE = ['id', 'nest', 'x', 'y', 'z', 'vx', 'vz', 'hp', 'state', 'burnTicks', 'burnDps', 'slowTicks', 'slowMult', 'freezeTicks'] as const;
const PROJECTILE = ['id', 'owner', 'faction', 'hp', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'tier', 'tk', 'tid', 'chainMult'] as const;
const ZONE = ['id', 'x', 'y', 'z', 'r', 'ticksLeft', 'faction', 'owner', 'dps', 'burst', 'structureMult', 'vx', 'vz', 'slow'] as const;
const WELL = ['id', 'x', 'y', 'z', 'reserve', 'max', 'age', 'fade'] as const;
const STRUCT = ['id', 'x', 'y', 'z', 'hp', 'max', 'alive', 'spawnCd', 'respawnAt'] as const;
const STRUCT_BOOL = ['alive'];

export interface SnapshotContext {
  /** Last input seq consumed per human slot. */
  acks: number[];
  /** Highest event seq already sent. */
  lastEventSeq: number;
  /** Terrain delta list version last sent ("" = never). */
  deltaKey: string;
}

export function deltaKey(sim: Sim): string {
  const d = sim.terrain.deltas;
  return `${d.compactionEpoch}:${d.nextId}:${d.list.length}`;
}

/** Humans' positions: everything within the interest radius of either is sent. */
function viewers(sim: Sim): PlayerState[] {
  return sim.players.filter((p) => !p.isRival || p.rivalIndex >= 0).slice(0, sim.humanCount);
}

export function buildSnapshot(sim: Sim, ctx: SnapshotContext): SnapshotWire {
  const view = viewers(sim);
  const r2 = NET.interestRadius * NET.interestRadius;
  const near = (x: number, z: number): boolean => {
    for (const v of view) if ((v.x - x) ** 2 + (v.z - z) ** 2 < r2) return true;
    return false;
  };
  const dist2 = (x: number, z: number): number => {
    let best = Infinity;
    for (const v of view) best = Math.min(best, (v.x - x) ** 2 + (v.z - z) ** 2);
    return best;
  };
  const m = sim.match;
  const orbs = sim.orbs.filter((o) => near(o.x, o.z));
  if (orbs.length > NET.maxOrbsPerSnapshot) orbs.sort((a, b) => dist2(a.x, a.z) - dist2(b.x, b.z)).length = NET.maxOrbsPerSnapshot;
  const events = sim.events.filter((e) => e.seq > ctx.lastEventSeq);
  if (events.length > NET.maxEventsPerSnapshot) events.splice(0, events.length - NET.maxEventsPerSnapshot);
  const snap: SnapshotWire = {
    k: sim.tick,
    a: ctx.acks.slice(),
    m: [m.status, m.reason, q(m.targetShare), m.suddenDeath ? 1 : 0, m.winner, m.endTick, m.shares.map(q)],
    f: sim.factions.map((f) => [q(f.captured), f.eliminated ? 1 : 0]),
    p: sim.players.map((p) => pack(p, PLAYER)),
    c: sim.castles.map((c) => [...pack(c, CASTLE), c.branches.join(',')]),
    cr: sim.creatures.filter((c) => near(c.x, c.z)).map((c) => [c.type, ...pack(c, CREATURE)]),
    o: orbs.map((o) => pack(o, ['id', 'x', 'y', 'z', 'value'])),
    pr: sim.projectiles.map((p) => [p.spell, ...pack(p, PROJECTILE)]),
    z: sim.zones.map((z) => [z.element, z.combo ?? '', ...pack(z, ZONE)]),
    w: sim.wells.map((w) => pack(w, WELL)),
    s: sim.structures.map((s) => [s.kind, ...pack(s, STRUCT)]),
    ev: events.map((e) => [e.seq, e.type, e.tick, q(e.x), q(e.y), q(e.z), q(e.v), q(e.x2), q(e.y2), q(e.z2)]),
  };
  const key = deltaKey(sim);
  if (key !== ctx.deltaKey) {
    const d = sim.terrain.deltas;
    snap.d = { e: d.compactionEpoch, n: d.nextId, l: d.list.map((x) => [x.id, q(x.x), q(x.z), q(x.r), q(x.amount), x.kind, x.tick]) };
  }
  if (events.length > 0) ctx.lastEventSeq = events[events.length - 1]!.seq;
  return snap;
}

// ---------------------------------------------------------------- decoding (client)
export interface DecodedSnapshot {
  tick: number;
  acks: number[];
  players: Partial<PlayerState>[];
  creatures: Creature[];
  orbs: Orb[];
  projectiles: Projectile[];
  zones: Zone[];
  wells: Well[];
  structures: Structure[];
  castles: (Partial<Castle> & { branches: string[] })[];
  events: SimEvent[];
  wire: SnapshotWire;
}

export function decodeSnapshot(w: SnapshotWire): DecodedSnapshot {
  const players = w.p.map((a) => {
    const p: Partial<PlayerState> = {};
    unpack(p, PLAYER, a as number[], 0, PLAYER_BOOL);
    return p;
  });
  const castles = w.c.map((a) => {
    const c: Partial<Castle> = {};
    unpack(c, CASTLE, a, 0, CASTLE_BOOL);
    const br = String(a[CASTLE.length] ?? '');
    return Object.assign(c, { branches: br === '' ? [] : br.split(',') });
  });
  const creatures = w.cr.map((a) => {
    const c = { type: a[0] as string, homeX: 0, homeZ: 0, wx: 0, wz: 0, wanderUntil: 0, cd: 0, px: 0, py: 0, pz: 0 } as unknown as Creature;
    unpack(c, CREATURE, a, 1);
    return c;
  });
  const orbs = w.o.map((a) => {
    const o = { vx: 0, vz: 0, age: 0, px: 0, py: 0, pz: 0 } as unknown as Orb;
    unpack(o, ['id', 'x', 'y', 'z', 'value'], a, 0);
    return o;
  });
  const projectiles = w.pr.map((a) => {
    const p = { spell: a[0] as string, px: 0, py: 0, pz: 0, travelled: 0 } as unknown as Projectile;
    unpack(p, PROJECTILE, a, 1);
    return p;
  });
  const zones = w.z.map((a) => {
    const z = { element: a[0] as string, combo: (a[1] as string) || undefined } as unknown as Zone;
    unpack(z, ZONE, a, 2);
    if (!z.slow) z.slow = undefined;
    return z;
  });
  const wells = w.w.map((a) => {
    const x = { px: 0 } as unknown as Well;
    unpack(x, WELL, a, 0);
    return x;
  });
  const structures = w.s.map((a) => {
    const s = { kind: a[0] as string } as unknown as Structure;
    unpack(s, STRUCT, a, 1, STRUCT_BOOL);
    return s;
  });
  const events = w.ev.map((a) => ({
    seq: a[0] as number, type: a[1] as SimEventType, tick: a[2] as number, x: a[3] as number, y: a[4] as number, z: a[5] as number, v: a[6] as number, x2: a[7] as number, y2: a[8] as number, z2: a[9] as number,
  }));
  return { tick: w.k, acks: w.a, players, creatures, orbs, projectiles, zones, wells, structures, castles, events, wire: w };
}

export function applyDeltas(sim: Sim, d: NonNullable<SnapshotWire['d']>): boolean {
  const store = sim.terrain.deltas;
  const list: TerrainDelta[] = d.l.map((a) => ({ id: a[0]!, x: a[1]!, z: a[2]!, r: a[3]!, amount: a[4]!, kind: a[5]!, tick: a[6]! }));
  const changedEpoch = store.compactionEpoch !== d.e;
  // The renderer rebuilds everything when the epoch moves; a pure append only needs the new chunks.
  const appendOnly = !changedEpoch && list.length >= store.list.length && store.list.every((old, i) => list[i]!.id === old.id);
  store.list = list;
  store.nextId = d.n;
  if (!appendOnly) store.compactionEpoch = changedEpoch ? d.e : store.compactionEpoch + 1;
  return true;
}
