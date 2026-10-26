// Match setup and rules: factions, mana shares, win/lose, comeback and sudden death.
import difficultyData from '../data/difficulty.json';
import matchData from '../data/match.json';
import type { Element } from '../data/elements';
import type { Sim } from './sim';
import { SIM_TICK_RATE } from './sim';

export type DifficultyId = 'easy' | 'normal' | 'hard';
export type DifficultyTuning = (typeof difficultyData)['normal'];
export const DIFFICULTIES = difficultyData as Record<DifficultyId, DifficultyTuning>;

export interface RivalSetup {
  id: string;
  name: string;
  personality: 'aggressive' | 'greedy' | 'defensive';
  element: Element;
}

export interface MatchSetup {
  humanElements: Element[];
  rivals: RivalSetup[];
  targetShare: number;
  /** 0..1 rival AI skill for the chapter. */
  aiLevel: number;
  comeback: {
    startMinute: number;
    trailingIncomeBonus: number;
    suddenDeathMinute: number;
    suddenDeathShare: number;
  };
  difficulty: DifficultyId;
  nestCount?: number;
}

export type MatchStatus = 'playing' | 'won' | 'lost';

export interface MatchState {
  status: MatchStatus;
  reason: string;
  /** Current target share (drops when sudden death begins). */
  targetShare: number;
  suddenDeath: boolean;
  /** Per-faction share of all mana captured so far (0..1). */
  shares: number[];
  endTick: number;
}

export function factionShare(sim: Sim, faction: number): number {
  const total = sim.factions.reduce((a, f) => a + f.captured, 0);
  return total > 0 ? sim.factions[faction]!.captured / total : 0;
}

/** Income multiplier for a faction: difficulty plus the comeback bonus for trailing factions. */
export function incomeMultiplier(sim: Sim, faction: number): number {
  const setup = sim.setup;
  if (!setup) return 1;
  const d = DIFFICULTIES[setup.difficulty];
  let m = sim.factions[faction]!.human ? d.playerIncome : d.rivalIncome;
  const minutes = sim.tick / (SIM_TICK_RATE * 60);
  if (minutes >= setup.comeback.startMinute) {
    const active = sim.factions.filter((f) => !f.eliminated).length;
    const fair = 1 / Math.max(1, active);
    if (sim.match.shares[faction]! < fair * 0.85) m *= 1 + setup.comeback.trailingIncomeBonus;
  }
  return m;
}

export function stepMatch(sim: Sim): void {
  const setup = sim.setup;
  const m = sim.match;
  if (!setup || m.status !== 'playing') return;
  if (sim.tick % SIM_TICK_RATE !== 0) return;

  const total = sim.factions.reduce((a, f) => a + f.captured, 0);
  for (const f of sim.factions) m.shares[f.id] = total > 0 ? f.captured / total : 0;

  const minutes = sim.tick / (SIM_TICK_RATE * 60);
  if (!m.suddenDeath && minutes >= setup.comeback.suddenDeathMinute) {
    m.suddenDeath = true;
    m.targetShare = setup.comeback.suddenDeathShare;
  }
  const end = (status: MatchStatus, reason: string) => {
    m.status = status;
    m.reason = reason;
    m.endTick = sim.tick;
    sim.emit('matchEnd', 0, 0, 0, status === 'won' ? 1 : 0);
  };

  // Last castle standing.
  const human = sim.factions[0]!;
  if (human.eliminated) return end('lost', 'Your castle fell.');
  if (sim.factions.every((f) => f.human || f.eliminated)) return end('won', 'Every rival castle has fallen.');

  // Mana share race.
  if (total >= matchData.minTotalForWin && minutes >= matchData.winAfterMinutes) {
    let best = -1;
    let bestShare = 0;
    for (const f of sim.factions) {
      if (f.eliminated) continue;
      if (m.shares[f.id]! > bestShare) {
        bestShare = m.shares[f.id]!;
        best = f.id;
      }
    }
    if (best >= 0 && bestShare >= m.targetShare) {
      return end(sim.factions[best]!.human ? 'won' : 'lost', sim.factions[best]!.human ? `You captured ${Math.round(bestShare * 100)}% of the mana.` : `${sim.factions[best]!.name} captured ${Math.round(bestShare * 100)}% of the mana.`);
    }
    // Hard stop a few minutes into sudden death: the leader wins.
    if (minutes >= setup.comeback.suddenDeathMinute + matchData.hardEndAfterSuddenDeathMinutes) {
      if (best >= 0) return end(sim.factions[best]!.human ? 'won' : 'lost', 'Time is up: the mana leader takes the chapter.');
    }
  }
}
