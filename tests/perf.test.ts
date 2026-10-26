import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import simData from '../src/data/sim.json';
import { Sim, type PlayerInput } from '../src/sim/sim';
import { sampleChunkHeights } from '../src/sim/terrain';

// Generous ceilings measured in Node (V8, desktop). They guard against accidental
// order-of-magnitude regressions (e.g. an O(n^2) in the sim), not micro-tuning.
describe('cpu budget guards', () => {
  it('a sim tick is far below its 33 ms budget', () => {
    const sim = new Sim({ terrain: CHAPTERS[0]!.terrain });
    const input: PlayerInput = { steer: 0.3, throttle: 0.5, actions: 0 };
    const t0 = performance.now();
    const N = 3000;
    for (let i = 0; i < N; i++) sim.step([input]);
    const per = (performance.now() - t0) / N;
    console.log(`sim tick: ${per.toFixed(4)} ms`);
    expect(per).toBeLessThan(1);
  });

  it('building a high-detail chunk height grid is cheap', () => {
    const sim = new Sim({ terrain: CHAPTERS[0]!.terrain });
    const n = 32;
    sampleChunkHeights(sim.terrain, 0, 0, n, simData.chunkSize); // warm up
    const t0 = performance.now();
    const N = 40;
    for (let i = 0; i < N; i++) sampleChunkHeights(sim.terrain, i, 3, n, simData.chunkSize);
    const per = (performance.now() - t0) / N;
    console.log(`chunk heights n=32: ${per.toFixed(3)} ms`);
    expect(per).toBeLessThan(15);
  });
});
