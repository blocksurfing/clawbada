/**
 * Comp-metagame report. bun run meta [-- --tier elite --purity 3 --fast --out file.md]
 * Answers: is "what team do I field?" solved or mixed, and do tactics or comps decide?
 */
import { deriveRandom, EvolutionTier, LobsterClass, v3 } from '../src/index';
const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k: string) => args.includes(`--${k}`);
const tier = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const purity = Number(opt('purity', '3'));
const out = opt('out', '');
const fast = has('fast');
const SEED = BigInt(opt('seed', '20260831'));
const rulesJson = opt('rules', '');
const parsedRules = rulesJson ? JSON.parse(rulesJson, (_k, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) : undefined;
const D: v3.DuelOptions = { tier, purity, seed: SEED, rules: parsedRules };
const lines: string[] = []; const say = (s = '') => { lines.push(s); console.log(s); };
const t0 = Date.now();

const comps = v3.enumerateComps();
const P = v3.focusPolicy;
const SCREEN_OPP = fast ? 8 : 15;   // opponents per comp in screening
const TOP_K = fast ? 32 : 48;       // round-robin size
const RR_N = fast ? 1 : 3;          // battles per side per pair
const XPL_N = 3;                    // battles per comp vs each menu member

say(`# Comp metagame — tier=${tier} purity=${purity} bot=focus seed=${SEED}${fast ? ' (fast)' : ''}`);

// ── Stage 1: screening ──
const rating = comps.map(() => 0);
{
  const games = comps.map(() => 0);
  for (let i = 0; i < comps.length; i++) {
    for (let k = 0; k < SCREEN_OPP; k++) {
      const j = Number(deriveRandom(SEED, `screen_${i}_${k}`) % BigInt(comps.length));
      if (j === i) continue;
      const w = v3.duelComps(comps[i], comps[j], P, 1, D);
      rating[i] += w; games[i]++;
      rating[j] += 1 - w; games[j]++;
    }
  }
  for (let i = 0; i < comps.length; i++) rating[i] /= Math.max(1, games[i]);
}
const order = [...comps.keys()].sort((a, b) => rating[b] - rating[a]);
say(`\nScreened all ${comps.length} comps (${SCREEN_OPP} sampled opponents each). Top ${TOP_K} seed the pool.`);

// ── Stage 2+3: PSRO-style loop — solve the pool, find the best response over the
// FULL comp space, add it to the pool, re-solve. Stops when no comp beats the
// menu by more than the threshold (or after MAX_ADD additions).
const pool: number[] = order.slice(0, TOP_K);
const W: number[][] = [];
const cell = new Map<string, number>();
const duelIdx = (ci: number, cj: number) => {
  const key = ci < cj ? `${ci}_${cj}` : `${cj}_${ci}`;
  let w = cell.get(key);
  if (w === undefined) { w = v3.duelComps(comps[Math.min(ci, cj)], comps[Math.max(ci, cj)], P, RR_N, D); cell.set(key, w); }
  return ci < cj ? w : 1 - w;
};
const rebuild = () => {
  W.length = 0;
  for (let x = 0; x < pool.length; x++) W.push(pool.map((cj, y) => (x === y ? 0.5 : duelIdx(pool[x], cj))));
};
rebuild();
const BR_THRESHOLD = 0.55, MAX_ADD = 12;
let mix = v3.replicatorAverage(W);
const trajectory: string[] = [];
let bestOutside = 0; let bestOutsideComp = -1;
for (let round = 0; round <= MAX_ADD; round++) {
  mix = v3.replicatorAverage(W);
  const inMenu = [...mix.keys()].filter(i => mix[i] >= 0.02).sort((a, b) => mix[b] - mix[a]).slice(0, 8);
  const wSum = inMenu.reduce((s, i) => s + mix[i], 0);
  bestOutside = 0; bestOutsideComp = -1;
  for (let ci = 0; ci < comps.length; ci++) {
    let score = 0;
    for (const m of inMenu) score += (mix[m] / wSum) * (pool.includes(ci) ? duelIdx(ci, pool[m]) : v3.duelComps(comps[ci], comps[pool[m]], P, XPL_N, D));
    if (score > bestOutside) { bestOutside = score; bestOutsideComp = ci; }
  }
  if (bestOutside <= BR_THRESHOLD || round === MAX_ADD) break;
  if (pool.includes(bestOutsideComp)) { trajectory.push(`${v3.compName(comps[bestOutsideComp], NAMES)} (${(100 * bestOutside).toFixed(0)}%, already in pool — equilibrium unstable at threshold)`); break; }
  trajectory.push(`+ ${v3.compName(comps[bestOutsideComp], NAMES)} counters the menu at ${(100 * bestOutside).toFixed(0)}%`);
  pool.push(bestOutsideComp);
  rebuild();
}
const support = v3.effectiveSupport(mix);
const inMenu = [...mix.keys()].filter(i => mix[i] >= 0.01).sort((a, b) => mix[b] - mix[a]);

say(`\n## Stable meta (replicator + best-response loop, pool ${pool.length})`);
if (trajectory.length) { say('Counter discovery:'); for (const t of trajectory) say(`- ${t}`); }
say(`\nMenu breadth: **${support.toFixed(1)} effective comps** · ${inMenu.length} comps above 1% weight`);
say('\n| Meta share | Comp |'); say('|---|---|');
for (const i of inMenu.slice(0, 15)) say(`| ${(100 * mix[i]).toFixed(1)}% | ${v3.compName(comps[pool[i]], NAMES)} |`);
say(`\n## Exploitability over ALL ${comps.length} comps`);
say(`Best response to the final menu: **${v3.compName(comps[bestOutsideComp], NAMES)}** at ${(100 * bestOutside).toFixed(1)}% (50% = perfectly unexploitable; ≤${100 * BR_THRESHOLD}% counts as converged).`);

// ── Stage 5: piloting edge vs comp edge ──
const bestComp = comps[pool[inMenu[0]]];
// Piloting edge: best available bot vs a competent baseline (greedy), measured on
// strong comps. Bot strength is comp-dependent (focus wins on average comps,
// balanced wins on elite comps), so take the max over the strong-bot suite.
const pilotN = fast ? 40 : 80;
const pilotFor = (strong: v3.Policy) => {
  const mk = (p: string, comp: v3.Comp) => comp.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier: { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[tier], purity }));
  let pilot = 0;
  for (let i = 0; i < pilotN; i++) {
    const seed = deriveRandom(SEED, `pilot_${i}`);
    const comp = comps[order[i % TOP_K]];
    const s = v3.createBattle({ battleId: 'p', vrfSeed: seed, tier, teamA: mk('A', comp), teamB: mk('B', comp), rules: D.rules });
    v3.runBattle(s, { A: strong, B: v3.greedyPolicy });
    pilot += s.winner === 'A' ? 1 : s.winner === 'draw' ? 0.5 : 0;
    const t = v3.createBattle({ battleId: 'q', vrfSeed: deriveRandom(seed, 'sw'), tier, teamA: mk('A', comp), teamB: mk('B', comp), rules: D.rules });
    v3.runBattle(t, { A: v3.greedyPolicy, B: strong });
    pilot += t.winner === 'B' ? 1 : t.winner === 'draw' ? 0.5 : 0;
  }
  return pilot / (2 * pilotN);
};
const pilotFocus = pilotFor(v3.focusPolicy);
const pilotBalanced = pilotFor(v3.balancedPolicy);
const pilotEdge = Math.max(pilotFocus, pilotBalanced);
const CE_SAMPLE = fast ? 10 : 20;
const ceOver = (pickFrom: number[]) => {
  let e = 0;
  for (let k = 0; k < CE_SAMPLE; k++) {
    const rc = comps[pickFrom[Number(deriveRandom(SEED, `ce_${k}`) % BigInt(pickFrom.length))]];
    e += v3.duelComps(bestComp, rc, P, fast ? 2 : 4, D);
  }
  return e / CE_SAMPLE;
};
const ceField = ceOver(order.slice(0, 100)); // plausible field: top-100 comps
const ceRandom = ceOver([...comps.keys()]);
say(`\n## Tactics vs comps`);
say(`Piloting edge (best strong bot vs greedy baseline, same strong comps): **${(100 * pilotEdge).toFixed(1)}%** (focus ${(100 * pilotFocus).toFixed(1)} / balanced ${(100 * pilotBalanced).toFixed(1)})`);
say(`Comp edge of ${v3.compName(bestComp, NAMES)}: vs meta menu **${(100 * bestOutside).toFixed(1)}%** (exploitability) · vs plausible field (top-100) **${(100 * ceField).toFixed(1)}%** ← north-star comparison · vs uniform random **${(100 * ceRandom).toFixed(1)}%** (floor badness)`);
say(`North star: piloting edge should exceed the plausible-field comp edge.`);

say(`\n_${((Date.now() - t0) / 60000).toFixed(1)} min_`);
if (out) { await Bun.write(out, lines.join('\n') + '\n'); console.log(`written ${out}`); }
