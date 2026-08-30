/**
 * Strategy-style report: which play styles beat which, and which style each
 * class prefers. bun run styles [-- --n 60 --tier elite --out file.md]
 */
import { v3 } from '../src/index';
import { EvolutionTier, LobsterClass } from '../src/types';
const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const n = Number(opt('n', '60'));
const tierName = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const tier = { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[tierName];
const out = opt('out', '');
const lines: string[] = []; const say = (s = '') => { lines.push(s); console.log(s); };
const mk = (p: string, cs: number[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier, purity: (i + j) % 7 }));
const pick = (i: number, k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
const pol: Record<string, v3.Policy> = { aggressive: v3.aggressivePolicy, balanced: v3.balancedPolicy, ...v3.STYLE_BOTS, greedy: v3.greedyPolicy };
const names = Object.keys(pol);

/** Win % of style `a` vs style `b` on mirrored random teams, sides swapped. */
function duel(a: string, b: string, games: number, fixedClass?: number): number {
  let w = 0, g = 0;
  for (let i = 0; i < games; i++) {
    const cs = [fixedClass ?? pick(i, 7), pick(i, 8), pick(i, 9)];
    const s = v3.createBattle({ battleId: `x${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', cs, i), teamB: mk('B', cs, i) });
    v3.runBattle(s, { A: pol[a], B: pol[b] }); g++; if (s.winner === 'A') w++;
    const t = v3.createBattle({ battleId: `y${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', cs, i), teamB: mk('B', cs, i) });
    v3.runBattle(t, { A: pol[b], B: pol[a] }); g++; if (t.winner === 'B') w++;
  }
  return Math.round(100 * w / g);
}

say(`# Strategy styles — tier=${tierName}, ${2 * n} battles per cell`);
say(); say('## Style vs style (row win % vs column, mirrored teams)');
say('| | ' + names.join(' | ') + ' |'); say('|---|' + '---|'.repeat(names.length));
for (const r of names) say(`| ${r} | ${names.map(c => (r === c ? ' 50' : String(duel(r, c, n)).padStart(3))).join(' | ')} |`);

say(); say('## Which style suits each class (team containing the class plays the style vs a balanced opponent)');
say('| Class | ' + names.filter(x => x !== 'greedy').join(' | ') + ' | best |'); say('|---|' + '---|'.repeat(names.length));
for (let c = 0; c < 10; c++) {
  const row = names.filter(x => x !== 'greedy').map(s => duel(s, 'balanced', Math.max(20, n >> 1), c));
  const best = names.filter(x => x !== 'greedy')[row.indexOf(Math.max(...row))];
  say(`| ${NAMES[c]} | ${row.map(v => String(v).padStart(3)).join(' | ')} | ${best} |`);
}
if (out) { await Bun.write(out, lines.join('\n') + '\n'); console.log(`written ${out}`); }
