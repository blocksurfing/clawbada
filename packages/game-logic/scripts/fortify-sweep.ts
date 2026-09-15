/**
 * Fortify radius sweep: Bulwark win rate + how many allies each cast actually covers, per
 * radius config and tier. Written for the 2026-09-12 radius decision; keep for re-runs.
 *
 *   bun scripts/fortify-sweep.ts          # 2000 battles per cell
 *   N=500 bun scripts/fortify-sweep.ts    # quicker
 */
import { v3 } from '../src/index';
import { EvolutionTier, LobsterClass } from '../src/types';

const N = Number(process.env.N ?? 2000);
const TIERS = [['evolved', EvolutionTier.Evolved], ['elite', EvolutionTier.Elite], ['apex', EvolutionTier.Apex]] as const;
const CONFIGS: Record<string, Record<number, number>> = {
  'team-wide (today)': { 0: 99, 1: 99, 2: 99, 3: 99 },
  'radius 1/2/3 (yours)': { 0: 1, 1: 1, 2: 2, 3: 3 },
  'radius 2/3/4 (mine)': { 0: 2, 1: 2, 2: 3, 3: 4 },
  'FLAT radius 1 (art as drawn)': { 0: 1, 1: 1, 2: 1, 3: 1 },
  'FLAT radius 2 (1.67x upscale)': { 0: 2, 1: 2, 2: 2, 3: 2 },
};
const bot = v3.BOTS['balanced'] ?? v3.greedyPolicy;
const mk = (p: string, cs: number[], i: number, tier: EvolutionTier) =>
  cs.map((c, j) => ({ id: `${p}${j}`, class: c as LobsterClass, tier, purity: (i + j) % 7 }));

console.log('| Config | Tier | Bulwark win % | casts | avg allies covered | % casts self-only |');
console.log('|---|---|---|---|---|---|');
for (const [label, radii] of Object.entries(CONFIGS)) {
  for (const [tierName, tier] of TIERS) {
    let wins = 0, games = 0, casts = 0, covered = 0, selfOnly = 0;
    for (let i = 0; i < N; i++) {
      const pick = (k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
      const a = [pick(1), pick(2), pick(3)], b = [pick(4), pick(5), pick(6)];
      const s = v3.createBattle({
        battleId: `b${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName,
        teamA: mk('A', a, i, tier), teamB: mk('B', b, i + 3, tier),
        rules: { fortifyRadiusByTier: radii },
      });
      const byId = new Map(s.lobsters.map((l) => [l.id, l]));
      const res = v3.runBattle(s, { A: bot, B: bot });
      for (const r of res) {
        const actor = byId.get(r.lobsterId);
        if (r.action !== 'special' || !actor || actor.class !== LobsterClass.Bulwark) continue;
        const n = r.statuses.filter((x: any) => x.status === 'fortify' && x.applied).length;
        casts++; covered += n; if (n <= 1) selfOnly++;
      }
      for (const c of a) { games++; if (s.winner === 'A') wins++; }
      for (const c of b) { games++; if (s.winner === 'B') wins++; }
    }
    // Only count games where Bulwark was actually on the team
    let bw = 0, bg = 0;
    for (let i = 0; i < N; i++) {
      const pick = (k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 10;
      const a = [pick(1), pick(2), pick(3)], b = [pick(4), pick(5), pick(6)];
      const s = v3.createBattle({
        battleId: `b${i}`, vrfSeed: BigInt(i + 1) * 104729n, tier: tierName,
        teamA: mk('A', a, i, tier), teamB: mk('B', b, i + 3, tier),
        rules: { fortifyRadiusByTier: radii },
      });
      v3.runBattle(s, { A: bot, B: bot });
      for (const c of a) if (c === LobsterClass.Bulwark) { bg++; if (s.winner === 'A') bw++; }
      for (const c of b) if (c === LobsterClass.Bulwark) { bg++; if (s.winner === 'B') bw++; }
    }
    const pct = (x: number, y: number) => (100 * x / Math.max(1, y)).toFixed(1);
    console.log(`| ${label} | ${tierName} | ${pct(bw, bg)} | ${casts} | ${(covered / Math.max(1, casts)).toFixed(2)} | ${pct(selfOnly, casts)} |`);
  }
}
