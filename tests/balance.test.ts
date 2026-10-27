import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../src/data/chapters';
import { ELEMENTS, type Element } from '../src/data/elements';
import { BALANCE, fullReport, primaryReport, signatureReport } from '../src/sim/balance';
import { COMBOS, KITS, MAX_SPELL_TIER, SPELLS, spellAt } from '../src/sim/spelldefs';

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

describe('spell table', () => {
  it('every wizard has a primary attack with 3 tiers and a signature spell of the right kind', () => {
    const kinds: Record<Element, string> = { fire: 'zone', water: 'nova', earth: 'wall', air: 'dash' };
    for (const el of ELEMENTS) {
      const k = KITS[el];
      expect(SPELLS[k.primary], el).toBeDefined();
      expect(SPELLS[k.primary]!.element).toBe(el);
      expect(SPELLS[k.primary]!.tiers!.length).toBe(MAX_SPELL_TIER - 1);
      expect(SPELLS[k.primary]!.tierNames!.length).toBe(MAX_SPELL_TIER);
      expect(SPELLS[k.signature]!.element).toBe(el);
      expect(SPELLS[k.signature]!.kind).toBe(kinds[el]);
    }
  });

  it('co-op combos are defined in the table, each needing two different elements', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(3);
    const pairs = COMBOS.map((c) => [...c.needs].sort().join('+'));
    expect(pairs).toContain('fire+water'); // steam
    expect(pairs).toContain('air+fire'); // fire tornado
    expect(pairs).toContain('earth+water'); // earth walls channel water
    for (const c of COMBOS) {
      expect(c.needs[0]).not.toBe(c.needs[1]);
      for (const e of c.needs) expect(ELEMENTS).toContain(e);
      expect(c.durationTicks).toBeGreaterThan(0);
    }
  });
});

describe('balance: every wizard sits on the same damage and efficiency budget', () => {
  it.each(ELEMENTS.flatMap((el) => [1, 2, 3].map((t) => [el, t] as const)))('%s tier %i is within tolerance of the budget', (el, tier) => {
    const r = primaryReport(el, tier);
    const dps = BALANCE.primaryBudget.dps[tier - 1]!;
    const eff = BALANCE.primaryBudget.efficiency[tier - 1]!;
    expect(Math.abs(r.dps / dps - 1), `${el} t${tier} dps ${r.dps.toFixed(1)} vs ${dps}`).toBeLessThanOrEqual(BALANCE.tolerance);
    expect(Math.abs(r.efficiency / eff - 1), `${el} t${tier} efficiency ${r.efficiency.toFixed(2)} vs ${eff}`).toBeLessThanOrEqual(BALANCE.tolerance);
  });

  it('signature spells hold a looser, separate budget (value per second and value per mana)', () => {
    for (const el of ELEMENTS) {
      const r = signatureReport(el);
      expect(Math.abs(r.valuePerSecond / BALANCE.signature.valuePerSecond - 1), `${el} value/s ${r.valuePerSecond.toFixed(2)}`).toBeLessThanOrEqual(BALANCE.signature.tolerance);
      expect(Math.abs(r.efficiency / BALANCE.signature.efficiency - 1), `${el} value/mana ${r.efficiency.toFixed(2)}`).toBeLessThanOrEqual(BALANCE.signature.tolerance);
    }
  });

  it('utility is not hidden behind raw DPS: time-to-kill a creature and time-to-destroy a structure', () => {
    for (let tier = 1; tier <= MAX_SPELL_TIER; tier++) {
      const rs = ELEMENTS.map((el) => primaryReport(el, tier));
      const ttk = rs.map((r) => r.ttkCreature);
      const ttd = rs.map((r) => r.ttdStructure);
      expect(Math.max(...ttk) / Math.min(...ttk), `tier ${tier} ttk spread`).toBeLessThanOrEqual(BALANCE.roles.ttkSpread);
      expect(Math.max(...ttd) / Math.min(...ttd), `tier ${tier} ttd spread`).toBeLessThanOrEqual(BALANCE.roles.ttdSpread);
      // Earth is the structure-breaker: clearly fastest against structures.
      const earth = rs.find((r) => r.element === 'earth')!;
      const others = rs.filter((r) => r.element !== 'earth').map((r) => r.ttdStructure);
      expect(earth.ttdStructure, `tier ${tier} earth ttd`).toBeLessThanOrEqual(median(others) * 0.7);
      for (const o of others) expect(o, `tier ${tier} non-earth structure time`).toBeLessThanOrEqual(BALANCE.roles.ttdMaxNonEarth); // nobody is locked out of structures
    }
  });

  it('every wizard has a distinct identity in the table', () => {
    const t1 = (el: Element) => spellAt(KITS[el].primary, 1);
    const rate = (el: Element) => 30 / t1(el).cooldownTicks;
    // Air: fastest cast rate and projectile; Earth: slowest rate, heaviest structure damage.
    expect(ELEMENTS.slice().sort((a, b) => rate(b) - rate(a))[0]).toBe('air');
    expect(ELEMENTS.slice().sort((a, b) => rate(a) - rate(b))[0]).toBe('earth');
    expect(ELEMENTS.slice().sort((a, b) => t1(b).speed - t1(a).speed)[0]).toBe('air');
    expect(ELEMENTS.slice().sort((a, b) => t1(b).structureMult - t1(a).structureMult)[0]).toBe('earth');
    expect(t1('water').chain!.count).toBeGreaterThanOrEqual(2);
    expect(t1('water').effects.some((e) => e.type === 'slow')).toBe(true);
    expect(spellAt(KITS.water.primary, 3).effects.some((e) => e.type === 'freeze')).toBe(true);
    expect(t1('fire').effects.some((e) => e.type === 'burn')).toBe(true);
    expect(spellAt(KITS.earth.primary, 3).aftershock).toBeDefined();
    expect(spellAt(KITS.air.primary, 3).chain).toBeDefined();
  });

  it('prints the balance report (informational)', () => {
    const rep = fullReport();
    const lines = rep.primary.map((r) => `${r.element.padEnd(6)} t${r.tier} ${r.spell.padEnd(10)} dps ${r.dps.toFixed(1).padStart(6)}  eff ${r.efficiency.toFixed(2)}  ttk ${r.ttkCreature.toFixed(2)}s  ttd ${r.ttdStructure.toFixed(2)}s`);
    console.log('\n' + lines.join('\n'));
    expect(rep.primary.length).toBe(12);
    expect(CHAPTERS.length).toBe(6);
  });
});
