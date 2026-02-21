import { describe, test, expect } from 'bun:test';
import { evolutionRequirements, canEvolve, previewEvolvedStats } from '../evolution';
import { scaleStats, getBaseStats } from '../battle-resolver';
import { encodeDNA, encodeAllele } from '../dna';
import { EVOLUTION_COSTS, EVOLUTION_FUEL_COUNT } from '../constants';
import { EvolutionTier, LegendStatus, LobsterClass } from '../types';
import type { Lobster } from '../types';

// ──────────── Helpers ────────────

function makeLobster(overrides: Partial<Lobster> = {}): Lobster {
  const cls = overrides.class ?? LobsterClass.Bulwark;
  const legend = overrides.legend ?? LegendStatus.Normal;
  const alleles = Array.from({ length: 18 }, () =>
    encodeAllele({ classAffinity: cls, variant: 5 }),
  );
  return {
    tokenId: BigInt(Math.floor(Math.random() * 100000)),
    owner: '0xabc123',
    dna: encodeDNA(cls, legend, 0, alleles),
    class: cls,
    legend,
    breedType: 0,
    purity: 6,
    evolutionTier: EvolutionTier.Base,
    damage: 0,
    breedCount: 0,
    generation: 0,
    soulbound: false,
    locked: false,
    ...overrides,
  };
}

// ──────────── evolutionRequirements ────────────

describe('evolutionRequirements', () => {
  test('Base tier returns fuel=2 Base fuel + 2000 CLAW', () => {
    const reqs = evolutionRequirements(EvolutionTier.Base);
    expect(reqs).not.toBeNull();
    expect(reqs!.fuelCount).toBe(2);
    expect(reqs!.fuelTier).toBe(EvolutionTier.Base);
    expect(reqs!.clawCost).toBe(2_000n);
  });

  test('Evolved tier returns fuel=2 Evolved fuel + 10000 CLAW', () => {
    const reqs = evolutionRequirements(EvolutionTier.Evolved);
    expect(reqs).not.toBeNull();
    expect(reqs!.fuelCount).toBe(2);
    expect(reqs!.fuelTier).toBe(EvolutionTier.Evolved);
    expect(reqs!.clawCost).toBe(10_000n);
  });

  test('Elite tier returns fuel=2 Elite fuel + 50000 CLAW', () => {
    const reqs = evolutionRequirements(EvolutionTier.Elite);
    expect(reqs).not.toBeNull();
    expect(reqs!.fuelCount).toBe(2);
    expect(reqs!.fuelTier).toBe(EvolutionTier.Elite);
    expect(reqs!.clawCost).toBe(50_000n);
  });

  test('Apex tier returns null (already max)', () => {
    const reqs = evolutionRequirements(EvolutionTier.Apex);
    expect(reqs).toBeNull();
  });

  test('fuel count always matches EVOLUTION_FUEL_COUNT constant', () => {
    for (const tier of [EvolutionTier.Base, EvolutionTier.Evolved, EvolutionTier.Elite]) {
      const reqs = evolutionRequirements(tier);
      expect(reqs!.fuelCount).toBe(EVOLUTION_FUEL_COUNT);
    }
  });

  test('CLAW costs match EVOLUTION_COSTS constants', () => {
    expect(evolutionRequirements(EvolutionTier.Base)!.clawCost).toBe(EVOLUTION_COSTS[1]);
    expect(evolutionRequirements(EvolutionTier.Evolved)!.clawCost).toBe(EVOLUTION_COSTS[2]);
    expect(evolutionRequirements(EvolutionTier.Elite)!.clawCost).toBe(EVOLUTION_COSTS[3]);
  });
});

// ──────────── canEvolve ────────────

