// Castles: tier table, upgrades (with branches), passive income, archers, healing, damage.
import castleData from '../data/castles.json';
import matchData from '../data/match.json';
import { clamp, dcos, dsin } from './dmath';
import type { Castle, Creature, Projectile } from './entities';
import { CREATURES, hurtCreature } from './combat';
import { incomeMultiplier } from './match';
import type { PlayerInput, PlayerState, Sim } from './sim';
import { SIM_DT, SIM_TICK_RATE } from './sim';
import { baseHeight, cityFactor, type TerrainParams } from './terrain';

export type TierDef = (typeof castleData.tiers)[number];
export type BranchId = 'archers' | 'walls' | 'income';
export const TIERS = castleData.tiers as TierDef[];
export const BRANCHES = castleData.branches as Record<string, { name: string; blurb: string; archers: number; wallHpMult: number; incomeMult: number }>;
export const MAX_TIER = TIERS.length;
const MAX_ARCHER_SLOTS = 16;

export function tierDef(tier: number): TierDef {
  return TIERS[clamp(tier, 1, MAX_TIER) - 1]!;
}

export interface CastleStats {
  archers: number;
  archerRange: number;
  archerDamage: number;
  archerRate: number;
  wallHp: number;
  income: number;
}

export function castleStats(tier: number, branches: readonly string[]): CastleStats {
  const t = tierDef(tier);
  let archers = t.archers;
  let hpMult = 1;
  let incomeMult = 1;
  for (const b of branches) {
    const def = BRANCHES[b];
    if (!def) continue;
    archers += def.archers;
    hpMult *= def.wallHpMult;
    incomeMult *= def.incomeMult;
  }
  return {
    archers: Math.min(archers, MAX_ARCHER_SLOTS),
    archerRange: t.archerRange,
    archerDamage: t.archerDamage,
    archerRate: t.archerRate,
    wallHp: Math.round(t.wallHp * hpMult),
    income: t.income * incomeMult,
  };
}

/** Archer damage per second for balance tests: count x damage x rate. */
export function archerDps(tier: number, branches: readonly string[]): number {
  const s = castleStats(tier, branches);
  return s.archers * s.archerDamage * s.archerRate;
}

/** Positions of archer posts on the battlements, relative to the castle centre. */
export function archerSlots(tier: number, count: number): { x: number; y: number; z: number }[] {
  const v = tierDef(tier).visual;
  const out: { x: number; y: number; z: number }[] = [];
  const r = v.wallRadius - 0.9;
  for (let i = 0; i < count; i++) {
    const a = (i / Math.max(1, count)) * 6.283185307 + 0.4;
    out.push({ x: dcos(a) * r, y: v.wallHeight + 0.2, z: dsin(a) * r });
  }
  return out;
}

/** Collision cylinder for flyers and projectiles. */
export function castleBounds(tier: number): { r: number; top: number } {
  const v = tierDef(tier).visual;
  return { r: v.wallRadius + matchData.castleHitPadding, top: v.keepHeight + 3 };
}

export function nextUpgrade(c: Castle): { tier: number; cost: number; needsBranch: boolean } | null {
  if (c.ruined || c.tier >= MAX_TIER) return null;
  const next = tierDef(c.tier + 1);
  return { tier: next.tier, cost: next.cost, needsBranch: castleData.branchTiers.includes(next.tier) };
}

export function makeCastle(id: number, faction: number, x: number, y: number, z: number): Castle {
  const stats = castleStats(1, []);
  return {
    id, faction, x, y, z, tier: 1, branches: [], hp: stats.wallHp, maxHp: stats.wallHp, bank: 0, invuln: 0,
    ruined: false, archerCd: Array.from({ length: MAX_ARCHER_SLOTS }, (_, i) => 4 + i * 3), threat: 0, lastHit: -999,
  };
}

