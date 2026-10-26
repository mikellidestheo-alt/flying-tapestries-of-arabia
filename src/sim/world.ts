// Ambient world systems: mana orbs, wild creatures (AI + spawning), mana wells.
import simData from '../data/sim.json';
import { clamp, dcos, dsin } from './dmath';
import { CREATURE_CHASE, CREATURE_WANDER } from './entities';
import { CREATURES, hurtCreature } from './combat';
import type { PlayerState, Sim } from './sim';
import { SIM_DT, SIM_TICK_RATE } from './sim';
import { baseHeight } from './terrain';
import { DIFFICULTIES } from './match';
import matchData from '../data/match.json';

const P = simData.player;

function nearestPlayer(sim: Sim, x: number, y: number, z: number): { p: PlayerState; d2: number } {
  let best = sim.players[0]!;
  let bd = Infinity;
  for (const p of sim.players) {
    if (!p.active || p.hp <= 0) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const dz = p.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bd) {
      bd = d2;
      best = p;
    }
  }
  return { p: best, d2: bd };
}

// ---------------------------------------------------------------- creatures
export function stepCreatures(sim: Sim): void {
  const T = sim.terrain;
  const sp = simData.creatureSpawning;
  const list = sim.creatures;

  // Spawning keeps a few hostile creatures AND a few neutral wild animals around the wizards, out of sight.
  if (sim.tick >= sp.firstSpawnTick && sim.tick % sp.spawnEveryTicks === 0 && list.length < simData.caps.creatures) {
    let hostile = 0;
    let wild = 0;
    const lim = sp.despawnDistance * sp.despawnDistance;
    for (const c of list) {
      const { d2 } = nearestPlayer(sim, c.x, c.y, c.z);
      if (d2 >= lim) continue;
      if (CREATURES[c.type]!.hostile) hostile++;
      else wild++;
    }
    const hostileTypes = sim.creatureTypes.filter((t) => CREATURES[t]!.hostile);
    const wildTypes = sim.creatureTypes.filter((t) => !CREATURES[t]!.hostile);
    const n = sim.players.length;
    let pool: string[] = [];
    if (hostile < sp.targetNear * n && hostileTypes.length > 0 && (wild >= sp.wildTarget * n || wildTypes.length === 0 || sim.rng.next() < 0.6)) pool = hostileTypes;
    else if (wild < sp.wildTarget * n && wildTypes.length > 0) pool = wildTypes;
    if (pool.length > 0) {
      const target = sim.players[sim.rng.int(0, sim.players.length)]!;
      const a = sim.rng.range(0, 6.2831853);
      const r = sim.rng.range(sp.ringMin, sp.ringMax);
      const x = target.x + dcos(a) * r;
      const z = target.z + dsin(a) * r;
      sim.spawnCreature(pool[sim.rng.int(0, pool.length)]!, x, z);
    }
  }

  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    const def = CREATURES[c.type]!;
    c.px = c.x;
    c.py = c.y;
    c.pz = c.z;

    // Burn damage over time.
    if (c.burnTicks > 0) {
      c.burnTicks--;
      hurtCreature(sim, c, c.burnDps * SIM_DT, 0);
      if (c.burnTicks === 0) c.burnDps = 0;
    }
    if (c.hp <= 0) continue;

    const { p: target, d2 } = nearestPlayer(sim, c.x, c.y, c.z);
    const dist = Math.sqrt(d2);
    if (dist > simData.creatureSpawning.despawnDistance) continue; // too far: despawn

    if (!def.hostile) {
      // Wild animal: wander, bolt away from any wizard that gets close, never attack.
      c.state = dist < def.fleeRange ? CREATURE_CHASE : CREATURE_WANDER;
    } else if (c.state === CREATURE_WANDER) {
      if (dist < def.aggroRange) c.state = CREATURE_CHASE;
    } else if (dist > def.leashRange) {
      c.state = CREATURE_WANDER;
      c.homeX = c.x;
      c.homeZ = c.z;
    }

    let tx: number;
    let tz: number;
    let speed: number;
    let ty: number;
    if (c.state === CREATURE_CHASE && !def.hostile) {
      // Flee: run directly away from the nearest wizard.
      tx = c.x + (c.x - target.x);
      tz = c.z + (c.z - target.z);
      speed = def.speed;
      ty = T.surfaceAt(c.x, c.z) + def.hover;
    } else if (c.state === CREATURE_CHASE) {
      tx = target.x;
      tz = target.z;
      speed = dist > def.attackRange * 0.7 ? def.speed : 0;
      ty = target.y - 1;
    } else {
      if (sim.tick >= c.wanderUntil) {
        const a = sim.rng.range(0, 6.2831853);
        const r = sim.rng.range(0, def.wanderRadius);
        c.wx = c.homeX + dcos(a) * r;
        c.wz = c.homeZ + dsin(a) * r;
        c.wanderUntil = sim.tick + sim.rng.int(60, 180);
      }
      tx = c.wx;
      tz = c.wz;
      speed = def.wanderSpeed;
      ty = T.surfaceAt(c.x, c.z) + def.hover;
    }
    const dx = tx - c.x;
    const dz = tz - c.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.5 && speed > 0) {
      c.vx = (dx / len) * speed;
      c.vz = (dz / len) * speed;
    } else {
      c.vx *= 0.8;
      c.vz *= 0.8;
    }
    c.x += c.vx * SIM_DT;
    c.z += c.vz * SIM_DT;
    const floor = T.surfaceAt(c.x, c.z) + (def.hover > 0 ? 1.5 : 0.9);
    const bob = def.hover > 0 ? dsin(sim.tick * 0.12 + c.id) * 0.6 : 0;
    c.y += (Math.max(floor, ty + bob) - c.y) * 0.12;
    if (c.y < floor) c.y = floor;

    // Attack.
    if (c.cd > 0) c.cd--;
    if (def.hostile && c.state === CREATURE_CHASE && c.cd === 0 && dist <= def.attackRange && target.invuln === 0) {
      const dmg = def.attackDamage * (sim.setup ? DIFFICULTIES[sim.setup.difficulty].enemyDamage : 1);
      target.hp -= dmg;
      target.lastHitBy = -1;
      c.cd = def.attackCooldownTicks;
      target.invuln = Math.max(target.invuln, 6);
      if (!target.isRival) sim.emit('playerHit', target.x, target.y, target.z, dmg);
    }
    list[w++] = c;
  }
  list.length = w;
}

