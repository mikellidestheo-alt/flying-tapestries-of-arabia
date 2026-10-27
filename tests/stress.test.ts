import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import { matchSetupFromChapter } from '../src/data/matchSetup';
import simData from '../src/data/sim.json';
import { CREATURES } from '../src/sim/combat';
import { Sim } from '../src/sim/sim';

// Worst-case load: every pool filled to its cap at the start, the densest allowed enemy population,
// four autopilot wizards fighting. Entity counts must stay at or under the caps, nothing may go
// non-finite, a tick must stay cheap, and the same run must repeat exactly.
const caps = simData.caps;

function stressSim(chapterIndex: number): Sim {
  const c = CHAPTERS[chapterIndex]!;
  const match = { ...matchSetupFromChapter(c, ['earth'], 'hard'), enemyDensity: 2 };
  const sim = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match, autopilot: 'aggressive' });
  const p = sim.players[0]!;
  const hostile = c.creatureSet.filter((t) => CREATURES[t]!.hostile);
  for (let i = 0; i < caps.creatures * 2; i++) sim.spawnCreature(hostile[i % hostile.length]!, p.x + 20 + (i % 7) * 9, p.z + 20 + Math.floor(i / 7) * 9);
  for (let i = 0; i < caps.orbs * 2; i++) sim.spawnOrb(p.x + (i % 13) * 4, p.y, p.z + Math.floor(i / 13) * 4, 4, 0, 0);
  return sim;
}

function fingerprint(sim: Sim): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return JSON.stringify([sim.tick, sim.players.map((w) => [r(w.x), r(w.y), r(w.z), r(w.mana), r(w.hp)]), sim.factions.map((f) => r(f.captured)), sim.creatures.length, sim.orbs.length, sim.terrain.deltas.list.length]);
}

describe.each(CHAPTERS.map((c, i) => [c.id, i] as const))('stress: %s', (_id, i) => {
  it('stays inside every cap, finite and fast over three minutes of worst-case fighting', () => {
    const sim = stressSim(i);
    let worst = 0;
    let total = 0;
    const times: number[] = [];
    const ticks = 30 * 60 * 3;
    for (let t = 0; t < ticks; t++) {
      const t0 = performance.now();
      sim.step([{ steer: 0.2, throttle: 0.6, actions: t % 12 === 0 ? 1 : 0 }]);
      const dt = performance.now() - t0;
      total += dt;
      times.push(dt);
      worst = Math.max(worst, dt);
      if (t % 30 === 0) {
        expect(sim.creatures.length).toBeLessThanOrEqual(caps.creatures);
        expect(sim.orbs.length).toBeLessThanOrEqual(caps.orbs);
        expect(sim.projectiles.length).toBeLessThanOrEqual(caps.projectiles);
        expect(sim.wells.length).toBeLessThanOrEqual(caps.wells);
        expect(sim.zones.length).toBeLessThanOrEqual(caps.zones);
        expect(sim.events.length).toBeLessThanOrEqual(caps.events);
        expect(sim.terrain.deltas.list.length).toBeLessThanOrEqual(simData.deltas.maxDeltas);
        for (const w of sim.players) expect(Number.isFinite(w.x + w.y + w.z + w.mana + w.hp)).toBe(true);
        for (const c of sim.creatures) expect(Number.isFinite(c.x + c.y + c.z + c.hp)).toBe(true);
      }
      if (sim.match.status !== 'playing') break;
    }
    const avg = total / Math.max(1, sim.tick);
    console.log(`${CHAPTERS[i]!.id}: avg ${avg.toFixed(3)} ms/tick, worst ${worst.toFixed(2)} ms over ${sim.tick} ticks`);
    expect(avg).toBeLessThan(1.5);
    // Isolated, the worst tick is ~10 ms; a lone spike while 20 test files share the CPU is scheduler noise, so
    // judge the 99.9th percentile against a frame's budget and only catch pathological outliers on the maximum.
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.999)]!).toBeLessThan(33);
    expect(worst).toBeLessThan(400);
  }, 120000);

  it('is deterministic under load', () => {
    const run = () => {
      const sim = stressSim(i);
      for (let t = 0; t < 30 * 40; t++) sim.step([{ steer: Math.sin(t / 50) * 0.5, throttle: 0.5, actions: t % 9 === 0 ? 1 : 0 }]);
      return fingerprint(sim);
    };
    expect(run()).toBe(run());
  }, 60000);
});