/** Where to build castle number `index` of `count` (0 = the players'). Deterministic. */
export function findCastleSite(p: TerrainParams, anchor: { x: number; z: number }, index: number, count: number): { x: number; z: number; h: number } {
  const ok = (x: number, z: number): number | null => {
    const h = baseHeight(p, x, z);
    if (h < p.waterLevel + 3) return null;
    if (cityFactor(p, x, z) > 0.05) return null;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 6.283185307;
      const hh = baseHeight(p, x + dcos(a) * 20, z + dsin(a) * 20);
      if (hh < p.waterLevel + 1.5 || Math.abs(hh - h) > 9) return null;
    }
    return h;
  };
  if (index === 0) {
    const h = ok(anchor.x, anchor.z);
    if (h !== null) return { x: anchor.x, z: anchor.z, h };
  }
  const baseAngle = 0.55 + (index / Math.max(1, count)) * 6.283185307;
  const dist = index === 0 ? 0 : matchData.castleSiteDistance;
  const tx = anchor.x + dcos(baseAngle) * dist;
  const tz = anchor.z + dsin(baseAngle) * dist;
  for (let i = 0; i < 400; i++) {
    const r = 18 * Math.sqrt(i);
    const a = i * 2.399963229728653;
    const x = tx + dcos(a) * r;
    const z = tz + dsin(a) * r;
    const h = ok(x, z);
    if (h !== null) return { x, z, h };
  }
  return { x: tx, z: tz, h: Math.max(baseHeight(p, tx, tz), p.waterLevel + 3) };
}

/** Attempt an upgrade for faction `p` standing near its castle. Pays from the bank, then the wizard's pool. */
export function tryUpgrade(sim: Sim, p: PlayerState, input: PlayerInput): boolean {
  const c = sim.castles.find((q) => q.faction === p.faction);
  if (!c) return false;
  const up = nextUpgrade(c);
  if (!up) return false;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  if (dx * dx + dz * dz > castleData.upgradeRadius * castleData.upgradeRadius) return false;
  if (c.bank + p.mana < up.cost) return false;
  let branch: string | null = null;
  if (up.needsBranch) {
    const idx = (input.branch ?? 0) - 1;
    const id = castleData.branchOrder[idx];
    if (!id) return false;
    branch = id;
  }
  const fromBank = Math.min(c.bank, up.cost);
  c.bank -= fromBank;
  p.mana -= up.cost - fromBank;
  c.tier = up.tier;
  if (branch) c.branches.push(branch);
  const stats = castleStats(c.tier, c.branches);
  c.maxHp = stats.wallHp;
  c.hp = stats.wallHp;
  refreshObstacle(sim, c);
  sim.emit('upgrade', c.x, c.y, c.z, c.tier);
  return true;
}

export function refreshObstacle(sim: Sim, c: Castle): void {
  const b = castleBounds(c.tier);
  const o = sim.terrain.obstacles.find((q) => q.id === c.id);
  if (o) {
    o.r = c.ruined ? 4 : b.r;
    o.top = c.y + (c.ruined ? 3 : b.top);
  } else sim.terrain.obstacles.push({ id: c.id, x: c.x, z: c.z, r: b.r, top: c.y + b.top });
}

function dropLoot(sim: Sim, c: Castle, amount: number): void {
  const n = clamp(Math.round(amount / 12), 0, 10);
  for (let i = 0; i < n; i++) {
    const a = sim.rng.range(0, 6.283185307);
    const sp = sim.rng.range(6, 16);
    sim.spawnOrb(c.x, c.y + 6, c.z, amount / n, dcos(a) * sp, dsin(a) * sp);
  }
}

