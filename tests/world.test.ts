import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import simData from '../src/data/sim.json';
import { CREATURES, SPELLS, hurtCreature } from '../src/sim/combat';
import { ACTION_SPELL, Sim, type PlayerInput } from '../src/sim/sim';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });
const make = (n = 1) => new Sim({ terrain: CHAPTERS[0]!.terrain, playerCount: n });
const run = (s: Sim, ticks: number, f: (i: number) => PlayerInput = () => input()) => {
  for (let i = 0; i < ticks; i++) s.step([f(i)]);
};

describe('spell: fireball', () => {
  it('spends mana, sets a cooldown, and refuses when broke or cooling down', () => {
    const s = make();
    const p = s.players[0]!;
    const start = p.mana;
    s.step([input(0, 0, ACTION_SPELL)]);
    expect(s.projectiles.length).toBe(1);
    expect(p.mana).toBe(start - SPELLS.fireball!.manaCost);
    s.step([input(0, 0, ACTION_SPELL)]); // still cooling down
    expect(s.projectiles.length).toBe(1);
    p.mana = 0;
    run(s, 20);
    s.step([input(0, 0, ACTION_SPELL)]);
    expect(s.projectiles.length).toBeLessThanOrEqual(1);
    expect(p.mana).toBe(0);
  });

  it('flies, lands on the ground and leaves a crater delta', () => {
    const s = make();
    s.step([input(0, 0, ACTION_SPELL)]);
    for (let i = 0; i < 200 && s.projectiles.length > 0; i++) s.step([input()]);
    expect(s.projectiles.length).toBe(0);
    expect(s.events.some((e) => e.type === 'impact')).toBe(true);
    expect(s.terrain.deltas.list.length).toBe(1);
  });

  it('hits and burns a creature, killing it and dropping mana orbs', () => {
    const s = make();
    const p = s.players[0]!;
    // Place a sprite directly ahead of the tapestry (heading 0 = +z).
    s.spawnCreature('dust-sprite', p.x, p.z + 60);
    const c = s.creatures[0]!;
    c.state = 0;
    c.wanderUntil = 1e9;
    c.wx = c.x;
    c.wz = c.z;
    c.homeX = c.x;
    c.homeZ = c.z;
    p.mana = 200;
    const orbsBefore = s.orbs.length;
    for (let i = 0; i < 400 && s.creatures.length > 0; i++) s.step([input(0, -1, i % 14 === 0 ? ACTION_SPELL : 0)]);
    expect(s.creatures.length).toBe(0);
    expect(s.events.some((e) => e.type === 'hit')).toBe(true);
    expect(s.events.some((e) => e.type === 'kill')).toBe(true);
    expect(p.kills).toBe(1);
    expect(s.orbs.length).toBeGreaterThanOrEqual(orbsBefore + CREATURES['dust-sprite']!.orbCount);
  });
});

describe('mana orbs and wells', () => {
  it('absorbing an orb adds its value, capped at the pool size', () => {
    const s = make();
    const p = s.players[0]!;
    p.mana = 10;
    s.spawnOrb(p.x, p.y, p.z, 25, 0, 0);
    s.step([input()]);
    expect(p.mana).toBeCloseTo(35, 5);
    p.mana = simData.player.maxMana - 1;
    s.spawnOrb(p.x, p.y, p.z, 25, 0, 0);
    s.step([input()]);
    expect(p.mana).toBe(simData.player.maxMana);
  });

  it('spawns ambient orbs over time, bounded by the cap', () => {
    const s = make();
    run(s, 3000, (i) => input(Math.sin(i / 50) * 0.5, 0.3));
    expect(s.orbs.length).toBeGreaterThan(0);
    expect(s.orbs.length).toBeLessThanOrEqual(simData.caps.orbs);
  });

  it('a mana well appears and refills the pool while you hover beside it', () => {
    const s = make();
    run(s, simData.wells.firstTick + 2);
    expect(s.wells.length).toBe(simData.wells.perSpawn); // wells come in pairs
    expect(s.events.filter((e) => e.type === 'wellSpawn').length).toBe(simData.wells.perSpawn);
    const well = s.wells[0]!;
    const p = s.players[0]!;
    p.mana = 5;
    p.x = well.x;
    p.z = well.z;
    p.y = well.y + 10;
    const reserve = well.reserve;
    s.step([input(0, -1)]);
    expect(p.drawing).toBe(well.id);
    expect(p.mana).toBeGreaterThan(5);
    expect(well.reserve).toBeLessThan(reserve);
    expect(Math.abs(reserve - well.reserve - (p.mana - 5))).toBeLessThan(1e-6);
  });

  it('wells expire and never exceed the active cap', () => {
    const s = make();
    let maxSeen = 0;
    for (let i = 0; i < 20000; i++) {
      s.step([input()]);
      maxSeen = Math.max(maxSeen, s.wells.length);
    }
    expect(maxSeen).toBeLessThanOrEqual(simData.wells.maxActive);
  });
});

