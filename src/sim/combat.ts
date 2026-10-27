// Spell casting, projectiles and damage. Part of the deterministic sim.
import creatureData from '../data/creatures.json';
import matchData from '../data/match.json';
import simData from '../data/sim.json';
import { clamp, dcos, dsin } from './dmath';
import type { Creature, Projectile, Structure } from './entities';
import { damageCastle } from './castles';
import { DIFFICULTIES } from './match';
import type { PlayerState, Sim } from './sim';
import { SIM_DT } from './sim';
import { buildingTopAt, landmarkTopAt } from './terrain';

import type { Element } from '../data/elements';
import { KITS, MAX_SPELL_TIER, SPELLS, spellAt, type SpellDef, type SpellEffect } from './spelldefs';

export { KITS, MAX_SPELL_TIER, SPELLS, spellAt };
export type { SpellDef, SpellEffect };

export interface CreatureDef {
  name: string;
  hp: number;
  speed: number;
  wanderSpeed: number;
  aggroRange: number;
  leashRange: number;
  fleeRange: number;
  attackRange: number;
  attackDamage: number;
  attackCooldownTicks: number;
  hover: number;
  hitRadius: number;
  manaDrop: number;
  orbCount: number;
  wanderRadius: number;
  hostile: boolean;
  /** Render-only colour multiplier (variants that reuse another creature's model). */
  tint?: [number, number, number];
  ranged?: { spell: string; range: number; preferred: number; cooldownTicks: number; aimError: number };
}
export const CREATURES = creatureData as unknown as Record<string, CreatureDef>;

/** Faction id used by monster projectiles: they hurt every wizard and nothing else. */
export const MONSTER_FACTION = 99;

/** The wizard's primary attack at their current weapon tier. */
export function primaryDef(p: { element: Element; spellTier: number }): SpellDef {
  return spellAt(KITS[p.element].primary, p.spellTier);
}

export function primaryId(element: Element): string {
  return KITS[element].primary;
}

/** The wizard's signature utility spell. */
export function signatureDef(p: { element: Element }): SpellDef {
  return spellAt(KITS[p.element].signature, 1);
}

/** Cost of the next weapon tier for a wizard, or null at the top. */
export function nextSpellUpgrade(element: Element, tier: number): { tier: number; cost: number; name: string } | null {
  if (tier >= MAX_SPELL_TIER) return null;
  const def = spellAt(KITS[element].primary, tier + 1);
  return { tier: tier + 1, cost: def.upgradeCost ?? 0, name: def.name };
}

/** Spend mana to raise a wizard's weapon one tier (anywhere on the map). */
export function tryUpgradeSpell(sim: Sim, p: PlayerState): boolean {
  const up = nextSpellUpgrade(p.element, p.spellTier);
  if (!up || !p.active || p.mana < up.cost) return false;
  p.mana -= up.cost;
  p.spellTier = up.tier;
  sim.emit('spellUpgrade', p.x, p.y, p.z, up.tier);
  return true;
}

interface Target {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** 1 creature, 2 wizard (index + 1), 3 nest; used for light homing in flight. */
  kind: number;
  id: number;
}

/** Best hostile target near the aim line (see spells.json aimAssist), or null. */
export function pickTarget(sim: Sim, p: PlayerState, ox: number, oy: number, oz: number, fx: number, fz: number, assist: NonNullable<SpellDef['aimAssist']>): Target | null {
  let best: Target | null = null;
  let bestScore = -Infinity;
  const consider = (t: Target) => {
    const dx = t.x - ox;
    const dy = t.y - oy;
    const dz = t.z - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > assist.range || d < 1) return;
    const cos = (dx * fx + dz * fz) / d;
    if (cos < assist.cosMin) return;
    const score = cos - (d / assist.range) * assist.distanceWeight;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  };
  for (const c of sim.creatures) consider({ x: c.x, y: c.y, z: c.z, vx: c.vx, vz: c.vz, kind: 1, id: c.id });
  for (const s of sim.structures) if (s.alive) consider({ x: s.x, y: s.y + 4, z: s.z, vx: 0, vz: 0, kind: 3, id: s.id });
  sim.players.forEach((w, i) => {
    if (w.active && w.hp > 0 && w.faction !== p.faction) consider({ x: w.x, y: w.y, z: w.z, vx: w.vx, vz: w.vz, kind: 2, id: i + 1 });
  });
  return best;
}

