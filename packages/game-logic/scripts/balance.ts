/**
 * Headless balance report for the V3 ATB engine.
 *
 *   bun run balance                 # default: 1500 mixed battles + 10×10 mono matrix + bot table
 *   bun run balance -- --n 500      # fewer battles
 *   bun run balance -- --tier apex  # evolved | elite | apex
 *   bun run balance -- --bot cautious
 *   bun run balance -- --out docs/_generated/balance/2026-08-30.md
 *
 * Deterministic: same args → same numbers.
 */
import { v3 } from '../src/index';
import { EvolutionTier, LobsterClass } from '../src/types';

const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', '1500'));
const tierName = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const tier = { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[tierName];
const botName = opt('bot', 'balanced');
const bot = v3.BOTS[botName] ?? v3.greedyPolicy;
const out = opt('out', '');
const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };

const mk = (p: string, cs: number[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier, purity: (i + j) % 7 }));
const pct = (w: number, g: number) => (100 * w / Math.max(1, g)).toFixed(1).padStart(5);

say(`# Clawbada V3 balance report — tier=${tierName} bot=${botName} n=${N} HP_BATTLE_SCALE=${v3.HP_BATTLE_SCALE ?? ''}`);

// 1) Mixed random teams
{
  const wins = Array(10).fill(0), games = Array(10).fill(0), turns: number[] = [];
  let capped = 0, aWins = 0, draws = 0, specials = 0, actions = 0;
  for (let i = 0; i < N; i++) {
    const pick = (k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
    const a = [pick(1), pick(2), pick(3)], b = [pick(4), pick(5), pick(6)];
    const s = v3.createBattle({ battleId: `b${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', a, i), teamB: mk('B', b, i + 3) });
    const res = v3.runBattle(s, { A: bot, B: bot });
    turns.push(s.turn); if (s.turn >= 100) capped++; if (s.winner === 'A') aWins++; if (s.winner === 'draw') draws++;
    for (const r of res) { if (r.action) actions++; if (r.action === 'special') specials++; }
    for (const c of a) { games[c]++; if (s.winner === 'A') wins[c]++; }
    for (const c of b) { games[c]++; if (s.winner === 'B') wins[c]++; }
  }
  turns.sort((x, y) => x - y);
  say(); say(`## Pacing (mixed random teams, ${N} battles)`);
  say(`median ${turns[N >> 1]} turns · p10 ${turns[Math.floor(N * 0.1)]} · p90 ${turns[Math.floor(N * 0.9)]} · hit 100-turn cap ${pct(capped, N)}% · draws ${draws} · side A wins ${pct(aWins, N)}% (compositions differ per side — not a side-bias measure; see mirrored bot table) · Specials ${pct(specials, actions)}% of actions`);
  say(); say(`## Class win rate when on your team (mixed teams)`);
  say('| Class | Win % | Games |'); say('|---|---|---|');
  for (const c of [...Array(10).keys()].sort((x, y) => wins[y] / games[y] - wins[x] / games[x])) say(`| ${NAMES[c]} | ${pct(wins[c], games[c])} | ${games[c]} |`);
}

// 2) Mono-class head-to-head
{
  const M = Math.max(10, Math.round(N / 40));
  const matrix: number[][] = Array.from({ length: 10 }, () => Array(10).fill(50));
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    if (x === y) continue;
    let w = 0, g = 0;
    for (let i = 0; i < M; i++) {
      const s = v3.createBattle({ battleId: `m${x}${y}${i}`, vrfSeed: BigInt(x * 1000 + y * 10 + i + 1) * 15485863n, tier: tierName, teamA: mk('A', [x, x, x], i), teamB: mk('B', [y, y, y], i) });
      v3.runBattle(s, { A: bot, B: bot }); g++; if (s.winner === 'A') w++;
      const t = v3.createBattle({ battleId: `n${x}${y}${i}`, vrfSeed: BigInt(x * 1000 + y * 10 + i + 1) * 32452843n, tier: tierName, teamA: mk('A', [y, y, y], i), teamB: mk('B', [x, x, x], i) });
      v3.runBattle(t, { A: bot, B: bot }); g++; if (t.winner === 'B') w++;
    }
    matrix[x][y] = Math.round(100 * w / g);
  }
  say(); say(`## Mono-class head-to-head (row win % vs column, ${2 * M} battles per cell, sides swapped)`);
  say('Design: each class beats the next 4 in this order and loses to the previous 4; 5 apart is neutral.');
  say('| | ' + NAMES.map(n => n.slice(0, 4)).join(' | ') + ' | avg |'); say('|---|' + '---|'.repeat(11));
  for (let x = 0; x < 10; x++) say(`| ${NAMES[x]} | ${matrix[x].map(v => String(v).padStart(3)).join(' | ')} | ${Math.round(matrix[x].filter((_, j) => j !== x).reduce((a, b) => a + b, 0) / 9)} |`);
}

// 3) Bot vs bot (mirrored teams, sides swapped)
{
  const names = Object.keys(v3.BOTS).concat('greedy');
  const pol = (k: string) => v3.BOTS[k] ?? v3.greedyPolicy;
  const G = Math.max(20, Math.round(N / 15));
  say(); say(`## Bot vs bot (row win % vs column, mirrored random teams, ${2 * G} battles per cell)`);
  say('| | ' + names.join(' | ') + ' |'); say('|---|' + '---|'.repeat(names.length));
  for (const r of names) {
    const row: string[] = [];
    for (const c of names) {
      if (r === c) { row.push(' 50'); continue; }
      let w = 0, g = 0;
      for (let i = 0; i < G; i++) {
        const pick = (k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
        const cs = [pick(7), pick(8), pick(9)];
        const s = v3.createBattle({ battleId: `x${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', cs, i), teamB: mk('B', cs, i) });
        v3.runBattle(s, { A: pol(r), B: pol(c) }); g++; if (s.winner === 'A') w++;
        const t = v3.createBattle({ battleId: `y${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', cs, i), teamB: mk('B', cs, i) });
        v3.runBattle(t, { A: pol(c), B: pol(r) }); g++; if (t.winner === 'B') w++;
      }
      row.push(String(Math.round(100 * w / g)).padStart(3));
    }
    say(`| ${r} | ${row.join(' | ')} |`);
  }
}

if (out) { await Bun.write(out, lines.join('\n') + '\n'); console.log(`\nwritten ${out}`); }