// ---------------------------------------------------------------- orbs
export function stepOrbs(sim: Sim): void {
  const o = simData.orbs;
  const T = sim.terrain;

  if (sim.tick % o.ambientEveryTicks === 0 && sim.orbs.length < simData.caps.orbs) {
    const target = sim.players[sim.rng.int(0, sim.players.length)]!;
    let near = 0;
    const r2 = o.ambientRadiusMax * o.ambientRadiusMax;
    for (const orb of sim.orbs) {
      const dx = orb.x - target.x;
      const dz = orb.z - target.z;
      if (dx * dx + dz * dz < r2) near++;
    }
    if (near < o.ambientNearMax) {
      const a = sim.rng.range(0, 6.2831853);
      const r = sim.rng.range(o.ambientRadiusMin, o.ambientRadiusMax);
      const cx = target.x + dcos(a) * r;
      const cz = target.z + dsin(a) * r;
      const n = sim.rng.int(1, 4);
      for (let i = 0; i < n && sim.orbs.length < simData.caps.orbs; i++) {
        const x = cx + sim.rng.range(-5, 5);
        const z = cz + sim.rng.range(-5, 5);
        sim.spawnOrb(x, T.surfaceAt(x, z) + o.ambientAltitude, z, o.ambientValue, 0, 0);
      }
    }
  }

  const list = sim.orbs;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const orb = list[i]!;
    orb.px = orb.x;
    orb.py = orb.y;
    orb.pz = orb.z;
    orb.age++;
    if (orb.age > o.lifetimeTicks) continue;
    const { p, d2 } = nearestPlayer(sim, orb.x, orb.y, orb.z);
    if (d2 > o.despawnDistance * o.despawnDistance) continue;

    // Burst-out drift from a kill, decaying.
    orb.x += orb.vx * SIM_DT;
    orb.z += orb.vz * SIM_DT;
    orb.vx *= 0.9;
    orb.vz *= 0.9;
    const minY = T.surfaceAt(orb.x, orb.z) + 1.4;
    if (orb.y < minY) orb.y += (minY - orb.y) * 0.3;

    if (p.mana < P.maxMana) {
      const dist = Math.sqrt(d2);
      if (dist < P.absorbRadius) {
        sim.gainMana(p, orb.value);
        if (!p.isRival) sim.emit('orb', orb.x, orb.y, orb.z, orb.value);
        continue;
      }
      if (dist < P.magnetRadius) {
        const pull = (P.magnetSpeed * (1.2 - dist / P.magnetRadius)) * SIM_DT;
        orb.x += ((p.x - orb.x) / dist) * pull;
        orb.y += ((p.y - orb.y) / dist) * pull;
        orb.z += ((p.z - orb.z) / dist) * pull;
      }
    }
    list[w++] = orb;
  }
  list.length = w;
}

