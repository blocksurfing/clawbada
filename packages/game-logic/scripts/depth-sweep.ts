/**
 * Strategy-depth sweep: what each parked/new tactical lever does to balance, pacing, and —
 * the metric that actually matters — whether the game rewards thinking.
 *
 *   bun scripts/depth-sweep.ts            # 600 battles per cell
 *   N=2000 bun scripts/depth-sweep.ts     # the real run
 *   bun scripts/depth-sweep.ts --out docs/_generated/balance/depth-sweep.md
 *
 * Levers under test (all default-off in DEFAULT_RULES):
 *   fortifyTaunt     Fortify also taunts — adjacent enemies must target the Bulwark
 *   focusFalloffBps  each hit on a target since its own last turn weakens the next
 *   guardPenaltyBps  ranged attacks lose damage while an enemy is adjacent to the shooter
 *   coverPenaltyBps  terrain on the line to the target soaks part of a ranged hit
 *
 * THE DEPTH METRIC: `deep` (2-ply search) vs `balanced` (1-ply greedy) head to head. A lever
 * that raises deep's win rate makes thinking pay. Paired with `focus` (a naive focus-fire
 * script) vs `balanced`: a lever that lowers focus's win rate punishes scripted play.
 * Both are run mirrored — each matchup played from both sides — so side bias cancels.
 *
 * Deterministic: same args → same numbers.
 */
