// Co-op combos between teammates' elements (defined in src/data/spells.json `combos`):
//  - Steam Cloud: a Water bolt crossing a teammate's Firestorm.
//  - Fire Tornado: an Air bolt through a teammate's Firestorm whips it into a roaming tornado.
//  - Earth Channel: a Water bolt flying along a teammate's Stone Wall chains twice as far.
// They only fire between wizards of the same faction with the two needed elements, so solo play and rivals never trigger them.
import simData from '../data/sim.json';
import spells from '../data/spells.json';
import { dcos } from './dmath';
import { SIM_DT, type Sim } from './sim';
import type { Zone } from './entities';

export interface ComboDef {
  id: string;
  name: string;
  needs: [string, string];
  description: string;
  durationTicks: number;
  radius: number;
  dps: number;
  slowMult: number;
}

export const COMBOS = (spells as unknown as { combos: ComboDef[] }).combos;
export const COMBO_INDEX: Record<string, number> = Object.fromEntries(COMBOS.map((c, i) => [c.id, i]));
const def = (id: string): ComboDef => COMBOS[COMBO_INDEX[id]!]!;

/** A raised Stone Wall that Water bolts can be channelled along for a short while. */
export interface WallChannel {
  x: number;
  z: number;
  /** Unit vector along the wall. */
  dx: number;
  dz: number;
  half: number;
  faction: number;
  untilTick: number;
}

const FIRE_COOLDOWN = 60;
const TORNADO_SPEED = 9;
const CHANNEL_REACH = 14;

function teamHas(sim: Sim, faction: number, element: string): boolean {
  for (const p of sim.players) if (p.faction === faction && p.element === element && !p.isRival) return true;
  return false;
}

export function stepCombos(sim: Sim): void {
  if (!sim.setup?.coop) return;
  for (const z of sim.zones) if ((z.comboCd ?? 0) > 0) z.comboCd!--;
  for (let i = sim.walls.length - 1; i >= 0; i--) if (sim.walls[i]!.untilTick < sim.tick) sim.walls.splice(i, 1);

  for (const p of sim.projectiles) {
    const owner = sim.players[p.owner];
    if (!owner || owner.isRival || p.hp <= 0) continue;
    const el = owner.element;
    if (el === 'water') {
      if (teamHas(sim, p.faction, 'fire')) {
        for (const z of sim.zones) {
          if (z.combo || z.element !== 'fire' || z.dps <= 0 || z.faction !== p.faction || (z.comboCd ?? 0) > 0) continue;
          if ((p.x - z.x) ** 2 + (p.z - z.z) ** 2 > z.r * z.r || Math.abs(p.y - z.y) > z.r + 12) continue;
          z.comboCd = FIRE_COOLDOWN;
          spawnCloud(sim, 'steam', p.x, z.y, p.z, z.faction, z.owner);
        }
      }
      if (teamHas(sim, p.faction, 'earth') && (p.chainMult ?? 1) === 1) {
        for (const w of sim.walls) {
          if (w.faction !== p.faction) continue;
          const rx = p.x - w.x;
          const rz = p.z - w.z;
          const along = rx * w.dx + rz * w.dz;
          const across = Math.abs(-rx * w.dz + rz * w.dx);
          if (Math.abs(along) <= w.half + CHANNEL_REACH && across < CHANNEL_REACH) {
            p.chainMult = 2;
            sim.emit('combo', p.x, p.y, p.z, COMBO_INDEX.channel!);
            break;
          }
        }
      }
    } else if (el === 'air' && teamHas(sim, p.faction, 'fire')) {
      for (const z of sim.zones) {
        if (z.combo || z.element !== 'fire' || z.dps <= 0 || z.faction !== p.faction || (z.comboCd ?? 0) > 0) continue;
        if ((p.x - z.x) ** 2 + (p.z - z.z) ** 2 > z.r * z.r || Math.abs(p.y - z.y) > z.r + 12) continue;
        z.comboCd = FIRE_COOLDOWN;
        z.ticksLeft = Math.floor(z.ticksLeft * 0.6); // the storm is spent feeding the tornado
        spawnCloud(sim, 'firetornado', z.x, z.y, z.z, z.faction, z.owner);
      }
    }
  }

  // Tornadoes drift towards the nearest hostile thing (creature or enemy wizard) and follow the ground.
  for (const z of sim.zones) {
    if (z.combo !== 'firetornado') continue;
    let bx = 0;
    let bz = 0;
    let bd = 160 * 160;
    for (const c of sim.creatures) {
      const d = (c.x - z.x) ** 2 + (c.z - z.z) ** 2;
      if (c.hp > 0 && d < bd) { bd = d; bx = c.x; bz = c.z; }
    }
    for (const w of sim.players) {
      if (!w.active || w.faction === z.faction || w.hp <= 0) continue;
      const d = (w.x - z.x) ** 2 + (w.z - z.z) ** 2;
      if (d < bd) { bd = d; bx = w.x; bz = w.z; }
    }
    if (bd < 160 * 160) {
      const len = Math.sqrt(bd) || 1;
      z.vx = ((bx - z.x) / len) * TORNADO_SPEED;
      z.vz = ((bz - z.z) / len) * TORNADO_SPEED;
    } else {
      z.vx = (z.vx ?? 0) * 0.98 + dcos(sim.tick * 0.03 + z.id) * 0.4;
      z.vz = (z.vz ?? 0) * 0.98 + dcos(sim.tick * 0.03 + z.id + 1.57) * 0.4;
    }
    z.x += (z.vx ?? 0) * SIM_DT;
    z.z += (z.vz ?? 0) * SIM_DT;
    z.y = sim.terrain.surfaceAt(z.x, z.z);
  }
}

function spawnCloud(sim: Sim, id: 'steam' | 'firetornado', x: number, y: number, z: number, faction: number, owner: number): void {
  if (sim.zones.length >= simData.caps.zones) return;
  const d = def(id);
  const zone: Zone = {
    id: sim.nextId++, x, y, z, r: d.radius, ticksLeft: d.durationTicks, faction, owner, dps: d.dps, burst: 0, structureMult: 0.4,
    element: id === 'steam' ? 'steam' : 'fire', combo: id, vx: 0, vz: 0, slow: d.slowMult < 1 ? d.slowMult : undefined,
  };
  sim.zones.push(zone);
  sim.emit('combo', x, y, z, COMBO_INDEX[id]!);
}
