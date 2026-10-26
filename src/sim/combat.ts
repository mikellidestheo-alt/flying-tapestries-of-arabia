// Spell casting, projectiles, creature damage. Part of the deterministic sim.
import spells from '../data/spells.json';
import creatureData from '../data/creatures.json';
import simData from '../data/sim.json';
import { clamp } from './dmath';
import { dcos, dsin } from './dmath';
import type { Creature, Projectile } from './entities';
import type { Sim } from './sim';
import { SIM_DT } from './sim';

export type SpellDef = (typeof spells)['fireball'];
export const SPELLS = spells as Record<string, SpellDef>;
export const CREATURES = creatureData as Record<string, (typeof creatureData)['dust-sprite']>;

/** Spell a wizard casts. M2 placeholder: everyone throws the Fireball (full kits in M4). */
export function spellFor(): string {
  return 'fireball';
}

export function tryCast(sim: Sim, playerIndex: number): boolean {
  const p = sim.players[playerIndex]!;
  const id = spellFor();
  const def = SPELLS[id]!;
  if (p.spellCd > 0 || p.mana < def.manaCost || sim.projectiles.length >= simData.caps.projectiles) return false;

  p.mana -= def.manaCost;
  p.spellCd = def.cooldownTicks;
  const fx = dsin(p.heading);
  const fz = dcos(p.heading);
  const ox = p.x + fx * 2.5;
  const oy = p.y + 1.6;
  const oz = p.z + fz * 2.5;

  // Aim assist: lead the creature closest to the aim line, within a forward cone.
  let best: Creature | null = null;
  let bestCos = def.aimAssist.cosMin;
  for (const c of sim.creatures) {
    const dx = c.x - ox;
    const dy = c.y - oy;
    const dz = c.z - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > def.aimAssist.range || d < 1) continue;
    const cos = (dx * fx + dz * fz) / d;
    if (cos > bestCos) {
      bestCos = cos;
      best = c;
    }
  }

  let vx = fx * def.speed;
  let vz = fz * def.speed;
  let vy = -1.5;
  if (best) {
    const dx0 = best.x - ox;
    const dz0 = best.z - oz;
    const t0 = Math.sqrt(dx0 * dx0 + dz0 * dz0) / def.speed;
    const tx = best.x + best.vx * t0 - ox;
    const tz = best.z + best.vz * t0 - oz;
    const dist = Math.sqrt(tx * tx + tz * tz);
    if (dist > 0.5) {
      const t = dist / def.speed;
      vx = (tx / dist) * def.speed;
      vz = (tz / dist) * def.speed;
      vy = (best.y - oy + 0.5 * def.gravity * t * t) / t;
    }
  }
  const proj: Projectile = {
    id: sim.nextId++, owner: playerIndex, spell: id,
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

function impact(sim: Sim, proj: Projectile, x: number, y: number, z: number, ground: boolean): void {
  const def = SPELLS[proj.spell]!;
  const area2 = def.area * def.area;
  for (const c of sim.creatures) {
    const dx = c.x - x;
    const dy = c.y - y;
    const dz = c.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > area2 || c.hp <= 0) continue;
    const frac = Math.sqrt(d2) / def.area;
    const dmg = def.damage * (1 - def.falloff * clamp(frac, 0, 1));
    for (const e of def.effects) {
      if (e.type === 'burn') {
        c.burnTicks = e.durationTicks;
        c.burnDps = Math.max(c.burnDps, e.dps);
      }
    }
    hurtCreature(sim, c, dmg, proj.owner);
  }
  if (ground && y - sim.terrain.params.waterLevel > 0.2) {
    const t = def.terrain;
    sim.terrain.deltas.add(x, z, t.radius, t.amount, t.kind, sim.tick);
  }
  sim.emit('impact', x, y, z, proj.owner);
}

export function stepProjectiles(sim: Sim): void {
  const list = sim.projectiles;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    const def = SPELLS[p.spell]!;
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
        impact(sim, p, p.x, p.y, p.z, p.y - sim.terrain.heightAt(p.x, p.z) < def.area * 0.5);
        done = true;
        break;
      }
    }
    if (!done) {
      const ground = sim.terrain.heightAt(p.x, p.z);
      const surface = Math.max(ground, sim.terrain.params.waterLevel);
      if (p.y <= surface) {
        impact(sim, p, p.x, surface, p.z, ground > sim.terrain.params.waterLevel);
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
