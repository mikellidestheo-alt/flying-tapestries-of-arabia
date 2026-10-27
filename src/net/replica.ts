// Client-side copy of a co-op match. The server owns the truth; this keeps a local `Sim` object (so the
// renderer, HUD and audio work unchanged) and fills it from snapshots:
//  - your own wizard is PREDICTED: each local tick it flies with your input, and every snapshot re-bases it on the
//    server's state and replays the inputs the server has not yet seen (so steering feels instant);
//  - everything else (teammate, rivals, creatures, orbs, bolts...) is INTERPOLATED a few ticks in the past, between
//    the two snapshots that surround the render time, so motion is smooth at 30 Hz from 15 Hz snapshots;
//  - scalars (HP, mana, castle tiers, match state) come straight from the newest snapshot, and sim events are
//    released when their tick is reached so effects line up with the interpolated bodies.
import { CHAPTERS } from '../data/chapters';
import type { Element } from '../data/elements';
import { wrapAngle } from '../sim/dmath';
import type { Creature, Orb, Projectile, SimEvent, Zone } from '../sim/entities';
import { refreshObstacle } from '../sim/castles';
import { Sim, type PlayerInput, type PlayerState } from '../sim/sim';
import type { DifficultyId } from '../sim/match';
import { NET, coopSetup, type SnapshotWire } from './protocol';
import { applyDeltas, decodeSnapshot, type DecodedSnapshot } from './snapshot';

const TICK_MS = 1000 / 30;

interface Held {
  snap: DecodedSnapshot;
  arrivedMs: number;
}

export interface ReplicaStats {
  snapshots: number;
  lastSnapshotAgeMs: number;
  bufferTicks: number;
  correction: number;
}

export class CoopReplica {
  readonly sim: Sim;
  readonly slot: number;
  private snaps: Held[] = [];
  private pendingEvents: SimEvent[] = [];
  private history: { seq: number; input: PlayerInput }[] = [];
  /** Local input counter: seq of the input applied on the most recent tick. */
  seq = 0;
  private renderTick = 0;
  private haveSnap = false;
  private snapCount = 0;
  private lastCorrection = 0;
  private lastEventSeq = 0;