import { v3 } from '../src/index';
import { EvolutionTier, LobsterClass } from '../src/types';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(process.env.N ?? opt('n', '600'));
const tierName = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const tier = { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[tierName]!;
const outPath = opt('out', '');

const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
/** Structurally exempt from cover: Maelstrom is a radius sweep (no line), Bind erupts on the target. */
const EXEMPT = { [LobsterClass.Tempest]: true, [LobsterClass.Kraken]: true } as Partial<Record<LobsterClass, boolean>>;
/** Adds Specter: Haunt is a spirit, and exempting it gives cover a counter. */
const EXEMPT_HAUNT = { ...EXEMPT, [LobsterClass.Specter]: true };

const CONFIGS: Array<[string, Partial<v3.BattleRules>]> = [
  ['baseline (shipped today)', {}],
  ['fortifyTaunt', { fortifyTaunt: true }],
  ['focusFalloff 1000', { focusFalloffBps: 1000n }],
  ['focusFalloff 2000', { focusFalloffBps: 2000n }],
  ['guardPenalty 2000', { guardPenaltyBps: 2000n }],
  ['guardPenalty 3000', { guardPenaltyBps: 3000n }],
  ['cover 2000', { coverPenaltyBps: 2000n, coverExemptSpecial: EXEMPT }],
  ['cover 2500', { coverPenaltyBps: 2500n, coverExemptSpecial: EXEMPT }],
  ['cover 2500 + Haunt exempt', { coverPenaltyBps: 2500n, coverExemptSpecial: EXEMPT_HAUNT }],
  ['ALL FOUR (Haunt exempt)', { fortifyTaunt: true, focusFalloffBps: 1500n, guardPenaltyBps: 2000n, coverPenaltyBps: 2500n, coverExemptSpecial: EXEMPT_HAUNT }],
];

const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const pct = (w: number, g: number) => (100 * w / Math.max(1, g)).toFixed(1);

const pick = (i: number, k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
const mk = (p: string, cs: number[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier, purity: (i + j) % 7 }));
const battle = (i: number, rules: Partial<v3.BattleRules>) => {
  const a = [pick(i, 1), pick(i, 2), pick(i, 3)], b = [pick(i, 4), pick(i, 5), pick(i, 6)];
  return {
    a, b,
    state: v3.createBattle({
      battleId: `b${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName,
      teamA: mk('A', a, i), teamB: mk('B', b, i + 3), rules,
    }),
  };
};

/** Mirrored head-to-head: `challenger` plays both sides against `champ`. Returns challenger win %. */
function headToHead(rules: Partial<v3.BattleRules>, challenger: v3.Policy, champ: v3.Policy) {
  let wins = 0, games = 0;
  for (let i = 0; i < N; i++) {
    for (const asA of [true, false]) {
      const { state } = battle(i, rules);
      v3.runBattle(state, asA ? { A: challenger, B: champ } : { A: champ, B: challenger });
      games++;
      if (state.winner === (asA ? 'A' : 'B')) wins++;
    }
  }
  return { winPct: Number(pct(wins, games)), games };
}

const balanced = v3.BOTS.balanced!;
const deep = v3.STYLE_BOTS.deep!;
const focus = v3.STYLE_BOTS.focus!;

say(`# Clawbada V3 strategy-depth sweep — tier=${tierName} n=${N}/cell`);
say();
say('Every lever is a `BattleRules` field defaulting to off. `deep` = 2-ply search, `balanced` = 1-ply greedy,');
say('`focus` = naive focus-fire script. Head-to-heads are mirrored, so 50.0% means no edge.');
say();

// ── 1. Balance + pacing under self-play ──────────────────────────────────────
say('## Balance and pacing (balanced vs balanced, mixed random teams)');
say();
say('| Config | class spread | strongest | weakest | Bulwark | Specter | median turns | 100-turn cap | draws |');
say('|---|---|---|---|---|---|---|---|---|');
const classWinByConfig: Record<string, number[]> = {};
for (const [label, rules] of CONFIGS) {
  const wins = Array(10).fill(0), games = Array(10).fill(0), turns: number[] = [];
  let capped = 0, draws = 0;
  for (let i = 0; i < N; i++) {
    const { a, b, state } = battle(i, rules);
    v3.runBattle(state, { A: balanced, B: balanced });
    turns.push(state.turn);
    if (state.turn >= 100) capped++;
    if (state.winner === 'draw') draws++;
    for (const c of a) { games[c]++; if (state.winner === 'A') wins[c]++; }
    for (const c of b) { games[c]++; if (state.winner === 'B') wins[c]++; }
  }
  const rates = wins.map((w, c) => (100 * w) / Math.max(1, games[c]));
  classWinByConfig[label] = rates;
  const best = rates.indexOf(Math.max(...rates)), worst = rates.indexOf(Math.min(...rates));
  turns.sort((x, y) => x - y);
  say(`| ${label} | ${(rates[best] - rates[worst]).toFixed(1)}pp | ${NAMES[best]} ${rates[best].toFixed(1)} | ${NAMES[worst]} ${rates[worst].toFixed(1)} | ${rates[0].toFixed(1)} | ${rates[4].toFixed(1)} | ${turns[N >> 1]} | ${pct(capped, N)}% | ${draws} |`);
}

// ── 2. The depth metric ──────────────────────────────────────────────────────
say();
say('## Does it reward thinking? (mirrored head-to-heads)');
say();
say('`deep` above 50 means searching pays. `focus` above 50 means the naive script is still good.');
say();
say('| Config | deep vs balanced | Δ vs baseline | focus vs balanced | Δ vs baseline |');
say('|---|---|---|---|---|');
let deepBase = 0, focusBase = 0;
for (const [label, rules] of CONFIGS) {
  const d = headToHead(rules, deep, balanced).winPct;
  const f = headToHead(rules, focus, balanced).winPct;
  if (label.startsWith('baseline')) { deepBase = d; focusBase = f; }
  const dd = (d - deepBase >= 0 ? '+' : '') + (d - deepBase).toFixed(1);
  const df = (f - focusBase >= 0 ? '+' : '') + (f - focusBase).toFixed(1);
  say(`| ${label} | ${d.toFixed(1)}% | ${label.startsWith('baseline') ? '—' : dd} | ${f.toFixed(1)}% | ${label.startsWith('baseline') ? '—' : df} |`);
}

// ── 3. How often cover is even live on real generated arenas ─────────────────
say();
say('## Cover reach on generated arenas');
say();
{
  const lanes: number[] = [], covered: number[] = [];
  let blockedTotal = 0;
  const layouts = 300;
  for (let i = 0; i < layouts; i++) {
    const layout = v3.generateLayout(BigInt(i + 1) * 7919n, tierName);
    blockedTotal += layout.blockedHexes.length;
    const cells: v3.HexPos[] = [];
    for (let col = 0; col < layout.cols; col++) for (let row = 0; row < layout.rows; row++) cells.push({ col, row });
    for (const p of cells) for (const q of cells) {
      const d = v3.hexDistance(p, q);
      if (d < 2) continue;
      lanes[d] = (lanes[d] ?? 0) + 1;
      if (v3.hasCover(layout, p, q)) covered[d] = (covered[d] ?? 0) + 1;
    }
  }
  say(`Across ${layouts} generated ${tierName} layouts (avg ${(blockedTotal / layouts).toFixed(1)} blocked hexes).`);
  say('How often a lane of each length crosses an obstacle — i.e. how often cover is live:');
  say();
  say('| lane length | % in cover | note |');
  say('|---|---|---|');
  const note: Record<number, string> = {
    2: 'one hex between — the common poke',
    3: 'max range for most classes',
    4: "Ember's Inferno, Specter's poke",
  };
  let allL = 0, allC = 0;
  for (let d = 2; d < lanes.length; d++) {
    if (!lanes[d]) continue;
    allL += lanes[d]; allC += covered[d] ?? 0;
    say(`| ${d} hexes | ${pct(covered[d] ?? 0, lanes[d])}% | ${note[d] ?? 'long diagonal'} |`);
  }
  say(`| **all ≥2** | **${pct(allC, allL)}%** | |`);
}

say();
say('_Generated by `bun scripts/depth-sweep.ts`._');

if (outPath) {
  await Bun.write(outPath, lines.join('\n') + '\n');
  console.error(`\nwrote ${outPath}`);
}
