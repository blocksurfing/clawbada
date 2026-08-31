/**
 * Underdog-bonus EV report. bun run economy [-- --cap 5000 --n 48 --out file.md]
 * Answers: how much rebate (as a share of the protocol fee) is needed to make
 * every class economically viable, and what does the economic meta look like?
 */
import { deriveRandom, v3 } from '../src/index';
const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEED = BigInt(opt('seed', '20260831'));
const out = opt('out', '');
const lines: string[] = []; const say = (s = '') => { lines.push(s); console.log(s); };
const D: v3.DuelOptions = { tier: 'elite', purity: 3, seed: SEED };
const comps = v3.enumerateComps();

// ── comp pool: screening top-N, plus each class's best comps so all 10 are represented ──
say(`# Underdog-bonus EV report — Mid bracket, Elite tier, seed=${SEED}`);
const rating = comps.map(() => 0); const games = comps.map(() => 0);
for (let i = 0; i < comps.length; i++)
  for (let k = 0; k < 10; k++) {
    const j = Number(deriveRandom(SEED, `es_${i}_${k}`) % BigInt(comps.length));
    if (j === i) continue;
    const w = v3.duelComps(comps[i], comps[j], v3.focusPolicy, 1, D);
    rating[i] += w; games[i]++; rating[j] += 1 - w; games[j]++;
  }
for (let i = 0; i < comps.length; i++) rating[i] /= Math.max(1, games[i]);
const order = [...comps.keys()].sort((a, b) => rating[b] - rating[a]);
const pool = new Set<number>(order.slice(0, Number(opt('n', '48'))));
for (let c = 0; c < 10; c++) {
  let added = 0;
  for (const i of order) { if (comps[i].includes(c)) { pool.add(i); if (++added >= 3) break; } }
}
const P = [...pool];
say(`Pool: ${P.length} comps (screening top-${opt('n', '48')} + each class's 3 best).`);

// ── win matrix ──
const W: number[][] = Array.from({ length: P.length }, () => Array(P.length).fill(0.5));
for (let x = 0; x < P.length; x++)
  for (let y = x + 1; y < P.length; y++) {
    const w = v3.duelComps(comps[P[x]], comps[P[y]], v3.focusPolicy, 2, D);
    W[x][y] = w; W[y][x] = 1 - w;
  }
const poolComps = P.map(i => comps[i]);

// ── equilibria across rebate caps ──
for (const cap of [0, 2500, 5000, 7500]) {
  const rule: v3.UnderdogRule = { rebateCapBps: cap, fairShareBps: 1000 };
  const eq = v3.economicEquilibrium(W, poolComps, v3.MID_ELITE, rule);
  const evs = eq.classBestEV;
  const viable = evs.filter(e => e > 0).length;
  say(`\n## Rebate cap ${cap / 100}% of the protocol fee`);
  say(`Effective comps in the economic meta: ${eq.effectiveComps.toFixed(1)} · classes with positive best-comp EV: ${viable}/10 · class EV spread (best−worst): ${(Math.max(...evs) - Math.min(...evs)).toFixed(0)} $CLAW`);
  say('| Class | Pick share | Best-comp EV ($CLAW/battle) |'); say('|---|---|---|');
  for (const c of [...Array(10).keys()].sort((a, b) => evs[b] - evs[a]))
    say(`| ${NAMES[c]} | ${(100 * eq.classShares[c]).toFixed(1)}% | ${evs[c].toFixed(0)} |`);
}
say(`\nMechanism reminder: rebate is paid out of the 10% protocol fee on winner settlement only — zero-sum stakes untouched, resolver untouched; cost is reduced burn on underdog wins.`);
if (out) { await Bun.write(out, lines.join('\n') + '\n'); console.log(`written ${out}`); }
