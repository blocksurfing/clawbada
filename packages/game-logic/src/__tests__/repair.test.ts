import { describe, test, expect } from 'bun:test';
import { repairCost, teamRepairCost, canEnterBattle } from '../repair';
import { EvolutionTier } from '../types';

// ──────────── repairCost ────────────

describe('repairCost', () => {
  test('Base tier: 0 per damage point (no repair cost)', () => {
    expect(repairCost(EvolutionTier.Base, 10)).toBe(0n);
    expect(repairCost(EvolutionTier.Base, 50)).toBe(0n);
    expect(repairCost(EvolutionTier.Base, 100)).toBe(0n);
  });

  test('Evolved tier: 5 per damage point', () => {
    expect(repairCost(EvolutionTier.Evolved, 1)).toBe(5n);
    expect(repairCost(EvolutionTier.Evolved, 10)).toBe(50n);
    expect(repairCost(EvolutionTier.Evolved, 30)).toBe(150n);
  });

  test('Elite tier: 15 per damage point', () => {
    expect(repairCost(EvolutionTier.Elite, 1)).toBe(15n);
    expect(repairCost(EvolutionTier.Elite, 10)).toBe(150n);
    expect(repairCost(EvolutionTier.Elite, 30)).toBe(450n);
  });

  test('Apex tier: 40 per damage point', () => {
    expect(repairCost(EvolutionTier.Apex, 1)).toBe(40n);
    expect(repairCost(EvolutionTier.Apex, 10)).toBe(400n);
    expect(repairCost(EvolutionTier.Apex, 30)).toBe(1200n);
  });

  test('zero damage returns 0 for all tiers', () => {
    expect(repairCost(EvolutionTier.Base, 0)).toBe(0n);
    expect(repairCost(EvolutionTier.Evolved, 0)).toBe(0n);
    expect(repairCost(EvolutionTier.Elite, 0)).toBe(0n);
    expect(repairCost(EvolutionTier.Apex, 0)).toBe(0n);
  });

  test('negative damage returns 0 for all tiers', () => {
    expect(repairCost(EvolutionTier.Base, -5)).toBe(0n);
    expect(repairCost(EvolutionTier.Evolved, -10)).toBe(0n);
    expect(repairCost(EvolutionTier.Elite, -1)).toBe(0n);
    expect(repairCost(EvolutionTier.Apex, -100)).toBe(0n);
  });
});

// ──────────── teamRepairCost ────────────

describe('teamRepairCost', () => {
  test('team of 3 with same tier and damage', () => {
    const team = [
      { tier: EvolutionTier.Evolved, damage: 10 },
      { tier: EvolutionTier.Evolved, damage: 10 },
      { tier: EvolutionTier.Evolved, damage: 10 },
    ];
    // 3 * (10 * 5) = 150
    expect(teamRepairCost(team)).toBe(150n);
  });

  test('team of 3 with different tiers', () => {
    const team = [
      { tier: EvolutionTier.Evolved, damage: 10 }, // 10 * 5 = 50
      { tier: EvolutionTier.Elite, damage: 20 }, // 20 * 15 = 300
      { tier: EvolutionTier.Apex, damage: 5 }, // 5 * 40 = 200
    ];
    expect(teamRepairCost(team)).toBe(550n);
  });

  test('team with zero damage costs nothing', () => {
    const team = [
      { tier: EvolutionTier.Apex, damage: 0 },
      { tier: EvolutionTier.Apex, damage: 0 },
      { tier: EvolutionTier.Apex, damage: 0 },
    ];
    expect(teamRepairCost(team)).toBe(0n);
  });

  test('empty team costs nothing', () => {
    expect(teamRepairCost([])).toBe(0n);
  });

  test('typical winner team (Evolved, ~30 total damage): ~150', () => {
    const team = [
      { tier: EvolutionTier.Evolved, damage: 10 },
      { tier: EvolutionTier.Evolved, damage: 10 },
      { tier: EvolutionTier.Evolved, damage: 10 },
    ];
    expect(teamRepairCost(team)).toBe(150n);
  });

  test('typical loser team (Evolved, ~90 total damage): ~450', () => {
    const team = [
      { tier: EvolutionTier.Evolved, damage: 30 },
      { tier: EvolutionTier.Evolved, damage: 30 },
      { tier: EvolutionTier.Evolved, damage: 30 },
    ];
    expect(teamRepairCost(team)).toBe(450n);
  });
});

// ──────────── canEnterBattle ────────────

describe('canEnterBattle', () => {
  test('0 damage: can enter', () => {
    expect(canEnterBattle(0)).toBe(true);
  });

  test('79 damage: can enter (just below threshold)', () => {
    expect(canEnterBattle(79)).toBe(true);
  });

  test('80 damage: cannot enter (at threshold)', () => {
    expect(canEnterBattle(80)).toBe(false);
  });

  test('100 damage: cannot enter (above threshold)', () => {
    expect(canEnterBattle(100)).toBe(false);
  });

  test('1 damage: can enter', () => {
    expect(canEnterBattle(1)).toBe(true);
  });
});
