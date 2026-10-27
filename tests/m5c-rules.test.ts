import { describe, expect, it } from 'vitest';
import castleData from '../src/data/castles.json';
import { CHAPTERS } from '../src/data/chapters';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import matchData from '../src/data/match.json';
import { CREATURES } from '../src/sim/combat';
import { damageCastle } from '../src/sim/castles';
import { Sim } from '../src/sim/sim';

const mk = (i: number) => {
  const c = CHAPTERS[i]!;
  return new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], 'normal') });
};
const idle = [{ steer: 0, throttle: 0, actions: 0 }];

describe('castle damage shakes mana loose every 20%', () => {
  it('releases one batch per 20% of wall HP and none for smaller hits', () => {
    const s = mk(0);
    const c = s.castles[1]!;
    const releases = () => s.events.filter((e) => e.type === 'castleRelease').length;
    damageCastle(s, c, c.maxHp * 0.15, 0);
    expect(releases()).toBe(0);
    damageCastle(s, c, c.maxHp * 0.1, 0); // 25% total
    expect(releases()).toBe(1);
    const orbsBefore = s.orbs.length;
    damageCastle(s, c, c.maxHp * 0.4, 0); // 65% total: steps at 40% and 60%
    expect(releases()).toBe(3);
    expect(s.orbs.length).toBeGreaterThan(orbsBefore);
    expect(c.hp).toBeGreaterThan(0);
  });

  it('scales with castle tier and resets after a tier drops', () => {
    const rel = castleData.damageRelease;
    expect(rel.step).toBeCloseTo(0.2);
    const s = mk(0);
    const c = s.castles[1]!;
    const first = c.tier;
    damageCastle(s, c, c.maxHp * 0.21, 0);
    const ev = s.events.filter((e) => e.type === 'castleRelease');
    expect(ev[0]!.v).toBe(rel.base + rel.perTier * first);
    damageCastle(s, c, c.maxHp * 10, 0);
    if (!c.ruined) expect(c.released).toBe(0);
  });
});

describe('smaller maps and fewer, sensibly scaling enemies', () => {
  it('castles are close together in every chapter', () => {
    for (let i = 0; i < CHAPTERS.length; i++) {
      const s = mk(i);
      for (const a of s.castles) {
        for (const b of s.castles) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z), CHAPTERS[i]!.id).toBeLessThan(matchData.castleSiteDistance * 2.6);
      }
    }
  });

  it('enemy density rises with the chapter and early chapters are calm', () => {
    const d = CHAPTERS.map((c) => c.enemyDensity);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThanOrEqual(d[i - 1]!);
    expect(d[0]!).toBeLessThan(0.8);
    expect(d[5]!).toBeGreaterThan(d[0]! * 2);
  });

  it('chapter 1 never has a swarm; chapter 6 is busier but capped', () => {
    const peak = (i: number) => {
      const s = mk(i);
      let hi = 0;
      for (let t = 0; t < 30 * 120; t++) {
        s.step(idle);
        if (t % 30 === 0) hi = Math.max(hi, s.creatures.filter((c) => CREATURES[c.type]!.hostile).length);
      }
      return hi;
    };
    const p1 = peak(0);
    const p6 = peak(5);
    expect(p1).toBeLessThanOrEqual(8);
    expect(p6).toBeGreaterThan(p1);
    expect(p6).toBeLessThanOrEqual(18);
  }, 60000);

  it('mana is plentiful: orbs and wells are common', () => {
    const s = mk(0);
    for (let t = 0; t < 30 * 60; t++) s.step(idle);
    expect(s.orbs.length).toBeGreaterThan(30);
    expect(s.nextWellTick - s.tick).toBeLessThan(1300);
  });
});
