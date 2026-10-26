import { describe, expect, it } from 'vitest';
import { musicSpecFor } from '../src/audio/gameAudio';
import { MusicPlanner, RHYTHMS, SCALES, degreeHz, midiToHz, parsePattern } from '../src/audio/musicPlanner';
import { CHAPTERS, MUSIC_SCALES, RHYTHMS as CHAPTER_RHYTHMS } from '../src/data/chapters';

describe('music data', () => {
  it('every scale named by the chapter validator exists with 7 ascending degrees', () => {
    for (const name of MUSIC_SCALES) {
      const sc = SCALES[name];
      expect(sc, name).toBeDefined();
      expect(sc!.length).toBe(7);
      for (let i = 1; i < 7; i++) expect(sc![i]!).toBeGreaterThan(sc![i - 1]!);
      expect(sc![6]!).toBeLessThan(12);
    }
  });

  it('maqams keep their characteristic intervals', () => {
    expect(SCALES.hijaz!.slice(0, 3)).toEqual([0, 1, 4]); // augmented second
    expect(SCALES.bayati![1]).toBe(1.5); // quarter-tone second
    expect(SCALES.nahawand![2]).toBe(3); // minor third
  });

  it('every rhythm is an 8-step pattern with valid oud steps', () => {
    for (const name of CHAPTER_RHYTHMS) {
      const r = RHYTHMS[name]!;
      expect(parsePattern(name).length).toBe(8);
      for (const s of r.oudSteps) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(8);
      }
      expect(parsePattern(name)[0]).toBe('D');
    }
  });

  it('degree to frequency maps octaves correctly', () => {
    const spec = musicSpecFor(CHAPTERS[0]!);
    expect(degreeHz(spec, 7)).toBeCloseTo(degreeHz(spec, 0) * 2, 6);
    expect(degreeHz(spec, -7)).toBeCloseTo(degreeHz(spec, 0) / 2, 6);
    expect(midiToHz(69)).toBe(440);
  });
});

describe('music planner', () => {
  it.each(CHAPTERS.map((c) => [c.id, c] as const))('%s: bars are deterministic and stay in the scale', (_id, c) => {
    const spec = musicSpecFor(c);
    const a = new MusicPlanner(spec);
    const b = new MusicPlanner(spec);
    const scaleHz = new Set<number>();
    for (let oct = -3; oct <= 4; oct++) for (let d = 0; d < 7; d++) scaleHz.add(Math.round(degreeHz(spec, d + oct * 7) * 1000));
    for (let bar = 0; bar < 16; bar++) {
      const pa = a.planBar(bar);
      expect(pa).toEqual(b.planBar(bar));
      for (const e of pa) {
        expect(e.step).toBeGreaterThanOrEqual(0);
        expect(e.step).toBeLessThan(8);
        if (e.freq !== undefined) expect(scaleHz.has(Math.round(e.freq * 1000))).toBe(true);
      }
      // Percussion follows the rhythm: a dum on every D step.
      const pat = parsePattern(spec.rhythm);
      const dums = pa.filter((e) => e.inst === 'dum').map((e) => e.step);
      expect(dums).toEqual(pat.map((p, i) => (p === 'D' ? i : -1)).filter((i) => i >= 0));
    }
  });

  it('phrases resolve on the root and the ney only plays in some phrases', () => {
    const spec = musicSpecFor(CHAPTERS[0]!);
    const p = new MusicPlanner(spec);
    const bars = Array.from({ length: 8 }, (_, i) => p.planBar(i));
    const lastOud = bars[3]!.filter((e) => e.inst === 'oud').at(-1)!;
    expect(lastOud.freq).toBeCloseTo(degreeHz(spec, 0), 6);
    const neyBars = bars.map((b, i) => (b.some((e) => e.inst === 'ney') ? i : -1)).filter((i) => i >= 0);
    expect(neyBars).toEqual([1]);
  });
});
