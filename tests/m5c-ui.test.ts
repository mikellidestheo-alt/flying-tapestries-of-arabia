import { afterEach, describe, expect, it, vi } from 'vitest';
import castleData from '../src/data/castles.json';
import { COLOR_BLIND_PALETTE, applyFactionPalette } from '../src/data/factionPalette';
import quality from '../src/data/quality.json';
import { DEFAULT_PROGRESS, loadSave } from '../src/save';

afterEach(() => vi.unstubAllGlobals());
const stub = (json: unknown) => vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(json) });

describe('M5c accessibility and progress save', () => {
  it('accepts valid text scales and falls back on bad ones', () => {
    stub({ settings: { textScale: 1.4, highContrast: true, reducedMotion: true, colorBlind: true } });
    const s = loadSave().settings;
    expect([s.textScale, s.highContrast, s.reducedMotion, s.colorBlind]).toEqual([1.4, true, true, true]);
    stub({ settings: { textScale: 7 } });
    expect(loadSave().settings.textScale).toBe(1);
  });

  it('sanitises per-chapter best times and win counters, and never shares the default array', () => {
    stub({ progress: { bestSeconds: [600, -5, 'x', 480], wins: 2.5, played: -1 } });
    const p = loadSave().progress;
    expect(p.bestSeconds).toEqual([600, 0, 0, 480, 0, 0]);
    expect(p.wins).toBe(0);
    expect(p.played).toBe(0);
    p.bestSeconds[0] = 1;
    expect(DEFAULT_PROGRESS.bestSeconds[0]).toBe(0);
  });

  it('the colour-blind palette is applied and restored, with four distinct colours', () => {
    const original = castleData.factionStyles.map((f) => f.color);
    applyFactionPalette(true);
    expect(castleData.factionStyles.map((f) => f.color)).toEqual(COLOR_BLIND_PALETTE.slice(0, castleData.factionStyles.length));
    expect(new Set(COLOR_BLIND_PALETTE).size).toBe(4);
    applyFactionPalette(false);
    expect(castleData.factionStyles.map((f) => f.color)).toEqual(original);
  });

  it('banner shapes always differ, so colour is never the only cue', () => {
    expect(new Set(castleData.factionStyles.map((f) => f.shape)).size).toBe(castleData.factionStyles.length);
  });

  it('real bloom is High only, and the governor can switch it off', () => {
    expect(quality.presets.high.bloom).toBe(true);
    expect(quality.presets.medium.bloom).toBe(false);
    expect(quality.presets.low.bloom).toBe(false);
    expect(quality.bloom.minRenderScale).toBeGreaterThan(0.5);
    expect(quality.bloom.minRenderScale).toBeLessThan(1);
    expect(quality.presets.low.weatherLayer).toBe(false);
  });
});
