import { describe, expect, it } from 'vitest';
import { AMBIENT } from '../src/audio/ambient';
import { CHAPTERS, type ChapterConfig } from '../src/data/chapters';
import game from '../src/data/game.json';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import { buildLandmarks, kitFor } from '../src/render/kits';
import { lightingFromPalette } from '../src/render/mesher';
import { CREATURES } from '../src/sim/combat';
import { Sim } from '../src/sim/sim';
import creatureData from '../src/data/creatures.json';

const playable = CHAPTERS.slice(0, game.playableChapters);

describe('playable chapter content is complete', () => {
  it('every creature type a playable chapter names exists in the creature table', () => {
    for (const c of playable) {
      const set = (c as unknown as { creatureSet: string[] }).creatureSet;
      expect(set.length, c.id).toBeGreaterThan(0);
      for (const t of set) expect(CREATURES[t], `${c.id}: ${t}`).toBeDefined();
    }
  });

  it('every ranged creature has a bolt spell and every chapter has an ambient recipe', () => {
    for (const [id, def] of Object.entries(creatureData as Record<string, { ranged?: { spell: string } }>)) {
      if (def.ranged) expect(def.ranged.spell, id).toMatch(/-bolt$/);
    }
    for (const c of playable) {
      const r = AMBIENT[c.ambient.sound];
      expect(r, c.id).toBeDefined();
      expect(r!.layers.length).toBeGreaterThan(0);
      for (const l of r!.layers) {
        expect(l.freq).toBeGreaterThan(20);
        expect(l.gain).toBeGreaterThan(0);
        expect(l.gain + l.lfoGain).toBeLessThan(0.5); // never louder than the music bed
      }
    }
  });

  it('structure kits are known for the chapters that name one', () => {
    for (const c of playable) {
      if (c.structureKit === 'rose-tombs' || c.structureKit === 'moonlit-harbour') expect(kitFor(c.structureKit), c.id).not.toBeNull();
    }
  });
});

function chunksWithGeometry(ch: ChapterConfig, R: number, build: (cx: number, cz: number, sim: Sim) => { mesher: { pos: number[]; col: number[] }; maxY: number }) {
  const sim = new Sim({ terrain: ch.terrain, creatureTypes: ch.creatureSet, match: matchSetupFromChapter(ch, ['fire'], 'normal') });
  let tris = 0;
  let chunks = 0;
  let maxTris = 0;
  for (let cz = -R; cz < R; cz++) {
    for (let cx = -R; cx < R; cx++) {
      const r = build(cx, cz, sim);
      expect(r.mesher.pos.length).toBe(r.mesher.col.length);
      for (const v of r.mesher.pos) expect(Number.isFinite(v)).toBe(true);
      if (r.mesher.pos.length > 0) {
        chunks++;
        tris += r.mesher.pos.length / 9;
        maxTris = Math.max(maxTris, r.mesher.pos.length / 9);
      }
    }
  }
  return { tris, chunks, maxTris };
}

describe('render kits produce sane geometry', () => {
  const ch3 = CHAPTERS[2]!;
  const ch4 = CHAPTERS[3]!;
  const light = (c: ChapterConfig) => lightingFromPalette(c.palette.sunDir, c.palette.sunLight, c.palette.ambient);

  it('chapter 3: needles stand in the landmark grid and tombs line the cliffs', () => {
    const lm = chunksWithGeometry(ch3, 12, (cx, cz, sim) => buildLandmarks({ chapter: ch3, terrain: sim.terrain, cx, cz, light: light(ch3), detail: 2 }));
    expect(lm.chunks).toBeGreaterThan(3);
    expect(lm.maxTris).toBeLessThan(400);
    const tombs = chunksWithGeometry(ch3, 12, (cx, cz, sim) => kitFor('rose-tombs')!({ chapter: ch3, terrain: sim.terrain, cx, cz, light: light(ch3), detail: 2 }));
    expect(tombs.chunks).toBeGreaterThan(3);
    expect(tombs.maxTris).toBeLessThan(400); // scenery stays cheap per chunk
  });

  it('chapter 4: lighthouses give beacons and the harbour has piers and ships', () => {
    let beacons = 0;
    const lm = chunksWithGeometry(ch4, 30, (cx, cz, sim) => {
      const r = buildLandmarks({ chapter: ch4, terrain: sim.terrain, cx, cz, light: light(ch4), detail: 2 });
      beacons += r.beacons.length;
      return r;
    });
    expect(lm.chunks).toBeGreaterThan(5);
    expect(beacons).toBe(lm.chunks); // one lit lantern room per lighthouse
    let lanterns = 0;
    const harbour = chunksWithGeometry(ch4, 30, (cx, cz, sim) => {
      const r = kitFor('moonlit-harbour')!({ chapter: ch4, terrain: sim.terrain, cx, cz, light: light(ch4), detail: 2 });
      lanterns += r.beacons.length;
      return r;
    });
    expect(harbour.chunks).toBeGreaterThan(0);
    expect(lanterns).toBeGreaterThan(0);
  });

  it('night chapters opt into stars and a moon; day chapters do not', () => {
    expect(ch4.palette.stars).toBe(true);
    expect(ch4.palette.moon).toBe(true);
    expect(CHAPTERS[0]!.palette.stars).toBeFalsy();
  });
});
