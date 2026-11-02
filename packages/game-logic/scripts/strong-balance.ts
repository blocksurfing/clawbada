/**
 * Strong-play balance report (campaign 2026-11-02). Balance is judged under the PLANNER bot (searches to its own
 * next turn — agents will play at least this well), checked under `balanced` (casual play must stay sane) and under
 * `deep` (a second strong pilot, so a change is not tuned to one bot's quirks).
 *
 *   N=500 bun scripts/strong-balance.ts --config baseline,focus50 [--tier elite] [--pilots planner,balanced,deep]
 *                                       [--jobs 8] [--out docs/_generated/balance/<date>-strong.md]
 *
 * Battles are split across processes by seed range (deterministic: same args → same numbers, any --jobs).
 * Targets (owner sign-off pending): every class 45–55 % and spread ≤ 12pp under the planner; 100-turn cap ≤ 3 %;
 * median 40–55 turns; under `balanced` no class outside 42–58 %.
 */
import { v3 } from '../src/index';
import { EvolutionTier, LobsterClass } from '../src/types';
import { CONFIGS } from './campaign/configs';

const NAMES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const tierName = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const tier = { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[tierName]!;
const PILOTS: Record<string, () => v3.Policy> = { planner: () => v3.STYLE_BOTS.planner!, balanced: () => v3.BOTS.balanced!, deep: () => v3.STYLE_BOTS.deep! };
const pick = (i: number, k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
const mk = (p: string, cs: number[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier, purity: (i + j) % 7 }));

interface Lob { cls: number; team: 'A' | 'B'; dealt: number; taken: number; kills: number; specials: number; turns: number; alive: boolean; stuns: number }
interface Battle { a: number[]; b: number[]; winner: string | null; turns: number; lob: Lob[]; firstStrike: number; hpA: number; hpB: number; lastDamageTurn: number }

function play(config: string, pilot: string, i: number): Battle {
  const a = [pick(i, 1), pick(i, 2), pick(i, 3)], b = [pick(i, 4), pick(i, 5), pick(i, 6)];
  const s = v3.createBattle({ battleId: `s${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', a, i), teamB: mk('B', b, i + 3), rules: CONFIGS[config] });
  const p = PILOTS[pilot]();
  const res = v3.runBattle(s, { A: p, B: p });
  const byId = new Map(s.lobsters.map((l) => [l.id, l]));
  const lob = new Map<string, Lob>(s.lobsters.map((l) => [l.id, { cls: l.class, team: l.team, dealt: 0, taken: 0, kills: 0, specials: 0, turns: 0, alive: l.alive, stuns: 0 }]));
  let firstStrike = -1, lastDamageTurn = 0;
  for (const r of res) {
    const me = lob.get(r.lobsterId)!;
    if (r.action) me.turns++;
    if (r.action === 'special') me.specials++;
    for (const d of r.damage) {
      const tgt = lob.get(d.targetId)!;
      const amt = Number(d.amount);
      tgt.taken += amt;
      if (amt > 0) lastDamageTurn = r.turn;
      if ((d.kind === 'attack' || d.kind === 'special') && tgt.team !== me.team) {
        me.dealt += amt;
        if (d.killed) me.kills++;
        if (firstStrike < 0) firstStrike = me.cls;
      }
    }
    for (const st of r.statuses) if (st.status === 'stun' && st.applied && lob.get(st.targetId)!.team !== me.team) me.stuns++;
  }
  const hp = (t: 'A' | 'B') => { let c = 0, m = 0; for (const l of s.lobsters) if (l.team === t) { c += Number(l.hp > l.maxHp ? l.maxHp : l.hp); m += Number(l.maxHp); } return (100 * c) / m; };
  void byId;
  return { a, b, winner: s.winner, turns: s.turn, lob: [...lob.values()], firstStrike, hpA: hp('A'), hpB: hp('B'), lastDamageTurn };
}

// ── worker mode: one config × pilot × seed range → JSON lines ──
if (args.includes('--worker')) {
  const [config, pilot, from, to] = [opt('cfg', ''), opt('pilot', ''), Number(opt('from', '0')), Number(opt('to', '0'))];
  const out: Battle[] = [];
  for (let i = from; i < to; i++) out.push(play(config, pilot, i));
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const N = Number(process.env.N ?? '500');
const jobs = Number(opt('jobs', String(Math.max(1, navigator.hardwareConcurrency - 1))));
const configs = opt('config', 'baseline').split(',');
const pilots = opt('pilots', 'planner,balanced,deep').split(',');
const outPath = opt('out', '');
for (const c of configs) if (!CONFIGS[c]) throw new Error(`unknown config ${c} (scripts/campaign/configs.ts)`);

async function run(config: string, pilot: string): Promise<Battle[]> {
  const per = Math.ceil(N / jobs);
  const procs = [];
  for (let j = 0; j < jobs; j++) {
    const from = j * per, to = Math.min(N, from + per);
    if (from >= to) break;
    procs.push(Bun.spawn([process.execPath, import.meta.path, '--worker', '--cfg', config, '--pilot', pilot, '--from', String(from), '--to', String(to), '--tier', tierName], { stdout: 'pipe', stderr: 'inherit' }));
  }
  const parts = await Promise.all(procs.map(async (p) => JSON.parse(await new Response(p.stdout).text()) as Battle[]));
  return parts.flat();
}

const lines: string[] = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const f1 = (x: number) => x.toFixed(1);
const se = (g: number) => 100 * Math.sqrt(0.25 / Math.max(1, g));

say(`# Strong-play balance — tier=${tierName}, n=${N} battles per config × pilot (${jobs} processes)`);
say();
say('Targets: every class 45–55 % and spread ≤ 12pp under the planner · 100-turn cap ≤ 3 % · median 40–55 turns · under balanced no class outside 42–58 %.');
for (const config of configs) {
  say(); say(`## ${config}`);
  const results: Record<string, Battle[]> = {};
  for (const pilot of pilots) { const t = Date.now(); results[pilot] = await run(config, pilot); console.error(`  ${config} × ${pilot}: ${((Date.now() - t) / 1000).toFixed(0)} s`); }
  say(); say('| Pilot | median turns (p10–p90) | 100-turn cap | draws | class spread | strongest | weakest | verdict |');
  say('|---|---|---|---|---|---|---|---|');
  const rates: Record<string, { r: number[]; g: number[] }> = {};
  for (const pilot of pilots) {
    const bs = results[pilot];
    const wins = Array(10).fill(0), games = Array(10).fill(0);
    for (const b of bs) { for (const c of b.a) { games[c]++; if (b.winner === 'A') wins[c]++; } for (const c of b.b) { games[c]++; if (b.winner === 'B') wins[c]++; } }
    const r = wins.map((w, c) => (100 * w) / Math.max(1, games[c])); rates[pilot] = { r, g: games };
    const t = bs.map((b) => b.turns).sort((x, y) => x - y);
    const capped = bs.filter((b) => b.turns >= 100).length, draws = bs.filter((b) => b.winner === 'draw').length;
    const hi = r.indexOf(Math.max(...r)), lo = r.indexOf(Math.min(...r));
    const spread = r[hi] - r[lo];
    const med = t[t.length >> 1], cap = (100 * capped) / bs.length;
    const ok = pilot === 'planner' ? (r.every((x) => x >= 45 && x <= 55) && spread <= 12 && cap <= 3 && med >= 40 && med <= 55)
      : pilot === 'balanced' ? r.every((x) => x >= 42 && x <= 58) : null;
    say(`| ${pilot} | ${med} (${t[Math.floor(t.length * 0.1)]}–${t[Math.floor(t.length * 0.9)]}) | ${f1(cap)}% | ${draws} | ${f1(spread)}pp | ${NAMES[hi]} ${f1(r[hi])} | ${NAMES[lo]} ${f1(r[lo])} | ${ok === null ? 'second pilot' : ok ? 'meets targets' : 'misses targets'} |`);
  }
  say(); say(`| Class | ${pilots.map((p) => `${p} win %`).join(' | ')} |`);
  say('|---|' + '---|'.repeat(pilots.length));
  for (let c = 0; c < 10; c++) say(`| ${NAMES[c]} | ${pilots.map((p) => `${f1(rates[p].r[c])} ± ${f1(se(rates[p].g[c]))}`).join(' | ')} |`);

  // Diagnostics under the first pilot (the planner by default).
  const lead = pilots[0], bs = results[lead];
  const agg = Array.from({ length: 10 }, () => ({ n: 0, dealt: 0, taken: 0, kills: 0, specials: 0, turns: 0, alive: 0, stuns: 0, first: 0 }));
  for (const b of bs) { for (const l of b.lob) { const x = agg[l.cls]; x.n++; x.dealt += l.dealt; x.taken += l.taken; x.kills += l.kills; x.specials += l.specials; x.turns += l.turns; x.alive += l.alive ? 1 : 0; x.stuns += l.stuns; } if (b.firstStrike >= 0) agg[b.firstStrike].first++; }
  say(); say(`### Why — per lobster, per battle (${lead})`);
  say('| Class | turns | damage dealt | damage taken | kills | Specials | stuns landed | survives | lands the first hit |');
  say('|---|---|---|---|---|---|---|---|---|');
  for (let c = 0; c < 10; c++) { const x = agg[c], k = Math.max(1, x.n); say(`| ${NAMES[c]} | ${f1(x.turns / k)} | ${(x.dealt / k).toFixed(0)} | ${(x.taken / k).toFixed(0)} | ${(x.kills / k).toFixed(2)} | ${(x.specials / k).toFixed(2)} | ${(x.stuns / k).toFixed(2)} | ${f1((100 * x.alive) / k)}% | ${f1((100 * x.first) / Math.max(1, bs.length))}% of battles |`); }
  const cappedB = bs.filter((b) => b.turns >= 100);
  if (cappedB.length) {
    const gap = cappedB.reduce((s, b) => s + Math.abs(b.hpA - b.hpB), 0) / cappedB.length;
    const quiet = cappedB.reduce((s, b) => s + (100 - b.lastDamageTurn), 0) / cappedB.length;
    const bothHealthy = cappedB.filter((b) => b.hpA > 50 && b.hpB > 50).length;
    say(); say(`### The ${cappedB.length} battles that hit the cap (${lead})`);
    say(`HP gap at the cap ${f1(gap)} points on average · last damage on average ${f1(quiet)} turns before the cap · both teams above 50 % HP in ${bothHealthy} of them (a standoff, not a slow grind).`);
  }
}
say(); say('_Generated by `bun scripts/strong-balance.ts`._');
if (outPath) { await Bun.write(outPath, lines.join('\n') + '\n'); console.error(`wrote ${outPath}`); }
