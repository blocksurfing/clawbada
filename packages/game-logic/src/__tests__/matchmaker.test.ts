import { describe, test, expect } from 'bun:test';
import {
  computeTeamPower,
  getCurrentRadius,
  powerMatchSeverity,
  makePoolKey,
  poolKeyString,
  assertValidPower,
  assertValidStakeBracket,
  MIN_TEAM_POWER,
  MAX_TEAM_POWER,
  RADIUS_THRESHOLDS,
} from '../matchmaker';
import { EvolutionTier } from '../types';

describe('computeTeamPower', () => {
  test('3 × Evolved → power 3 (minimum)', () => {
    expect(
      computeTeamPower([EvolutionTier.Evolved, EvolutionTier.Evolved, EvolutionTier.Evolved]),
    ).toBe(3);
  });

  test('3 × Apex → power 9 (maximum)', () => {
    expect(
      computeTeamPower([EvolutionTier.Apex, EvolutionTier.Apex, EvolutionTier.Apex]),
    ).toBe(9);
  });

  test('mixed 1E + 1El + 1Ap → power 6', () => {
    expect(
      computeTeamPower([EvolutionTier.Evolved, EvolutionTier.Elite, EvolutionTier.Apex]),
    ).toBe(6);
  });

  test('smurf-shape 1E + 2Ap → power 7', () => {
    expect(
      computeTeamPower([EvolutionTier.Evolved, EvolutionTier.Apex, EvolutionTier.Apex]),
    ).toBe(7);
  });

  test('rejects wrong team size', () => {
    expect(() => computeTeamPower([EvolutionTier.Evolved, EvolutionTier.Elite])).toThrow();
    expect(() =>
      computeTeamPower([EvolutionTier.Evolved, EvolutionTier.Elite, EvolutionTier.Apex, EvolutionTier.Apex]),
    ).toThrow();
  });

  test('rejects Base-tier lobsters (V3 entry rule)', () => {
    expect(() =>
      computeTeamPower([EvolutionTier.Base, EvolutionTier.Evolved, EvolutionTier.Evolved]),
    ).toThrow(/Base-tier lobster cannot enter battle/);
  });
});

describe('getCurrentRadius', () => {
  test('elapsed 0s → exact match (halfWidth 0)', () => {
    const r = getCurrentRadius(6, 0);
    expect(r).toEqual({ low: 6, high: 6, halfWidth: 0 });
  });

  test('elapsed 30s → ±1 (halfWidth 1)', () => {
    const r = getCurrentRadius(6, 30);
    expect(r).toEqual({ low: 5, high: 7, halfWidth: 1 });
  });

  test('elapsed 60s → ±2 (halfWidth 2)', () => {
    const r = getCurrentRadius(6, 60);
    expect(r).toEqual({ low: 4, high: 8, halfWidth: 2 });
  });

  test('elapsed 120s+ → all power within stake bracket', () => {
    const r = getCurrentRadius(6, 120);
    expect(r.low).toBe(MIN_TEAM_POWER);
    expect(r.high).toBe(MAX_TEAM_POWER);
    expect(r.halfWidth).toBe(Infinity);
  });

  test('clamps low end at MIN_TEAM_POWER', () => {
    const r = getCurrentRadius(3, 60); // ±2 from power 3 would be 1 (below min)
    expect(r.low).toBe(MIN_TEAM_POWER);
    expect(r.high).toBe(5);
  });

  test('clamps high end at MAX_TEAM_POWER', () => {
    const r = getCurrentRadius(9, 60); // ±2 from power 9 would be 11 (above max)
    expect(r.low).toBe(7);
    expect(r.high).toBe(MAX_TEAM_POWER);
  });

  test('threshold edge cases — exact 30/60/120 seconds', () => {
    expect(getCurrentRadius(6, 29).halfWidth).toBe(0);
    expect(getCurrentRadius(6, 30).halfWidth).toBe(1);
    expect(getCurrentRadius(6, 59).halfWidth).toBe(1);
    expect(getCurrentRadius(6, 60).halfWidth).toBe(2);
    expect(getCurrentRadius(6, 119).halfWidth).toBe(2);
    expect(getCurrentRadius(6, 120).halfWidth).toBe(Infinity);
  });

  test('negative elapsed treated as 0 (clock skew defense)', () => {
    expect(getCurrentRadius(6, -100).halfWidth).toBe(0);
  });

  test('thresholds are sorted by elapsed cutoff', () => {
    let prev = -1;
    for (const [cutoff] of RADIUS_THRESHOLDS) {
      expect(cutoff).toBeGreaterThan(prev);
      prev = cutoff;
    }
  });
});

