import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import simData from '../src/data/sim.json';
import { DeltaStore } from '../src/sim/deltas';
import { Terrain, checksumFloats, sampleChunkHeights, type TerrainParams } from '../src/sim/terrain';
import { chunkProps } from '../src/sim/props';
import { Prng } from '../src/sim/prng';
import { dcos, dsin, datan2 } from '../src/sim/dmath';

// Fixed params so the golden checksum only changes when the terrain *algorithm* changes,
// not when chapter tuning data is edited.
const GOLDEN: TerrainParams = {
  seed: 1234, baseHeight: 14, swellAmplitude: 9, swellScale: 0.0018, duneAmplitude: 16, duneScale: 0.0075,
  duneWarp: 60, duneSharpness: 2, detailAmplitude: 0.9, detailScale: 0.05, waterLevel: 4,
  oasisScale: 0.0026, oasisThreshold: 0.56, oasisSoftness: 0.12, oasisDepth: 6, oasisRim: 3.2,
};

const mk = (p: TerrainParams) => new Terrain(p, new DeltaStore(simData.deltas));

describe('seeded terrain', () => {
  it('generates identical chunks twice, for every chapter', () => {
    for (const ch of CHAPTERS) {
      for (const [cx, cz] of [[0, 0], [-3, 5], [12, -9], [-40, -41]] as const) {
        const a = sampleChunkHeights(mk(ch.terrain), cx, cz, 16, simData.chunkSize);
        const b = sampleChunkHeights(mk(ch.terrain), cx, cz, 16, simData.chunkSize);
        expect(checksumFloats(a)).toBe(checksumFloats(b));
        expect(Array.from(a)).toEqual(Array.from(b));
      }
    }
  });

  it('matches the golden checksum (guards against platform/maths drift)', () => {
    const t = mk(GOLDEN);
    const sums = [[0, 0], [3, -2], [-7, 9]].map(([cx, cz]) =>
      checksumFloats(sampleChunkHeights(t, cx!, cz!, 16, simData.chunkSize)),
    );
    expect(sums).toMatchInlineSnapshot(`
      [
        1015187425,
        305421907,
        616193947,
      ]
    `);
  });

  it('is continuous across chunk borders', () => {
    const t = mk(GOLDEN);
    const n = 16;
    const a = sampleChunkHeights(t, 0, 0, n, simData.chunkSize);
    const b = sampleChunkHeights(t, 1, 0, n, simData.chunkSize);
    const stride = n + 3;
    for (let j = 0; j < stride; j++) {
      // chunk 0's last vertex column (i = n + 1) equals chunk 1's first (i = 1)
      expect(a[j * stride + n + 1]).toBe(b[j * stride + 1]);
    }
  });

  it('different seeds give different terrain', () => {
    const a = sampleChunkHeights(mk(GOLDEN), 0, 0, 16, simData.chunkSize);
    const b = sampleChunkHeights(mk({ ...GOLDEN, seed: 99 }), 0, 0, 16, simData.chunkSize);
    expect(checksumFloats(a)).not.toBe(checksumFloats(b));
  });

  it('places props deterministically', () => {
    const pp = { candidatesPerChunk: 22, palmChance: 0.55, rockChance: 0.1 };
    expect(chunkProps(GOLDEN, pp, 4, 4, 64)).toEqual(chunkProps(GOLDEN, pp, 4, 4, 64));
  });
});

describe('deterministic maths', () => {
  it('dsin/dcos/datan2 are accurate', () => {
    for (let a = -10; a <= 10; a += 0.173) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-6);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-6);
    }
    for (const [y, x] of [[1, 1], [-1, 2], [3, -1], [-2, -2], [0, 1], [1, 0]] as const) {
      expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(2e-4);
    }
  });

  it('the PRNG is reproducible', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('spawn', () => {
  it('every chapter spawns on dry land, deterministically', async () => {
    const { findSpawn, baseHeight } = await import('../src/sim/terrain');
    for (const ch of CHAPTERS) {
      const a = findSpawn(ch.terrain);
      expect(a).toEqual(findSpawn(ch.terrain));
      expect(baseHeight(ch.terrain, a.x, a.z)).toBeGreaterThan(ch.terrain.waterLevel + 2);
    }
  });
});