describe('creatures and the player', () => {
  it('chase and hurt the player, who respawns at the spawn point with a mana penalty', () => {
    const s = make();
    const p = s.players[0]!;
    for (let i = 0; i < 6; i++) s.spawnCreature('dust-sprite', p.x + 5 + i, p.z + 5);
    p.mana = 100;
    let died = false;
    for (let i = 0; i < 900 && !died; i++) {
      s.step([input(0, -1)]);
      died = s.events.some((e) => e.type === 'respawn');
    }
    expect(died).toBe(true);
    expect(p.deaths).toBe(1);
    expect(p.mana).toBeLessThan(100);
    expect(p.hp).toBe(simData.player.maxHp);
    expect(p.invuln).toBeGreaterThan(0);
  });

  it('respect hard caps and keep a wild population near the player', () => {
    const s = make();
    run(s, 4000, (i) => input(Math.sin(i / 30), 1));
    expect(s.creatures.length).toBeLessThanOrEqual(simData.caps.creatures);
    expect(s.projectiles.length).toBeLessThanOrEqual(simData.caps.projectiles);
  });
});

describe('determinism of the whole world', () => {
  it('identical inputs give identical state, including every entity', () => {
    const play = () => {
      const s = make(2);
      for (let i = 0; i < 3000; i++) {
        s.step([
          input(Math.sin(i / 37), i % 120 < 60 ? 1 : -0.2, i % 9 === 0 ? ACTION_SPELL : 0),
          input(Math.cos(i / 53), 0.4, i % 15 === 0 ? ACTION_SPELL : 0),
        ]);
      }
      return JSON.stringify({ p: s.players, o: s.orbs, c: s.creatures, w: s.wells, d: s.terrain.deltas.toArray(), r: s.rng.getState(), e: s.eventSeq });
    };
    expect(play()).toBe(play());
  });

  it('event log stays bounded', () => {
    const s = make();
    run(s, 6000, (i) => input(0.2, 0.2, i % 13 === 0 ? ACTION_SPELL : 0));
    expect(s.events.length).toBeLessThanOrEqual(simData.caps.events);
  });
});

describe('wild animals (neutral mana source)', () => {
  const sandbox = () => new Sim({ terrain: CHAPTERS[0]!.terrain, creatureTypes: ['oryx'] });

  it('flee from a nearby wizard and never attack', () => {
    const s = sandbox();
    const p = s.players[0]!;
    s.spawnCreature('oryx', p.x + 30, p.z + 30);
    const a = s.creatures[0]!;
    const d0 = Math.hypot(a.x - p.x, a.z - p.z);
    for (let i = 0; i < 90; i++) s.step([input(0, -1)]); // the wizard brakes to a hover
    const alive = s.creatures.find((c) => c.id === a.id)!;
    expect(Math.hypot(alive.x - p.x, alive.z - p.z)).toBeGreaterThan(d0 + 20);
    expect(p.hp).toBe(simData.player.maxHp);
    expect(s.events.some((e) => e.type === 'playerHit')).toBe(false);
  });

  it('give mana orbs when hunted, and the spawner keeps a small herd nearby', () => {
    const s = sandbox();
    const p = s.players[0]!;
    s.spawnCreature('oryx', p.x + 400, p.z + 400); // far from the wizard, so its orbs are not absorbed
    const a = s.creatures[0]!;
    const orbs0 = s.orbs.length;
    hurtCreature(s, a, 1000, 0);
    expect(s.creatures.length).toBe(1); // removed on the next creature step
    expect(s.events.some((e) => e.type === 'kill')).toBe(true);
    expect(s.orbs.length).toBe(orbs0 + CREATURES.oryx!.orbCount);
    expect(p.kills).toBe(1);
    const herd = sandbox();
    run(herd, 1200, () => input(0, -1));
    expect(herd.creatures.filter((c) => c.type === 'oryx').length).toBeGreaterThan(0);
  });
});
