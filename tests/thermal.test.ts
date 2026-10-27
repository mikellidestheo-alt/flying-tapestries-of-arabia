import { describe, expect, it } from 'vitest';
import { CHAPTERS, RANKS, validateChapter } from '../src/data/chapters';
import gameData from '../src/data/game.json';
import quality from '../src/data/quality.json';
import { PRESETS, THERMAL, ThermalGuard } from '../src/render/quality';

describe('heat reduction', () => {
  it('long play steps visual effects down in stages and a rest steps them back up', () => {
    const g = new ThermalGuard();
    for (let t = 0; t < THERMAL.stage1Heat - 5; t++) g.update(1, true);
    expect(g.stage).toBe(0);
    for (let t = 0; t < 10; t++) g.update(1, true);
    expect(g.stage).toBe(1);
    for (let t = 0; t < THERMAL.stage2Heat; t++) g.update(1, true);
    expect(g.stage).toBe(2);
    for (let t = 0; t < 3000; t++) g.update(1, false); // a long break in the menu
    expect(g.stage).toBe(0);
    expect(g.heat).toBeLessThan(THERMAL.stage1Heat * THERMAL.releaseFraction);
  });

  it('is gentle: ten minutes of play is stage 2, five minutes is stage 1, and the second stage keeps most of the picture', () => {
    expect(THERMAL.stage1Heat).toBeLessThanOrEqual(300);
    expect(THERMAL.stage2Heat).toBeLessThanOrEqual(600);
    expect(THERMAL.stage2RenderScale).toBeGreaterThanOrEqual(0.85);
    expect(THERMAL.stage2RadiusScale).toBeGreaterThanOrEqual(0.8);
  });

  it('the heaviest preset got cheaper: lower pixel ratio and a lighter bloom', () => {
    expect(PRESETS.high.pixelRatioCap).toBeLessThanOrEqual(1.35);
    expect(quality.bloom.msaaSamples).toBeLessThanOrEqual(2);
    expect(quality.bloom.resolutionScale).toBeLessThanOrEqual(0.4);
  });
});

describe('every chapter is open, with a wizard rank', () => {
  it('all six chapters are playable from the start', () => {
    expect(gameData.playableChapters).toBe(CHAPTERS.length);
  });

  it('ranks run Beginner to Grand Master Wizard in chapter order', () => {
    expect([...RANKS]).toEqual(['Beginner', 'Novice', 'Apprentice', 'Wizard', 'Grand Wizard', 'Grand Master Wizard']);
    expect(CHAPTERS.map((c) => c.rank)).toEqual([...RANKS]);
    for (const c of CHAPTERS) expect(validateChapter(c)).toEqual([]);
    const bad = { ...CHAPTERS[2]!, rank: 'Beginner' as const };
    expect(validateChapter(bad).length).toBeGreaterThan(0);
  });
});
