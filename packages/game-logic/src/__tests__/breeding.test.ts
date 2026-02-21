import { describe, test, expect } from 'bun:test';
import { breedCostPerParent, totalBreedCost } from '../breeding';

// ──────────── breedCostPerParent ────────────

describe('breedCostPerParent', () => {
  test('Gen 0, breed index 0 (1st breed): 500', () => {
    // 500 * 1000 * 1000 / (1000 * 1000) = 500
    expect(breedCostPerParent(0, 0)).toBe(500n);
  });

  test('Gen 0, breed index 1 (2nd breed): 750', () => {
    // 500 * 1500 * 1000 / (1000 * 1000) = 750
    expect(breedCostPerParent(1, 0)).toBe(750n);
  });

  test('Gen 0, breed index 2 (3rd breed): 1250', () => {
    // 500 * 2500 * 1000 / (1000 * 1000) = 1250
    expect(breedCostPerParent(2, 0)).toBe(1250n);
  });

  test('Gen 0, breed index 3 (4th breed): 2000', () => {
    // 500 * 4000 * 1000 / (1000 * 1000) = 2000
    expect(breedCostPerParent(3, 0)).toBe(2000n);
  });

  test('Gen 0, breed index 4 (5th breed): 4000', () => {
    // 500 * 8000 * 1000 / (1000 * 1000) = 4000
    expect(breedCostPerParent(4, 0)).toBe(4000n);
  });

  test('Gen 1, breed index 0 (1st breed): 750', () => {
    // 500 * 1000 * 1500 / (1000 * 1000) = 750
    expect(breedCostPerParent(0, 1)).toBe(750n);
  });

  test('Gen 2, breed index 0 (1st breed): 1125', () => {
    // genMult = 1000 -> 1500 -> (1500*1500)/1000 = 2250
    // 500 * 1000 * 2250 / 1_000_000 = 1125
    expect(breedCostPerParent(0, 2)).toBe(1125n);
  });

  test('Gen 3, breed index 0 (1st breed): 1687', () => {
    // genMult = 1000 -> 1500 -> 2250 -> (2250*1500)/1000 = 3375
    // 500 * 1000 * 3375 / 1_000_000 = 1687 (truncated from 1687.5)
    expect(breedCostPerParent(0, 3)).toBe(1687n);
  });

  test('Gen 1, breed index 4 (5th breed): 6000', () => {
    // 500 * 8000 * 1500 / 1_000_000 = 6000
    expect(breedCostPerParent(4, 1)).toBe(6000n);
  });

  test('Gen 0 pair, 5 breeds total: cumulative 8500 per parent, 17000 total', () => {
    // Sum of all 5 breeds for a Gen 0 parent
    let total = 0n;
    for (let i = 0; i < 5; i++) {
      total += breedCostPerParent(i, 0);
    }
    // 500 + 750 + 1250 + 2000 + 4000 = 8500
    expect(total).toBe(8500n);
    // For a pair, double it
    expect(total * 2n).toBe(17000n);
  });
});

// ──────────── breedCostPerParent — invalid inputs ────────────

describe('breedCostPerParent — invalid inputs', () => {
  test('throws for breed index -1', () => {
    expect(() => breedCostPerParent(-1, 0)).toThrow('Invalid breed index');
  });

  test('throws for breed index 5', () => {
    expect(() => breedCostPerParent(5, 0)).toThrow('Invalid breed index');
  });

  test('throws for breed index 100', () => {
    expect(() => breedCostPerParent(100, 0)).toThrow('Invalid breed index');
  });
});

// ──────────── totalBreedCost ────────────

describe('totalBreedCost', () => {
  test('two Gen 0 parents, both 1st breed: 500 + 500 = 1000', () => {
    expect(totalBreedCost(0, 0, 0, 0)).toBe(1000n);
  });

  test('two Gen 0 parents, both 2nd breed: 750 + 750 = 1500', () => {
    expect(totalBreedCost(1, 0, 1, 0)).toBe(1500n);
  });

  test('two Gen 0 parents, both 5th breed: 4000 + 4000 = 8000', () => {
    expect(totalBreedCost(4, 0, 4, 0)).toBe(8000n);
  });

  test('mixed: parent A (Gen 0, 3rd breed) + parent B (Gen 1, 1st breed)', () => {
    // Parent A: 500 * 2500 * 1000 / 1e6 = 1250
    // Parent B: 500 * 1000 * 1500 / 1e6 = 750
    expect(totalBreedCost(2, 0, 0, 1)).toBe(2000n);
  });

  test('Gen 0 pair, all 5 sequential breeds sum to 17000', () => {
    let cumulative = 0n;
    const expectedPerBreed = [1000n, 1500n, 2500n, 4000n, 8000n];
    for (let i = 0; i < 5; i++) {
      const cost = totalBreedCost(i, 0, i, 0);
      expect(cost).toBe(expectedPerBreed[i]);
      cumulative += cost;
    }
    expect(cumulative).toBe(17000n);
  });

  test('asymmetric parents: different gen and breed count', () => {
    // Parent A: Gen 2, 4th breed = 500 * 4000 * 2250 / 1e6 = 4500
    // Parent B: Gen 0, 1st breed = 500 * 1000 * 1000 / 1e6 = 500
    expect(totalBreedCost(3, 2, 0, 0)).toBe(4500n + 500n);
  });
});