export function tryCast(sim: Sim, playerIndex: number): boolean {
  const p = sim.players[playerIndex]!;
  const def = primaryDef(p);
  const id = primaryId(p.element);
  const assist = def.aimAssist!;
  if (!p.active || p.freezeTicks > 0 || p.spellCd > 0 || p.mana < def.manaCost || sim.projectiles.length >= simData.caps.projectiles) return false;

  p.mana -= def.manaCost;
  p.spellCd = def.cooldownTicks;
  p.casts++;
  const fx = dsin(p.heading);
  const fz = dcos(p.heading);
  const ox = p.x + fx * 2.5;
  const oy = p.y + 1.6;
  const oz = p.z + fz * 2.5;

  const tgt = pickTarget(sim, p, ox, oy, oz, fx, fz, assist);
  let vx = fx * def.speed;
  let vz = fz * def.speed;
  let vy = def.gravity > 0 ? -1.5 : 0;
  if (tgt) {
    const dx0 = tgt.x - ox;
    const dz0 = tgt.z - oz;
    const t0 = Math.sqrt(dx0 * dx0 + dz0 * dz0) / def.speed;
    const tx = tgt.x + tgt.vx * t0 - ox;
    const tz = tgt.z + tgt.vz * t0 - oz;
    const dist = Math.sqrt(tx * tx + tz * tz);
    if (dist > 0.5) {
      const t = dist / def.speed;
      vx = (tx / dist) * def.speed;
      vz = (tz / dist) * def.speed;
      vy = (tgt.y - oy + 0.5 * def.gravity * t * t) / t;
    }
  }
  const proj: Projectile = {
    id: sim.nextId++, owner: playerIndex, faction: p.faction, hp: def.interceptHp, spell: id,
    x: ox, y: oy, z: oz, px: ox, py: oy, pz: oz, vx, vy, vz, travelled: 0, tk: tgt ? tgt.kind : 0, tid: tgt ? tgt.id : 0, tier: p.spellTier,
  };
  sim.projectiles.push(proj);
  sim.emit('cast', ox, oy, oz, playerIndex);
  return true;
}

/** Apply a spell's status effects (burn, slow, freeze) to a creature. */
export function applyCreatureEffects(c: Creature, effects: SpellEffect[]): void {
  for (const e of effects) {
    if (e.type === 'burn') {
      c.burnTicks = Math.max(c.burnTicks, e.durationTicks);
      c.burnDps = Math.max(c.burnDps, e.dps ?? 0);
    } else if (e.type === 'slow') {
      c.slowMult = c.slowTicks > 0 ? Math.min(c.slowMult, e.mult ?? 1) : (e.mult ?? 1);
      c.slowTicks = Math.max(c.slowTicks, e.durationTicks);
    } else if (e.type === 'freeze') {
      c.freezeTicks = Math.max(c.freezeTicks, e.durationTicks);
    }
  }
}

/** Apply a spell's status effects to a wizard. `by` is the attacker's index (credit for burn kills). */
export function applyWizardEffects(w: PlayerState, effects: SpellEffect[], by: number): void {
  for (const e of effects) {
    if (e.type === 'burn') {
      w.burnTicks = Math.max(w.burnTicks, e.durationTicks);
      w.burnDps = Math.max(w.burnDps, e.dps ?? 0);
      w.burnBy = by;
    } else if (e.type === 'slow') {
      w.slowMult = w.slowTicks > 0 ? Math.min(w.slowMult, e.mult ?? 1) : (e.mult ?? 1);
      w.slowTicks = Math.max(w.slowTicks, e.durationTicks);
    } else if (e.type === 'freeze') {
      w.freezeTicks = Math.max(w.freezeTicks, e.durationTicks);
    }
  }
}

export function hurtCreature(sim: Sim, c: Creature, amount: number, owner: number): void {
  if (c.hp <= 0) return;
  c.hp -= amount;
  sim.emit('hit', c.x, c.y, c.z, amount);
  if (c.hp <= 0) killCreature(sim, c, owner);
}

