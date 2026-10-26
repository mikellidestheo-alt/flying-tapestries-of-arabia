import { describe, expect, it } from 'vitest';
import simData from '../src/data/sim.json';
import { DELTA_BUMP, DELTA_CRATER, DeltaStore, deltaHeight } from '../src/sim/deltas';
import { Prng } from '../src/sim/prng';

describe('terrain deltas', () => {
  it('digs a crater with a raised rim', () => {
    const d = { id: 1, x: 0, z: 0, r: 10, amount: -8, kind: DELTA_CRATER, tick: 0 };
    expect(deltaHeight(d, 0, 0)).toBeCloseTo(-8, 5);
    expect(deltaHeight(d, 10, 0)).toBe(0);
    expect(deltaHeight(d, 11, 0)).toBe(0);
    let rim = 0;
    for (let x = 0; x < 10; x += 0.25) rim = Math.max(rim, deltaHeight(d, x, 0));
    expect(rim).toBeGreaterThan(0);
  });

  it('never exceeds the hard cap and stays deterministic', () => {
    const run = () => {
      const store = new DeltaStore(simData.deltas);
      const rng = new Prng(7);
      for (let i = 0; i < 1000; i++) {
        store.add(rng.range(-300, 300), rng.range(-300, 300), rng.range(4, 20), rng.range(-8, 8), i % 2, i);
        if (i % 25 === 0) store.compact(i + 1000);
        expect(store.list.length).toBeLessThanOrEqual(simData.deltas.maxDeltas);
      }
      return store.toArray();
    };
    expect(run()).toEqual(run());
  });

  it('compaction keeps terrain roughly the same and bumps the epoch', () => {
    const store = new DeltaStore(simData.deltas);
    const rng = new Prng(3);
    for (let i = 0; i < simData.deltas.softLimit + 20; i++) {
      store.add(rng.range(-60, 60), rng.range(-60, 60), 8, -2, DELTA_BUMP, 0);
    }
    const before = store.list.length;
    const epoch = store.compactionEpoch;
    expect(store.compact(10_000)).toBe(true);
    expect(store.list.length).toBeLessThan(before);
    expect(store.compactionEpoch).toBe(epoch + 1);
  });

  it('does not compact young deltas', () => {
    const store = new DeltaStore(simData.deltas);
    for (let i = 0; i < simData.deltas.softLimit + 10; i++) store.add(i, 0, 5, 1, DELTA_BUMP, 100);
    expect(store.compact(101)).toBe(false);
  });
});
