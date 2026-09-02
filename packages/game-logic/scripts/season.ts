/**
 * Season-burn report: fixed vs auto-glide baseReward across adoption
 * scenarios, boost funding modes, battle-layer stress at season end.
 * Usage: bun run season [--out file.md]
 */
import { SCENARIOS, runSeason, type SeasonConfig } from '../src/v3/season';

const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const f0 = (v: number) => Math.round(v).toLocaleString('en-US');
const fM = (v: number) => `${(v / 1e6).toFixed(1)}M`;

say('# Season burn — S1 budget 352.5M, 60 days, launch baseReward 1,250');
say();
say('Assumptions: 1 team per participating wallet, full-time mining; arrivals ramp over the faucet window; 50% of income retained toward tier upgrades (effective upgrade costs 12k/60k/300k $CLAW incl. market fuel); boost = +30% avg on 50% of Evolved+ teams (expected +15%); glide recomputes baseReward daily = min(1,250, remaining/(remainingDays x demand)); carve = 20% of budget reserved for boost.');
say();

say('## Fixed baseReward (current contract semantics) vs auto-glide');
say('| Scenario | Mode | Boost | Exhaustion day | Zero-income days | Reward d1/d30/d60 | Day-1 team season earnings | Tier mix d60 (B/E/El/A) | Unspent | Elite breakeven boost at final reward |');
say('|---|---|---|---|---|---|---|---|---|---|');
for (const scenario of SCENARIOS) {
  for (const [mode, boost] of [['fixed', 'none'], ['fixed', 'same-budget'], ['glide', 'same-budget'], ['glide', 'carve']] as SeasonConfig['mode' | 'boost'][][]) {
    const r = runSeason({ scenario, mode: mode as SeasonConfig['mode'], boost: boost as SeasonConfig['boost'] });
    const rp = r.rewardPath.map(p => f0(p.reward)).join(' / ');
    const be = r.finalEliteBreakevenBps === Infinity ? 'battle dead' : `${(r.finalEliteBreakevenBps / 100).toFixed(1)}%`;
    say(`| ${scenario.name} | ${mode} | ${boost} | ${r.exhaustionDay ?? '—'} | ${r.zeroIncomeDays} | ${rp} | ${f0(r.day1TeamEarnings)} | ${r.tierMix.join('/')} | ${fM(r.unspent)} | ${be}${r.boostUnpaidDays ? ` (boost unpaid ${r.boostUnpaidDays}d)` : ''} |`);
  }
}
say();
say('Reading: "Exhaustion day" is when fixed-reward mining halts (SeasonBudgetExhausted) — everything after is zero income, boost value zero, battle qualification irrational. Glide never halts: crowding becomes declining per-team yield instead. The last column is the battle-layer stress test: the base boost needed to keep Elite battle qualification rational at the season-end reward — above the 50% schedule cap means fixed-$CLAW battle costs (stakes, repairs) have outgrown compressed mining yields and need per-season re-pegging.');

const outIdx = process.argv.indexOf('--out');
if (outIdx > 0 && process.argv[outIdx + 1]) {
  await Bun.write(process.argv[outIdx + 1], lines.join('\n') + '\n');
  console.log(`written ${process.argv[outIdx + 1]}`);
}
