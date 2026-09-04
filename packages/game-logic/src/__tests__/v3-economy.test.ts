import { describe, expect, test } from 'bun:test';
import { v3 } from '../index';

const econ = v3.MID_ELITE;
const rule: v3.UnderdogRule = { rebateCapBps: 5000, fairShareBps: 1000 };

describe('underdog-bonus economics', () => {
  test('battleEV matches the documented Mid-bracket economics', () => {
    // winner net +8000 - 450 repairs = 7550; loser net -10000 - 1350 = -11350
    expect(v3.battleEV(1, econ)).toBe(7550);
    expect(v3.battleEV(0, econ)).toBe(-11350);
    // documented breakeven ≈ 60% incl. repairs
    const be = 11350 / (7550 + 11350);
    expect(Math.abs(v3.battleEV(be, econ))).toBeLessThan(1e-9);
    expect(be).toBeGreaterThan(0.58); expect(be).toBeLessThan(0.62);
  });

  test('rebate: zero at fair share, capped at half the fee for a fully unpicked team', () => {
    const fair = Array(10).fill(0.1);
    expect(v3.rebateFor([0, 1, 2], fair, econ, rule)).toBe(0);
    const none = Array(10).fill(0.1); none[4] = 0; none[5] = 0; none[6] = 0; // classes 4,5,6 unpicked
    expect(v3.rebateFor([4, 5, 6], none, econ, rule)).toBe(1000); // fee 2000 × 50% × u=1
    expect(v3.rebateFor([4, 5, 0], none, econ, rule)).toBeCloseTo(1000 * (2 / 3), 6);
    // never exceeds the cap
    expect(v3.rebateFor([4, 5, 6], none, econ, { ...rule, rebateCapBps: 10_000 })).toBe(2000);
  });

  test('pick shares sum to 1 and count slots', () => {
    const comps: v3.Comp[] = [[0, 0, 0], [1, 2, 3]];
    const shares = v3.classPickShares([0.5, 0.5], comps);
    expect(shares[0]).toBeCloseTo(0.5);
    expect(shares[1]).toBeCloseTo(0.5 / 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  test('equilibrium: rebate keeps a weaker class economically alive and narrows the EV gap', () => {
    // Two comps: A beats B 65/35. Class 0 only in A, class 1 only in B.
    const comps: v3.Comp[] = [[0, 0, 0], [1, 1, 1]];
    const W = [
      [0.5, 0.65],
      [0.35, 0.5],
    ];
    const off = v3.economicEquilibrium(W, comps, econ, v3.NO_REBATE);
    const on = v3.economicEquilibrium(W, comps, econ, rule);
    expect(on.mix[1]).toBeGreaterThan(off.mix[1]); // underdog holds more share
    const gapOff = off.classBestEV[0] - off.classBestEV[1];
    const gapOn = on.classBestEV[0] - on.classBestEV[1];
    expect(gapOn).toBeLessThan(gapOff); // EV gap narrows
  });
});
