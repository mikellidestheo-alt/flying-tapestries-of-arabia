import { describe, expect, it } from 'vitest';
import { musicSpecFor } from '../src/audio/gameAudio';
import { IntensityFollower, threatTarget } from '../src/audio/intensity';
import { MusicPlanner } from '../src/audio/musicPlanner';
import { CHAPTERS } from '../src/data/chapters';

const calm = { hostileNear: 0, rivalsNear: 0, boltsNear: 0, secondsSinceCastleHit: Infinity, hpFrac: 1 };

describe('adaptive music', () => {
  it('threat is zero when calm and rises with danger, capped at 1', () => {
    expect(threatTarget(calm)).toBe(0);
    const a = threatTarget({ ...calm, hostileNear: 1 });
    const b = threatTarget({ ...calm, hostileNear: 3, rivalsNear: 1 });
    const c = threatTarget({ hostileNear: 9, rivalsNear: 9, boltsNear: 9, secondsSinceCastleHit: 1, hpFrac: 0.1 });
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBe(1);
    expect(threatTarget({ ...calm, secondsSinceCastleHit: 2 })).toBeGreaterThan(0);
    expect(threatTarget({ ...calm, hpFrac: 0.2 })).toBeGreaterThan(0);
  });

  it('the follower rises quickly and fades slowly', () => {
    const f = new IntensityFollower();
    for (let i = 0; i < 10; i++) f.update(1, 0.1); // 1 s of danger
    const up = f.value;
    expect(up).toBeGreaterThan(0.4);
    for (let i = 0; i < 10; i++) f.update(0, 0.1); // 1 s of calm
    expect(f.value).toBeGreaterThan(up * 0.8);
    for (let i = 0; i < 300; i++) f.update(0, 0.1);
    expect(f.value).toBe(0);
  });

  it('combat layers add events only as intensity rises, and are deterministic', () => {
    for (const c of CHAPTERS) {
      const p = new MusicPlanner(musicSpecFor(c));
      expect(p.planCombat(3, 0.1)).toEqual([]);
      const low = p.planCombat(3, 0.3).length;
      const mid = p.planCombat(3, 0.5).length;
      const high = p.planCombat(3, 0.9).length;
      expect(low).toBeGreaterThan(0);
      expect(mid).toBeGreaterThanOrEqual(low);
      expect(high).toBeGreaterThan(mid);
      expect(new MusicPlanner(musicSpecFor(c)).planCombat(3, 0.9)).toEqual(p.planCombat(3, 0.9));
      for (const e of p.planCombat(5, 1)) {
        expect(e.step).toBeGreaterThanOrEqual(0);
        expect(e.step).toBeLessThan(8);
        expect(e.vel).toBeGreaterThan(0);
        expect(e.vel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('planning combat never disturbs the calm line', () => {
    const spec = musicSpecFor(CHAPTERS[0]!);
    const a = new MusicPlanner(spec);
    const b = new MusicPlanner(spec);
    for (let bar = 0; bar < 8; bar++) {
      b.planCombat(bar, 1);
      expect(b.planBar(bar)).toEqual(a.planBar(bar));
    }
  });
});
