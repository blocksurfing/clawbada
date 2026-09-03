import { describe, expect, test } from 'bun:test';
import { battleEV } from '../v3/economy';
import { skillPopulation } from '../v3/participation';
import {
  APEX_HIGH, ELITE_MID, EVOLVED_LOW,
  boostBpsAt, boostCollusionGain, boostParticipation, breakevenBaseBps, type BoostConfig, type BoostSchedule,
} from '../v3/boost';

const SMOOTH: BoostSchedule = { kind: 'smooth', minBps: 1000, maxBps: 5000 };
const STEPPED: BoostSchedule = { kind: 'stepped', tiers: [
  { pctlFloor: 0.9, boostBps: 5000 }, { pctlFloor: 0.75, boostBps: 2500 },
  { pctlFloor: 0.5, boostBps: 1500 }, { pctlFloor: 0, boostBps: 1000 },
] };
const cfg = (over: Partial<BoostConfig> = {}): BoostConfig => ({
  skills: skillPopulation(500, 200),
  tier: ELITE_MID,
  schedule: SMOOTH,
  minBattlesPerEpoch: 14,
  banded: true,
  ...over,
});

describe('boostBpsAt', () => {
  test('smooth is linear, stepped picks the met tier', () => {
    expect(boostBpsAt(0, SMOOTH)).toBe(1000);
    expect(boostBpsAt(1, SMOOTH)).toBe(5000);
    expect(boostBpsAt(0.5, SMOOTH)).toBe(3000);
    expect(boostBpsAt(0.95, STEPPED)).toBe(5000);
    expect(boostBpsAt(0.6, STEPPED)).toBe(1500);
    expect(boostBpsAt(0.1, STEPPED)).toBe(1000);
  });
});

describe('breakevenBaseBps', () => {
  test('hand-computed Elite/Mid: 14 x (1900 + 781.25) / 525000', () => {
    const bps = breakevenBaseBps(ELITE_MID, 14);
    expect(bps).toBeCloseTo((10_000 * 14 * (1900 + 781.25)) / 525_000, 6);
  });
  test('all three tiers land in the same ~7-10% band (one base number works everywhere)', () => {
    for (const t of [EVOLVED_LOW, ELITE_MID, APEX_HIGH]) {
      const bps = breakevenBaseBps(t, 14);
      expect(bps).toBeGreaterThan(600);
      expect(bps).toBeLessThan(1050);
    }
  });
});

describe('boostParticipation', () => {
  test('base tier above breakeven + banded -> full participation, no unravel', () => {
    const eq = boostParticipation(cfg());
    expect(eq.entrantShare).toBe(1);
    expect(eq.marginalEV).toBeGreaterThanOrEqual(0);
  });
  test('base tier zero -> unravels (the participation.ts result reappears)', () => {
    const noBase: BoostSchedule = { kind: 'stepped', tiers: [{ pctlFloor: 0.5, boostBps: 2500 }] };
    const eq = boostParticipation(cfg({ schedule: noBase, banded: false }));
    expect(eq.entrantShare).toBeLessThan(0.6);
  });
  test('banded participation >= random (banding caps the marginal cost at the drain)', () => {
    const banded = boostParticipation(cfg({ banded: true }));
    const random = boostParticipation(cfg({ banded: false }));
    expect(banded.entrantShare).toBeGreaterThanOrEqual(random.entrantShare);
  });
  test('population-proof: identical economics at 50 / 500 / 5000 teams', () => {
    const shares = [50, 500, 5000].map(n => boostParticipation(cfg({ skills: skillPopulation(n, 200) })));
    for (const r of shares) expect(r.entrantShare).toBe(1);
    expect(shares[0].avgBoostBps).toBeCloseTo(shares[2].avgBoostBps, 0);
    expect(Math.abs(shares[0].medianEV - shares[2].medianEV) / Math.abs(shares[2].medianEV)).toBeLessThan(0.02);
  });
  test('skill is paid: top > median > marginal', () => {
    const eq = boostParticipation(cfg());
    expect(eq.topEV).toBeGreaterThan(eq.medianEV);
    expect(eq.medianEV).toBeGreaterThan(eq.marginalEV);
  });
  test('spend share is bounded by the schedule max', () => {
    const eq = boostParticipation(cfg());
    expect(eq.spendShareOfMining).toBeLessThanOrEqual(0.5);
    expect(eq.spendShareOfMining).toBeGreaterThan(0);
  });
});

describe('boostCollusionGain', () => {
  test('q=0 is honest play exactly', () => {
    const out = boostCollusionGain(cfg(), 0, 0.5)!;
    expect(out.gain).toBeCloseTo(0, 6);
  });
  test('stepped tiers pay win-trading; smooth stays near zero in the interior', () => {
    // The profitable stepped attacks: moderate snipe at a boundary, heavy snipe mid-pool.
    const boundary = boostCollusionGain(cfg({ schedule: STEPPED }), 0.25, 0.88)!;
    const midPool = boostCollusionGain(cfg({ schedule: STEPPED }), 0.5, 0.5)!;
    const smoothMid = boostCollusionGain(cfg(), 0.5, 0.5)!;
    expect(boundary.gain).toBeGreaterThan(0);
    expect(midPool.gain).toBeGreaterThan(0);
    expect(Math.abs(smoothMid.gain)).toBeLessThan(midPool.gain / 10);
  });
  test('throwing at 50% banded costs only drain: pair loses nothing on stakes', () => {
    const c = cfg();
    const winner = battleEV(1, c.tier.econ);
    const loser = battleEV(0, c.tier.econ);
    expect(winner + loser).toBeCloseTo(2 * battleEV(0.5, c.tier.econ), 6);
  });
});

import { pctlOf } from '../v3/boost';

describe('pctlOf (exported ladder normalization)', () => {
  test('closed interval: best → 1, worst → 0, lone team → 1', () => {
    expect(pctlOf(0, 10)).toBe(1);
    expect(pctlOf(9, 10)).toBe(0);
    expect(pctlOf(0, 1)).toBe(1);
    expect(pctlOf(1, 3)).toBeCloseTo(0.5, 12);
  });
});
