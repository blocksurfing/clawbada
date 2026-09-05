import { describe, expect, test } from 'bun:test';
import { encodeDNA, calculatePurity } from '../dna';
import { EvolutionTier, LegendStatus, LobsterClass } from '../types';
import { v3 } from '../index';

const { lobsterInputFromChain, partClassIds, repairDamage, createBattle, runBattle, BOTS, botPolicy, isBotName, BOT_NAMES, forfeit } = v3;

/** alleles: 6 parts × [D, R1, R2]; each byte = (classAffinity << 4) | variant. */
function alleles(dominantClasses: number[]): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < 6; slot++) out.push((dominantClasses[slot] << 4) | 3, (1 << 4) | 1, (2 << 4) | 2);
  return out;
}

describe('adapter', () => {
  test('lobsterInputFromChain decodes class, legend, tier and purity from DNA + tier', () => {
    const dna = encodeDNA(LobsterClass.Kraken, LegendStatus.Legend, 5, alleles([8, 8, 8, 1, 2, 8]) as any);
    const input = lobsterInputFromChain({ tokenId: 4242n, dna, evolutionTier: 2 });
    expect(input).toEqual({ id: '4242', class: LobsterClass.Kraken, tier: EvolutionTier.Elite, purity: 4, legend: true });
    expect(input.purity).toBe(calculatePurity(dna));
    // Trusted on-chain purity wins when given.
    expect(lobsterInputFromChain({ tokenId: '7', dna, evolutionTier: EvolutionTier.Apex, purity: 6 }).purity).toBe(6);
    expect(lobsterInputFromChain({ tokenId: 7, dna: encodeDNA(LobsterClass.Ember, LegendStatus.Normal, 0, alleles([0, 0, 0, 0, 0, 0]) as any), evolutionTier: 1 }).legend).toBe(false);
  });

  test('partClassIds returns the six dominant affinities in DNA slot order', () => {
    const dna = encodeDNA(LobsterClass.Mantis, LegendStatus.Normal, 0, alleles([1, 9, 0, 4, 1, 7]) as any);
    expect(partClassIds(dna)).toEqual([1, 9, 0, 4, 1, 7]);
  });
});

describe('repairDamage', () => {
  function finished(seed: bigint) {
    const mk = (p: string, cs: LobsterClass[]) => cs.map((c, i) => ({ id: `${p}${i}`, class: c, tier: EvolutionTier.Evolved, purity: 0 }));
    const s = createBattle({ battleId: 'd', vrfSeed: seed, tier: 'evolved', teamA: mk('A', [LobsterClass.Leviathan, LobsterClass.Reaver, LobsterClass.Abyss]), teamB: mk('B', [LobsterClass.Mantis, LobsterClass.Ember, LobsterClass.Specter]) });
    runBattle(s, { A: BOTS.aggressive, B: BOTS.aggressive });
    return s;
  }

  test('winner rolls 5–15 per slot, loser 20–40, deterministic per seed', () => {
    for (const seed of [1n, 2n, 3n, 4n]) {
      const s = finished(seed);
      expect(s.finished).toBe(true);
      const d = repairDamage(s);
      const winner = s.winner === 'A' ? d.damageA : d.damageB;
      const loser = s.winner === 'A' ? d.damageB : d.damageA;
      if (s.winner !== 'draw') {
        for (const x of winner) { expect(x).toBeGreaterThanOrEqual(5); expect(x).toBeLessThanOrEqual(15); }
        for (const x of loser) { expect(x).toBeGreaterThanOrEqual(20); expect(x).toBeLessThanOrEqual(40); }
      }
      expect(repairDamage(s)).toEqual(d);
    }
  });

  test('a draw rolls the winner band for both teams', () => {
    const s = finished(5n);
    // Force a draw outcome on the finished state to exercise the branch.
    s.winner = 'draw';
    const d = repairDamage(s);
    for (const x of [...d.damageA, ...d.damageB]) { expect(x).toBeGreaterThanOrEqual(5); expect(x).toBeLessThanOrEqual(15); }
  });

  test('refuses an unfinished battle', () => {
    const mk = (p: string) => [LobsterClass.Bulwark, LobsterClass.Bulwark, LobsterClass.Bulwark].map((c, i) => ({ id: `${p}${i}`, class: c, tier: EvolutionTier.Evolved, purity: 0 }));
    const s = createBattle({ battleId: 'u', vrfSeed: 1n, tier: 'evolved', teamA: mk('A'), teamB: mk('B') });
    expect(() => repairDamage(s)).toThrow(/not finished/);
    forfeit(s, 'A', 'resign');
    expect(repairDamage(s).damageB.every(x => x >= 5 && x <= 15)).toBe(true);
    expect(repairDamage(s).damageA.every(x => x >= 20 && x <= 40)).toBe(true);
  });
});

describe('bot registry', () => {
  test('every named bot resolves to a policy that produces legal commands', () => {
    expect(BOT_NAMES).toHaveLength(8);
    for (const name of BOT_NAMES) {
      expect(isBotName(name)).toBe(true);
      const p = botPolicy(name);
      const mk = (pre: string, cs: LobsterClass[]) => cs.map((c, i) => ({ id: `${pre}${i}`, class: c, tier: EvolutionTier.Evolved, purity: 0 }));
      const s = createBattle({ battleId: name, vrfSeed: 3n, tier: 'evolved', teamA: mk('A', [LobsterClass.Kraken, LobsterClass.Sentinel, LobsterClass.Tempest]), teamB: mk('B', [LobsterClass.Reaver, LobsterClass.Bulwark, LobsterClass.Mantis]) });
      const results = runBattle(s, { A: p, B: BOTS.balanced }, 12);
      expect(results.length).toBe(12);
    }
    expect(isBotName('gpt')).toBe(false);
    expect(() => botPolicy('gpt' as any)).toThrow();
  });
});
