/**
 * Battle-rank mining boost report: per-tier breakevens, the proposed S1
 * schedule, participation equilibrium, population-proofness, budget spend,
 * lapse sting, win-trading surface. Usage: bun run boost [--out file.md]
 */
import { skillPopulation } from '../src/v3/participation';
import {
  APEX_HIGH, ELITE_MID, EVOLVED_LOW,
  boostBpsAt, boostCollusionGain, boostParticipation, breakevenBaseBps,
  type BoostConfig, type BoostSchedule, type TierEconomy,
} from '../src/v3/boost';

const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const f0 = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const bps = (v: number) => `${(v / 100).toFixed(1)}%`;

const TIERS: TierEconomy[] = [EVOLVED_LOW, ELITE_MID, APEX_HIGH];
const MIN_BATTLES = 14; // 2/day qualification floor
const SMOOTH: BoostSchedule = { kind: 'smooth', minBps: 1000, maxBps: 5000 };
const STEPPED: BoostSchedule = { kind: 'stepped', tiers: [
  { pctlFloor: 0.9, boostBps: 5000 }, { pctlFloor: 0.75, boostBps: 2500 },
  { pctlFloor: 0.5, boostBps: 1500 }, { pctlFloor: 0, boostBps: 1000 },
] };
const cfg = (tier: TierEconomy, over: Partial<BoostConfig> = {}): BoostConfig => ({
  skills: skillPopulation(500, 200),
  tier,
  schedule: SMOOTH,
  minBattlesPerEpoch: MIN_BATTLES,
  banded: true,
  ...over,
});

say('# Battle-rank mining boost — team-keyed, weekly epochs');
say();
say(`Proposed S1 schedule under test: smooth +10% -> +50% of the team's own mining income, linear in ELO percentile among qualified participants. Qualification: ${MIN_BATTLES} battles PLAYED per weekly epoch (lapse -> boost 0 next epoch, ELO persists). Stakes untouched (fully zero-sum). 500 candidate teams, Elo sigma 200, banded matchmaking unless noted.`);
say();

say('## Breakeven base boost per tier (banded, marginal team at ~50%)');
say('| Tier | Mining/epoch/team | Battle cost/epoch | Breakeven base boost |');
say('|---|---|---|---|');
for (const t of TIERS) {
  const be = breakevenBaseBps(t, MIN_BATTLES);
  say(`| ${t.name} | ${f0(t.miningPerEpochPerTeam)} | ${f0((be / 10_000) * t.miningPerEpochPerTeam)} | ${bps(be)} |`);
}
say();

say('## Participation equilibrium under the proposed schedule');
say('| Tier | Matchmaking | Participation | Marginal EV/epoch | Median EV | Top EV | Spend (% of tier mining) | Battles/day per 1,000 teams |');
say('|---|---|---|---|---|---|---|---|');
for (const t of TIERS) {
  for (const banded of [true, false]) {
    const eq = boostParticipation(cfg(t, { banded }));
    say(`| ${t.name} | ${banded ? 'banded' : 'random'} | ${pct(eq.entrantShare)} | ${f0(eq.marginalEV)} | ${f0(eq.medianEV)} | ${f0(eq.topEV)} | ${pct(eq.spendShareOfMining)} | ${f0((eq.battlesPerEpochTotal / 7) * (1000 / 500))} |`);
  }
}
say();

say('## Population-proof test (Elite/Mid, banded, zero retuning)');
say('| Candidate teams | Participation | Avg boost | Median EV/epoch | Marginal EV |');
say('|---|---|---|---|---|');
for (const n of [50, 500, 5000]) {
  const eq = boostParticipation(cfg(ELITE_MID, { skills: skillPopulation(n, 200) }));
  say(`| ${n} | ${pct(eq.entrantShare)} | ${bps(eq.avgBoostBps)} | ${f0(eq.medianEV)} | ${f0(eq.marginalEV)} |`);
}
say('(Contrast: the fixed overlay pool bought 34 battlers at 500 candidates and would buy the SAME 34 at 5,000 — the boost pays every qualifying team identically at any population.)');
say();

say('## The unravel keystone: base tier and banding are both load-bearing');
say('| Variant (Elite/Mid) | Participation |');
say('|---|---|');
const noBase: BoostSchedule = { kind: 'stepped', tiers: [{ pctlFloor: 0.5, boostBps: 2500 }, { pctlFloor: 0.9, boostBps: 5000 }] };
say(`| Proposed (base +10%, banded) | ${pct(boostParticipation(cfg(ELITE_MID)).entrantShare)} |`);
say(`| Base +10%, RANDOM matchmaking | ${pct(boostParticipation(cfg(ELITE_MID, { banded: false })).entrantShare)} |`);
say(`| NO base tier (boost only above median), banded | ${pct(boostParticipation(cfg(ELITE_MID, { schedule: noBase })).entrantShare)} |`);
say(`| NO base tier, random | ${pct(boostParticipation(cfg(ELITE_MID, { schedule: noBase, banded: false })).entrantShare)} |`);
say();

say('## Lapse sting: skipping one epoch (fleet loses its boost for the next week)');
say('| Fleet | At median boost | At top-decile boost |');
say('|---|---|---|');
for (const [n, t] of [[10, EVOLVED_LOW], [10, ELITE_MID], [10, APEX_HIGH]] as [number, TierEconomy][]) {
  const mid = (boostBpsAt(0.5, SMOOTH) / 10_000) * t.miningPerEpochPerTeam * n;
  const top = (boostBpsAt(0.95, SMOOTH) / 10_000) * t.miningPerEpochPerTeam * n;
  say(`| ${n} ${t.name} teams | ${f0(mid)} | ${f0(top)} |`);
}
say();

say('## Wallet-internal win-trading (full 500-team pool; pessimistic upper bound)');
say('Feeder throws q of its battles to a flagship at the same skill. Gain in $CLAW/epoch for the pair vs honest play. Win-rate-score ranking (pessimistic; real ELO pays ~nothing for farming a collapsed feeder).');
say('| Schedule | Pair position | q=25% | q=50% |');
say('|---|---|---|---|');
for (const [name, sched, pos] of [
  ['smooth', SMOOTH, 0.5], ['smooth', SMOOTH, 0.85],
  ['stepped', STEPPED, 0.5], ['stepped (at tier boundary)', STEPPED, 0.88],
] as [string, BoostSchedule, number][]) {
  const g = (q: number) => boostCollusionGain(cfg(ELITE_MID, { banded: false, schedule: sched }), q, pos);
  say(`| ${name} | pctl ${pos} | ${f0(g(0.25)?.gain ?? 0)} | ${f0(g(0.5)?.gain ?? 0)} |`);
}
say();

say('Reading: the base tier converts the qualification floor into a wash for the weakest qualified team (drain repaid), the smooth ladder pays skill linearly on top, and because every boost is a percentage of the TEAM\'S OWN mining, the design needs no population forecast, no pool sizing, and no per-season retuning — spend scales with real participation and is capped by the schedule max.');

const outIdx = process.argv.indexOf('--out');
if (outIdx > 0 && process.argv[outIdx + 1]) {
  await Bun.write(process.argv[outIdx + 1], lines.join('\n') + '\n');
  console.log(`written ${process.argv[outIdx + 1]}`);
}