function killCreature(sim: Sim, c: Creature, owner: number): void {
  const def = CREATURES[c.type]!;
  sim.emit('kill', c.x, c.y, c.z, owner);
  const p = sim.players[owner];
  if (p) p.kills++;
  const n = def.orbCount;
  for (let i = 0; i < n && sim.orbs.length < simData.caps.orbs; i++) {
    const a = sim.rng.range(0, 6.2831853);
    const speed = sim.rng.range(3, 9);
    sim.spawnOrb(c.x, c.y, c.z, def.manaDrop / n, dcos(a) * speed, dsin(a) * speed);
  }
}

/** Damage a wizard (human or rival). Death is resolved in the vitals step. */
export function hurtWizard(sim: Sim, w: PlayerState, amount: number, attacker: number): void {
  if (!w.active || w.hp <= 0 || w.invuln > 0) return;
  w.hp -= amount;
  w.lastHitBy = attacker;
  w.lastHitTick = sim.tick;
  sim.emit('hit', w.x, w.y, w.z, amount);
  if (!w.isRival) sim.emit('playerHit', w.x, w.y, w.z, amount);
}

export function hurtStructure(sim: Sim, s: Structure, amount: number, attacker: number): void {
  if (!s.alive) return;
  s.hp -= amount;
  sim.emit('hit', s.x, s.y + 4, s.z, amount);
  if (s.hp > 0) return;
  s.alive = false;
  s.respawnAt = sim.tick + matchData.nests.respawnAfterTicks;
  sim.emit('nestDestroyed', s.x, s.y + 4, s.z, attacker);
  const att = sim.players[attacker];
  if (att) att.kills++;
  const n = matchData.nests.rewardOrbs;
  for (let i = 0; i < n; i++) {
    const a = sim.rng.range(0, 6.2831853);
    const sp = sim.rng.range(4, 12);
    sim.spawnOrb(s.x, s.y + 3, s.z, matchData.nests.rewardMana / n, dcos(a) * sp, dsin(a) * sp);
  }
}

/** Damage a creature with a spell: effects first (so a kill still leaves the status), then the hit. */
function hitCreature(sim: Sim, c: Creature, dmg: number, def: SpellDef, owner: number): void {
  applyCreatureEffects(c, def.effects);
  hurtCreature(sim, c, dmg, owner);
}

function hitWizard(sim: Sim, w: PlayerState, dmg: number, def: SpellDef, owner: number): void {
  if (w.invuln === 0) applyWizardEffects(w, def.effects, owner);
  hurtWizard(sim, w, dmg, owner);
}

/** Arc to nearby hostile targets (Frost Chain / Thunder Arc), each hit weaker than the last. */
function chainFrom(sim: Sim, proj: Projectile, def: SpellDef, x: number, y: number, z: number, hitC: Set<number>, hitW: Set<number>): void {
  const chain = def.chain!;
  let cx = x;
  let cy = y;
  let cz = z;
  let dmg = def.damage;
  for (let n = 0; n < chain.count; n++) {
    dmg *= chain.falloff;
    let best: { kind: 0 | 1; c?: Creature; w?: PlayerState; i: number; d2: number } | null = null;
    const r2 = chain.radius * chain.radius;
    for (const c of sim.creatures) {
      if (c.hp <= 0 || hitC.has(c.id)) continue;
      const d2 = (c.x - cx) ** 2 + (c.y - cy) ** 2 + (c.z - cz) ** 2;
      if (d2 < r2 && (!best || d2 < best.d2 || (d2 === best.d2 && c.id < (best.c?.id ?? Infinity)))) best = { kind: 0, c, i: c.id, d2 };
    }
    sim.players.forEach((w, i) => {
      if (!w.active || w.hp <= 0 || w.faction === proj.faction || hitW.has(i)) return;
      const d2 = (w.x - cx) ** 2 + (w.y - cy) ** 2 + (w.z - cz) ** 2;
      if (d2 < r2 && (!best || d2 < best.d2)) best = { kind: 1, w, i, d2 };
    });
    const b = best as typeof best;
    if (!b) return;
    const tx = b.kind === 0 ? b.c!.x : b.w!.x;
    const ty = b.kind === 0 ? b.c!.y : b.w!.y;
    const tz = b.kind === 0 ? b.c!.z : b.w!.z;
    sim.emitLine('chain', cx, cy, cz, tx, ty, tz, proj.owner);
    if (b.kind === 0) {
      hitC.add(b.i);
      hitCreature(sim, b.c!, dmg, def, proj.owner);
    } else {
      hitW.add(b.i);
      hitWizard(sim, b.w!, dmg, def, proj.owner);
    }
    cx = tx;
    cy = ty;
    cz = tz;
  }
}