// ---------------------------------------------------------------- wells
export function stepWells(sim: Sim): void {
  const W = simData.wells;
  const T = sim.terrain;

  if (sim.tick >= sim.nextWellTick && sim.wells.length < Math.min(W.maxActive, simData.caps.wells)) {
    const target = sim.players[sim.rng.int(0, sim.players.length)]!;
    let placed = false;
    for (let attempt = 0; attempt < 8 && !placed; attempt++) {
      const a = sim.rng.range(0, 6.2831853);
      const r = sim.rng.range(W.minDistance, W.maxDistance);
      const x = target.x + dcos(a) * r;
      const z = target.z + dsin(a) * r;
      if (baseHeight(T.params, x, z) > T.params.waterLevel + 1.5) {
        const y = T.surfaceAt(x, z);
        sim.wells.push({ id: sim.nextId++, x, y, z, reserve: W.reserve, max: W.reserve, age: 0, fade: 0 });
        sim.emit('wellSpawn', x, y, z, 0);
        placed = true;
      }
    }
    sim.nextWellTick = sim.tick + (placed ? sim.rng.int(W.minIntervalTicks, W.maxIntervalTicks) : 100);
  }

  for (const p of sim.players) p.drawing = 0;
  const list = sim.wells;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const well = list[i]!;
    well.age++;
    if (well.fade === 0) {
      if (well.reserve <= 0 || well.age > W.lifeTicks) {
        well.fade = W.fadeTicks;
        sim.emit('wellEnd', well.x, well.y, well.z, 0);
      } else {
        // Players channelling the well: hover close and the pool fills.
        for (const p of sim.players) {
          if (!p.active) continue;
          const dx = p.x - well.x;
          const dz = p.z - well.z;
          if (dx * dx + dz * dz > W.drawRadius * W.drawRadius || p.y - well.y > W.drawMaxHeight) continue;
          if (p.mana >= P.maxMana) continue;
          const amount = sim.gainMana(p, Math.min(W.drawPerSecond / SIM_TICK_RATE, well.reserve));
          well.reserve -= amount;
          p.drawing = well.id;
          if (sim.tick % 10 === 0) sim.emit('wellDraw', well.x, well.y, well.z, amount);
        }
      }
    } else {
      well.fade--;
      if (well.fade === 0) continue;
    }
    list[w++] = well;
  }
  list.length = w;
}

export function stepPlayerVitals(sim: Sim): void {
  for (const p of sim.players) {
    if (!p.active) continue;
    if (p.invuln > 0) p.invuln--;
    if (p.spellCd > 0) p.spellCd--;
    const max = sim.maxHpFor(p);
    if (p.hp <= 0) {
      sim.emit('wizardDown', p.x, p.y, p.z, sim.players.indexOf(p));
      sim.respawn(p);
    } else if (p.hp < max) p.hp = clamp(p.hp + P.hpRegenPerSecond * SIM_DT, 0, max);
  }
}

// ---------------------------------------------------------------- nests (hostile structures)
/** Nests wake when a wizard comes near, spawn guard creatures, and come back after a while. */
export function stepNests(sim: Sim): void {
  const cfg = matchData.nests;
  for (const s of sim.structures) {
    if (!s.alive) {
      if (sim.tick >= s.respawnAt) {
        s.alive = true;
        s.hp = s.max;
      }
      continue;
    }
    if (s.spawnCd > 0) s.spawnCd--;
    const guards = sim.creatureTypes.filter((t) => CREATURES[t]!.hostile);
    if (s.spawnCd > 0 || guards.length === 0) continue;
    const { d2 } = nearestPlayer(sim, s.x, s.y, s.z);
    if (d2 > cfg.wakeRadius * cfg.wakeRadius) continue;
    let alive = 0;
    for (const c of sim.creatures) if (c.nest === s.id) alive++;
    if (alive >= cfg.maxSpawned) continue;
    sim.spawnCreature(guards[sim.rng.int(0, guards.length)]!, s.x + sim.rng.range(-6, 6), s.z + sim.rng.range(-6, 6), s.id);
    s.spawnCd = cfg.spawnEveryTicks;
  }
}
