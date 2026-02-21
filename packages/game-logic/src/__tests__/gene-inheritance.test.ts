import { describe, test, expect } from 'bun:test';
import {
  rollClass,
  rollLegend,
  orderAlleles,
  inheritBodyPart,
  generateOffspringDNA,
} from '../gene-inheritance';
import { encodeDNA, encodeAllele, isValidDNA, decodeDNA, decodeClass, calculatePurity } from '../dna';
import { keccak256Packed } from '../hash';
import { LobsterClass, LegendStatus } from '../types';
import type { Allele } from '../types';

// ──────────── Helpers ────────────

/** Build a DNA with all alleles sharing the same class affinity. */
function makePureDNA(cls: LobsterClass, variant: number = 5): bigint {
  const alleles = Array.from({ length: 18 }, () =>
    encodeAllele({ classAffinity: cls, variant }),
  );
  return encodeDNA(cls, LegendStatus.Normal, 0, alleles);
}

/** Build a DNA with random-ish alleles spread across classes. */
function makeMixedDNA(cls: LobsterClass): bigint {
  const alleles = Array.from({ length: 18 }, (_, i) =>
    encodeAllele({ classAffinity: i % 10 as LobsterClass, variant: (i * 3) % 16 }),
  );
  return encodeDNA(cls, LegendStatus.Normal, 0, alleles);
}

/** Generate a deterministic seed from an integer. */
function seedFrom(n: number): bigint {
  return keccak256Packed(BigInt(n), 'test_seed');
}

// ──────────── rollClass ────────────

describe('rollClass', () => {
  test('same class parents always return that class', () => {
    for (let i = 0; i < 100; i++) {
      const seed = seedFrom(i);
      const result = rollClass(LobsterClass.Bulwark, LobsterClass.Bulwark, seed);
      expect(result).toBe(LobsterClass.Bulwark);
    }
  });

  test('same class parents work for all 10 classes', () => {
    for (let cls = 0; cls < 10; cls++) {
      const result = rollClass(cls as LobsterClass, cls as LobsterClass, 42n);
      expect(result).toBe(cls);
    }
  });

  test('different class parents produce roughly 50/50 over 1000 trials', () => {
    let countA = 0;
    let countB = 0;
    const classA = LobsterClass.Bulwark;
    const classB = LobsterClass.Ember;

    for (let i = 0; i < 1000; i++) {
      const seed = seedFrom(i + 10000);
      const result = rollClass(classA, classB, seed);
      if (result === classA) countA++;
      else if (result === classB) countB++;
      else throw new Error(`Unexpected class: ${result}`);
    }

    // Expect each to be between 400-600 (40-60% with high confidence)
    expect(countA).toBeGreaterThan(400);
    expect(countA).toBeLessThan(600);
    expect(countB).toBeGreaterThan(400);
    expect(countB).toBeLessThan(600);
    expect(countA + countB).toBe(1000);
  });

  test('deterministic: same inputs produce same output', () => {
    const seed = 123456789n;
    const r1 = rollClass(LobsterClass.Mantis, LobsterClass.Kraken, seed);
    const r2 = rollClass(LobsterClass.Mantis, LobsterClass.Kraken, seed);
    expect(r1).toBe(r2);
  });
});

// ──────────── rollLegend ────────────

describe('rollLegend', () => {
  test('returns a boolean', () => {
    const result = rollLegend(42n);
    expect(typeof result).toBe('boolean');
  });

  test('approximately 0.3% rate over 10000 trials (expect 15-60 hits)', () => {
    let legends = 0;
    for (let i = 0; i < 10000; i++) {
      const seed = seedFrom(i + 50000);
      if (rollLegend(seed)) legends++;
    }
    // 0.3% of 10000 = 30 expected. Allow 15-60 range for statistical variation.
    expect(legends).toBeGreaterThanOrEqual(15);
    expect(legends).toBeLessThanOrEqual(60);
  });

  test('deterministic: same seed produces same result', () => {
    const seed = 987654321n;
    const r1 = rollLegend(seed);
    const r2 = rollLegend(seed);
    expect(r1).toBe(r2);
  });

  test('different seeds can produce different results', () => {
    // Over 1000 seeds, at least one should differ (since ~0.3% are true)
    const results = new Set<boolean>();
    for (let i = 0; i < 1000; i++) {
      results.add(rollLegend(seedFrom(i + 70000)));
    }
    expect(results.size).toBe(2); // Both true and false should appear
  });
});