function impact(sim: Sim, proj: Projectile, x: number, y: number, z: number, ground: boolean): void {
  const def = spellAt(proj.spell, proj.tier ?? 1);
  const monster = proj.faction === MONSTER_FACTION;
  // A target is in the blast if its body (not just its centre) is inside the area.
  const falloffDamage = (d: number, reach: number) => def.damage * (1 - def.falloff * clamp(d / Math.max(0.01, reach), 0, 1));
  const hitC = new Set<number>();
  const hitW = new Set<number>();
  let first: { x: number; y: number; z: number } | null = null;

  for (const c of monster ? [] : sim.creatures) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const reach = def.area + CREATURES[c.type]!.hitRadius;
    if (d2 > reach * reach || c.hp <= 0) continue;
    hitC.add(c.id);
    first ??= c;
    hitCreature(sim, c, falloffDamage(Math.sqrt(d2), reach), def, proj.owner);
  }
  sim.players.forEach((w, i) => {
    if (!w.active || w.faction === proj.faction) return;
    const dx = w.x - x;
    const dy = w.y - y;
    const dz = w.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const reach = def.area + matchData.wizardHitRadius;
    if (d2 > reach * reach) return;
    hitW.add(i);
    first ??= w;
    hitWizard(sim, w, falloffDamage(Math.sqrt(d2), reach), def, proj.owner);
  });
  for (const s of monster ? [] : sim.structures) {
    const dx = s.x - x;
    const dz = s.z - z;
    const d2 = dx * dx + dz * dz;
    if (!s.alive || d2 > (def.area + matchData.nests.radius) ** 2) continue;
    hurtStructure(sim, s, falloffDamage(Math.sqrt(d2), def.area + matchData.nests.radius) * def.structureMult, proj.owner);
  }
  for (const c of monster ? [] : sim.castles) {
    if (c.faction === proj.faction || c.ruined) continue;
    const o = sim.terrain.obstacles.find((q) => q.id === c.id);
    const r = (o?.r ?? 12) + def.area;
    const dx = c.x - x;
    const dz = c.z - z;
    if (dx * dx + dz * dz < r * r) damageCastle(sim, c, def.damage * def.structureMult, proj.owner);
  }
  if (def.chain && first) chainFrom(sim, proj, def, first.x, first.y, first.z, hitC, hitW);
  if (def.aftershock) {
    sim.zones.push({
      id: sim.nextId++, x, y, z, r: def.aftershock.radius, ticksLeft: def.aftershock.delayTicks, faction: proj.faction, owner: proj.owner,
      dps: 0, burst: def.damage * def.aftershock.damageMult, structureMult: def.structureMult, element: def.element,
    });
  }
  if (def.terrain && ground && y - sim.terrain.params.waterLevel > 0.2 && buildingTopAt(sim.terrain.params, x, z) === 0) {
    const t = def.terrain;
    sim.terrain.deltas.add(x, z, t.radius, t.amount, t.kind, sim.tick);
  }
  sim.emit('impact', x, y, z, proj.owner);
}

/** Light guidance: bend the bolt's velocity a little toward its (moving) target, never a hard lock. */
function homeIn(sim: Sim, p: Projectile, def: SpellDef): void {
  let tx: number;
  let ty: number;
  let tz: number;
  if (p.tk === 1) {
    const c = sim.creatures.find((q) => q.id === p.tid);
    if (!c || c.hp <= 0) return;
    tx = c.x; ty = c.y; tz = c.z;
  } else if (p.tk === 2) {
    const w = sim.players[(p.tid ?? 0) - 1];
    if (!w || !w.active || w.hp <= 0) return;
    tx = w.x; ty = w.y; tz = w.z;
  } else {
    const s = sim.structures.find((q) => q.id === p.tid);
    if (!s || !s.alive) return;
    tx = s.x; ty = s.y + 4; tz = s.z;
  }
  const dx = tx - p.x;
  const dz = tz - p.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const assist = def.aimAssist;
  if (!assist || dist < 1 || dist > assist.homingRange) return;
  const sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  if (sp < 1) return;
  const cos = (p.vx * dx + p.vz * dz) / (sp * dist);
  if (cos < dcos(assist.homingMaxAngle)) return; // already past it: let it fly
  const k = assist.homingStrength;
  const t = dist / sp;
  p.vx += ((dx / dist) * sp - p.vx) * k;
  p.vz += ((dz / dist) * sp - p.vz) * k;
  const needVy = (ty - p.y + 0.5 * def.gravity * t * t) / Math.max(0.05, t);
  p.vy += (needVy - p.vy) * k;
}

