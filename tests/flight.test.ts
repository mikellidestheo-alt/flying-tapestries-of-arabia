import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import flight from '../src/data/flight.json';
import { ACTION_CRATER, Sim, type PlayerInput } from '../src/sim/sim';

const input = (steer = 0, throttle = 0, actions = 0): PlayerInput => ({ steer, throttle, actions });
const make = () => new Sim({ terrain: CHAPTERS[0]!.terrain });

describe('flight', () => {
  it('is deterministic for the same inputs', () => {
    const run = () => {
      const s = make();
      for (let i = 0; i < 600; i++) s.step([input(Math.sin(i / 40) > 0 ? 0.7 : -0.4, i % 90 < 30 ? 1 : 0)]);
      return JSON.stringify(s.players);
    };
    expect(run()).toBe(run());
  });

  it('cruises forward and reaches cruise speed', () => {
    const s = make();
    const start = { ...s.players[0]! };
    for (let i = 0; i < 120; i++) s.step([input()]);
    const p = s.players[0]!;
    expect(p.speed).toBeCloseTo(flight.cruiseSpeed, 3);
    expect(p.z - start.z).toBeGreaterThan(50);
    expect(Math.abs(p.x - start.x)).toBeLessThan(1);
  });

  it('steering right turns clockwise (heading decreases) with momentum', () => {
    const s = make();
    const startX = s.players[0]!.x;
    for (let i = 0; i < 20; i++) s.step([input(1)]);
    const p = s.players[0]!;
    expect(p.heading).toBeLessThan(-0.2);
    expect(p.x - startX).toBeLessThan(0); // right of +z is -x
  });

  it('boost is faster than brake', () => {
    const fast = make();
    const slow = make();
    for (let i = 0; i < 150; i++) {
      fast.step([input(0, 1)]);
      slow.step([input(0, -1)]);
    }
    expect(fast.players[0]!.speed).toBeCloseTo(flight.maxSpeed, 3);
    expect(slow.players[0]!.speed).toBeCloseTo(flight.minSpeed, 3);
  });

  it('always stays above the terrain, even over huge hills and fresh mounds', () => {
    const s = make();
    for (let i = 0; i < 3000; i++) {
      s.step([input(i % 300 < 150 ? 0.8 : -0.8, 1, i % 40 === 0 ? 2 : 0)]);
      const p = s.players[0]!;
      expect(p.y).toBeGreaterThanOrEqual(s.terrain.surfaceAt(p.x, p.z) + flight.minClearance - 1e-6);
    }
  });

  it('ignores garbage input', () => {
    const s = make();
    s.step([{ steer: NaN, throttle: Infinity, actions: 1e9 }]);
    expect(Number.isFinite(s.players[0]!.x)).toBe(true);
  });

  it('crater tool adds a delta ahead and respects its cooldown', () => {
    const s = make();
    s.step([input(0, 0, ACTION_CRATER)]);
    s.step([input(0, 0, ACTION_CRATER)]);
    expect(s.terrain.deltas.list.length).toBe(1);
    const d = s.terrain.deltas.list[0]!;
    expect(d.z - s.players[0]!.z).toBeGreaterThan(20);
    for (let i = 0; i < 12; i++) s.step([input()]);
    s.step([input(0, 0, ACTION_CRATER)]);
    expect(s.terrain.deltas.list.length).toBe(2);
  });
});
