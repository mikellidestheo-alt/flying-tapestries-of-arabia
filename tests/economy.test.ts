import { describe, expect, it } from 'vitest';
import castleData from '../src/data/castles.json';
import { CHAPTERS } from '../src/data/chapters';
import creatureData from '../src/data/creatures.json';
import matchData from '../src/data/match.json';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import simData from '../src/data/sim.json';
import { BALANCE } from '../src/sim/balance';
import { archerDps, castleStats } from '../src/sim/castles';
import { hurtCreature } from '../src/sim/combat';
import { Sim } from '../src/sim/sim';

const make = (chapter = 0) => {
  const c = CHAPTERS[chapter]!;
  const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], 'normal') });
  for (const w of s.players.slice(1)) w.mana = 0; // rivals must not upgrade mid-test
  return s;
};
const idle = [{ steer: 0, throttle: -1, actions: 0 }];

describe('fallen enemies pay for the mana it took to kill them, plus extra', () => {
  it('every creature drops at least 20% more than a typical (65% accurate) fireball volley costs', () => {
    const eff = BALANCE.primaryBudget.efficiency[0]!;
    for (const [id, def] of Object.entries(creatureData as Record<string, { hp: number; manaDrop: number; orbCount: number }>)) {
      const cost = def.hp / eff / 0.65;
      expect(def.manaDrop, id).toBeGreaterThanOrEqual(cost * 1.2);
      expect(def.orbCount, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('a kill really scatters orbs worth the full drop', () => {
    const s = make();
    s.spawnCreature('dust-sprite', 500, 500);
    const c = s.creatures[0]!;
    s.orbs.length = 0;
    hurtCreature(s, c, 9999, 0);
    const total = s.orbs.reduce((a, o) => a + o.value, 0);
    expect(total).toBeCloseTo(creatureData['dust-sprite'].manaDrop, 3);
  });
});

describe('one shared mana pool', () => {
  it('castle income goes straight into the wizard pool and counts towards the share', () => {
    const s = make();
    const p = s.players[0]!;
    const m0 = p.mana;
    const cap0 = s.factions[0]!.captured;
    for (let t = 0; t < 300; t++) s.step(idle);
    expect(p.mana - m0).toBeGreaterThan(8); // ten seconds of tier-1 income
    expect(s.factions[0]!.captured - cap0).toBeGreaterThanOrEqual(p.mana - m0 - 1);
    expect('bank' in s.castles[0]!).toBe(false);
  });

  it('upgrades, weapon tiers and spells all draw on that one pool', () => {
    const s = make();
    const p = s.players[0]!;
    const c = s.castles[0]!;
    p.x = c.x; p.z = c.z; p.y = c.y + 20;
    p.mana = 300;
    s.step([{ steer: 0, throttle: -1, actions: 8 }]); // ACTION_UPGRADE
    expect(c.tier).toBe(2);
    expect(p.mana).toBeLessThan(300 - castleData.tiers[1]!.cost + 1);
  });

  it('income is much higher than before and keeps growing with the tier', () => {
    const t = castleData.tiers.map((x) => x.income);
    expect(t[0]!).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    // A tier-3 castle pays for the next upgrade (300) within a few minutes on its own.
    expect(300 / castleStats(3, []).income).toBeLessThan(150);
  });

  it('the pool is big enough for the costliest upgrade', () => {
    expect(simData.player.maxMana).toBeGreaterThanOrEqual(castleData.tiers[4]!.cost * 1.5);
  });
});

describe('mana is plentiful and the map is compact', () => {
  it('wells come in pairs, more often and nearer', () => {
    expect(simData.wells.perSpawn).toBe(2);
    const s = make();
    for (let t = 0; t < simData.wells.firstTick + 5; t++) s.step(idle);
    expect(s.wells.length).toBe(2);
    expect(Math.hypot(s.wells[0]!.x - s.wells[1]!.x, s.wells[0]!.z - s.wells[1]!.z)).toBeLessThan(simData.wells.pairMax + 1);
    expect(simData.wells.maxDistance).toBeLessThanOrEqual(220);
  });

  it('castle sites are close in every chapter', () => {
    expect(matchData.castleSiteDistance).toBeLessThanOrEqual(380);
    for (let i = 0; i < CHAPTERS.length; i++) {
      const s = make(i);
      const home = s.castles[0]!;
      for (const c of s.castles.slice(1)) expect(Math.hypot(c.x - home.x, c.z - home.z), CHAPTERS[i]!.id).toBeLessThan(matchData.castleSiteDistance * 2.2);
    }
  });
});

describe('castle archers', () => {
  const staged = (tier: number) => {
    const s = make();
    const c = s.castles[0]!;
    c.tier = tier;
    const me = s.players[0]!;
    me.x = c.x; me.z = c.z; me.y = c.y + 60; me.invuln = 1e9;
    return { s, c, me };
  };

  it('stats rise with every tier: more archers, longer range, more damage, faster', () => {
    for (let tier = 3; tier <= 5; tier++) {
      const a = castleStats(tier - 1, []);
      const b = castleStats(tier, []);
      expect(b.archers).toBeGreaterThan(a.archers);
      expect(b.archerRange).toBeGreaterThan(a.archerRange);
      expect(b.archerDamage).toBeGreaterThan(a.archerDamage);
      expect(archerDps(tier, [])).toBeGreaterThan(archerDps(tier - 1, []));
    }
  });

  it('shoot enemy wizards (another faction) that come into range, and credit the castle owner', () => {
    const { s, c } = staged(3);
    const foe = s.players[1]!;
    foe.x = c.x + 40; foe.z = c.z; foe.y = c.y + 12; foe.invuln = 0; foe.hp = 100;
    let hit = false;
    for (let t = 0; t < 120 && !hit; t++) {
      foe.x = c.x + 40; foe.z = c.z; foe.y = c.y + 12;
      s.step(idle);
      if (foe.hp < 100) hit = true;
    }
    expect(hit).toBe(true);
    expect(foe.lastHitBy).toBe(0);
    expect(s.events.some((e) => e.type === 'arrow')).toBe(true);
  });

  it('never shoot wizards of their own faction, or peaceful animals', () => {
    const { s, c, me } = staged(4);
    s.spawnCreature('oryx', c.x + 30, c.z + 30);
    const oryxHp = s.creatures.find((q) => q.type === 'oryx')!.hp;
    for (let t = 0; t < 120; t++) {
      me.x = c.x + 30; me.z = c.z; me.y = c.y + 12; me.hp = 100;
      s.step(idle);
    }
    expect(me.hp).toBe(100);
    expect(s.creatures.find((q) => q.type === 'oryx')!.hp).toBe(oryxHp);
  });

  it('a higher-tier castle hurts an intruding wizard faster', () => {
    const timeToHurt = (tier: number) => {
      const { s, c } = staged(tier);
      const foe = s.players[1]!;
      foe.invuln = 0;
      foe.hp = 100;
      for (let t = 1; t <= 600; t++) {
        foe.x = c.x + 40; foe.z = c.z; foe.y = c.y + 12; foe.vx = foe.vz = 0;
        s.step(idle);
        if (foe.hp <= 100 - 30) return t;
      }
      return 601;
    };
    expect(timeToHurt(5)).toBeLessThan(timeToHurt(3));
    expect(timeToHurt(3)).toBeLessThan(601);
  });

  it('shoot hostile creatures at long range and several threats at once', () => {
    const { s, c } = staged(5);
    for (let i = 0; i < 4; i++) s.spawnCreature('dust-sprite', c.x + 60 + i * 8, c.z + 40);
    const hp0 = s.creatures.map((q) => q.hp);
    for (let t = 0; t < 60; t++) s.step(idle);
    const hurt = s.creatures.filter((q, i) => q.hp < (hp0[i] ?? 0)).length + (4 - s.creatures.filter((q) => q.type === 'dust-sprite').length);
    expect(hurt).toBeGreaterThanOrEqual(2); // archers spread their arrows
  });
});