// ──────────── orderAlleles ────────────

describe('orderAlleles', () => {
  test('class-matching allele sorts to dominant position', () => {
    const alleles: [Allele, Allele, Allele] = [
      { classAffinity: 5, variant: 10 }, // Sentinel — does NOT match Bulwark
      { classAffinity: 0, variant: 3 },  // Bulwark — matches
      { classAffinity: 8, variant: 15 }, // Kraken — does NOT match
    ];
    const [d, r1, r2] = orderAlleles(alleles, LobsterClass.Bulwark);
    expect(d.classAffinity).toBe(0); // Bulwark-matching allele is dominant
  });

  test('variant value breaks ties when multiple match class', () => {
    const alleles: [Allele, Allele, Allele] = [
      { classAffinity: 0, variant: 3 },  // Bulwark, low variant
      { classAffinity: 0, variant: 12 }, // Bulwark, high variant
      { classAffinity: 0, variant: 7 },  // Bulwark, mid variant
    ];
    const [d, r1, r2] = orderAlleles(alleles, LobsterClass.Bulwark);
    expect(d.variant).toBe(12);   // Highest variant first
    expect(r1.variant).toBe(7);   // Middle
    expect(r2.variant).toBe(3);   // Lowest
  });

  test('variant value breaks ties when none match class', () => {
    const alleles: [Allele, Allele, Allele] = [
      { classAffinity: 3, variant: 2 },
      { classAffinity: 5, variant: 14 },
      { classAffinity: 7, variant: 8 },
    ];
    const [d, r1, r2] = orderAlleles(alleles, LobsterClass.Bulwark);
    // None match Bulwark (class 0), so priority = 0 + variant
    expect(d.variant).toBe(14);
    expect(r1.variant).toBe(8);
    expect(r2.variant).toBe(2);
  });

  test('stable for already-ordered alleles', () => {
    const alleles: [Allele, Allele, Allele] = [
      { classAffinity: 0, variant: 15 }, // Best match
      { classAffinity: 0, variant: 10 }, // Second
      { classAffinity: 5, variant: 1 },  // Non-matching, lowest
    ];
    const [d, r1, r2] = orderAlleles(alleles, LobsterClass.Bulwark);
    expect(d).toEqual({ classAffinity: 0, variant: 15 });
    expect(r1).toEqual({ classAffinity: 0, variant: 10 });
    expect(r2).toEqual({ classAffinity: 5, variant: 1 });
  });

  test('mixed class affinities: matching alleles always rank above non-matching', () => {
    const alleles: [Allele, Allele, Allele] = [
      { classAffinity: 9, variant: 15 }, // Ember, high variant but non-matching
      { classAffinity: 0, variant: 0 },  // Bulwark, lowest variant but matching
      { classAffinity: 9, variant: 14 }, // Ember, high variant but non-matching
    ];
    const [d, _r1, _r2] = orderAlleles(alleles, LobsterClass.Bulwark);
    // Matching allele (priority = 256 + 0 = 256) beats non-matching (priority = 0 + 15 = 15)
    expect(d.classAffinity).toBe(0);
  });
});

// ──────────── inheritBodyPart ────────────

