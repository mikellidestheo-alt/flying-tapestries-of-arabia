// Rival wizard AI. Produces a PlayerInput each tick, so rivals fly and cast through exactly the
// same sim code as human players. Personality (aggressive / greedy / defensive) and the chapter's
// AI level shape what they chase.
import castleData from '../data/castles.json';
import rivalData from '../data/rivals.json';
import { clamp, datan2, wrapAngle } from './dmath';
import { nextUpgrade } from './castles';
import { nextSpellUpgrade, spellAt, spellFor } from './combat';
import { DIFFICULTIES } from './match';
import { ACTION_DEPOSIT, ACTION_SPELL, ACTION_SPELLUP, ACTION_UPGRADE, type PlayerInput, type PlayerState, type Sim } from './sim';

export type Personality = keyof typeof rivalData.personalities;
const AI = rivalData.ai;

export type GoalKind = 'explore' | 'orb' | 'well' | 'creature' | 'nest' | 'wizard' | 'castle' | 'home';

export interface RivalAI {
  personality: Personality;
  goal: GoalKind;
  goalId: number;
  gx: number;
  gz: number;
  replanAt: number;
  orbitDir: number;
  branchPick: number;
}

export function makeRivalAI(personality: Personality, index: number): RivalAI {
  const pref: Record<string, number> = { aggressive: 1, greedy: 3, defensive: 2 };
  return { personality, goal: 'explore', goalId: 0, gx: 0, gz: 0, replanAt: 5 + index * 3, orbitDir: index % 2 === 0 ? 1 : -1, branchPick: pref[personality] ?? 1 };
}

