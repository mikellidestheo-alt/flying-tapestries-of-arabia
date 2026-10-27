// Balance model: turns the spell table into comparable numbers. Used by tests/balance.test.ts
// and `npm run balance`. Nothing here is used at runtime by the game.
import balance from '../data/balance.json';
import type { Element } from '../data/elements';
import { ELEMENTS } from '../data/elements';
import { KITS, MAX_SPELL_TIER, spellAt, type SpellDef } from './spelldefs';

export const BALANCE = balance;
export const TICKS = 30;

/** Damage-equivalent value of one cast of a primary attack against a typical target mix. */
export function effectiveDamage(s: SpellDef): number {
  const areaBonus = balance.areaCoef * Math.max(0, s.area - balance.areaBase);
  let e = s.damage * (1 + areaBonus);
  for (const f of s.effects) {
    if (f.type === 'burn') e += (f.dps ?? 0) * (f.durationTicks / TICKS) * balance.dotUptime;
    else if (f.type === 'slow') e += (1 - (f.mult ?? 1)) * (f.durationTicks / TICKS) * balance.slowValuePerSec;
    else if (f.type === 'freeze') e += (f.durationTicks / TICKS) * balance.freezeValuePerSec;
  }
  if (s.chain) {
    let sum = 0;
    for (let i = 1; i <= s.chain.count; i++) sum += s.chain.falloff ** i;
    e += s.damage * sum * balance.chainHit;
  }
  if (s.aftershock) e += s.damage * s.aftershock.damageMult * balance.aftershockHit;
  // Calibration from AI-vs-AI play (see docs/decisions.md): the plain model undervalues how much
  // more mana an element really collects (area shots that one-shot clusters), so those spells are
  // costed higher and the solver gives them less damage per hit for the same budget.
  return e * ((balance.elementPower as Record<string, number>)[s.element] ?? 1);
}

export function castsPerSecond(s: SpellDef): number {
  return TICKS / s.cooldownTicks;
}

export interface PrimaryReport {
  element: Element;
  tier: number;
  spell: string;
  dps: number;
  efficiency: number;
  /** Seconds to kill one creature (single target: damage plus burn at its usual uptime). */
  ttkCreature: number;
  /** Seconds to destroy one nest-sized structure. */
  ttdStructure: number;
}

export function primaryReport(element: Element, tier: number): PrimaryReport {
  const id = KITS[element].primary;
  const s = spellAt(id, tier);
  const e = effectiveDamage(s);
  const burn = s.effects.filter((f) => f.type === 'burn').reduce((a, f) => a + (f.dps ?? 0) * (f.durationTicks / TICKS) * balance.dotUptime, 0);
  const singlePerCast = s.damage + burn;
  const rate = castsPerSecond(s);
  return {
    element,
    tier,
    spell: id,
    dps: e * rate,
    efficiency: e / s.manaCost,
    ttkCreature: balance.roles.creatureHp / (singlePerCast * rate),
    ttdStructure: balance.roles.structureHp / (s.damage * s.structureMult * rate),
  };
}

/** Damage-equivalent value of one cast of a signature spell. */
export function signatureValue(s: SpellDef): number {
  const targets = (r: number) => Math.max(1, 1 + balance.signature.targetsCoef * (r - balance.signature.targetsBase));
  switch (s.kind) {
    case 'zone':
      return (s.dps ?? 0) * ((s.durationTicks ?? 0) / TICKS) * targets(s.radius ?? 0);
    case 'nova': {
      let v = s.damage * targets(s.radius ?? 0);
      for (const f of s.effects) {
        if (f.type === 'slow') v += (1 - (f.mult ?? 1)) * (f.durationTicks / TICKS) * balance.slowValuePerSec;
        if (f.type === 'freeze') v += (f.durationTicks / TICKS) * balance.freezeValuePerSec;
      }
      return v;
    }
    case 'wall':
      return balance.signature.wallValue;
    case 'dash':
      return balance.signature.dashValue;
    default:
      return 0;
  }
}

export interface SignatureReport {
  element: Element;
  spell: string;
  valuePerSecond: number;
  efficiency: number;
}

export function signatureReport(element: Element): SignatureReport {
  const id = KITS[element].signature;
  const s = spellAt(id, 1);
  const v = signatureValue(s);
  return { element, spell: id, valuePerSecond: (v * TICKS) / s.cooldownTicks, efficiency: v / s.manaCost };
}

export function fullReport(): { primary: PrimaryReport[]; signature: SignatureReport[] } {
  const primary: PrimaryReport[] = [];
  for (const el of ELEMENTS) for (let t = 1; t <= MAX_SPELL_TIER; t++) primary.push(primaryReport(el, t));
  return { primary, signature: ELEMENTS.map(signatureReport) };
}
