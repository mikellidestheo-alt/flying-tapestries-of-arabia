// Terrain deformation deltas: small records (position, radius, amount) that can be
// synced in co-op. Capped in number; old ones are merged over time.
import { lerp } from './dmath';

export const DELTA_BUMP = 0; // smooth raise (amount > 0) or dent (amount < 0)
export const DELTA_CRATER = 1; // bowl with a raised rim (amount < 0 digs)

export interface TerrainDelta {
  id: number;
  x: number;
  z: number;
  r: number;
  amount: number;
  kind: number;
  tick: number;
}

export interface DeltaLimits {
  maxDeltas: number;
  softLimit: number;
  compactEveryTicks: number;
  compactMinAgeTicks: number;
  compactPairsPerPass: number;
  compactWindow: number;
  maxRadius: number;
}

/** Height contribution of one delta at (x, z). */
export function deltaHeight(d: TerrainDelta, x: number, z: number): number {
  const dx = x - d.x;
  const dz = z - d.z;
  const rr = d.r * d.r;
  const dd = dx * dx + dz * dz;
  if (dd >= rr) return 0;
  const u = 1 - dd / rr;
  const profile = d.kind === DELTA_CRATER ? u * (2 * u - 1) : u * u;
  return d.amount * profile;
}

export class DeltaStore {
  list: TerrainDelta[] = [];
  nextId = 1;
  /** Bumped whenever existing deltas are merged or dropped, so renderers rebuild everything. */
  compactionEpoch = 0;

  constructor(private limits: DeltaLimits) {}

  add(x: number, z: number, r: number, amount: number, kind: number, tick: number): TerrainDelta {
    const rr = Math.min(r, this.limits.maxRadius);
    const d: TerrainDelta = { id: this.nextId++, x, z, r: rr, amount, kind, tick };
    this.list.push(d);
    if (this.list.length > this.limits.maxDeltas) this.enforceHardCap();
    return d;
  }

  /** Periodic maintenance: merge old, overlapping deltas when above the soft limit. */
  compact(tick: number): boolean {
    if (this.list.length <= this.limits.softLimit) return false;
    let changed = false;
    for (let pass = 0; pass < this.limits.compactPairsPerPass; pass++) {
      if (this.list.length <= this.limits.softLimit) break;
      if (!this.mergeOldestPair(tick - this.limits.compactMinAgeTicks)) break;
      changed = true;
    }
    if (changed) this.compactionEpoch++;
    return changed;
  }

  private enforceHardCap(): void {
    let changed = false;
    while (this.list.length > this.limits.maxDeltas) {
      if (!this.mergeOldestPair(Infinity)) {
        // Nothing mergeable: drop the weakest delta.
        let weakest = 0;
        let weakestV = Infinity;
        for (let i = 0; i < this.list.length; i++) {
          const d = this.list[i]!;
          const v = Math.abs(d.amount) * d.r * d.r;
          if (v < weakestV) {
            weakestV = v;
            weakest = i;
          }
        }
        this.list.splice(weakest, 1);
      }
      changed = true;
    }
    if (changed) this.compactionEpoch++;
  }

  /** Merge the closest pair among the oldest deltas (older than maxTick). */
  private mergeOldestPair(maxTick: number): boolean {
    const win = Math.min(this.limits.compactWindow, this.list.length);
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < win; i++) {
      const a = this.list[i]!;
      if (a.tick > maxTick) continue;
      for (let j = i + 1; j < win; j++) {
        const b = this.list[j]!;
        if (b.tick > maxTick) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 < best) {
          best = dist2;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) return false;
    const a = this.list[bi]!;
    const b = this.list[bj]!;
    const va = a.amount * a.r * a.r;
    const vb = b.amount * b.r * b.r;
    const wa = Math.abs(va) + 1e-6;
    const wb = Math.abs(vb) + 1e-6;
    const t = wb / (wa + wb);
    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    const dist = Math.sqrt(best);
    const r = Math.min(this.limits.maxRadius, Math.max(a.r, b.r) + dist * 0.5);
    const amount = (va + vb) / (r * r);
    const merged: TerrainDelta = {
      id: this.nextId++,
      x,
      z,
      r,
      amount,
      kind: a.kind === b.kind ? a.kind : DELTA_BUMP,
      tick: Math.max(a.tick, b.tick),
    };
    this.list.splice(bj, 1);
    this.list[bi] = merged;
    return true;
  }

  /** Full list for (re)joining players and for tests. */
  toArray(): TerrainDelta[] {
    return this.list.map((d) => ({ ...d }));
  }

  /** Replace the whole list (used when a client receives the full delta list). */
  load(list: TerrainDelta[], nextId: number): void {
    this.list = list.map((d) => ({ ...d }));
    this.nextId = nextId;
    this.compactionEpoch++;
  }
}