  constructor(start: { slot: number; chapter: number; difficulty: DifficultyId; elements: [Element, Element] }) {
    const ch = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, start.chapter))]!;
    this.slot = start.slot;
    this.sim = new Sim({ terrain: ch.terrain, creatureTypes: ch.creatureSet, match: coopSetup(start.chapter, start.elements, start.difficulty), playerCount: 2 });
    this.sim.localPlayer = start.slot;
  }

  get stats(): ReplicaStats {
    const newest = this.snaps[this.snaps.length - 1];
    return {
      snapshots: this.snapCount,
      lastSnapshotAgeMs: newest ? performance.now() - newest.arrivedMs : Infinity,
      bufferTicks: newest ? newest.snap.tick - this.renderTick : 0,
      correction: this.lastCorrection,
    };
  }

  get ready(): boolean {
    return this.haveSnap;
  }

  /** A snapshot arrived. `nowMs` is a monotonic clock in milliseconds. */
  push(wire: SnapshotWire, nowMs: number): void {
    const snap = decodeSnapshot(wire);
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.snap.tick) return; // stale or duplicate
    this.snaps.push({ snap, arrivedMs: nowMs });
    if (this.snaps.length > 12) this.snaps.shift();
    this.snapCount++;
    for (const e of snap.events) if (e.seq > this.lastEventSeq) {
      this.lastEventSeq = e.seq;
      this.pendingEvents.push(e);
    }
    this.applyScalars(snap, wire);
    this.reconcileLocal(snap);
    if (!this.haveSnap) {
      this.haveSnap = true;
      this.renderTick = snap.tick - NET.interpDelayTicks;
      this.placeAll(snap, snap);
    }
  }

  /** One local 30 Hz tick. Applies prediction and advances the interpolated world. */
  tick(input: PlayerInput, nowMs: number): void {
    const sim = this.sim;
    for (let i = 0; i < sim.players.length; i++) Object.assign(sim.prevPlayers[i]!, sim.players[i]);
    this.seq++;
    this.history.push({ seq: this.seq, input });
    if (this.history.length > 120) this.history.shift();
    const me = sim.players[this.slot]!;
    sim.predictPlayer(me, input);
    if (!this.haveSnap) return;

    const newest = this.snaps[this.snaps.length - 1]!;
    // Aim the render clock at "now" on the server timeline minus the interpolation delay, easing towards it.
    const serverNow = newest.snap.tick + (nowMs - newest.arrivedMs) / TICK_MS;
    const target = serverNow - NET.interpDelayTicks;
    const lag = target - this.renderTick;
    // Normal case: ease towards the target. If this device fell far behind (a slow frame burst, a tab in the
    // background), jump instead of replaying the past at 1x.
    if (lag > 6 || lag < -6) this.renderTick = target;
    else this.renderTick += 1 + Math.max(-0.5, Math.min(0.5, (lag - 1) * 0.1));
    if (this.renderTick > newest.snap.tick) this.renderTick = newest.snap.tick; // never extrapolate
    sim.tick = newest.snap.tick;

    let a = this.snaps[0]!.snap;
    let b = newest.snap;
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i]!.snap.tick <= this.renderTick) a = this.snaps[i]!.snap;
      else {
        b = this.snaps[i]!.snap;
        break;
      }
    }
    if (a.tick > this.renderTick) a = b;
    this.placeAll(a, b);

    // Release events whose moment has come.
    const ready = this.pendingEvents.filter((e) => e.tick <= this.renderTick + 1);
    if (ready.length > 0) {
      this.pendingEvents = this.pendingEvents.filter((e) => e.tick > this.renderTick + 1);
      for (const e of ready) sim.events.push(e);
      const extra = sim.events.length - 160;
      if (extra > 0) sim.events.splice(0, extra);
    }
  }

  // ---------------------------------------------------------------- internals
  /** Non-positional state straight from the newest snapshot. */
  private applyScalars(snap: DecodedSnapshot, wire: SnapshotWire): void {
    const sim = this.sim;
    const m = wire.m;
    sim.match.status = m[0] as typeof sim.match.status;
    sim.match.reason = m[1];
    sim.match.targetShare = m[2];
    sim.match.suddenDeath = m[3] === 1;
    sim.match.winner = m[4];
    sim.match.endTick = m[5];
    sim.match.shares = m[6].slice();
    wire.f.forEach((f, i) => {
      const fac = sim.factions[i];
      if (fac) {
        fac.captured = f[0]!;
        fac.eliminated = f[1] === 1;
      }
    });
    snap.castles.forEach((c, i) => {
      const castle = sim.castles[i];
      if (!castle) return;
      const tierChanged = castle.tier !== c.tier || castle.ruined !== c.ruined;
      Object.assign(castle, c);
      if (tierChanged) refreshObstacle(sim, castle);
    });
    snap.players.forEach((p, i) => {
      if (i === this.slot) return; // predicted
      const target = sim.players[i];
      if (!target) return;
      const { x, y, z, vx, vy, vz, heading, ...rest } = p;
      void x; void y; void z; void vx; void vy; void vz; void heading;
      Object.assign(target, rest);
    });
    // Own wizard: scalars (not motion) from the server too.
    const mine = snap.players[this.slot];
    const me = sim.players[this.slot];
    if (mine && me) {
      const { x, y, z, vx, vy, vz, heading, speed, turnRate, ...rest } = mine;
      void x; void y; void z; void vx; void vy; void vz; void heading; void speed; void turnRate;
      Object.assign(me, rest);
    }
    sim.wells = snap.wells.map((w) => ({ ...w, px: w.x }));
    sim.structures.forEach((s) => {
      const n = snap.structures.find((q) => q.id === s.id);
      if (n) Object.assign(s, n);
    });
    if (wire.d) applyDeltas(sim, wire.d);
  }

  /** Re-base the predicted wizard on the server's state, then replay inputs the server has not consumed. */
  private reconcileLocal(snap: DecodedSnapshot): void {
    const sp = snap.players[this.slot];
    if (!sp) return;
    const me = this.sim.players[this.slot]!;
    const before = { x: me.x, y: me.y, z: me.z };
    const ack = snap.acks[this.slot] ?? 0;
    Object.assign(me, sp);
    this.history = this.history.filter((h) => h.seq > ack);
    for (const h of this.history) this.sim.predictPlayer(me, h.input);
    this.lastCorrection = Math.hypot(me.x - before.x, me.y - before.y, me.z - before.z);
    // Big disagreement (respawn, teleport): do not glide across the map.
    if (this.lastCorrection > 40) Object.assign(this.sim.prevPlayers[this.slot]!, me);
  }

  /** Fill the interpolated parts of the world from snapshots `a` (older) and `b` (newer). */
  private placeAll(a: DecodedSnapshot, b: DecodedSnapshot): void {
    const sim = this.sim;
    const span = b.tick - a.tick;
    const f = span <= 0 ? 1 : Math.max(0, Math.min(1, (this.renderTick - a.tick) / span));
    const mix = (x: number, y: number): number => x + (y - x) * f;

    // Remote wizards: position and heading interpolated.
    for (let i = 0; i < sim.players.length; i++) {
      if (i === this.slot) continue;
      const pa = a.players[i];
      const pb = b.players[i];
      const p = sim.players[i];
      if (!pa || !pb || !p) continue;
      const jump = Math.hypot(pb.x! - pa.x!, pb.z! - pa.z!) > 60; // respawn
      const ff = jump ? 1 : f;
      p.x = pa.x! + (pb.x! - pa.x!) * ff;
      p.y = pa.y! + (pb.y! - pa.y!) * ff;
      p.z = pa.z! + (pb.z! - pa.z!) * ff;
      p.vx = pb.vx!; p.vy = pb.vy!; p.vz = pb.vz!;
      p.speed = pb.speed!; p.turnRate = pb.turnRate!;
      p.heading = pa.heading! + wrapAngle(pb.heading! - pa.heading!) * ff;
      if (!this.haveSnap || jump) Object.assign(sim.prevPlayers[i]!, p);
    }

    // Entities with identity: previous = what was drawn last tick, current = interpolated target.
    const prevCreatures = new Map(sim.creatures.map((c) => [c.id, c] as const));
    const aC = new Map(a.creatures.map((c) => [c.id, c] as const));
    sim.creatures = b.creatures.map((c) => {
      const o = aC.get(c.id);
      const prev = prevCreatures.get(c.id);
      const x = o ? mix(o.x, c.x) : c.x;
      const y = o ? mix(o.y, c.y) : c.y;
      const z = o ? mix(o.z, c.z) : c.z;
      const out: Creature = { ...c, x, y, z, px: prev ? prev.x : x, py: prev ? prev.y : y, pz: prev ? prev.z : z };
      return out;
    });
    const prevOrbs = new Map(sim.orbs.map((c) => [c.id, c] as const));
    const aO = new Map(a.orbs.map((c) => [c.id, c] as const));
    sim.orbs = b.orbs.map((c) => {
      const o = aO.get(c.id);
      const prev = prevOrbs.get(c.id);
      const x = o ? mix(o.x, c.x) : c.x;
      const y = o ? mix(o.y, c.y) : c.y;
      const z = o ? mix(o.z, c.z) : c.z;
      const out: Orb = { ...c, x, y, z, px: prev ? prev.x : x, py: prev ? prev.y : y, pz: prev ? prev.z : z };
      return out;
    });
    const prevProj = new Map(sim.projectiles.map((c) => [c.id, c] as const));
    const aP = new Map(a.projectiles.map((c) => [c.id, c] as const));
    sim.projectiles = b.projectiles.map((c) => {
      const o = aP.get(c.id);
      const prev = prevProj.get(c.id);
      const x = o ? mix(o.x, c.x) : c.x;
      const y = o ? mix(o.y, c.y) : c.y;
      const z = o ? mix(o.z, c.z) : c.z;
      const out: Projectile = { ...c, x, y, z, px: prev ? prev.x : x, py: prev ? prev.y : y, pz: prev ? prev.z : z };
      return out;
    });
    const aZ = new Map(a.zones.map((c) => [c.id, c] as const));
    sim.zones = b.zones.map((c) => {
      const o = aZ.get(c.id);
      const out: Zone = { ...c, x: o ? mix(o.x, c.x) : c.x, z: o ? mix(o.z, c.z) : c.z };
      return out;
    });
  }
}

export type { PlayerState };
