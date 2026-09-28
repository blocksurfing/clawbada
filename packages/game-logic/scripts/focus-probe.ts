/**
 * Focus-fire investigation (2026-09-28): the naive `focus` script (whole team piles onto the enemy closest to
 * dying) beats the "smart" bots — is focus fire too strong in the RULES, or are the smart bots just not
 * doing the obvious thing (and not defending against it)?
 *
 *   bun scripts/focus-probe.ts [--n 200] [--tier elite] [--part bots|rules|all]
 *
 * Part "bots" — everything plays `focus` on today's rules:
 *   balanced / deep / roles   the shipped bots
 *   deepPlain                 the pre-upgrade deep (2-ply search, no team play)
 *   deepFocus                 deep's search + team focus fire only
 *   guard                     balanced + cover (v3.protectBias): the likely victim Defends and steps back,
 *                             Sentinel Rallies it, Bulwark Fortifies, allies stand next to it
 *   guardFocus                balanced + focus fire + cover
 *   deep                      SHIPPED since 2026-09-28: deep's search + focus fire + cover (v3.teamplayBias)
 * If counter-play or skill clearly beats focus, the rules are fine and the bots are the problem.
 *
 * Part "rules" — focus vs balanced (and deep vs balanced, the "does thinking pay" check) across the focus-falloff
 * setting (each hit on a target since its own last turn weakens the next; shipped 1000 = 10 %/hit, floor 40 %).
 *
 * Mirrored random teams (same classes both sides, sides swapped); deterministic.
 */
import { v3 } from '../src/index';
import { EvolutionTier, LobsterClass } from '../src/types';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', '200'));
const tierName = opt('tier', 'elite') as v3.ArenaLayout['tier'];
const part = opt('part', 'all');
const tier = { evolved: EvolutionTier.Evolved, elite: EvolutionTier.Elite, apex: EvolutionTier.Apex }[tierName]!;

type Lob = v3.AtbLobster;
type State = v3.AtbBattleState;
const n = (b: bigint) => Number(b);

const POL: Record<string, v3.Policy> = {
  focus: v3.STYLE_BOTS.focus,
  balanced: v3.balancedPolicy,
  deepPlain: v3.deepPolicy(4, null),                        // the pre-2026-09-28 deep
  deep: v3.STYLE_BOTS.deep,                                 // shipped: focus fire + cover
  roles: v3.STYLE_BOTS.roles,
  deepFocus: v3.deepPolicy(4, v3.focusBias),
  guard: (s, a) => v3.chooseTurn(s, a, v3.BOT_WEIGHTS.balanced, v3.protectBias(s, a)),
  guardFocus: (s, a) => v3.chooseTurn(s, a, v3.BOT_WEIGHTS.balanced, v3.teamplayBias(s, a)),
};

const pick = (i: number, k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
const mk = (p: string, cs: number[], i: number) => cs.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier, purity: (i + j) % 7 }));

/** Win % of `a` vs `b` (draws count half), mirrored. */
function duel(a: v3.Policy, b: v3.Policy, rules?: Partial<v3.BattleRules>): number {
  let w = 0, g = 0;
  for (let i = 0; i < N; i++) {
    const cs = [pick(i, 7), pick(i, 8), pick(i, 9)];
    for (const swap of [false, true]) {
      const s = v3.createBattle({ battleId: `${swap ? 'y' : 'x'}${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName, teamA: mk('A', cs, i), teamB: mk('B', cs, i), rules });
      v3.runBattle(s, swap ? { A: b, B: a } : { A: a, B: b });
      g++;
      const mine = swap ? 'B' : 'A';
      if (s.winner === mine) w++; else if (s.winner === 'draw') w += 0.5;
    }
  }
  return (100 * w) / g;
}

const t0 = Date.now();
const say = (s: string) => console.log(s);
say(`# Focus-fire probe — tier=${tierName}, ${2 * N} battles per cell`);
if (part === 'bots' || part === 'all') {
  say('\n## Who beats `focus`? (win % vs focus; 50 = even)');
  say('| bot | vs focus |'); say('|---|---|');
  for (const name of ['balanced', 'deepPlain', 'roles', 'deepFocus', 'guard', 'guardFocus', 'deep']) {
    say(`| ${name} | ${duel(POL[name], POL.focus).toFixed(1)} |`);
  }
  say('\n## Does the counter-play cost anything against the shipped bots? (win % vs balanced / deep)');
  say('| bot | vs balanced | vs old deep |'); say('|---|---|---|');
  for (const name of ['guard', 'guardFocus', 'deepFocus', 'deep']) {
    say(`| ${name} | ${duel(POL[name], POL.balanced).toFixed(1)} | ${duel(POL[name], POL.deepPlain).toFixed(1)} |`);
  }
}
if (part === 'rules' || part === 'all') {
  say('\n## Focus-falloff setting (focus vs balanced; deep vs balanced = does thinking pay)');
  say('| falloff | focus vs balanced | deep vs balanced |'); say('|---|---|---|');
  for (const ff of [0n, 1000n, 1500n, 2000n, 3000n]) {
    const r = { focusFalloffBps: ff };
    say(`| ${n(ff) / 100}%/hit | ${duel(POL.focus, POL.balanced, r).toFixed(1)} | ${duel(POL.deep, POL.balanced, r).toFixed(1)} |`);
  }
}
say(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
