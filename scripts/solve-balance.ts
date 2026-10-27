// Regenerates src/data/spells.json from the DESIGN below: each wizard's creative choices (area,
// effects, chain, speed, cooldown windows) are fixed, and damage + mana cost are SOLVED so every
// tier lands on the balance budget (src/data/balance.json). Run: npx tsx scripts/solve-balance.ts
// Then `npm test` verifies the result stays within tolerance.
import { writeFileSync } from 'node:fs';
import balance from '../src/data/balance.json';
import oldSpells from '../src/data/spells.json';
import { effectiveDamage, signatureValue, TICKS } from '../src/sim/balance';
import type { SpellDef } from '../src/sim/spelldefs';

type Tier = Partial<SpellDef> & { cds: number[] };
interface Design {
  id: string;
  names: string[];
  base: Partial<SpellDef>;
  tiers: Tier[];
}

const aim = (cosMin: number, homing: number) => ({ range: 200, cosMin, distanceWeight: 0.18, homingStrength: homing, homingMaxAngle: 0.9, homingRange: 150 });

const designs: Record<string, Design> = {
  fire: {
    id: 'fireball',
    names: ['Fireball', 'Blazing Fireball', 'Inferno Orb'],
    base: { element: 'fire', maxRange: 230, falloff: 0.45, interceptHp: 16, aimAssist: aim(0.86, 0.16), structureMult: 1.0 },
    tiers: [
      { speed: 78, gravity: 7, area: 7.5, hitRadius: 1.6, effects: [{ type: 'burn', dps: 3, durationTicks: 90 }], terrain: { radius: 5.5, amount: -1.8, kind: 1 }, cds: [11, 12, 13] },
      { speed: 82, gravity: 7, area: 9.5, hitRadius: 1.9, effects: [{ type: 'burn', dps: 4, durationTicks: 100 }], terrain: { radius: 7, amount: -2.2, kind: 1 }, cds: [10, 11, 12] },
      { speed: 86, gravity: 7, area: 12, hitRadius: 2.3, effects: [{ type: 'burn', dps: 5, durationTicks: 120 }], terrain: { radius: 9, amount: -2.8, kind: 1 }, cds: [9, 10, 11] },
    ],
  },
  water: {
    id: 'frostchain',
    names: ['Frost Chain', 'Glacial Chain', 'Absolute Zero'],
    base: { element: 'water', maxRange: 240, falloff: 0.4, interceptHp: 14, aimAssist: aim(0.86, 0.2), structureMult: 0.8 },
    tiers: [
      { speed: 95, gravity: 3, area: 4, hitRadius: 1.5, effects: [{ type: 'slow', mult: 0.65, durationTicks: 70 }], chain: { count: 2, radius: 22, falloff: 0.65 }, cds: [13, 14, 15] },
      { speed: 98, gravity: 3, area: 4.5, hitRadius: 1.7, effects: [{ type: 'slow', mult: 0.55, durationTicks: 85 }], chain: { count: 3, radius: 26, falloff: 0.65 }, cds: [12, 13, 14] },
      { speed: 100, gravity: 3, area: 5, hitRadius: 1.9, effects: [{ type: 'slow', mult: 0.5, durationTicks: 95 }, { type: 'freeze', durationTicks: 12 }], chain: { count: 3, radius: 30, falloff: 0.7 }, cds: [11, 12, 13] },
    ],
  },
  earth: {
    id: 'boulder',
    names: ['Boulder', 'Granite Boulder', 'Quake Boulder'],
    base: { element: 'earth', maxRange: 190, falloff: 0.35, interceptHp: 34, aimAssist: aim(0.86, 0.14) },
    tiers: [
      { speed: 52, gravity: 14, area: 8, hitRadius: 2.2, structureMult: 2.6, effects: [], terrain: { radius: 8, amount: -2.6, kind: 1 }, cds: [18, 20, 22] },
      { speed: 55, gravity: 14, area: 9.5, hitRadius: 2.4, structureMult: 2.7, effects: [{ type: 'slow', mult: 0.75, durationTicks: 40 }], terrain: { radius: 10, amount: -3.2, kind: 1 }, cds: [17, 19, 21] },
      { speed: 58, gravity: 14, area: 11, hitRadius: 2.6, structureMult: 2.8, effects: [{ type: 'slow', mult: 0.7, durationTicks: 60 }], aftershock: { delayTicks: 12, radius: 11, damageMult: 0.5 }, terrain: { radius: 12, amount: -4, kind: 1 }, cds: [16, 18, 20] },
    ],
  },
  air: {
    id: 'lightning',
    names: ['Lightning Bolt', 'Storm Bolt', 'Thunder Arc'],
    base: { element: 'air', maxRange: 340, gravity: 0, area: 2, falloff: 0.3, interceptHp: 6, aimAssist: aim(0.9, 0.05), structureMult: 0.7, effects: [] },
    tiers: [
      { speed: 190, hitRadius: 1.2, cds: [7, 8, 9] },
      { speed: 200, hitRadius: 1.2, cds: [6, 7, 8] },
      { speed: 210, hitRadius: 1.3, chain: { count: 1, radius: 22, falloff: 0.6 }, cds: [5, 6, 7] },
    ],
  },
};

const TIER_COST = [0, 90, 180];

