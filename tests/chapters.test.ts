import { describe, expect, it } from 'vitest';
import { CHAPTERS, rivalCountForChapter, validateChapter } from '../src/data/chapters';
import { ELEMENTS, assignRivalElements } from '../src/data/elements';

describe('chapter configs', () => {
  it('has six chapters numbered 1-6', () => {
    expect(CHAPTERS.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(CHAPTERS.map((c) => [c.id, c] as const))('%s is valid', (_id, c) => {
    expect(validateChapter(c)).toEqual([]);
  });

  it('every chapter is a four-player match: three rivals', () => {
    expect(CHAPTERS.map((c) => c.rivals.length)).toEqual([3, 3, 3, 3, 3, 3]);
    expect([1, 2, 3, 4, 5, 6].map(() => rivalCountForChapter())).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it('rival personalities are mixed in every chapter', () => {
    for (const c of CHAPTERS) expect(new Set(c.rivals.map((r) => r.personality)).size).toBe(3);
  });

  it('has unique ids and terrain seeds', () => {
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(6);
    expect(new Set(CHAPTERS.map((c) => c.terrain.seed)).size).toBe(6);
  });

  it('validation catches a broken chapter', () => {
    const bad = structuredClone(CHAPTERS[0]!);
    bad.music.scale = 'blues';
    bad.palette.fog = 'red';
    bad.rivals = [];
    expect(validateChapter(bad).length).toBeGreaterThanOrEqual(3);
  });
});

describe('rival element assignment', () => {
  it('picks elements the players did not choose', () => {
    expect(assignRivalElements(['fire'], 1)).toEqual(['water']);
    expect(assignRivalElements(['fire', 'water'], 2)).toEqual(['earth', 'air']);
  });

  it('duplicates only when there are more rivals than unused elements', () => {
    const e = assignRivalElements(['fire', 'water'], 3);
    expect(e).toEqual(['earth', 'air', 'earth']);
    expect(assignRivalElements(['air'], 3).every((x) => x !== 'air')).toBe(true);
    for (const x of e) expect(ELEMENTS).toContain(x);
  });
});
