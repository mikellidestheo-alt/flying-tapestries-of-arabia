// Signature spells (zones, novas, walls, dashes), lasting zones, and wizard status effects.
import { clamp, dcos, dsin } from './dmath';
import { DELTA_BUMP } from './deltas';
import { applyCreatureEffects, applyWizardEffects, hurtCreature, hurtStructure, hurtWizard, pickTarget, primaryDef, signatureDef } from './combat';
import simData from '../data/sim.json';
import type { Sim } from './sim';
import { SIM_DT } from './sim';
import type { PlayerState } from './sim';

/** Cast the wizard's signature spell. Returns true if it fired. */
export function trySignature(sim: Sim, idx: number): boolean {
  const p = sim.players[idx]!;
  const def = signatureDef(p);
  if (!p.active || p.sigCd > 0 || p.mana < def.manaCost) return false;
  if (p.freezeTicks > 0 && def.kind !== 'dash') return false; // only Gale Dash breaks a freeze
  if (def.kind === 'zone' && sim.zones.length >= simData.caps.zones) return false;
  const fx = dsin(p.heading);
  const fz = dcos(p.heading);

  switch (def.kind) {
    case 'zone': {
      // Centre on the best target near the aim line, else a point ahead.
      const assist = primaryDef(p).aimAssist!;
      const t = pickTarget(sim, p, p.x, p.y, p.z, fx, fz, assist);
      const reach = def.castRange ?? 50;
      const x = t ? t.x : p.x + fx * reach;
      const z = t ? t.z : p.z + fz * reach;
      const y = sim.terrain.surfaceAt(x, z);
      sim.zones.push({
        id: sim.nextId++, x, y, z, r: def.radius ?? 12, ticksLeft: def.durationTicks ?? 120, faction: p.faction, owner: idx,
        dps: def.dps ?? 0, burst: 0, structureMult: def.structureMult, element: def.element,
      });
      sim.emit('zoneStart', x, y, z, idx);
      break;
    }
    case 'nova': {
      const r = def.radius ?? 20;
      const r2 = r * r;
      for (const c of sim.creatures) {
        if (c.hp <= 0 || (c.x - p.x) ** 2 + (c.y - p.y) ** 2 + (c.z - p.z) ** 2 > r2) continue;
        applyCreatureEffects(c, def.effects);
        hurtCreature(sim, c, def.damage, idx);
      }
      sim.players.forEach((w) => {
        if (!w.active || w.faction === p.faction || w.hp <= 0 || (w.x - p.x) ** 2 + (w.y - p.y) ** 2 + (w.z - p.z) ** 2 > r2) return;
        if (w.invuln === 0) applyWizardEffects(w, def.effects, idx);
        hurtWizard(sim, w, def.damage, idx);
      });
      for (const s of sim.structures) {
        if (s.alive && (s.x - p.x) ** 2 + (s.z - p.z) ** 2 < r2) hurtStructure(sim, s, def.damage * def.structureMult, idx);
      }
      sim.emit('nova', p.x, p.y, p.z, r);
      break;
    }
    case 'wall': {
      const w = def.wall!;
      const cx = p.x + fx * w.distance;
      const cz = p.z + fz * w.distance;
      for (let i = 0; i < w.segments; i++) {
        const off = (i - (w.segments - 1) / 2) * w.spacing;
        sim.terrain.deltas.add(cx - fz * off, cz + fx * off, w.radius, w.amount, DELTA_BUMP, sim.tick);
      }
      sim.emit('wallRaised', cx, sim.terrain.surfaceAt(cx, cz), cz, idx);
      break;
    }
    case 'dash': {
      const d = def.dash!;
      p.boostTicks = d.durationTicks;
      p.boostMult = d.speedMult;
      p.slowTicks = 0;
      p.freezeTicks = 0; // the gale tears free of any freeze or slow
      p.speed = Math.max(p.speed, 0);
      sim.emit('dash', p.x, p.y, p.z, idx);
      break;
    }
    default:
      return false;
  }
  p.mana -= def.manaCost;
  p.sigCd = def.cooldownTicks;
  return true;
}

/** Lasting zones: Firestorm burns everything hostile inside, bursts (aftershocks) go off once. */
export function stepZones(sim: Sim): void {
  const list = sim.zones;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const z = list[i]!;
    z.ticksLeft--;
    const r2 = z.r * z.r;
    const inside = (x: number, y: number, zz: number) => (x - z.x) ** 2 + (zz - z.z) ** 2 < r2 && Math.abs(y - z.y) < z.r + 12;
    const tickDmg = z.dps * SIM_DT;
    if (z.dps > 0) {
      for (const c of sim.creatures) if (c.hp > 0 && inside(c.x, c.y, c.z)) hurtCreature(sim, c, tickDmg, z.owner);
      sim.players.forEach((p) => {
        if (p.active && p.hp > 0 && p.faction !== z.faction && inside(p.x, p.y, p.z)) hurtWizard(sim, p, tickDmg, z.owner);
      });
      for (const s of sim.structures) if (s.alive && inside(s.x, s.y, s.z)) hurtStructure(sim, s, tickDmg * z.structureMult, z.owner);
    }
    if (z.ticksLeft <= 0) {
      if (z.burst > 0) {
        sim.emit('quake', z.x, z.y, z.z, z.r);
        for (const c of sim.creatures) if (c.hp > 0 && inside(c.x, c.y, c.z)) hurtCreature(sim, c, z.burst, z.owner);
        sim.players.forEach((p) => {
          if (p.active && p.hp > 0 && p.faction !== z.faction && inside(p.x, p.y, p.z)) hurtWizard(sim, p, z.burst, z.owner);
        });
        for (const s of sim.structures) if (s.alive && inside(s.x, s.y, s.z)) hurtStructure(sim, s, z.burst * z.structureMult, z.owner);
      }
      continue;
    }
    list[w++] = z;
  }
  list.length = w;
}

/** Tick down wizard status effects, apply burn damage, and cool down signatures. */
export function stepWizardStatuses(sim: Sim): void {
  for (const p of sim.players) {
    if (!p.active) continue;
    if (p.sigCd > 0) p.sigCd--;
    if (p.slowTicks > 0 && --p.slowTicks === 0) p.slowMult = 1;
    if (p.freezeTicks > 0) p.freezeTicks--;
    if (p.boostTicks > 0) p.boostTicks--;
    if (p.burnTicks > 0) {
      p.burnTicks--;
      hurtWizardDot(sim, p);
      if (p.burnTicks === 0) p.burnDps = 0;
    }
  }
}

function hurtWizardDot(sim: Sim, p: PlayerState): void {
  hurtWizard(sim, p, clamp(p.burnDps, 0, 100) * SIM_DT, p.burnBy);
}
