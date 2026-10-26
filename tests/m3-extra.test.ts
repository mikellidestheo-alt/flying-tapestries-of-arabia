import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import simData from '../src/data/sim.json';
import { Tutorial } from '../src/game/tutorial';
import tutorial from '../src/data/tutorial.json';
import { ACTION_SPELL, Sim, type PlayerInput } from '../src/sim/sim';
import { buildingCell, buildingTopAt, checksumFloats, sampleChunkHeights, cityFactor } from '../src/sim/terrain';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });
const make = (ch: number) => {
  const c = CHAPTERS[ch]!;
  return new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['fire'], 'normal') });
};

describe('city district (chapter 2)', () => {
  const p = CHAPTERS[1]!.terrain;

  it('has buildings, deterministically, and none outside the city mask', () => {
    const a: string[] = [];
    const b: string[] = [];
    let found = 0;
    for (let iz = -60; iz < 60; iz++) {
      for (let ix = -60; ix < 60; ix++) {
        const x = buildingCell(p, ix, iz);
        const y = buildingCell(p, ix, iz);
        a.push(JSON.stringify(x));
        b.push(JSON.stringify(y));
        if (x) {
          found++;
          expect(cityFactor(p, x.cx, x.cz)).toBeGreaterThanOrEqual(0.9);
          expect(x.top).toBeGreaterThan(p.city!.plateau + p.city!.minHeight - 1e-9);
          expect(x.top).toBeLessThanOrEqual(p.city!.plateau + p.city!.maxHeight + 1e-9);
          expect(x.half * 2).toBeLessThan(p.city!.cell); // alleys always remain between buildings
        }
      }
    }
    expect(a).toEqual(b);
    expect(found).toBeGreaterThan(50);
  });

  it('chapter 1 has no buildings and terrain checksums repeat with pads in place', () => {
    expect(buildingTopAt(CHAPTERS[0]!.terrain, 100, 100)).toBe(0);
    const s1 = make(1);
    const s2 = make(1);
    for (const [cx, cz] of [[0, 0], [5, -3]] as const) {
      expect(checksumFloats(sampleChunkHeights(s1.terrain, cx, cz, 16, simData.chunkSize))).toBe(
        checksumFloats(sampleChunkHeights(s2.terrain, cx, cz, 16, simData.chunkSize)),
      );
    }
    expect(s1.terrain.pads).toEqual(s2.terrain.pads);
  });

  it('projectiles burst on rooftops and buildings block shots', () => {
    const s = make(1);
    let spot: { x: number; z: number; top: number } | null = null;
    for (let ix = -80; ix < 80 && !spot; ix++) {
      for (let iz = -80; iz < 80 && !spot; iz++) {
        const b = buildingCell(p, ix, iz);
        if (b && b.top > p.city!.plateau + 10) spot = { x: b.cx, z: b.cz, top: b.top };
      }
    }
    expect(spot).not.toBeNull();
    s.projectiles.push({
      id: 4242, owner: 0, faction: 0, hp: 16, spell: 'fireball',
      x: spot!.x, y: spot!.top + 6, z: spot!.z, px: spot!.x, py: spot!.top + 6, pz: spot!.z, vx: 0, vy: -40, vz: 0, travelled: 0,
    });
    for (let i = 0; i < 20 && s.projectiles.some((q) => q.id === 4242); i++) s.step([input()]);
    const hit = s.events.find((e) => e.type === 'impact' && Math.abs(e.x - spot!.x) < 1);
    expect(hit).toBeDefined();
    expect(hit!.y).toBeGreaterThan(spot!.top - 1); // exploded on the roof, not at ground level
  });
});

describe('tutorial', () => {
  it('advances by observing the sim and can be skipped', () => {
    const s = make(0);
    const t = new Tutorial(s);
    expect(t.stepId).toBe('fly');
    s.players[0]!.x += 200; // flew far enough
    expect(t.update(s, 0.1)).toBe(true);
    expect(t.stepId).toBe('mana');
    s.players[0]!.mana += 20;
    t.update(s, 0.1);
    expect(t.stepId).toBe('spell');
    for (let i = 0; i < 2; i++) {
      s.players[0]!.mana = 100;
      s.players[0]!.spellCd = 0;
      s.step([input(0, -1, ACTION_SPELL)]);
    }
    t.update(s, 0.1);
    expect(t.stepId).toBe('castle');
    s.castles[0]!.tier = 2;
    t.update(s, 0.1);
    expect(t.stepId).toBe('goal');
    t.update(s, 10);
    expect(t.finished).toBe(true);
    expect(t.text).toBeNull();
    const t2 = new Tutorial(make(0));
    t2.skip();
    expect(t2.finished).toBe(true);
    expect(tutorial.steps.length).toBe(5);
  });
});

describe('cpu budget: full matches', () => {
  it('a 4-wizard chapter-5 tick is far below its 33 ms budget', () => {
    const s = make(4);
    const inp = input(0.2, 0.4);
    for (let i = 0; i < 600; i++) s.step([inp]); // warm up
    const t0 = performance.now();
    const N = 3000;
    for (let i = 0; i < N; i++) s.step([inp]);
    const per = (performance.now() - t0) / N;
    console.log(`chapter-5 match tick: ${per.toFixed(4)} ms`);
    expect(per).toBeLessThan(2);
  });
});
