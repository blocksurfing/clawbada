/**
 * Comp-metagame report. bun run meta [-- --tier elite --purity 3 --fast --out file.md]
 * Answers: is "what team do I field?" solved or mixed, and do tactics or comps decide?
 */
import { v3 } from '../src/index';
const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const has = (k: string) => args.includes(`--${k}`);
const tier = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const purity = Number(opt('purity', '3'));
const out = opt('out', '');
const fast = has('fast');
const SEED = BigInt(opt('seed', '20260831'));
const D: v3.DuelOptions = { tier, purity, seed: SEED };
const lines: string[] = []; const say = (s = '') => { lines.push(s); console.log(s); };
const t0 = Date.now();

const comps = v3.enumerateComps();
const P = v3.focusPolicy;
const SCREEN_OPP = fast ? 8 : 15;   // opponents per comp in screening
const TOP_K = fast ? 32 : 48;       // round-robin size
const RR_N = fast ? 1 : 2;          // battles per side per pair
const XPL_N = fast ? 3 : 5;         // battles per comp vs the mix

say(`# Comp metagame — tier=${tier} purity=${purity} bot=focus seed=${SEED}${fast ? ' (fast)' : ''}`);

// ── Stage 1: screening ──
const rating = comps.map(() => 0);
{
  const games = comps.map(() => 0);
  for (let i = 0; i < comps.length; i++) {
    for (let k = 0; k < SCREEN_OPP; k++) {
      const j = Number(v3.deriveRandom(SEED, `screen_${i}_${k}`) % BigInt(comps.length));
      if (j === i) continue;
      const w = v3.duelComps(comps[i], comps[j], P, 1, D);
      rating[i] += w; games[i]++;
      rating[j] += 1 - w; games[j]++;
    }
  }
  for (let i = 0; i < comps.length; i++) rating[i] /= Math.max(1, games[i]);
}
const order = [...comps.keys()].sort((a, b) => rating[b] - rating[a]);
const top = order.slice(0, TOP_K);
say(`\nScreened all ${comps.length} comps (${SCREEN_OPP} sampled opponents each). Top ${TOP_K} advance to round-robin.`);

// ── Stage 2: round-robin the top K ──
const W: number[][] = Array.from({ length: TOP_K }, () => Array(TOP_K).fill(0.5));
for (let x = 0; x < TOP_K; x++)
  for (let y = x + 1; y < TOP_K; y++) {
    const w = v3.duelComps(comps[top[x]], comps[top[y]], P, RR_N, D);
    W[x][y] = w; W[y][x] = 1 - w;
  }

// ── Stage 3: stable meta ──
const mix = v3.replicator(W);
const support = v3.effectiveSupport(mix);
const inMenu = [...mix.keys()].filter(i => mix[i] >= 0.01).sort((a, b) => mix[b] - mix[a]);
const pay = v3.payoffsVsMix(W, mix);
const bestInside = Math.max(...pay);

say(`\n## Stable meta (replicator dynamics over the top ${TOP_K})`);
say(`Menu breadth: **${support.toFixed(1)} effective comps** · ${inMenu.length} comps above 1% weight · in-pool exploitability ${(100 * bestInside).toFixed(1)}%`);
say('\n| Meta share | Comp | Screening win % |'); say('|---|---|---|');
for (const i of inMenu.slice(0, 15)) say(`| ${(100 * mix[i]).toFixed(1)}% | ${v3.compName(comps[top[i]], NAMES)} | ${(100 * rating[top[i]]).toFixed(0)} |`);

// ── Stage 4: full-space exploitability (can anything outside the pool counter the meta?) ──
const menuIdx = inMenu.filter(i => mix[i] >= 0.02);
const menuWeights = menuIdx.map(i => mix[i]); const wSum = menuWeights.reduce((a, b) => a + b, 0);
let bestOutside = 0; let bestOutsideComp: v3.Comp | null = null;
for (let i = 0; i < comps.length; i++) {
  let score = 0;
  for (let m = 0; m < menuIdx.length; m++) score += (menuWeights[m] / wSum) * v3.duelComps(comps[i], comps[top[menuIdx[m]]], P, XPL_N, D);
  if (score > bestOutside) { bestOutside = score; bestOutsideComp = comps[i]; }
}
say(`\n## Exploitability over ALL ${comps.length} comps`);
say(`Best response to the meta: **${v3.compName(bestOutsideComp!, NAMES)}** at ${(100 * bestOutside).toFixed(1)}% vs the menu (50% = perfectly unexploitable).`);

// ── Stage 5: piloting edge vs comp edge ──
const midComp = comps[order[Math.floor(order.length / 2)]];
const bestComp = comps[top[inMenu[0]]];
const pilotN = fast ? 40 : 80;
let pilot = 0;
{
  const mk = (p: string, comp: v3.Comp) => comp.map((c, j) => ({ id: `${p}${j}`, class: c as v3.LobsterClass, tier: { evolved: 1, elite: 2, apex: 3 }[tier] as v3.EvolutionTier, purity }));
  for (let i = 0; i < pilotN; i++) {
    const seed = v3.deriveRandom(SEED, `pilot_${i}`);
    const comp = comps[order[i % TOP_K]];
    const s = v3.createBattle({ battleId: 'p', vrfSeed: seed, tier, teamA: mk('A', comp), teamB: mk('B', comp) });
    v3.runBattle(s, { A: v3.focusPolicy, B: v3.greedyPolicy });
    pilot += s.winner === 'A' ? 1 : s.winner === 'draw' ? 0.5 : 0;
    const t = v3.createBattle({ battleId: 'q', vrfSeed: v3.deriveRandom(seed, 'sw'), tier, teamA: mk('A', comp), teamB: mk('B', comp) });
    v3.runBattle(t, { A: v3.greedyPolicy, B: v3.focusPolicy });
    pilot += t.winner === 'B' ? 1 : t.winner === 'draw' ? 0.5 : 0;
  }
}
const pilotEdge = pilot / (2 * pilotN);
const compEdge = v3.duelComps(bestComp, midComp, P, fast ? 15 : 30, D);
say(`\n## Tactics vs comps`);
say(`Piloting edge (strong bot vs weak bot, same comp): **${(100 * pilotEdge).toFixed(1)}%**`);
say(`Comp edge (top meta comp vs median comp, same bot): **${(100 * compEdge).toFixed(1)}%** (${v3.compName(bestComp, NAMES)} vs ${v3.compName(midComp, NAMES)})`);
say(`North star: piloting edge should exceed comp edge.`);

say(`\n_${((Date.now() - t0) / 60000).toFixed(1)} min_`);
if (out) { await Bun.write(out, lines.join('\n') + '\n'); console.log(`written ${out}`); }