describe('canEvolve', () => {
  test('valid: unlocked Evolved lobster + 2 Evolved fuel returns valid=true', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Evolved, tokenId: 1n });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Evolved, tokenId: 2n });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Evolved, tokenId: 3n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('valid: Base lobster + 2 Base fuel returns valid=true', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 10n });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 11n });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 12n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(true);
  });

  test('valid: fuel can exceed required tier (Evolved fuel for Base->Evolved)', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 20n });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Evolved, tokenId: 21n });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Apex, tokenId: 22n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(true);
  });

  test('already Apex returns valid=false with Apex in reason', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Apex, tokenId: 30n });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Apex, tokenId: 31n });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Apex, tokenId: 32n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Apex');
  });

  test('locked lobster returns valid=false', () => {
    const lobster = makeLobster({
      evolutionTier: EvolutionTier.Base,
      locked: true,
      tokenId: 40n,
    });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 41n });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 42n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('wrong fuel count (1 instead of 2) returns valid=false', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 50n });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 51n });
    const result = canEvolve(lobster, [fuel1]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('wrong fuel count (3 instead of 2) returns valid=false', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 60n });
    const fuels = [61n, 62n, 63n].map((id) =>
      makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: id }),
    );
    const result = canEvolve(lobster, fuels);
    expect(result.valid).toBe(false);
  });

  test('fuel wrong tier (Base fuel for Evolved->Elite) returns valid=false', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Evolved, tokenId: 70n });
    const fuel1 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 71n });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Evolved, tokenId: 72n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('fuel is self (same tokenId as target) returns valid=false', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 80n });
    const fuelSelf = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 80n });
    const fuelOther = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 81n });
    const result = canEvolve(lobster, [fuelSelf, fuelOther]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('fuel');
  });

  test('fuel is locked returns valid=false', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 90n });
    const fuel1 = makeLobster({
      evolutionTier: EvolutionTier.Base,
      locked: true,
      tokenId: 91n,
    });
    const fuel2 = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 92n });
    const result = canEvolve(lobster, [fuel1, fuel2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('locked');
  });

  test('empty fuel array returns valid=false', () => {
    const lobster = makeLobster({ evolutionTier: EvolutionTier.Base, tokenId: 100n });
    const result = canEvolve(lobster, []);
    expect(result.valid).toBe(false);
  });
});

// ──────────── previewEvolvedStats ────────────

describe('previewEvolvedStats', () => {
  test('matches scaleStats output for same inputs (Bulwark, Evolved, non-legend)', () => {
    const preview = previewEvolvedStats(LobsterClass.Bulwark, EvolutionTier.Evolved, false);
    const base = getBaseStats(LobsterClass.Bulwark);
    const expected = scaleStats(base, EvolutionTier.Evolved, false);
    expect(preview.hp).toBe(expected.hp);
    expect(preview.attack).toBe(expected.attack);
    expect(preview.armor).toBe(expected.armor);
    expect(preview.speed).toBe(expected.speed);
    expect(preview.critical).toBe(expected.critical);
  });

  test('matches scaleStats output for legend Mantis at Elite tier', () => {
    const preview = previewEvolvedStats(LobsterClass.Mantis, EvolutionTier.Elite, true);
    const base = getBaseStats(LobsterClass.Mantis);
    const expected = scaleStats(base, EvolutionTier.Elite, true);
    expect(preview.hp).toBe(expected.hp);
    expect(preview.attack).toBe(expected.attack);
    expect(preview.armor).toBe(expected.armor);
    expect(preview.speed).toBe(expected.speed);
    expect(preview.critical).toBe(expected.critical);
  });

  test('each successive tier produces strictly higher stats', () => {
    const tiers = [EvolutionTier.Base, EvolutionTier.Evolved, EvolutionTier.Elite, EvolutionTier.Apex];
    for (let i = 1; i < tiers.length; i++) {
      const prev = previewEvolvedStats(LobsterClass.Bulwark, tiers[i - 1], false);
      const curr = previewEvolvedStats(LobsterClass.Bulwark, tiers[i], false);
      expect(curr.hp).toBeGreaterThan(prev.hp);
      expect(curr.attack).toBeGreaterThan(prev.attack);
      expect(curr.armor).toBeGreaterThan(prev.armor);
      expect(curr.speed).toBeGreaterThan(prev.speed);
      expect(curr.critical).toBeGreaterThan(prev.critical);
    }
  });

  test('legend produces higher stats than non-legend at same tier', () => {
    const normal = previewEvolvedStats(LobsterClass.Ember, EvolutionTier.Apex, false);
    const legend = previewEvolvedStats(LobsterClass.Ember, EvolutionTier.Apex, true);
    expect(legend.hp).toBeGreaterThan(normal.hp);
    expect(legend.attack).toBeGreaterThan(normal.attack);
  });

  test('works for all 10 classes at Base tier', () => {
    for (let cls = 0; cls < 10; cls++) {
      const stats = previewEvolvedStats(cls, EvolutionTier.Base, false);
      expect(stats.hp).toBeGreaterThan(0n);
      expect(stats.attack).toBeGreaterThan(0n);
      expect(stats.armor).toBeGreaterThan(0n);
      expect(stats.speed).toBeGreaterThan(0n);
      expect(stats.critical).toBeGreaterThan(0n);
    }
  });
});
