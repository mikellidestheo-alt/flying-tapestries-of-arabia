// Prints each wizard's damage-per-second, mana efficiency and utility numbers vs the budget.
// Run: npm run balance
import { BALANCE, fullReport } from '../src/sim/balance';

const rep = fullReport();
console.log('PRIMARY ATTACKS (budget DPS / efficiency per tier: ' + BALANCE.primaryBudget.dps.join(', ') + ' / ' + BALANCE.primaryBudget.efficiency.join(', ') + ', tolerance ' + BALANCE.tolerance * 100 + '%)');
for (const r of rep.primary) {
  const dBud = BALANCE.primaryBudget.dps[r.tier - 1]!;
  const eBud = BALANCE.primaryBudget.efficiency[r.tier - 1]!;
  console.log(
    `${r.element.padEnd(6)} t${r.tier} ${r.spell.padEnd(10)} dps ${r.dps.toFixed(1).padStart(6)} (${((r.dps / dBud - 1) * 100).toFixed(1).padStart(5)}%)  eff ${r.efficiency.toFixed(2)} (${((r.efficiency / eBud - 1) * 100).toFixed(1).padStart(5)}%)  kill-creature ${r.ttkCreature.toFixed(2)}s  destroy-structure ${r.ttdStructure.toFixed(2)}s`,
  );
}
console.log('\nSIGNATURE SPELLS (budget value/s ' + BALANCE.signature.valuePerSecond + ', tolerance ' + BALANCE.signature.tolerance * 100 + '%)');
for (const r of rep.signature) console.log(`${r.element.padEnd(6)} ${r.spell.padEnd(10)} value/s ${r.valuePerSecond.toFixed(2)}  value/mana ${r.efficiency.toFixed(2)}`);