describe('powerMatchSeverity', () => {
  test('equal power → even', () => {
    expect(powerMatchSeverity(6, 6)).toBe('even');
  });
  test('opponent +1 → slight-disadvantage', () => {
    expect(powerMatchSeverity(6, 7)).toBe('slight-disadvantage');
  });
  test('opponent +2 → significant-disadvantage', () => {
    expect(powerMatchSeverity(6, 8)).toBe('significant-disadvantage');
    expect(powerMatchSeverity(3, 9)).toBe('significant-disadvantage');
  });
  test('viewer-stronger → advantage', () => {
    expect(powerMatchSeverity(7, 6)).toBe('advantage');
    expect(powerMatchSeverity(9, 3)).toBe('advantage');
  });
});

describe('makePoolKey + poolKeyString', () => {
  test('valid (stake, power) → PoolKey', () => {
    expect(makePoolKey(0, 3)).toEqual({ stakeBracket: 0, powerScore: 3 });
    expect(makePoolKey(2, 9)).toEqual({ stakeBracket: 2, powerScore: 9 });
  });

  test('rejects out-of-range stake', () => {
    expect(() => makePoolKey(-1, 3)).toThrow();
    expect(() => makePoolKey(3, 3)).toThrow();
    expect(() => makePoolKey(1.5, 3)).toThrow();
  });

  test('rejects out-of-range power', () => {
    expect(() => makePoolKey(0, 2)).toThrow();
    expect(() => makePoolKey(0, 10)).toThrow();
    expect(() => makePoolKey(0, 6.5)).toThrow();
  });

  test('poolKeyString is stable and parseable', () => {
    expect(poolKeyString({ stakeBracket: 0, powerScore: 3 })).toBe('s0:p3');
    expect(poolKeyString({ stakeBracket: 2, powerScore: 9 })).toBe('s2:p9');
  });
});

describe('validators', () => {
  test('assertValidPower covers [3, 9]', () => {
    for (let p = 3; p <= 9; p++) {
      expect(() => assertValidPower(p)).not.toThrow();
    }
    expect(() => assertValidPower(2)).toThrow();
    expect(() => assertValidPower(10)).toThrow();
  });

  test('assertValidStakeBracket covers [0, 2]', () => {
    for (let s = 0; s <= 2; s++) {
      expect(() => assertValidStakeBracket(s)).not.toThrow();
    }
    expect(() => assertValidStakeBracket(-1)).toThrow();
    expect(() => assertValidStakeBracket(3)).toThrow();
  });
});

// ──────────── Rating bands (S1) ────────────

import {
  RATING_RADIUS_THRESHOLDS,
  RATING_RADIUS_CAP,
  getCurrentRatingRadius,
  ratingInRadius,
} from '../matchmaker';

describe('getCurrentRatingRadius', () => {
  test('schedule is ±75 → ±150 → ±225 → ±300 at 0 / 30 / 60 / 120 s', () => {
    expect(RATING_RADIUS_THRESHOLDS.map(([t, hw]) => [t, hw])).toEqual([[0, 75], [30, 150], [60, 225], [120, 300]]);
    expect(getCurrentRatingRadius(0)).toBe(75);
    expect(getCurrentRatingRadius(29)).toBe(75);
    expect(getCurrentRatingRadius(30)).toBe(150);
    expect(getCurrentRatingRadius(59)).toBe(150);
    expect(getCurrentRatingRadius(60)).toBe(225);
    expect(getCurrentRatingRadius(119)).toBe(225);
    expect(getCurrentRatingRadius(120)).toBe(300);
  });

  test('never opens wider than the cap, no matter how long the wait', () => {
    expect(RATING_RADIUS_CAP).toBe(300);
    expect(getCurrentRatingRadius(10_000)).toBe(300);
    expect(getCurrentRatingRadius(Number.MAX_SAFE_INTEGER)).toBe(300);
  });

  test('negative elapsed clamps to the first step', () => {
    expect(getCurrentRatingRadius(-5)).toBe(75);
  });

  test('ratingInRadius is inclusive on both ends', () => {
    expect(ratingInRadius(1275, 1200, 75)).toBe(true);
    expect(ratingInRadius(1125, 1200, 75)).toBe(true);
    expect(ratingInRadius(1276, 1200, 75)).toBe(false);
    expect(ratingInRadius(1124, 1200, 75)).toBe(false);
  });
});
