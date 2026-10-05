/**
 * D-19 report: the mining-reward glide as the contract runs it, against the populations the
 * audit asked for (15,000–30,000 teams, a surge, a step, an exodus), versus the idealised glide
 * the design was validated with, and versus candidate contract changes.
 * Usage: bun run season:glide [--out file.md]
 */
import { D19_SCENARIOS, CANDIDATES, ONCHAIN, SHAPE_SCENARIOS, ESTIMATORS, runGlideSeason, type GlideScenario, type GlideParams, type GlideRunResult } from '../src/v3/season-glide';

const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const f0 = (v: number) => Math.round(v).toLocaleString('en-US');
const fM = (v: number) => `${(v / 1e6).toFixed(1)}M`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const reward = (r: GlideRunResult) => [1, 2, 3, 7, 30, 60].map((d) => f0(r.rewardByDay[d - 1])).join(' / ');
const be = (r: GlideRunResult) => r.finalEliteBreakevenBps === Infinity ? 'battle dead' : `${(r.finalEliteBreakevenBps / 100).toFixed(0)}%`;

function row(name: string, r: GlideRunResult) {
  say(`| ${name} | ${r.exhaustionDay ?? '—'} | ${r.zeroIncomeDays} | ${pct(r.mintedShareByDay[6])} | ${r.maxDayOverspendX.toFixed(1)}× | ${reward(r)} | ${f0(r.day1TeamEarnings)} | ${fM(r.unspentGold)} | ${be(r)} |`);
}
const header = (first: string) => {
  say(`| ${first} | Budget dry on day | Zero-income days | Spent by day 7 (fair: 11.7%) | Worst day vs fair share | Reward d1 / d2 / d3 / d7 / d30 / d60 | Day-1 team earnings | Unspent | Elite breakeven boost at d60 |`);
  say('|---|---|---|---|---|---|---|---|---|');
};

say('# D-19 — the mining-reward glide as the contract runs it');
say();
say('S1 budget 352.5M GOLD, 60 days, launch reward 1,250 per Base expedition, 6 expeditions a day per team, tier weights 1/3/10/25, 50% of income retained toward upgrades (12k/60k/300k effective), boost on the same budget (+15% expected on Evolved+). "Ideal" is the daily exact re-peg the design was validated with (season.ts): no clamp, no lag, no blind first day. "On-chain" is `MiningPool` as it deploys after D-19 (2026-10-02): re-peg once an HOUR from the average demand of the last four hours (D-C, 2026-10-03; "D-19 as first shipped" in section 2 is the same controller pacing on the previous hour alone), at most ±30% an hour, nothing in hour 0, and no hour minting more than twice its fair share of what is left. Section 2 keeps the controller this replaced ("before D-19") and the alternatives weighed.');
say();

say('## 1. Ideal glide vs the contract (D-19 controller), same populations');
say();
header('Scenario · mode');
for (const scenario of D19_SCENARIOS) {
  row(`${scenario.name} · ideal`, runGlideSeason({ scenario, mode: 'ideal' }));
  row(`${scenario.name} · on-chain`, runGlideSeason({ scenario, mode: 'onchain' }));
}
say();

say('## 2. The controller before D-19, the alternatives weighed, and the one shipped — on the hard cases');
say();
const hard: GlideScenario[] = [D19_SCENARIOS[3], D19_SCENARIOS[4], D19_SCENARIOS[5], D19_SCENARIOS[6], D19_SCENARIOS[7], D19_SCENARIOS[8]];
for (const scenario of hard) {
  say(`### ${scenario.name}`);
  say();
  header('Controller');
  row('ideal (reference)', runGlideSeason({ scenario, mode: 'ideal' }));
  for (const c of CANDIDATES) row(c.name, runGlideSeason({ scenario, mode: 'onchain', params: c.params }));
  say();
}

say('## 3. Recovery after the exodus (D-19 a): on-chain reward as a share of the ideal, by day');
say();
const exodus = D19_SCENARIOS[8];
const ideal = runGlideSeason({ scenario: exodus, mode: 'ideal' });
say('| Controller | d30 | d31 | d32 | d33 | d35 | d40 | d45 | d60 | days below 90% of ideal after d30 |');
say('|---|---|---|---|---|---|---|---|---|---|');
for (const c of CANDIDATES) {
  const r = runGlideSeason({ scenario: exodus, mode: 'onchain', params: c.params });
  const ratio = (d: number) => r.rewardByDay[d - 1] / ideal.rewardByDay[d - 1];
  let below = 0;
  for (let d = 31; d <= 60; d++) if (ratio(d) < 0.9) below++;
  say(`| ${c.name} | ${[30, 31, 32, 33, 35, 40, 45, 60].map((d) => pct(ratio(d))).join(' | ')} | ${below} |`);
}
say();

say('## 4. Demand shape × demand estimator (review 2026-10-03 D-C): 20,000 teams from day 1');
say();
say('"Locked / spread" = GOLD earned per unit demanded by the bunched cohort vs the smooth one (phase-locked: the cohort starting on one hour in four; daily rhythm: peak-hour vs off-peak starts). Ratio 1.00 = fair. Refused starts retry next hour.');
say();
say('| Shape · estimator | Spent | Reward d1 / d7 / d30 / d60 | Locked / spread per unit | Ratio | Refused starts | Worst day | Unspent |');
say('|---|---|---|---|---|---|---|---|');
for (const scenario of SHAPE_SCENARIOS) {
  for (const est of ESTIMATORS) {
    const r = runGlideSeason({ scenario, mode: 'onchain', params: est.params });
    const rd = (d: number) => f0(r.rewardByDay[d - 1]);
    say(`| ${scenario.name} · ${est.name} | ${pct(r.mintedShareByDay[59])} | ${rd(1)} / ${rd(7)} / ${rd(30)} / ${rd(60)} | ${r.cohortPerUnit.locked.toFixed(1)} / ${r.cohortPerUnit.spread.toFixed(1)} | ${r.cohortPerUnit.ratio.toFixed(2)} | ${pct(r.refusedShare)} | ${r.maxDayOverspendX.toFixed(2)}× | ${fM(r.unspentGold)} |`);
  }
}
say();

const outIdx = process.argv.indexOf('--out');
if (outIdx > 0 && process.argv[outIdx + 1]) {
  await Bun.write(process.argv[outIdx + 1], lines.join('\n') + '\n');
  console.log(`written ${process.argv[outIdx + 1]}`);
}