describe('inheritBodyPart', () => {
  test('returns exactly 3 alleles', () => {
    const dnaA = makePureDNA(LobsterClass.Bulwark);
    const dnaB = makePureDNA(LobsterClass.Mantis);
    const seed = seedFrom(1);
    const result = inheritBodyPart(dnaA, dnaB, 0, LobsterClass.Bulwark, seed);
    expect(result).toHaveLength(3);
  });

  test('all alleles have valid classAffinity (0-9) and variant (0-15)', () => {
    const dnaA = makeMixedDNA(LobsterClass.Leviathan);
    const dnaB = makeMixedDNA(LobsterClass.Specter);

    for (let slot = 0; slot < 6; slot++) {
      const seed = seedFrom(slot + 200);
      const [d, r1, r2] = inheritBodyPart(dnaA, dnaB, slot, LobsterClass.Leviathan, seed);
      for (const allele of [d, r1, r2]) {
        expect(allele.classAffinity).toBeGreaterThanOrEqual(0);
        expect(allele.classAffinity).toBeLessThanOrEqual(9);
        expect(allele.variant).toBeGreaterThanOrEqual(0);
        expect(allele.variant).toBeLessThanOrEqual(15);
      }
    }
  });

  test('dominant allele has highest priority (class-match first)', () => {
    // Both parents are pure Bulwark — all alleles match class 0
    const dnaA = makePureDNA(LobsterClass.Bulwark, 10);
    const dnaB = makePureDNA(LobsterClass.Bulwark, 5);
    const seed = seedFrom(300);
    const [d, r1, r2] = inheritBodyPart(dnaA, dnaB, 0, LobsterClass.Bulwark, seed);
    // All three should match Bulwark (class 0)
    expect(d.classAffinity).toBe(0);
  });

  test('works for all 6 body part slots', () => {
    const dnaA = makePureDNA(LobsterClass.Tempest);
    const dnaB = makeMixedDNA(LobsterClass.Sentinel);

    for (let slot = 0; slot < 6; slot++) {
      const seed = seedFrom(slot + 400);
      const result = inheritBodyPart(dnaA, dnaB, slot, LobsterClass.Tempest, seed);
      expect(result).toHaveLength(3);
    }
  });

  test('deterministic: same inputs produce same output', () => {
    const dnaA = makePureDNA(LobsterClass.Reaver);
    const dnaB = makeMixedDNA(LobsterClass.Abyss);
    const seed = 999n;
    const r1 = inheritBodyPart(dnaA, dnaB, 2, LobsterClass.Reaver, seed);
    const r2 = inheritBodyPart(dnaA, dnaB, 2, LobsterClass.Reaver, seed);
    expect(r1[0]).toEqual(r2[0]);
    expect(r1[1]).toEqual(r2[1]);
    expect(r1[2]).toEqual(r2[2]);
  });
});

// ──────────── generateOffspringDNA ────────────

