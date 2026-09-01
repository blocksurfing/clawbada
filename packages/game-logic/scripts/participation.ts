/**
 * Battle-vs-mining participation report. bun run participation
 * Core result: pure negative-sum battle unravels to zero rational
 * participation; this report sizes the per-battle reward needed to sustain a
 * pool, across skill spreads, seasons (mining halvings), and throughput —
 * and compares it to the protocol fee (could fee recycling self-fund it?).
 */
import { v3 } from '../src/index';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const out = opt('out', '');
const lines: string[] = []; const say = (s = '') => { lines.push(s); console.log(s); };
const econ = v3.MID_ELITE;
const fee = (2 * econ.stake * econ.feeBps) / 10_000;
const N = 2000;

say('# Battle participation — who battles, and what does it cost to make that rational?');
say();
say('## Core result: complete unraveling');
say('Battle is negative-sum (~1,900 $CLAW average drain per player per Mid battle from fee + repairs). Under random matchmaking, the weakest agent in ANY pool wins <50% inside it while breakeven is ~60% — so the rational exit cascade never stops. **With purely profit-maximizing agents, battle participation collapses to zero at every skill spread.** Humans battle anyway (fun, overconfidence); rational agents will not. A positive-sum layer is required.');
say();
say('## Subsidy required per battle (paid to each participant) to hold a pool');
say(`Mid bracket, Elite mining alternative. Protocol fee collected per battle: ${fee} $CLAW.`);
say();
say('| Skill spread (Elo σ) | Battles/hr | Mining $CLAW/hr | Pool 10% | Pool 25% | Pool 50% |');
say('|---|---|---|---|---|---|');
for (const sigma of [100, 200, 400]) {
  for (const bph of [4, 10]) {
    for (const [season, mining] of [['S1', 3125], ['S3', 781], ['S5', 195]] as const) {
      const skills = v3.skillPopulation(N, sigma);
      const cells = [0.10, 0.25, 0.50].map(share => {
        const { subsidy } = v3.requiredSubsidy({ skills, battlesPerHour: bph, miningPerHour: mining, econ }, share);
        const pctFee = (100 * 2 * subsidy) / fee; // both participants paid
        return `${Math.round(subsidy)} (${pctFee.toFixed(0)}% of fee)`;
      });
      say(`| ${sigma} | ${bph} | ${mining} (${season}) | ${cells.join(' | ')} |`);
    }
  }
}
say();
say('Reading the table: "X (Y% of fee)" = per-participant subsidy X, and Y% is the share of that battle\'s own protocol fee needed to fund BOTH participants\' subsidies. Under 100% means fee recycling alone could sustain the pool (burn less, pay battlers); over 100% needs emissions or treasury.');
if (out) { await Bun.write(out, lines.join('\n') + '\n'); console.log(`written ${out}`); }
