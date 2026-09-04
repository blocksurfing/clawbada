import { describe, expect, test } from 'bun:test';
import { v3 } from '../index';

const econ = v3.MID_ELITE;

describe('participation equilibrium (battle vs mining)', () => {
  test('elo win prob is sane and symmetric', () => {
    expect(v3.eloWinProb(0, 0)).toBeCloseTo(0.5);
    expect(v3.eloWinProb(400, 0)).toBeCloseTo(1 / (1 + 0.1), 5);
    expect(v3.eloWinProb(0, 400) + v3.eloWinProb(400, 0)).toBeCloseTo(1);
  });

  test('skill population is deterministic, sorted-symmetric, with the right spread', () => {
    const s = v3.skillPopulation(1001, 200);
    expect(s[500]).toBeCloseTo(0, 1);
    expect(s[0]).toBeLessThan(-500);
    expect(Math.abs(s[0] + s[1000])).toBeLessThan(2);
    const sd = Math.sqrt(s.reduce((a, x) => a + x * x, 0) / s.length);
    expect(Math.abs(sd - 200)).toBeLessThan(6);
  });

  test('equal skill → pool collapses (battle is negative-sum, mining wins)', () => {
    const r = v3.participationEquilibrium({ skills: Array(100).fill(0), battlesPerHour: 6, miningPerHour: 3125, econ });
    expect(r.poolShare).toBe(0);
    expect(r.burnPerAgentHour).toBe(0);
  });

  test('COMPLETE UNRAVELING: without subsidy, rational agents never battle — at any skill spread', () => {
    // The weakest member of any pool wins <50% within it; breakeven is ~60%.
    // The exit cascade therefore never stops. This is the model's core finding.
    for (const sigma of [100, 300, 600]) {
      const r = v3.participationEquilibrium({ skills: v3.skillPopulation(400, sigma), battlesPerHour: 6, miningPerHour: 0, econ });
      expect(r.poolShare).toBe(0);
    }
  });

  test('a per-battle subsidy revives the pool, and requiredSubsidy computes the indifference point', () => {
    const base = { skills: v3.skillPopulation(500, 200), battlesPerHour: 6, miningPerHour: 3125, econ };
    const { subsidy, marginalWinRate } = v3.requiredSubsidy(base, 0.25);
    expect(marginalWinRate).toBeLessThan(0.5); // weakest in the top-25% pool
    expect(subsidy).toBeGreaterThan(0);
    const revived = v3.participationEquilibrium({ ...base, subsidyPerBattle: subsidy * 1.001 });
    expect(revived.poolShare).toBeGreaterThanOrEqual(0.24);
    const starved = v3.participationEquilibrium({ ...base, subsidyPerBattle: subsidy * 0.8 });
    expect(starved.poolShare).toBeLessThan(revived.poolShare);
  });
});