describe('generateOffspringDNA', () => {
  test('output is valid DNA', () => {
    const dnaA = makePureDNA(LobsterClass.Bulwark);
    const dnaB = makePureDNA(LobsterClass.Mantis);
    const seed = seedFrom(500);
    const offspring = generateOffspringDNA(dnaA, dnaB, seed);
    expect(isValidDNA(offspring)).toBe(true);
  });

  test('class matches one of the two parents', () => {
    const classA = LobsterClass.Leviathan;
    const classB = LobsterClass.Ember;
    const dnaA = makePureDNA(classA);
    const dnaB = makePureDNA(classB);

    for (let i = 0; i < 50; i++) {
      const seed = seedFrom(i + 600);
      const offspring = generateOffspringDNA(dnaA, dnaB, seed);
      const offspringClass = decodeClass(offspring);
      expect([classA, classB]).toContain(offspringClass);
    }
  });

  test('same-class parents always produce same-class offspring', () => {
    const cls = LobsterClass.Kraken;
    const dnaA = makePureDNA(cls, 8);
    const dnaB = makePureDNA(cls, 3);

    for (let i = 0; i < 50; i++) {
      const seed = seedFrom(i + 700);
      const offspring = generateOffspringDNA(dnaA, dnaB, seed);
      expect(decodeClass(offspring)).toBe(cls);
    }
  });

  test('breedType is 0-63', () => {
    const dnaA = makePureDNA(LobsterClass.Sentinel);
    const dnaB = makePureDNA(LobsterClass.Reaver);

    for (let i = 0; i < 100; i++) {
      const seed = seedFrom(i + 800);
      const offspring = generateOffspringDNA(dnaA, dnaB, seed);
      const decoded = decodeDNA(offspring);
      expect(decoded.breedType).toBeGreaterThanOrEqual(0);
      expect(decoded.breedType).toBeLessThanOrEqual(63);
    }
  });

  test('determinism: same inputs produce same output', () => {
    const dnaA = makePureDNA(LobsterClass.Tempest);
    const dnaB = makeMixedDNA(LobsterClass.Specter);
    const seed = 42424242n;
    const r1 = generateOffspringDNA(dnaA, dnaB, seed);
    const r2 = generateOffspringDNA(dnaA, dnaB, seed);
    expect(r1).toBe(r2);
  });

  test('different seeds produce different offspring', () => {
    const dnaA = makePureDNA(LobsterClass.Abyss);
    const dnaB = makeMixedDNA(LobsterClass.Ember);
    const results = new Set<bigint>();
    for (let i = 0; i < 20; i++) {
      results.add(generateOffspringDNA(dnaA, dnaB, seedFrom(i + 900)));
    }
    // With 20 different seeds, we expect many distinct offspring
    expect(results.size).toBeGreaterThan(10);
  });

  test('offspring body parts have 6 parts with 3 alleles each', () => {
    const dnaA = makePureDNA(LobsterClass.Bulwark);
    const dnaB = makeMixedDNA(LobsterClass.Mantis);
    const seed = seedFrom(1000);
    const offspring = generateOffspringDNA(dnaA, dnaB, seed);
    const decoded = decodeDNA(offspring);
    expect(decoded.bodyParts).toHaveLength(6);
    for (const part of decoded.bodyParts) {
      expect(part.dominant).toBeDefined();
      expect(part.r1).toBeDefined();
      expect(part.r2).toBeDefined();
    }
  });

  test('purity tendency: high-purity same-class parents produce higher-purity offspring on average', () => {
    const cls = LobsterClass.Bulwark;
    const pureA = makePureDNA(cls, 10);
    const pureB = makePureDNA(cls, 8);

    let totalPurity = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      const seed = seedFrom(i + 1100);
      const offspring = generateOffspringDNA(pureA, pureB, seed);
      totalPurity += calculatePurity(offspring);
    }
    const avgPurity = totalPurity / trials;
    // Two 6/6 pure parents should produce offspring with average purity > 2
    expect(avgPurity).toBeGreaterThan(2);
  });

  test('mixed-class parents produce lower average purity than same-class pure parents', () => {
    const pureA = makePureDNA(LobsterClass.Bulwark, 10);
    const pureB = makePureDNA(LobsterClass.Bulwark, 8);
    const mixedA = makeMixedDNA(LobsterClass.Bulwark);
    const mixedB = makeMixedDNA(LobsterClass.Ember);

    let pureTotalPurity = 0;
    let mixedTotalPurity = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      const seed = seedFrom(i + 1200);
      const pureOffspring = generateOffspringDNA(pureA, pureB, seed);
      pureTotalPurity += calculatePurity(pureOffspring);

      const mixedOffspring = generateOffspringDNA(mixedA, mixedB, seed);
      mixedTotalPurity += calculatePurity(mixedOffspring);
    }
    expect(pureTotalPurity / trials).toBeGreaterThan(mixedTotalPurity / trials);
  });

  test('all allele class affinities in offspring are in range 0-9', () => {
    const dnaA = makeMixedDNA(LobsterClass.Tempest);
    const dnaB = makeMixedDNA(LobsterClass.Specter);

    for (let i = 0; i < 20; i++) {
      const seed = seedFrom(i + 1300);
      const offspring = generateOffspringDNA(dnaA, dnaB, seed);
      const decoded = decodeDNA(offspring);
      for (const part of decoded.bodyParts) {
        for (const allele of [part.dominant, part.r1, part.r2]) {
          expect(allele.classAffinity).toBeGreaterThanOrEqual(0);
          expect(allele.classAffinity).toBeLessThanOrEqual(9);
          expect(allele.variant).toBeGreaterThanOrEqual(0);
          expect(allele.variant).toBeLessThanOrEqual(15);
        }
      }
    }
  });
});
