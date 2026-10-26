// Spell casting, projectiles and damage. Part of the deterministic sim.
import spells from '../data/spells.json';
import creatureData from '../data/creatures.json';
import matchData from '../data/match.json';
import simData from '../data/sim.json';
import { clamp, dcos, dsin } from './dmath';
import type { Creature, Projectile, Structure } from './entities';
import { damageCastle } from './castles';
import { DIFFICULTIES } from './match';
import type { PlayerState, Sim } from './sim';
import { SIM_DT } from './sim';
import { buildingTopAt } from './terrain';

export type SpellDef = (typeof spells)['fireball'];
export const SPELLS = spells as Record<string, SpellDef>;
export const CREATURES = creatureData as Record<string, (typeof creatureData)['dust-sprite']>;

/** Spell a wizard casts. M2/M3 placeholder: everyone throws the Fireball (full kits in M4). */
export function spellFor(): string {
  return 'fireball';
}

interface Target {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

export function tryCast(sim: Sim, playerIndex: number): boolean {
  const p = sim.players[playerIndex]!;
  const id = spellFor();
  const def = SPELLS[id]!;
  if (!p.active || p.spellCd > 0 || p.mana < def.manaCost || sim.projectiles.length >= simData.caps.projectiles) return false;

  p.mana -= def.manaCost;
  p.spellCd = def.cooldownTicks;
  p.casts++;
  const fx = dsin(p.heading);
  const fz = dcos(p.heading);
  const ox = p.x + fx * 2.5;
  const oy = p.y + 1.6;
  const oz = p.z + fz * 2.5;

  // Aim assist: lead the hostile target closest to the aim line, within a forward cone.
  let best: Target | null = null;
  let bestCos = def.aimAssist.cosMin;
  const consider = (t: Target) => {
    const dx = t.x - ox;
    const dy = t.y - oy;
    const dz = t.z - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > def.aimAssist.range || d < 1) return;
    const cos = (dx * fx + dz * fz) / d;
    if (cos > bestCos) {
      bestCos = cos;
      best = t;
    }
  };
  for (const c of sim.creatures) consider(c);
  for (const s of sim.structures) if (s.alive) consider({ x: s.x, y: s.y + 4, z: s.z, vx: 0, vz: 0 });
  for (const w of sim.players) if (w.active && w.hp > 0 && w.faction !== p.faction) consider(w);

  let vx = fx * def.speed;
  let vz = fz * def.speed;
  let vy = -1.5;
  const tgt = best as Target | null;
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
    x: ox, y: oy, z: oz, px: ox, py: oy, pz: oz, vx, vy, vz, travelled: 0,
  };
  sim.projectiles.push(proj);
  sim.emit('cast', ox, oy, oz, playerIndex);
  return true;
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

function impact(sim: Sim, proj: Projectile, x: number, y: number, z: number, ground: boolean): void {
  const def = SPELLS[proj.spell]!;
  const area2 = def.area * def.area;
  const falloffDamage = (d: number) => def.damage * (1 - def.falloff * clamp(d / def.area, 0, 1));

  for (const c of sim.creatures) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > area2 || c.hp <= 0) continue;
    for (const e of def.effects) {
      if (e.type === 'burn') {
        c.burnTicks = e.durationTicks;
        c.burnDps = Math.max(c.burnDps, e.dps);
      }
    }
    hurtCreature(sim, c, falloffDamage(Math.sqrt(d2)), proj.owner);
  }
  for (const w of sim.players) {
    if (!w.active || w.faction === proj.faction) continue;
    const dx = w.x - x;
    const dy = w.y - y;
    const dz = w.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > area2) continue;
    hurtWizard(sim, w, falloffDamage(Math.sqrt(d2)), proj.owner);
  }
  for (const s of sim.structures) {
    const dx = s.x - x;
    const dz = s.z - z;
    const d2 = dx * dx + dz * dz;
    if (!s.alive || d2 > (def.area + matchData.nests.radius) ** 2) continue;
    hurtStructure(sim, s, falloffDamage(Math.sqrt(d2)) * def.structureMult, proj.owner);
  }
  for (const c of sim.castles) {
    if (c.faction === proj.faction || c.ruined) continue;
    const o = sim.terrain.obstacles.find((q) => q.id === c.id);
    const r = (o?.r ?? 12) + def.area;
    const dx = c.x - x;
    const dz = c.z - z;
    if (dx * dx + dz * dz < r * r) damageCastle(sim, c, def.damage * def.structureMult);
  }
  if (ground && y - sim.terrain.params.waterLevel > 0.2 && buildingTopAt(sim.terrain.params, x, z) === 0) {
    const t = def.terrain;
    sim.terrain.deltas.add(x, z, t.radius, t.amount, t.kind, sim.tick);
  }
  sim.emit('impact', x, y, z, proj.owner);
}

export function stepProjectiles(sim: Sim): void {
  const list = sim.projectiles;
  const T = sim.terrain;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const def = SPELLS[p.spell]!;
    if (p.hp <= 0) {
      sim.emit('fizzle', p.x, p.y, p.z, p.owner); // shot down by archers
      continue;
    }
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.vy -= def.gravity * SIM_DT;
    p.x += p.vx * SIM_DT;
    p.y += p.vy * SIM_DT;
    p.z += p.vz * SIM_DT;
    p.travelled += def.speed * SIM_DT;

    let done = false;
    for (const c of sim.creatures) {
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
    if (!done) {
      for (const s of sim.structures) {
        if (!s.alive) continue;
        const dx = s.x - p.x;
        const dz = s.z - p.z;
        const r = matchData.nests.radius + def.hitRadius;
        if (dx * dx + dz * dz < r * r && p.y > s.y - 1 && p.y < s.y + matchData.nests.height + 2) {
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
    if (!done) list[w++] = p;
  }
  list.length = w;
}

/** Hit points a hostile creature of this type starts with under the given difficulty. */
export function creatureHp(type: string, difficulty: keyof typeof DIFFICULTIES): number {
  return CREATURES[type]!.hp * DIFFICULTIES[difficulty].enemyHp;
}
