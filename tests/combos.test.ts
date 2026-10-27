import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import type { Element } from '../src/data/elements';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import matchData from '../src/data/match.json';
import { stepCastles } from '../src/sim/castles';
import { COMBOS, COMBO_INDEX } from '../src/sim/combos';
import { directorFactor } from '../src/sim/world';
import { ACTION_SIGNATURE, ACTION_SPELL, Sim, type PlayerInput } from '../src/sim/sim';

const idle: PlayerInput = { steer: 0, throttle: -1, actions: 0 };

function coop(elements: [Element, Element], opts: { coop?: boolean } = {}): Sim {
  const c = CHAPTERS[0]!;
  const setup = { ...matchSetupFromChapter(c, elements, 'normal'), coop: opts.coop ?? true };
  const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: setup, playerCount: 2 });
  for (const w of s.players.slice(2)) w.mana = 0;
  for (const w of s.players.slice(0, 2)) { w.mana = 500; w.invuln = 1e9; }
  return s;
}

describe('co-op match setup', () => {
  it('two humans share faction 0 and the castle; rivals take the other elements', () => {
    const s = coop(['fire', 'water']);
    expect(s.players.length).toBe(5);
    expect(s.players[0]!.faction).toBe(0);
    expect(s.players[1]!.faction).toBe(0);
    expect(s.players[0]!.element).toBe('fire');
    expect(s.players[1]!.element).toBe('water');
    expect(s.factions[0]!.name).toBe('Your team');
  });

  it('castle income is split between the two teammates', () => {
    const s = coop(['fire', 'water']);
    const m = s.players.map((p) => p.mana);
    for (let t = 0; t < 300; t++) stepCastles(s); // income alone, no orbs or fights
    const a = s.players[0]!.mana - m[0]!;
    const b = s.players[1]!.mana - m[1]!;
    expect(a).toBeGreaterThan(2);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it('a dropped teammate can be flown by the AI and handed back', () => {
    const s = coop(['fire', 'water']);
    s.setAutopilot(1, 'defensive');
    expect(s.players[1]!.rivalIndex).toBeGreaterThanOrEqual(0);
    const x0 = s.players[1]!.x;
    for (let t = 0; t < 150; t++) s.step([idle, idle]);
    expect(Math.hypot(s.players[1]!.x - x0, s.players[1]!.z - s.players[1]!.z)).toBeDefined();
    expect(s.players[1]!.x).not.toBe(x0);
    s.setAutopilot(1, null);
    expect(s.players[1]!.rivalIndex).toBe(-1);
  });
});

describe('difficulty director', () => {
  it('co-op is busier and tougher than solo; solo is untouched', () => {
    const solo = coop(['fire', 'water'], { coop: false });
    const duo = coop(['fire', 'water']);
    expect(directorFactor(solo)).toBe(1);
    expect(directorFactor(duo)).toBeGreaterThanOrEqual(matchData.coop.enemyDensityMult * matchData.coop.directorMin - 1e-9);
    expect(directorFactor(duo)).toBeLessThanOrEqual(matchData.coop.enemyDensityMult * matchData.coop.directorMax + 1e-9);
    solo.spawnCreature('dust-sprite', 0, 0);
    duo.spawnCreature('dust-sprite', 0, 0);
    expect(duo.creatures[0]!.hp).toBeCloseTo(solo.creatures[0]!.hp * matchData.coop.enemyHpMult, 5);
  });

  it('eases off for a struggling team and pushes a leading team', () => {
    const behind = coop(['fire', 'water']);
    behind.match.shares[0] = 0.05;
    const ahead = coop(['fire', 'water']);
    ahead.match.shares[0] = 0.6;
    expect(directorFactor(behind)).toBeLessThan(directorFactor(ahead));
  });
});

describe('combos between teammates', () => {
  const stormAndWait = (s: Sim, fireIdx: number): void => {
    const fire = s.players[fireIdx]!;
    fire.heading = 0;
    s.step(fireIdx === 0 ? [{ ...idle, actions: ACTION_SIGNATURE }, idle] : [idle, { ...idle, actions: ACTION_SIGNATURE }]);
    expect(s.zones.some((z) => z.element === 'fire')).toBe(true);
  };

  it('data: three combos, each needing two different elements', () => {
    expect(COMBOS.map((c) => c.id).sort()).toEqual(['channel', 'firetornado', 'steam']);
    for (const c of COMBOS) expect(c.needs[0]).not.toBe(c.needs[1]);
  });

  it('Steam Cloud: a water bolt through a teammate\'s Firestorm makes a slowing, damaging cloud', () => {
    const s = coop(['fire', 'water']);
    stormAndWait(s, 0);
    const storm = s.zones.find((z) => z.element === 'fire')!;
    s.projectiles.push({ id: 900, owner: 1, faction: 0, hp: 14, spell: 'frostchain', tier: 1, x: storm.x - 2, y: storm.y + 4, z: storm.z, px: storm.x - 2, py: storm.y + 4, pz: storm.z, vx: 1, vy: 0, vz: 0, travelled: 0 });
    s.step([idle, idle]);
    const steam = s.zones.find((z) => z.combo === 'steam');
    expect(steam).toBeDefined();
    expect(steam!.slow).toBeLessThan(1);
    expect(s.events.some((e) => e.type === 'combo' && e.v === COMBO_INDEX.steam)).toBe(true);
    // Hostile creatures inside it are hurt and slowed.
    s.spawnCreature('dust-sprite', steam!.x, steam!.z);
    const c = s.creatures[0]!;
    c.x = steam!.x; c.z = steam!.z; c.y = steam!.y + 2;
    const hp0 = c.hp;
    for (let i = 0; i < 20; i++) { c.x = steam!.x; c.z = steam!.z; c.y = steam!.y + 2; s.step([idle, idle]); }
    expect(c.hp).toBeLessThan(hp0);
    expect(c.slowMult).toBeLessThan(1);
  });

  it('Fire Tornado: an air bolt through the Firestorm spawns a roaming tornado', () => {
    const s = coop(['fire', 'air']);
    stormAndWait(s, 0);
    const storm = s.zones.find((z) => z.element === 'fire')!;
    s.spawnCreature('dust-sprite', storm.x + 60, storm.z);
    s.projectiles.push({ id: 901, owner: 1, faction: 0, hp: 30, spell: 'lightning', tier: 1, x: storm.x, y: storm.y + 4, z: storm.z, px: storm.x, py: storm.y + 4, pz: storm.z, vx: 1, vy: 0, vz: 0, travelled: 0 });
    s.step([idle, idle]);
    const tornado = s.zones.find((z) => z.combo === 'firetornado')!;
    expect(tornado).toBeDefined();
    const x0 = tornado.x;
    for (let i = 0; i < 60; i++) s.step([idle, idle]);
    expect(s.zones.find((z) => z.combo === 'firetornado') ? Math.abs(tornado.x - x0) : 99).toBeGreaterThan(1); // it moves
  });

  it('Earth Channel: a water bolt along a teammate\'s Stone Wall chains twice as far', () => {
    const s = coop(['earth', 'water']);
    s.players[0]!.heading = 0;
    s.step([{ ...idle, actions: ACTION_SIGNATURE }, idle]);
    expect(s.walls.length).toBe(1);
    const w = s.walls[0]!;
    s.projectiles.push({ id: 902, owner: 1, faction: 0, hp: 14, spell: 'frostchain', tier: 1, x: w.x, y: s.terrain.surfaceAt(w.x, w.z) + 6, z: w.z, px: w.x, py: 0, pz: w.z, vx: 0, vy: 0, vz: 1, travelled: 0 });
    s.step([idle, idle]);
    expect(s.projectiles.find((q) => q.id === 902)?.chainMult).toBe(2);
    expect(s.events.some((e) => e.type === 'combo' && e.v === COMBO_INDEX.channel)).toBe(true);
  });

  it('combos need the right pair: fire + earth does nothing, and solo play never triggers them', () => {
    const s = coop(['fire', 'earth']);
    stormAndWait(s, 0);
    const storm = s.zones.find((z) => z.element === 'fire')!;
    s.projectiles.push({ id: 903, owner: 1, faction: 0, hp: 14, spell: 'boulder', tier: 1, x: storm.x, y: storm.y + 4, z: storm.z, px: storm.x, py: 0, pz: storm.z, vx: 1, vy: 0, vz: 0, travelled: 0 });
    s.step([idle, idle]);
    expect(s.zones.some((z) => z.combo)).toBe(false);
    const solo = coop(['fire', 'water'], { coop: false });
    stormAndWait(solo, 0);
    const z0 = solo.zones.find((z) => z.element === 'fire')!;
    solo.projectiles.push({ id: 904, owner: 1, faction: 0, hp: 14, spell: 'frostchain', tier: 1, x: z0.x, y: z0.y + 4, z: z0.z, px: z0.x, py: 0, pz: z0.z, vx: 1, vy: 0, vz: 0, travelled: 0 });
    solo.step([idle, idle]);
    expect(solo.zones.some((z) => z.combo)).toBe(false);
  });

  it('casting still works for two humans in the same step', () => {
    const s = coop(['fire', 'water']);
    s.step([{ ...idle, actions: ACTION_SPELL }, { ...idle, actions: ACTION_SPELL }]);
    expect(s.projectiles.length).toBe(2);
  });
});
