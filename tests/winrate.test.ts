import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import { ELEMENTS, type Element } from '../src/data/elements';
import { BALANCE } from '../src/sim/balance';
import type { MatchSetup } from '../src/sim/match';
import { Sim } from '../src/sim/sim';

// AI-vs-AI win rates. Every match has all four elements, one per faction. A Latin-square design
// rotates which element sits in which faction slot (castle position) so slot advantages cancel,
// across all six chapters and two sets of AI personality assignments. The sim is deterministic,
// so these counts are exactly reproducible. Takes ~1.5 minutes: set FAST=1 to skip it
// (`npm run test:fast`).
const PERSONALITIES = ['aggressive', 'greedy', 'defensive'] as const;

describe.skipIf(process.env.FAST === '1')('AI-vs-AI win rates by element', () => {
  it(
    'each element wins as often as the others, within the tolerance',
    () => {
      const wins: Record<Element, number> = { fire: 0, water: 0, earth: 0, air: 0 };
      let matches = 0;
      for (let pi = 0; pi < 2; pi++) {
        for (const chapterNumber of BALANCE.winRate.chapters) {
          const c = CHAPTERS[chapterNumber - 1]!;
          for (let rot = 0; rot < 4; rot++) {
            const el = (i: number) => ELEMENTS[(i + rot) % 4]!;
            const setup: MatchSetup = {
              humanElements: [el(0)],
              rivals: c.rivals.map((r, i) => ({ id: r.id, name: r.name, personality: r.personality, element: el(i + 1) })),
              targetShare: c.targetShare, palaceWinMana: c.palaceWinMana, aiLevel: c.aiLevel, comeback: c.comeback, difficulty: 'normal',
            };
            const sim = new Sim({ terrain: c.terrain, creatureTypes: c.creatureSet, match: setup, autopilot: PERSONALITIES[(chapterNumber + pi) % 3]! });
            let ticks = 0;
            while (sim.match.status === 'playing' && ticks < 30 * 60 * 25) {
              sim.step([{ steer: 0, throttle: 0, actions: 0 }]);
              ticks++;
            }
            expect(sim.match.status, `match must end (chapter ${chapterNumber}, rotation ${rot})`).not.toBe('playing');
            expect(sim.match.winner).toBeGreaterThanOrEqual(0);
            wins[sim.players[sim.match.winner]!.element]++;
            matches++;
          }
        }
      }
      const fair = 1 / ELEMENTS.length;
      const rates = ELEMENTS.map((e) => ({ e, rate: wins[e] / matches }));
      console.log(`win rates over ${matches} matches: ${rates.map((r) => `${r.e} ${(r.rate * 100).toFixed(1)}%`).join(', ')}`);
      for (const r of rates) {
        expect(Math.abs(r.rate - fair), `${r.e} win rate ${(r.rate * 100).toFixed(1)}% vs fair 25%`).toBeLessThanOrEqual(BALANCE.winRate.tolerance + 1e-9);
      }
    },
    600_000,
  );
});