interface Candidate {
  kind: GoalKind;
  id: number;
  x: number;
  z: number;
  score: number;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function maxHp(sim: Sim, p: PlayerState): number {
  return sim.maxHpFor(p);
}

function decide(sim: Sim, p: PlayerState, ai: RivalAI): void {
  const setup = sim.setup!;
  const pers = rivalData.personalities[ai.personality];
  const diff = DIFFICULTIES[setup.difficulty];
  const skill = 0.5 + 0.5 * setup.aiLevel;
  const castle = sim.castles.find((c) => c.faction === p.faction)!;
  const spellCost = spellAt(spellFor(), p.spellTier).manaCost;
  const need = clamp(1 - p.mana / 90, 0, 1);
  const best: Candidate = { kind: 'explore', id: 0, x: castle.x + sim.rng.range(-320, 320), z: castle.z + sim.rng.range(-320, 320), score: 0.1 };
  const offer = (c: Candidate) => {
    if (c.score > best.score) Object.assign(best, c);
  };

  // Hurt: run home to heal under the castle's aura.
  if (p.hp < maxHp(sim, p) * AI.retreatHpFraction) offer({ kind: 'home', id: castle.id, x: castle.x, z: castle.z, score: 5 });

  // Upgrade when affordable (defensive builders do it earliest).
  const up = nextUpgrade(castle);
  if (up && castle.bank + p.mana >= up.cost * (1.05 - 0.2 * pers.upgradeEagerness * skill)) {
    offer({ kind: 'home', id: castle.id, x: castle.x, z: castle.z, score: 1.5 + 2.5 * pers.upgradeEagerness });
  }

  // Mana: the closest orb cluster, then wells (greedy collectors love these).
  let bo = Infinity;
  let bi = -1;
  for (let i = 0; i < sim.orbs.length; i++) {
    const o = sim.orbs[i]!;
    const d = dist(o.x, o.z, p.x, p.z);
    if (d < bo) {
      bo = d;
      bi = i;
    }
  }
  if (bi >= 0 && bo < AI.orbSearchRadius) {
    const o = sim.orbs[bi]!;
    offer({ kind: 'orb', id: o.id, x: o.x, z: o.z, score: (pers.greed * 1.1 + need) / (1 + bo / 110) });
  }
  for (const w of sim.wells) {
    if (w.fade > 0) continue;
    const d = dist(w.x, w.z, p.x, p.z);
    if (d < AI.wellSearchRadius && p.mana < 150) offer({ kind: 'well', id: w.id, x: w.x, z: w.z, score: (pers.greed * 1.7 + need) / (1 + d / 260) });
  }

  // Fighting needs mana for spells.
  if (p.mana >= spellCost * 2) {
    for (const c of sim.creatures) {
      const d = dist(c.x, c.z, p.x, p.z);
      if (d < 170) offer({ kind: 'creature', id: c.id, x: c.x, z: c.z, score: (pers.hunt * 0.9 + need * 0.6) / (1 + d / 100) });
    }
    for (const s of sim.structures) {
      if (!s.alive) continue;
      const d = dist(s.x, s.z, p.x, p.z);
      if (d < 420) offer({ kind: 'nest', id: s.id, x: s.x, z: s.z, score: (pers.hunt * 0.55 + pers.greed * 0.3) / (1 + d / 220) });
    }
    for (const w of sim.players) {
      if (!w.active || w.faction === p.faction || w.hp <= 0) continue;
      const d = dist(w.x, w.z, p.x, p.z);
      const dHome = dist(w.x, w.z, castle.x, castle.z);
      const aggression = pers.aggression * diff.rivalAggression * (0.6 + 0.4 * skill);
      if (d < 560) offer({ kind: 'wizard', id: sim.players.indexOf(w) + 1, x: w.x, z: w.z, score: (aggression * 1.6) / (1 + d / 190) });
      if (dHome < AI.defendRadius) offer({ kind: 'wizard', id: sim.players.indexOf(w) + 1, x: w.x, z: w.z, score: pers.defense * 2.2 });
    }
  }
  // Raids on enemy castles grow more tempting as the match goes on (aggressive rivals first).
  if (p.mana >= spellCost * 5) {
    const minutes = sim.tick / (30 * 60);
    for (const c of sim.castles) {
      if (c.faction === p.faction || c.ruined) continue;
      const d = dist(c.x, c.z, p.x, p.z);
      if (d < 1500) {
        const urge = pers.aggression * diff.rivalAggression * skill * (0.3 + minutes / 5);
        offer({ kind: 'castle', id: c.id, x: c.x, z: c.z, score: (urge * 1.3) / (1 + d / 1000) });
      }
    }
  }

  ai.goal = best.kind;
  ai.goalId = best.id;
  ai.gx = best.x;
  ai.gz = best.z;
  if (sim.rng.next() < 0.2) ai.orbitDir = -ai.orbitDir;
}

/** Re-resolve a goal's current position (targets move). Returns false when the target is gone. */
function resolve(sim: Sim, ai: RivalAI): boolean {
  switch (ai.goal) {
    case 'orb': {
      const o = sim.orbs.find((q) => q.id === ai.goalId);
      if (!o) return false;
      ai.gx = o.x;
      ai.gz = o.z;
      return true;
    }
    case 'well': {
      const w = sim.wells.find((q) => q.id === ai.goalId);
      if (!w || w.fade > 0) return false;
      ai.gx = w.x;
      ai.gz = w.z;
      return true;
    }
    case 'creature': {
      const c = sim.creatures.find((q) => q.id === ai.goalId);
      if (!c) return false;
      ai.gx = c.x;
      ai.gz = c.z;
      return true;
    }
    case 'nest': {
      const s = sim.structures.find((q) => q.id === ai.goalId);
      if (!s || !s.alive) return false;
      return true;
    }
    case 'wizard': {
      const w = sim.players[ai.goalId - 1];
      if (!w || !w.active || w.hp <= 0) return false;
      ai.gx = w.x;
      ai.gz = w.z;
      return true;
    }
    case 'castle': {
      const c = sim.castles.find((q) => q.id === ai.goalId);
      return !!c && !c.ruined;
    }
    default:
      return true;
  }
}

export function rivalInput(sim: Sim, index: number): PlayerInput {
  const p = sim.players[index]!;
  const ai = sim.ai[p.rivalIndex]!;
  const setup = sim.setup!;
  const diff = DIFFICULTIES[setup.difficulty];
  const castle = sim.castles.find((c) => c.faction === p.faction)!;

  if (sim.tick >= ai.replanAt || !resolve(sim, ai)) {
    decide(sim, p, ai);
    ai.replanAt = sim.tick + AI.decideEveryTicks + sim.rng.int(0, 6);
  }

  const dx = ai.gx - p.x;
  const dz = ai.gz - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const toGoal = datan2(dx, dz);
  const combat = ai.goal === 'wizard' || ai.goal === 'creature' || ai.goal === 'nest' || ai.goal === 'castle';

  // Combat: close to orbit range, then strafe around the target.
  let desired = toGoal;
  let throttle = AI.cruiseThrottle;
  if (combat) {
    if (d < AI.orbitDistance * 0.85) {
      desired = toGoal + ai.orbitDir * 1.45;
      throttle = 0.15;
    } else throttle = 0.5;
  } else if (ai.goal === 'well') {
    throttle = d < 20 ? -0.7 : 0.4;
  } else if (ai.goal === 'home') {
    throttle = d > 60 ? 0.6 : 0.1;
  } else if (ai.goal === 'orb') {
    throttle = 0.4;
  }
  // Keep clear of the castle walls when passing close.
  const steer = clamp(wrapAngle(p.heading - desired) * AI.steerGain, -1, 1);

  let actions = 0;
  const def = spellAt(spellFor(), p.spellTier);
  if (combat && p.mana >= def.manaCost) {
    let range = AI.combatRange;
    if (ai.goal === 'castle') range = AI.castleAttackRange;
    const aligned = Math.abs(wrapAngle(p.heading - toGoal)) < 0.3;
    if (d < range && aligned && sim.rng.next() < diff.rivalAccuracy * (0.5 + 0.5 * setup.aiLevel)) actions |= ACTION_SPELL;
  }
  // Buy better weapons when flush: aggressive rivals do it first.
  const wu = nextSpellUpgrade(p.spellTier);
  if (wu && p.mana >= wu.cost + 40 && sim.rng.next() < 0.04 + 0.04 * (ai.personality === 'aggressive' ? 1 : 0)) actions |= ACTION_SPELLUP;
  let branch = 0;
  if (ai.goal === 'home') {
    const up = nextUpgrade(castle);
    if (up && dist(p.x, p.z, castle.x, castle.z) < castleData.upgradeRadius - 4 && castle.bank + p.mana >= up.cost) {
      actions |= ACTION_UPGRADE;
      branch = ai.branchPick;
    } else if (up && dist(p.x, p.z, castle.x, castle.z) < castleData.upgradeRadius - 4 && p.mana > 120) {
      actions |= ACTION_DEPOSIT; // top up the bank towards a big upgrade
    }
  }
  return { steer, throttle, actions, branch };
}
