import { describe, expect, it } from 'vitest';
import { AMBIENT } from '../src/audio/ambient';
import { CHAPTERS, validateChapter, type ChapterConfig } from '../src/data/chapters';
import creatureData from '../src/data/creatures.json';
import game from '../src/data/game.json';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import { buildLandmarks, kitFor } from '../src/render/kits';
import { lightingFromPalette } from '../src/render/mesher';
import { gustAt } from '../src/render/weather';
import { CREATURES, SPELLS } from '../src/sim/combat';
import { chunkProps } from '../src/sim/props';
import { Sim, type PlayerInput } from '../src/sim/sim';
import { baseHeight, landmarkInCell, landmarkNear, landmarkTopAt } from '../src/sim/terrain';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });
const ch5 = CHAPTERS[4]!;
const ch6 = CHAPTERS[5]!;
const light = (c: ChapterConfig) => lightingFromPalette(c.palette.sunDir, c.palette.sunLight, c.palette.ambient);

describe('M5b: all six chapters are playable', () => {
  it('the menu unlocks all six and every chapter validates', () => {
    expect(game.playableChapters).toBe(6);
    for (const c of CHAPTERS) expect(validateChapter(c), c.id).toEqual([]);
  });

  it('chapters 5 and 6 have monsters of their own, a neutral mana animal, and bolts that exist', () => {
    for (const c of [ch5, ch6]) {
      const kinds = c.creatureSet.map((t) => CREATURES[t]!);
      expect(kinds.every(Boolean), c.id).toBe(true);
      expect(kinds.filter((k) => k.hostile).length, c.id).toBeGreaterThanOrEqual(2);
      expect(kinds.filter((k) => !k.hostile).length, c.id).toBeGreaterThanOrEqual(1);
      expect(AMBIENT[c.ambient.sound], c.id).toBeDefined();
    }
    for (const [id, def] of Object.entries(creatureData as Record<string, { ranged?: { spell: string; range: number; preferred: number } }>)) {
      if (!def.ranged) continue;
      expect(SPELLS[def.ranged.spell], id).toBeDefined();
      expect(def.ranged.preferred, id).toBeLessThan(def.ranged.range);
    }
  });

  it('the golem is slow and tough, the serpent is fast and fragile', () => {
    const golem = CREATURES['ruin-golem']!;
    const serpent = CREATURES['cloud-serpent']!;
    const sprite = CREATURES['dust-sprite']!;
    expect(golem.hp).toBeGreaterThan(2 * sprite.hp);
    expect(golem.speed).toBeLessThan(sprite.speed);
    expect(golem.manaDrop).toBeGreaterThan(sprite.manaDrop * 3);
    expect(serpent.speed).toBeGreaterThan(sprite.speed);
    expect(serpent.hp).toBeLessThanOrEqual(sprite.hp * 1.2);
  });

  it('structure kits are registered', () => {
    expect(kitFor('buried-ruins')).not.toBeNull();
    expect(kitFor('sky-palace')).not.toBeNull();
  });
});

describe('chapter 5: The Sunken Sand City', () => {
  it('has broken towers in the dunes that fliers hover over', () => {
    const p = ch5.terrain;
    let n = 0;
    let first: ReturnType<typeof landmarkInCell> = null;
    for (let iz = -10; iz < 10; iz++) for (let ix = -10; ix < 10; ix++) {
      const m = landmarkInCell(p, ix, iz);
      if (m) {
        n++;
        first ??= m;
        expect(m.kind).toBe('ruin-tower');
      }
    }
    expect(n).toBeGreaterThan(30);
    expect(landmarkTopAt(p, first!.x, first!.z)).toBeCloseTo(first!.top, 5);
  });

  it('draws ruins cheaply and puts a sandstorm in the config', () => {
    expect(ch5.weather?.sandstorm).toBeDefined();
    let ruinChunks = 0;
    let maxTris = 0;
    const sim = new Sim({ terrain: ch5.terrain, creatureTypes: ch5.creatureSet, match: matchSetupFromChapter(ch5, ['fire'], 'normal') });
    for (let cz = -10; cz < 10; cz++) for (let cx = -10; cx < 10; cx++) {
      const ctx = { chapter: ch5, terrain: sim.terrain, cx, cz, light: light(ch5), detail: 2 };
      for (const r of [kitFor('buried-ruins')!(ctx), buildLandmarks(ctx)]) {
        for (const v of r.mesher.pos) expect(Number.isFinite(v)).toBe(true);
        if (r.mesher.pos.length > 0) {
          ruinChunks++;
          maxTris = Math.max(maxTris, r.mesher.pos.length / 9);
        }
      }
    }
    expect(ruinChunks).toBeGreaterThan(30);
    expect(maxTris).toBeLessThan(500);
  }, 30000);

  it('the gust function stays in 0..1 and actually varies', () => {
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 600; t += 0.5) {
      const g = gustAt(t);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    expect(hi - lo).toBeGreaterThan(0.5);
  });

  it('rejects out-of-range weather', () => {
    const bad = { ...ch5, weather: { sandstorm: { fogTighten: 0.95, layer: 0.2 } } } as ChapterConfig;
    expect(validateChapter(bad).length).toBeGreaterThan(0);
  });
});

