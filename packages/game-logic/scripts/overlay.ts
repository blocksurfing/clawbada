/**
 * Overlay-pool sizing report: what a fixed seasonal battle prize pool buys
 * (participation, volume, burn-back) and what it risks (win-trading).
 * Usage: bun run overlay [--out file.md]
 */
import { MID_ELITE, type BracketEconomics } from '../src/v3/economy';
import { skillPopulation } from '../src/v3/participation';
import { collusionGain, overlayEquilibrium, type OverlayConfig, type PayoutSchedule } from '../src/v3/overlay';

const S1_SEASON = 352_500_000; // S1 mining emissions (705M allocation, halving)
const REDUCED: BracketEconomics = { stake: 10_000, feeBps: 500, repairWinner: 225, repairLoser: 675 };
const OPP = 937.5 / 4; // Evolved-mine team rate / 4 battles per hour
const SEASON_DAYS = 60;

const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const f0 = (v: number) => Math.round(v).toLocaleString('en-US');
const fM = (v: number) => `${(v / 1e6).toFixed(2)}M`;
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

const cfg = (pool: number, schedule: PayoutSchedule, over: Partial<OverlayConfig> = {}): OverlayConfig => ({
  skills: skillPopulation(300, 200),
  pool,
  schedule,
  battlesPerSeason: 120,
  econ: MID_ELITE,
  opportunityPerBattle: OPP,
  ...over,
});

const schedName = (s: PayoutSchedule) => (s.kind === 'geometric' ? `geometric g=${s.ratio}` : s.kind);
const POOL_FRACS = [0.005, 0.01, 0.025, 0.05];
const SCHEDULES: PayoutSchedule[] = [{ kind: 'geometric', ratio: 0.9 }, { kind: 'linear' }, { kind: 'flat' }];

say('# Overlay-pool equilibrium — Mid bracket, S1');
say();
say(`Assumptions: 300 candidate agents (Elo sigma 200), qualification floor 120 battles/season (2/day), season ${SEASON_DAYS} days, Mid economics (stake 10,000, fee 10%, repairs 450/1350 -> drain 1,900/player/battle), opportunity cost ${f0(OPP)}/battle (Evolved-mine team rate). Rank pay means rational entrants play exactly the floor; ranking must be ELO-like or volume grinding returns.`);
say();

say('## Sizing: what a pool buys (current drain)');
say();
for (const s of SCHEDULES) {
  say(`### ${schedName(s)}`);
  say('| Pool (% of S1) | Pool | N* battlers | Battles/day | Marginal win% | Top-1 EV/season | Median EV | Cost/entrant | Net emission after burn |');
  say('|---|---|---|---|---|---|---|---|---|');
  for (const fr of POOL_FRACS) {
    const pool = S1_SEASON * fr;
    const eq = overlayEquilibrium(cfg(pool, s));
    say(`| ${pct(fr)} | ${fM(pool)} | ${eq.entrants} | ${f0((eq.battlesPerSeasonTotal / SEASON_DAYS))} | ${pct(eq.marginalWinRate)} | ${f0(eq.topEV)} | ${f0(eq.medianEV)} | ${f0(eq.costPerEntrant)} | ${fM(eq.netEmission)} |`);
  }
  say();
}

say('## ELO-banded matchmaking inside the pool (everyone ~50%): same pools, cheaper battlers');
say('| Pool (% of S1) | Schedule | N* random | N* banded | Cost/entrant banded |');
say('|---|---|---|---|---|');
for (const s of SCHEDULES) {
  for (const fr of POOL_FRACS) {
    const pool = S1_SEASON * fr;
    const rnd = overlayEquilibrium(cfg(pool, s));
    const band = overlayEquilibrium({ ...cfg(pool, s), banded: true });
    say(`| ${pct(fr)} | ${schedName(s)} | ${rnd.entrants} | ${band.entrants} | ${f0(band.costPerEntrant)} |`);
  }
}
say();

say('## Drain reduction: fee 10%->5%, repairs halved (linear schedule)');
say('| Pool (% of S1) | N* current drain | N* reduced drain | Battles/day reduced |');
say('|---|---|---|---|');
for (const fr of POOL_FRACS) {
  const pool = S1_SEASON * fr;
  const cur = overlayEquilibrium(cfg(pool, { kind: 'linear' }));
  const red = overlayEquilibrium(cfg(pool, { kind: 'linear' }, { econ: REDUCED }));
  say(`| ${pct(fr)} | ${cur.entrants} | ${red.entrants} | ${f0(red.battlesPerSeasonTotal / SEASON_DAYS)} |`);
}
say();

say('## Qualification floor (pool 2.5%, linear): volume knob vs participation');
say('| Battles/season each | N* | Battles/day total | Net emission after burn |');
say('|---|---|---|---|');
for (const b of [60, 120, 240]) {
  const eq = overlayEquilibrium(cfg(S1_SEASON * 0.025, { kind: 'linear' }, { battlesPerSeason: b }));
  say(`| ${b} | ${eq.entrants} | ${f0(eq.battlesPerSeasonTotal / SEASON_DAYS)} | ${fM(eq.netEmission)} |`);
}
say();

say('## Win-trading (pool 2.5%): pair gain from throwing q of battles, mid-rank pair');
say('Positive gain = colluding beats honest play. Throwing costs the pair nothing beyond ordinary drain, so this is purely what the schedule pays for rank manipulation. Win-rate-score ranking (pessimistic); real ELO self-corrects and pays less.');
say('| Schedule | q=10% | q=25% | q=50% | main rank shift at q=50% |');
say('|---|---|---|---|---|');
for (const s of SCHEDULES) {
  const g = (q: number) => collusionGain(cfg(S1_SEASON * 0.025, s), q, 0.5);
  const g50 = g(0.5);
  say(`| ${schedName(s)} | ${f0(g(0.1)?.gain ?? 0)} | ${f0(g(0.25)?.gain ?? 0)} | ${f0(g50?.gain ?? 0)} | ${g50 ? `${g50.mainRankFrom + 1} -> ${g50.mainRankTo + 1} (feeder -> ${g50.feederRankTo + 1})` : '-'} |`);
}
say();

say('## Skill-spread sensitivity (pool 2.5%, linear)');
say('| Elo sigma | N* | Marginal win% | Top-1 EV/season |');
say('|---|---|---|---|');
for (const sigma of [100, 200, 400]) {
  const eq = overlayEquilibrium(cfg(S1_SEASON * 0.025, { kind: 'linear' }, { skills: skillPopulation(300, sigma) }));
  say(`| ${sigma} | ${eq.entrants} | ${pct(eq.marginalWinRate)} | ${f0(eq.topEV)} |`);
}
say();

say('Reading the tables: N* is the self-selecting number of rational battlers the pool sustains — you buy participation, skill decides shares. Net emission is pool minus the 85% burn on fee+repairs the battles generate; negative means the battle layer burns more than it emits. Flat schedules buy the most bodies but pay nothing for skill and invite sybil qualification; top-heavy geometric pays tactics hardest but pays win-traders too. Linear sits between: rank climbs by main are largely offset by the feeder\'s fall.');

const outIdx = process.argv.indexOf('--out');
if (outIdx > 0 && process.argv[outIdx + 1]) {
  await Bun.write(process.argv[outIdx + 1], lines.join('\n') + '\n');
  console.log(`written ${process.argv[outIdx + 1]}`);
}
