import { describe, expect, test } from 'bun:test';
import { MID_ELITE } from '../v3/economy';
import { skillPopulation } from '../v3/participation';
import { collusionGain, marginalSeasonEV, overlayEquilibrium, payoutShares, type OverlayConfig, type PayoutSchedule } from '../v3/overlay';

const SKILLS = skillPopulation(300, 200);
const base = (pool: number, schedule: PayoutSchedule): OverlayConfig => ({
  skills: SKILLS,
  pool,
  schedule,
  battlesPerSeason: 120,
  econ: MID_ELITE,
  opportunityPerBattle: 937.5 / 4,
});

describe('payoutShares', () => {
  const kinds: PayoutSchedule[] = [{ kind: 'flat' }, { kind: 'linear' }, { kind: 'geometric', ratio: 0.9 }];
  test('sums to 1 and is non-increasing by rank', () => {
    for (const s of kinds) {
      const shares = payoutShares(25, s);
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      for (let r = 1; r < shares.length; r++) expect(shares[r]).toBeLessThanOrEqual(shares[r - 1] + 1e-12);
    }
  });
  test('edge sizes', () => {
    expect(payoutShares(0, { kind: 'linear' })).toEqual([]);
    expect(payoutShares(1, { kind: 'geometric', ratio: 0.9 })).toEqual([1]);
  });
});

describe('overlayEquilibrium', () => {
  test('zero pool -> nobody battles (the unraveling result)', () => {
    expect(overlayEquilibrium(base(0, { kind: 'linear' })).entrants).toBe(0);
  });
  test('entrants weakly increase with pool size', () => {
    let prev = 0;
    for (const pool of [1_000_000, 3_500_000, 8_800_000, 17_600_000]) {
      const n = overlayEquilibrium(base(pool, { kind: 'linear' })).entrants;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBeGreaterThan(0);
  });
  test('flat schedule buys at least as much participation as geometric', () => {
    const pool = 8_800_000;
    const flat = overlayEquilibrium(base(pool, { kind: 'flat' })).entrants;
    const geo = overlayEquilibrium(base(pool, { kind: 'geometric', ratio: 0.9 })).entrants;
    expect(flat).toBeGreaterThanOrEqual(geo);
  });
  test('equilibrium is stable: marginal in, next candidate out', () => {
    const cfg = base(8_800_000, { kind: 'linear' });
    const eq = overlayEquilibrium(cfg);
    expect(eq.entrants).toBeGreaterThan(2);
    expect(eq.marginalEV).toBeGreaterThanOrEqual(0);
    expect(marginalSeasonEV(cfg, eq.entrants + 1)).toBeLessThan(0);
  });
  test('skill is paid: top EV >= median EV >= marginal EV under rank pay', () => {
    const eq = overlayEquilibrium(base(8_800_000, { kind: 'geometric', ratio: 0.9 }));
    expect(eq.topEV).toBeGreaterThanOrEqual(eq.medianEV);
    expect(eq.medianEV).toBeGreaterThanOrEqual(eq.marginalEV);
  });
});

describe('banded matchmaking', () => {
  test('banding lowers the cost of participation (N* >= random for same pool)', () => {
    for (const s of [{ kind: 'flat' } as const, { kind: 'linear' } as const]) {
      const random = overlayEquilibrium(base(8_800_000, s));
      const banded = overlayEquilibrium({ ...base(8_800_000, s), banded: true });
      expect(banded.entrants).toBeGreaterThanOrEqual(random.entrants);
      expect(banded.marginalWinRate).toBeCloseTo(0.5, 10);
    }
  });
});

describe('collusionGain', () => {
  test('q=0 is exactly honest play', () => {
    const out = collusionGain(base(8_800_000, { kind: 'geometric', ratio: 0.9 }), 0, 0.5)!;
    expect(out.gain).toBeCloseTo(0, 6);
    expect(out.mainRankTo).toBe(out.mainRankFrom);
  });
  test('top-heavy schedules reward win-trading more than flat', () => {
    const q = 0.5;
    const geo = collusionGain(base(8_800_000, { kind: 'geometric', ratio: 0.9 }), q, 0.5)!;
    const flat = collusionGain(base(8_800_000, { kind: 'flat' }), q, 0.5)!;
    expect(geo.gain).toBeGreaterThan(flat.gain);
  });
  test('flat schedule makes rank manipulation pointless (gain ~ stake noise only)', () => {
    const flat = collusionGain(base(8_800_000, { kind: 'flat' }), 0.5, 0.5)!;
    expect(Math.abs(flat.gain)).toBeLessThan(0.02 * 8_800_000);
  });
});
