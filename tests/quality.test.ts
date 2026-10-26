import { describe, expect, it } from 'vitest';
import { GOVERNOR, PRESETS, QualityGovernor } from '../src/render/quality';

const feed = (g: QualityGovernor, ms: number, frames: number) => {
  let changes = 0;
  for (let i = 0; i < frames; i++) if (g.sample(ms)) changes++;
  return changes;
};

describe('quality governor', () => {
  it('lowers render scale when frames are slow, then view distance, never below the floor', () => {
    const g = new QualityGovernor(60);
    feed(g, 40, 3000);
    expect(g.renderScale).toBeCloseTo(GOVERNOR.minRenderScale, 5);
    expect(g.radiusScale).toBeCloseTo(GOVERNOR.minRadiusScale, 5);
  });

  it('leaves a healthy frame rate alone', () => {
    const g = new QualityGovernor(60);
    expect(feed(g, 15, 2000)).toBe(0);
    expect(g.renderScale).toBe(1);
  });

  it('recovers when there is sustained headroom', () => {
    const g = new QualityGovernor(60);
    feed(g, 40, 1500);
    const low = g.renderScale;
    feed(g, 6, 6000);
    expect(g.renderScale).toBeGreaterThan(low);
  });

  it('uses a looser budget in battery-saver (30 fps) mode', () => {
    const g = new QualityGovernor(30);
    expect(feed(g, 30, 1000)).toBe(0);
  });

  it('presets cap pixel ratio at 1.5 and have increasing view distance', () => {
    for (const p of Object.values(PRESETS)) expect(p.pixelRatioCap).toBeLessThanOrEqual(1.5);
    expect(PRESETS.high.viewRadiusChunks).toBeGreaterThan(PRESETS.medium.viewRadiusChunks);
    expect(PRESETS.medium.viewRadiusChunks).toBeGreaterThan(PRESETS.low.viewRadiusChunks);
  });
});
