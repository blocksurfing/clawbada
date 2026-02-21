import { describe, test, expect } from 'bun:test';
import {
  BASE_STATS,
  TIER_WEIGHTS,
  EVOLUTION_COSTS,
  BREED_MULTIPLIERS,
  REPAIR_RATES,
  SPECIAL_BASE_POWERS,
  SEASON_EMISSIONS,
  STAKE_BRACKETS,
  DAMAGE_THRESHOLD,
  NUM_CLASSES,
} from '../constants';

describe('BASE_STATS', () => {
  test('has exactly 10 entries (one per class)', () => {
    expect(BASE_STATS).toHaveLength(NUM_CLASSES);
  });

  test('each class has exactly 5 stat values', () => {
    for (let i = 0; i < BASE_STATS.length; i++) {
      expect(BASE_STATS[i]).toHaveLength(5);
    }
  });

  test('each class has positive non-HP stat totals (Atk + Armor + Spd + Crit)', () => {
    for (let i = 0; i < BASE_STATS.length; i++) {
      const [_hp, atk, armor, spd, crit] = BASE_STATS[i];
      const total = atk + armor + spd + crit;
      expect(total).toBeGreaterThan(0n);
    }
  });

  test('all stats are positive bigints', () => {
    for (const stats of BASE_STATS) {
      for (const stat of stats) {
        expect(stat).toBeGreaterThan(0n);
      }
    }
  });
});

describe('TIER_WEIGHTS', () => {
  test('has exactly 4 entries', () => {
    expect(TIER_WEIGHTS).toHaveLength(4);
  });

  test('all weights are positive', () => {
    for (const w of TIER_WEIGHTS) {
      expect(w).toBeGreaterThan(0n);
    }
  });

  test('weights are in ascending order', () => {
    for (let i = 1; i < TIER_WEIGHTS.length; i++) {
      expect(TIER_WEIGHTS[i]).toBeGreaterThan(TIER_WEIGHTS[i - 1]);
    }
  });
});

describe('EVOLUTION_COSTS', () => {
  test('has exactly 4 entries', () => {
    expect(EVOLUTION_COSTS).toHaveLength(4);
  });

  test('first entry (Base) is 0', () => {
    expect(EVOLUTION_COSTS[0]).toBe(0n);
  });

  test('subsequent entries are positive and increasing', () => {
    for (let i = 1; i < EVOLUTION_COSTS.length; i++) {
      expect(EVOLUTION_COSTS[i]).toBeGreaterThan(0n);
      expect(EVOLUTION_COSTS[i]).toBeGreaterThan(EVOLUTION_COSTS[i - 1]);
    }
  });
});

describe('BREED_MULTIPLIERS', () => {
  test('has exactly 5 entries', () => {
    expect(BREED_MULTIPLIERS).toHaveLength(5);
  });

  test('monotonically increasing', () => {
    for (let i = 1; i < BREED_MULTIPLIERS.length; i++) {
      expect(BREED_MULTIPLIERS[i]).toBeGreaterThan(BREED_MULTIPLIERS[i - 1]);
    }
  });

  test('all entries are positive', () => {
    for (const m of BREED_MULTIPLIERS) {
      expect(m).toBeGreaterThan(0n);
    }
  });
});

describe('REPAIR_RATES', () => {
  test('has exactly 4 entries', () => {
    expect(REPAIR_RATES).toHaveLength(4);
  });

  test('Base tier rate is 0', () => {
    expect(REPAIR_RATES[0]).toBe(0n);
  });

  test('non-Base tiers have positive rates in ascending order', () => {
    for (let i = 1; i < REPAIR_RATES.length; i++) {
      expect(REPAIR_RATES[i]).toBeGreaterThan(0n);
    }
    for (let i = 2; i < REPAIR_RATES.length; i++) {
      expect(REPAIR_RATES[i]).toBeGreaterThan(REPAIR_RATES[i - 1]);
    }
  });
});

describe('SPECIAL_BASE_POWERS', () => {
  test('has exactly 10 entries', () => {
    expect(SPECIAL_BASE_POWERS).toHaveLength(NUM_CLASSES);
  });

  test('all entries are non-negative bigints', () => {
    for (const p of SPECIAL_BASE_POWERS) {
      expect(p).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe('SEASON_EMISSIONS', () => {
  test('has exactly 7 entries', () => {
    expect(SEASON_EMISSIONS).toHaveLength(7);
  });

  test('each season is roughly half the previous (except the floor)', () => {
    // Seasons 1-6: each is approximately half the previous
    for (let i = 1; i < 6; i++) {
      const ratio = Number(SEASON_EMISSIONS[i - 1]) / Number(SEASON_EMISSIONS[i]);
      // Should be approximately 2.0 (allow some tolerance for integer rounding)
      expect(ratio).toBeGreaterThan(1.9);
      expect(ratio).toBeLessThan(2.1);
    }
  });

  test('season 7 (floor) is less than season 6', () => {
    expect(SEASON_EMISSIONS[6]).toBeLessThan(SEASON_EMISSIONS[5]);
  });

  test('all entries are positive', () => {
    for (const e of SEASON_EMISSIONS) {
      expect(e).toBeGreaterThan(0n);
    }
  });
});

describe('STAKE_BRACKETS', () => {
  test('has exactly 3 entries', () => {
    expect(STAKE_BRACKETS).toHaveLength(3);
  });

  test('brackets are in ascending order', () => {
    for (let i = 1; i < STAKE_BRACKETS.length; i++) {
      expect(STAKE_BRACKETS[i]).toBeGreaterThan(STAKE_BRACKETS[i - 1]);
    }
  });

  test('all entries are positive', () => {
    for (const b of STAKE_BRACKETS) {
      expect(b).toBeGreaterThan(0n);
    }
  });
});

describe('DAMAGE_THRESHOLD', () => {
  test('is 80', () => {
    expect(DAMAGE_THRESHOLD).toBe(80);
  });
});
