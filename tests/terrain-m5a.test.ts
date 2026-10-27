import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import { CREATURES } from '../src/sim/combat';
import { Sim, type PlayerInput } from '../src/sim/sim';
import { baseHeight, landmarkInCell, landmarkNear, landmarkTopAt } from '../src/sim/terrain';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });
const ch3 = CHAPTERS[2]!;
const ch4 = CHAPTERS[3]!;

function sample(p: typeof ch3.terrain, range = 2400, step = 40) {
  const hs: number[] = [];
  for (let z = -range; z < range; z += step) for (let x = -range; x < range; x += step) hs.push(baseHeight(p, x, z));
  return hs;
}

describe('chapter 3: Canyons of Rose Stone', () => {
  it('has real canyons: flat floors well below a plateau, with steep walls between', () => {
    const p = ch3.terrain;
    const hs = sample(p);
    const floorLevel = p.baseHeight - p.canyon!.depth;
    const floor = hs.filter((h) => h < floorLevel + 3).length / hs.length;
    const top = hs.filter((h) => h > p.baseHeight - 6).length / hs.length;
    expect(floor).toBeGreaterThan(0.12);
    expect(floor).toBeLessThan(0.55);
    expect(top).toBeGreaterThan(0.3);
    let steepest = 0;
    for (let z = -1200; z < 1200; z += 6) for (let x = -1200; x < 1200; x += 6) {
      steepest = Math.max(steepest, Math.abs(baseHeight(p, x + 3, z) - baseHeight(p, x - 3, z)) / 6);
    }
    expect(steepest).toBeGreaterThan(1.2); // cliffs, not slopes
  });

  it('has rock needles that fliers hover over and shots burst on', () => {
    const p = ch3.terrain;
    let n = 0;
    let found: ReturnType<typeof landmarkInCell> = null;
    for (let iz = -10; iz < 10; iz++) for (let ix = -10; ix < 10; ix++) {
      const m = landmarkInCell(p, ix, iz);
      if (m) { n++; found ??= m; }
    }
    expect(n).toBeGreaterThan(20);
    const m = found!;
    expect(landmarkTopAt(p, m.x, m.z)).toBeCloseTo(m.top, 5);
    expect(landmarkTopAt(p, m.x + m.r + 1, m.z)).toBe(0);
    expect(landmarkNear(p, m.x + m.r + 3, m.z, 5)).toBe(true);
    const s = new Sim({ terrain: p, creatureTypes: ch3.creatureSet, match: matchSetupFromChapter(ch3, ['fire'], 'normal') });
    expect(s.terrain.surfaceAt(m.x, m.z)).toBeGreaterThanOrEqual(m.top);
    s.players.forEach((w, i) => { if (i > 0) w.active = false; });
    s.projectiles.push({
      id: 700, owner: 0, faction: 0, hp: 16, spell: 'fireball', tier: 1,
      x: m.x - 7.5, y: m.ground + 12, z: m.z, px: m.x - 7.5, py: m.ground + 12, pz: m.z, vx: 60, vy: 0, vz: 0, travelled: 0,
    });
    for (let i = 0; i < 12; i++) s.step([input(0, -1)]);
    expect(s.projectiles.some((q) => q.id === 700)).toBe(false);
    expect(s.events.some((e) => e.type === 'impact' && Math.abs(e.x - m.x) < m.r + 4)).toBe(true);
  });

  it('flies through the canyons without ever clipping rock', () => {
    const s = new Sim({ terrain: ch3.terrain, creatureTypes: ch3.creatureSet, match: matchSetupFromChapter(ch3, ['air'], 'normal') });
    s.players.forEach((w, i) => { if (i > 0) w.active = false; });
    const p = s.players[0]!;
    p.invuln = 1e9;
    for (let t = 0; t < 4000; t++) {
      s.step([input(Math.sin(t / 60) * 0.9, 1)]);
      expect(p.y).toBeGreaterThanOrEqual(s.terrain.surfaceAt(p.x, p.z) + 2.2 - 1e-6);
    }
  });
});

describe('chapter 4: Pearl Harbour by Moonlight', () => {
  it('is a night coast: a big sea with islands and shoreline lighthouses', () => {
    const p = ch4.terrain;
    const hs = sample(p, 3000, 50);
    const sea = hs.filter((h) => h < p.waterLevel).length / hs.length;
    expect(sea).toBeGreaterThan(0.2);
    expect(sea).toBeLessThan(0.6);
    let lights = 0;
    for (let iz = -8; iz < 8; iz++) for (let ix = -8; ix < 8; ix++) {
      const m = landmarkInCell(p, ix, iz);
      if (m) {
        lights++;
        expect(m.ground - p.waterLevel).toBeLessThanOrEqual(p.landmarks!.maxAboveWater); // on the shore, never inland
      }
    }
    expect(lights).toBeGreaterThan(6);
    expect(ch4.palette.stars).toBe(true);
    expect(ch4.palette.moon).toBe(true);
  });
});

describe('new chapters are playable matches', () => {
  it.each([2, 3].map((i) => [CHAPTERS[i]!.id, i] as const))('%s: castles and spawn are on dry flat land clear of landmarks, and creature types exist', (_id, i) => {
    const c = CHAPTERS[i]!;
    const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['water'], 'normal') });
    expect(s.castles.length).toBe(4);
    for (const castle of s.castles) {
      expect(castle.y).toBeGreaterThan(c.terrain.waterLevel + 2);
      expect(landmarkNear(c.terrain, castle.x, castle.z, 20)).toBe(false);
    }
    for (const t of c.creatureSet) expect(CREATURES[t], `${c.id} creature ${t}`).toBeDefined();
    expect(s.creatureTypes.length).toBe(c.creatureSet.length);
    for (let t = 0; t < 30 * 60; t++) s.step([input(0.1, 0.3)]);
    for (const w of s.players) expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
  });
});