export function stepProjectiles(sim: Sim): void {
  const list = sim.projectiles;
  const T = sim.terrain;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const def = spellAt(p.spell, p.tier ?? 1);
    if (p.hp <= 0) {
      sim.emit('fizzle', p.x, p.y, p.z, p.owner); // shot down by archers
      continue;
    }
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    if (p.tk) homeIn(sim, p, def);
    const monster = p.faction === MONSTER_FACTION;
    // Fast bolts (lightning) move in several short sub-steps so they cannot skip over targets.
    const sub = Math.max(1, Math.ceil((def.speed * SIM_DT) / 3));
    const h = SIM_DT / sub;
    let done = false;
    for (let s = 0; s < sub && !done; s++) {
      p.vy -= def.gravity * h;
      p.x += p.vx * h;
      p.y += p.vy * h;
      p.z += p.vz * h;
      p.travelled += def.speed * h;

      for (const c of monster ? [] : sim.creatures) {
        const r = def.hitRadius + CREATURES[c.type]!.hitRadius;
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const dz = c.z - p.z;
        if (c.hp > 0 && dx * dx + dy * dy + dz * dz < r * r) {
          impact(sim, p, p.x, p.y, p.z, p.y - T.heightAt(p.x, p.z) < def.area * 0.5);
          done = true;
          break;
        }
      }
      if (!done) {
        const r = def.hitRadius + matchData.wizardHitRadius;
        for (const wz of sim.players) {
          if (!wz.active || wz.faction === p.faction || wz.hp <= 0) continue;
          const dx = wz.x - p.x;
          const dy = wz.y - p.y;
          const dz = wz.z - p.z;
          if (dx * dx + dy * dy + dz * dz < r * r) {
            impact(sim, p, p.x, p.y, p.z, false);
            done = true;
            break;
          }
        }
      }
      if (!done && !monster) {
        for (const st of sim.structures) {
          if (!st.alive) continue;
          const dx = st.x - p.x;
          const dz = st.z - p.z;
          const r = matchData.nests.radius + def.hitRadius;
          if (dx * dx + dz * dz < r * r && p.y > st.y - 1 && p.y < st.y + matchData.nests.height + 2) {
            impact(sim, p, p.x, p.y, p.z, false);
            done = true;
            break;
          }
        }
      }
      if (!done) {
        for (const o of T.obstacles) {
          const dx = o.x - p.x;
          const dz = o.z - p.z;
          if (dx * dx + dz * dz < o.r * o.r && p.y < o.top) {
            impact(sim, p, p.x, p.y, p.z, false);
            done = true;
            break;
          }
        }
      }
      if (!done) {
        const lm = landmarkTopAt(T.params, p.x, p.z);
        if (lm > 0 && p.y < lm) {
          impact(sim, p, p.x, p.y, p.z, false);
          done = true;
        }
      }
      if (!done) {
        const roof = buildingTopAt(T.params, p.x, p.z);
        if (roof > 0 && p.y < roof) {
          impact(sim, p, p.x, roof, p.z, false);
          done = true;
        }
      }
      if (!done) {
        const ground = T.heightAt(p.x, p.z);
        const surface = Math.max(ground, T.params.waterLevel);
        if (p.y <= surface) {
          impact(sim, p, p.x, surface, p.z, ground > T.params.waterLevel);
          done = true;
        } else if (p.travelled > def.maxRange) {
          sim.emit('fizzle', p.x, p.y, p.z, p.owner);
          done = true;
        }
      }
    }
    if (!done) list[w++] = p;
  }
  list.length = w;
}

/** Hit points a hostile creature of this type starts with under the given difficulty. */
export function creatureHp(type: string, difficulty: keyof typeof DIFFICULTIES): number {
  return CREATURES[type]!.hp * DIFFICULTIES[difficulty].enemyHp;
}