describe('chapter 6: The Sultan\'s Sky Palace', () => {
  it('is sky islands over a cloud sea: a third of the map is land, well above the clouds', () => {
    const p = ch6.terrain;
    expect(ch6.palette.cloudSea).toBe(true);
    let land = 0;
    let total = 0;
    let lowest = Infinity;
    for (let z = -2400; z < 2400; z += 48) for (let x = -2400; x < 2400; x += 48) {
      const h = baseHeight(p, x, z);
      total++;
      if (h > p.waterLevel + 2) land++;
      lowest = Math.min(lowest, h);
    }
    expect(land / total).toBeGreaterThan(0.15);
    expect(land / total).toBeLessThan(0.55);
    expect(lowest).toBeLessThan(p.waterLevel - 10); // the sea floor is far below the clouds
  });

  it('has gilded spires on islands only, and no rocks hidden below the clouds', () => {
    const p = ch6.terrain;
    let n = 0;
    for (let iz = -8; iz < 8; iz++) for (let ix = -8; ix < 8; ix++) {
      const m = landmarkInCell(p, ix, iz);
      if (m) {
        n++;
        expect(m.ground).toBeGreaterThan(p.waterLevel + 8);
      }
    }
    expect(n).toBeGreaterThan(6);
    for (let cz = -10; cz < 10; cz++) for (let cx = -10; cx < 10; cx++) {
      for (const pr of chunkProps(p, ch6.props, cx, cz, 64)) expect(baseHeight(p, pr.x, pr.z)).toBeGreaterThan(p.waterLevel - 3);
    }
  });

  it('builds pavilions, bridges and spires cheaply, with lanterns', () => {
    const sim = new Sim({ terrain: ch6.terrain, creatureTypes: ch6.creatureSet, match: matchSetupFromChapter(ch6, ['air'], 'normal') });
    let chunks = 0;
    let lanterns = 0;
    let maxTris = 0;
    for (let cz = -16; cz < 16; cz++) for (let cx = -16; cx < 16; cx++) {
      const ctx = { chapter: ch6, terrain: sim.terrain, cx, cz, light: light(ch6), detail: 2 };
      const r = kitFor('sky-palace')!(ctx);
      const lm = buildLandmarks(ctx);
      for (const k of [r, lm]) for (const v of k.mesher.pos) expect(Number.isFinite(v)).toBe(true);
      if (r.mesher.pos.length > 0) {
        chunks++;
        maxTris = Math.max(maxTris, r.mesher.pos.length / 9);
      }
      lanterns += r.beacons.length;
    }
    expect(chunks).toBeGreaterThan(8);
    expect(lanterns).toBeGreaterThan(8);
    expect(maxTris).toBeLessThan(1200);
  });
});

describe.each([ch5, ch6].map((c) => [c.id, c] as const))('%s is a playable four-player match', (_id, c) => {
  it('castles sit on dry flat land clear of landmarks and the sim runs finite for a minute', () => {
    const s = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: matchSetupFromChapter(c, ['earth'], 'normal') });
    expect(s.castles.length).toBe(4);
    for (const castle of s.castles) {
      expect(castle.y).toBeGreaterThan(c.terrain.waterLevel + 2);
      expect(landmarkNear(c.terrain, castle.x, castle.z, 20)).toBe(false);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        expect(baseHeight(c.terrain, castle.x + Math.cos(a) * 20, castle.z + Math.sin(a) * 20)).toBeGreaterThan(c.terrain.waterLevel + 1);
      }
    }
    for (let t = 0; t < 30 * 60; t++) s.step([input(0.1, 0.3)]);
    for (const w of s.players) expect(Number.isFinite(w.x + w.y + w.z + w.mana)).toBe(true);
    for (const cr of s.creatures) expect(Number.isFinite(cr.x + cr.y + cr.z)).toBe(true);
  });
});