/** Damage a castle. At zero HP it drops a tier; a tier-1 castle is destroyed and its faction eliminated. */
export function damageCastle(sim: Sim, c: Castle, amount: number): void {
  if (c.ruined || c.invuln > 0 || amount <= 0) return;
  c.hp -= amount;
  c.lastHit = sim.tick;
  sim.emit('castleHit', c.x, c.y + 6, c.z, amount);
  if (c.hp > 0) return;
  if (c.tier > 1) {
    const loot = c.bank * castleData.downgradeLootFraction;
    c.bank -= loot;
    dropLoot(sim, c, loot + 20);
    c.tier--;
    c.branches = c.branches.slice(0, castleData.branchTiers.filter((t) => t <= c.tier).length);
    const stats = castleStats(c.tier, c.branches);
    c.maxHp = stats.wallHp;
    c.hp = c.maxHp;
    c.invuln = castleData.downgradeInvulnTicks;
    refreshObstacle(sim, c);
    sim.emit('castleDowngrade', c.x, c.y + 6, c.z, c.tier);
  } else {
    c.ruined = true;
    c.hp = 0;
    dropLoot(sim, c, c.bank + 60);
    c.bank = 0;
    refreshObstacle(sim, c);
    sim.factions[c.faction]!.eliminated = true;
    for (const p of sim.players) {
      if (p.faction === c.faction && p.isRival) p.active = false;
    }
    sim.emit('castleDestroyed', c.x, c.y + 6, c.z, c.faction);
  }
}

interface Threat {
  kind: 0 | 1; // 0 creature, 1 projectile
  c?: Creature;
  p?: Projectile;
  x: number;
  y: number;
  z: number;
  d2: number;
}

export function stepCastles(sim: Sim): void {
  const settings = castleData;
  for (const c of sim.castles) {
    if (c.ruined) continue;
    if (c.invuln > 0) c.invuln--;
    const stats = castleStats(c.tier, c.branches);

    // Passive income into the shared castle bank (counts towards the faction's mana share).
    const income = (stats.income / SIM_TICK_RATE) * incomeMultiplier(sim, c.faction);
    c.bank = Math.min(settings.bankCap, c.bank + income);
    sim.factions[c.faction]!.captured += income;

    // Healing aura for the faction's wizards.
    for (const p of sim.players) {
      if (p.faction !== c.faction || !p.active || p.hp <= 0) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      if (dx * dx + dz * dz < settings.healRadius * settings.healRadius) {
        p.hp = Math.min(sim.maxHpFor(p), p.hp + (settings.healPerSecond * SIM_DT));
      }
    }

    if (stats.archers === 0) continue;
    // Pick the nearest threat: wild creatures and enemy projectiles (never wizards).
    const range2 = stats.archerRange * stats.archerRange;
    let best: Threat | null = null;
    for (const cr of sim.creatures) {
      const dx = cr.x - c.x;
      const dz = cr.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (CREATURES[cr.type]!.hostile && cr.hp > 0 && d2 < range2 && (!best || d2 < best.d2)) best = { kind: 0, c: cr, x: cr.x, y: cr.y, z: cr.z, d2 };
    }
    for (const pr of sim.projectiles) {
      if (pr.faction === c.faction || pr.hp <= 0) continue;
      const dx = pr.x - c.x;
      const dz = pr.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < range2 && (!best || d2 < best.d2)) best = { kind: 1, p: pr, x: pr.x, y: pr.y, z: pr.z, d2 };
    }
    const slots = archerSlots(c.tier, stats.archers);
    const cooldown = Math.max(1, Math.round(SIM_TICK_RATE / stats.archerRate));
    let arrowEvents = 0;
    for (let i = 0; i < slots.length; i++) {
      if (c.archerCd[i]! > 0) {
        c.archerCd[i]!--;
        continue;
      }
      if (!best) continue;
      c.archerCd[i] = cooldown;
      if (best.kind === 0) hurtCreature(sim, best.c!, stats.archerDamage, -1);
      else best.p!.hp -= stats.archerDamage;
      if (arrowEvents++ < settings.maxArrowEventsPerTick) {
        const s = slots[i]!;
        sim.emitLine('arrow', c.x + s.x, c.y + s.y, c.z + s.z, best.x, best.y, best.z, c.faction);
      }
    }
  }
}