function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function solvePrimary(d: Design) {
  const out: SpellDef[] = [];
  d.tiers.forEach((t, i) => {
    // A higher tier must never be weaker per hit, slower to fire, or cheaper to cast.
    const prev = out[i - 1];
    const merged = { ...d.base, ...t } as SpellDef;
    merged.name = d.names[i]!;
    merged.damage = 0;
    merged.manaCost = 1;
    merged.cooldownTicks = 10;
    const e0 = effectiveDamage(merged);
    merged.damage = 1;
    const k = effectiveDamage(merged) - e0;
    const B = balance.primaryBudget.dps[i]!;
    const eta = balance.primaryBudget.efficiency[i]!;
    let best: { c: number; m: number; dmg: number; err: number } | null = null;
    for (const c of t.cds) {
      const E = (B * c) / TICKS;
      for (let m = 4; m <= 30; m++) {
        const dmg = round((E - e0) / k, 1);
        if (prev && (dmg < prev.damage || c > prev.cooldownTicks || m < prev.manaCost)) continue;
        const probe = { ...merged, damage: dmg, cooldownTicks: c, manaCost: m };
        const e = effectiveDamage(probe);
        const err = Math.max(Math.abs((e * TICKS) / c / B - 1), Math.abs(e / m / eta - 1));
        if (!best || err < best.err) best = { c, m, dmg, err };
      }
    }
    merged.damage = best!.dmg;
    merged.cooldownTicks = best!.c;
    merged.manaCost = best!.m;
    console.log(`${d.id} t${i + 1}: dmg ${best!.dmg} cd ${best!.c} mana ${best!.m} (worst error ${(best!.err * 100).toFixed(1)}%)`);
    out.push(merged);
  });
  return out;
}

function toEntry(d: Design, tiers: SpellDef[]) {
  const [t1, ...rest] = tiers;
  const entry: Record<string, unknown> = { ...t1 };
  entry.tierNames = d.names;
  entry.tiers = rest.map((t, i) => {
    const ov: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      if (JSON.stringify(v) !== JSON.stringify((t1 as unknown as Record<string, unknown>)[k])) ov[k] = v;
    }
    // Always spell out the numbers that define power, so the table is readable.
    ov.name = t.name;
    ov.upgradeCost = TIER_COST[i + 1];
    ov.damage = t.damage;
    ov.manaCost = t.manaCost;
    ov.cooldownTicks = t.cooldownTicks;
    ov.effects = t.effects;
    return ov;
  });
  return entry;
}

function solveSignature(base: SpellDef, cds: number[], eta = balance.signature.efficiency): SpellDef {
  const v = signatureValue(base);
  let best = { c: cds[0]!, m: 10, err: Infinity };
  for (const c of cds) {
    for (let m = 8; m <= 60; m++) {
      const err = Math.max(Math.abs(((v * TICKS) / c) / balance.signature.valuePerSecond - 1), Math.abs(v / m / eta - 1));
      if (err < best.err) best = { c, m, err };
    }
  }
  console.log(`${base.name}: value ${v.toFixed(1)} cd ${best.c} mana ${best.m} (error ${(best.err * 100).toFixed(1)}%)`);
  return { ...base, cooldownTicks: best.c, manaCost: best.m };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sigBase = { speed: 0, maxRange: 0, gravity: 0, area: 0, falloff: 0, hitRadius: 0, structureMult: 0, interceptHp: 0, damage: 0, effects: [] as SpellDef['effects'] };

const signatures: Record<string, SpellDef> = {
  firestorm: solveSignature({ ...sigBase, name: 'Firestorm', element: 'fire', kind: 'zone', manaCost: 1, cooldownTicks: 1, castRange: 55, radius: 14, durationTicks: 150, dps: 15, structureMult: 0.6 }, range(300, 520)),
  frostnova: solveSignature({ ...sigBase, name: 'Frost Nova', element: 'water', kind: 'nova', manaCost: 1, cooldownTicks: 1, radius: 26, damage: 16, effects: [{ type: 'slow', mult: 0.5, durationTicks: 120 }], structureMult: 0.5 }, range(150, 300)),
  stonewall: solveSignature({ ...sigBase, name: 'Stone Wall', element: 'earth', kind: 'wall', manaCost: 1, cooldownTicks: 1, wall: { segments: 5, spacing: 6.5, distance: 22, amount: 11, radius: 5.5 } }, range(200, 320)),
  galedash: solveSignature({ ...sigBase, name: 'Gale Dash', element: 'air', kind: 'dash', manaCost: 1, cooldownTicks: 1, dash: { speedMult: 1.75, durationTicks: 75 } }, range(200, 320)),
};

const spells: Record<string, unknown> = {
  kits: {
    fire: { primary: 'fireball', signature: 'firestorm' },
    water: { primary: 'frostchain', signature: 'frostnova' },
    earth: { primary: 'boulder', signature: 'stonewall' },
    air: { primary: 'lightning', signature: 'galedash' },
  },
};
for (const d of Object.values(designs)) spells[d.id] = toEntry(d, solvePrimary(d));
Object.assign(spells, signatures);
spells['genie-bolt'] = (oldSpells as unknown as Record<string, unknown>)['genie-bolt'];
spells.combos = [
  { id: 'steam', name: 'Steam Cloud', needs: ['water', 'fire'], description: 'Water bolts crossing a fire zone make a scalding, vision-blocking steam cloud.', durationTicks: 150, radius: 16, dps: 12, slowMult: 0.7 },
  { id: 'firetornado', name: 'Fire Tornado', needs: ['air', 'fire'], description: 'Lightning through a Firestorm whips it into a roaming fire tornado.', durationTicks: 120, radius: 10, dps: 22, slowMult: 1 },
  { id: 'channel', name: 'Earth Channel', needs: ['earth', 'water'], description: 'Frost Chain bolts fired along a Stone Wall are channelled and chain twice as far.', durationTicks: 180, radius: 12, dps: 0, slowMult: 0.5 },
];
writeFileSync(new URL('../src/data/spells.json', import.meta.url), JSON.stringify(spells, null, 2) + '\n');
console.log('wrote src/data/spells.json');
