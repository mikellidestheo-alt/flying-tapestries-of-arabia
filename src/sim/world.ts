// Ambient world systems: mana orbs, wild creatures (AI + spawning), mana wells.
import simData from '../data/sim.json';
import utility from '../data/utility-spells.json';
import { clamp, dcos, dsin } from './dmath';
import { CREATURE_CHASE, CREATURE_WANDER } from './entities';
import { CREATURES, MONSTER_FACTION, SPELLS, hurtCreature } from './combat';
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

// ---------------------------------------------------------------- co-op difficulty director
/**
 * Population multiplier for the world's hostile creatures. Solo: 1. Co-op: 1.6x the chapter's density, nudged
 * between 0.8x and 1.25x of that every 30 s by how the team is doing (a team far ahead on mana share meets
 * more enemies, a struggling team fewer). Pure function of sim state, so the server and any replay agree.
 */
export function directorFactor(sim: Sim): number {
  const c = matchData.coop;
  if (!sim.setup?.coop) return 1;
  const epoch = Math.floor(sim.tick / c.directorEveryTicks);
  const fair = 1 / Math.max(1, sim.factions.filter((f) => !f.eliminated).length);
  const share = sim.match.shares[0] ?? fair;
  // Cache per epoch so the factor does not wobble between director updates.
  if (sim.directorEpoch !== epoch) {
    sim.directorEpoch = epoch;
    sim.directorScale = clamp(1 + (share - fair) * 2, c.directorMin, c.directorMax);
  }
  return c.enemyDensityMult * sim.directorScale;
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
    const density = (sim.setup?.enemyDensity ?? 1) * directorFactor(sim);
    let pool: string[] = [];
    if (hostile < Math.ceil(sp.targetNear * density * n) && hostileTypes.length > 0 && (wild >= sp.wildTarget * n || wildTypes.length === 0 || sim.rng.next() < 0.6)) pool = hostileTypes;
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
    if (c.slowTicks > 0 && --c.slowTicks === 0) c.slowMult = 1;
    if (c.freezeTicks > 0) c.freezeTicks--;
    const mobility = c.freezeTicks > 0 ? 0 : c.slowTicks > 0 ? c.slowMult : 1;
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
    } else if (c.state === CREATURE_CHASE && def.ranged) {
      // Ranged monsters (genies) close to their preferred range, then circle the target and fire.
      const near = dist < def.ranged.preferred;
      const ux = (target.x - c.x) / Math.max(1, dist);
      const uz = (target.z - c.z) / Math.max(1, dist);
      const side = c.id % 2 === 0 ? 1 : -1;
      tx = near ? c.x - uz * side * 20 - ux * 6 : target.x;
      tz = near ? c.z + ux * side * 20 - uz * 6 : target.z;
      speed = near ? def.speed * 0.75 : def.speed;
      ty = target.y + 4;
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
      c.vx = (dx / len) * speed * mobility;
      c.vz = (dz / len) * speed * mobility;
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

    // Ranged attack: a curse bolt aimed with a little lead and a seeded error.
    if (c.cd > 0) c.cd--;
    if (def.ranged && c.freezeTicks === 0 && c.state === CREATURE_CHASE && c.cd === 0 && dist <= def.ranged.range && sim.projectiles.length < simData.caps.projectiles) {
      const bolt = SPELLS[def.ranged.spell]!;
      const t = dist / bolt.speed;
      let dx = target.x + target.vx * t * 0.8 - c.x;
      let dz = target.z + target.vz * t * 0.8 - c.z;
      const dy = target.y - c.y;
      const err = sim.rng.range(-def.ranged.aimError, def.ranged.aimError);
      const ce = dcos(err);
      const se = dsin(err);
      [dx, dz] = [dx * ce - dz * se, dx * se + dz * ce];
      const hd = Math.sqrt(dx * dx + dz * dz) || 1;
      const flight = hd / bolt.speed;
      sim.projectiles.push({
        id: sim.nextId++, owner: -1, faction: MONSTER_FACTION, hp: bolt.interceptHp, spell: def.ranged.spell,
        x: c.x, y: c.y + 1.5, z: c.z, px: c.x, py: c.y + 1.5, pz: c.z,
        vx: (dx / hd) * bolt.speed, vy: dy / Math.max(0.05, flight), vz: (dz / hd) * bolt.speed, travelled: 0, tk: 0, tid: 0, tier: 1,
      });
      c.cd = def.ranged.cooldownTicks;
      sim.emit('monsterFire', c.x, c.y + 1.5, c.z, 0);
    }
    // Melee attack.
    if (def.hostile && c.freezeTicks === 0 && c.state === CREATURE_CHASE && c.cd === 0 && dist <= def.attackRange && target.invuln === 0) {
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
    if (orb.claim) {
      // Possessed: fly to the claimant (released if they are gone or their pool is full).
      const owner = sim.players[orb.claim - 1];
      if (!owner || !owner.active || owner.mana >= P.maxMana) orb.claim = 0;
      else {
        const dx = owner.x - orb.x;
        const dy = owner.y - orb.y;
        const dz = owner.z - orb.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < utility.possess.absorbRadius) {
          sim.gainMana(owner, orb.value);
          if (!owner.isRival) sim.emit('orb', orb.x, orb.y, orb.z, orb.value);
          continue;
        }
        const step = Math.min(dist, utility.possess.pullSpeed * SIM_DT);
        orb.x += (dx / dist) * step;
        orb.y += (dy / dist) * step;
        orb.z += (dz / dist) * step;
        list[w++] = orb;
        continue;
      }
    }
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

  if (sim.tick >= sim.nextWellTick && sim.wells.length + W.perSpawn <= Math.min(W.maxActive, simData.caps.wells)) {
    const target = sim.players[sim.rng.int(0, sim.players.length)]!;
    // Wells come in pairs: the first somewhere around a wizard, the second a short flight from it.
    let ax = 0;
    let az = 0;
    let placed = 0;
    const place = (x: number, z: number): boolean => {
      if (baseHeight(T.params, x, z) <= T.params.waterLevel + 1.5) return false;
      const y = T.surfaceAt(x, z);
      sim.wells.push({ id: sim.nextId++, x, y, z, reserve: W.reserve, max: W.reserve, age: 0, fade: 0 });
      sim.emit('wellSpawn', x, y, z, 0);
      return true;
    };
    for (let attempt = 0; attempt < 8 && placed === 0; attempt++) {
      const a = sim.rng.range(0, 6.2831853);
      const r = sim.rng.range(W.minDistance, W.maxDistance);
      ax = target.x + dcos(a) * r;
      az = target.z + dsin(a) * r;
      if (place(ax, az)) placed++;
    }
    for (let attempt = 0; attempt < 8 && placed > 0 && placed < W.perSpawn; attempt++) {
      const a = sim.rng.range(0, 6.2831853);
      const r = sim.rng.range(W.pairMin, W.pairMax);
      if (place(ax + dcos(a) * r, az + dsin(a) * r)) placed++;
    }
    sim.nextWellTick = sim.tick + (placed > 0 ? sim.rng.int(W.minIntervalTicks, W.maxIntervalTicks) : 100);
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
    if (alive >= Math.max(1, Math.round(cfg.maxSpawned * (sim.setup?.enemyDensity ?? 1) * directorFactor(sim)))) continue;
    sim.spawnCreature(guards[sim.rng.int(0, guards.length)]!, s.x + sim.rng.range(-6, 6), s.z + sim.rng.range(-6, 6), s.id);
    s.spawnCd = cfg.spawnEveryTicks;
  }
}
