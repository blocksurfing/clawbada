import { describe, expect, test } from 'bun:test';
import {
  WEI, ONCHAIN, S1_EMISSION_WEI, S1_LAUNCH_WEI, MINING_ALLOCATION_WEI,
  newGlideState, repegIfNeeded, runGlideSeason, D19_SCENARIOS,
} from '../v3/season-glide';

const BASE = 1_250n * WEI;

describe('repegIfNeeded reproduces the contract', () => {
  // test/MiningPool.t.sol::test_glideRepegsDownWithDampingClamp — a 125,000 CLAW season, six Base
  // expeditions on day 0 (7,500 CLAW minted, 6 units served), first touch of epoch 1 → 70 % of 1,250.
  test('damping clamp: 1,250 → 875 on the contract\'s own vector', () => {
    const s = newGlideState(BASE * 100n, BASE);
    s.minted = 6n * BASE;
    s.lifetimeMinted = 6n * BASE;
    s.servedBps = 6n * 10_000n;
    repegIfNeeded(s, 1, 60, ONCHAIN);
    expect(s.base).toBe((BASE * 7_000n) / 10_000n);
    expect(s.trailing).toBe(6n);
  });

  // test_glideHoldsAtLaunchCapUnderLightDemand — full S1 budget, one Base expedition on day 0.
  test('launch cap: one expedition against the S1 budget holds 1,250', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE);
    s.minted = BASE; s.lifetimeMinted = BASE; s.servedBps = 10_000n;
    repegIfNeeded(s, 1, 60, ONCHAIN);
    expect(s.base).toBe(BASE);
  });

  // test_glideNeverExceedsLaunchAfterAdminOverride — an above-launch override snaps back at the next re-peg.
  test('an admin override above launch snaps back to launch', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE);
    s.base = BASE * 2n;
    s.minted = BASE * 2n; s.lifetimeMinted = BASE * 2n; s.servedBps = 10_000n;
    repegIfNeeded(s, 1, 60, ONCHAIN);
    expect(s.base).toBe(BASE);
  });

  test('epoch 0 is blind and a quiet epoch holds (no demand signal)', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE);
    s.servedBps = 6n * 10_000n;
    repegIfNeeded(s, 0, 60, ONCHAIN); // same epoch as lastRepegEpoch (0): nothing happens
    expect(s.base).toBe(BASE);
    expect(s.servedBps).toBe(6n * 10_000n);
    const quiet = newGlideState(S1_EMISSION_WEI, BASE);
    repegIfNeeded(quiet, 1, 60, ONCHAIN);
    expect(quiet.base).toBe(BASE);
  });

  test('D-19(c): an exhausted budget holds the last rate; D-18: epoch 59 paces over 1 day; dust floor', () => {
    const s = newGlideState(1_000n * WEI, BASE);
    s.base = 700n * WEI; s.minted = 1_000n * WEI; s.lifetimeMinted = s.minted; s.servedBps = 10_000n;
    repegIfNeeded(s, 5, 60, ONCHAIN);
    expect(s.base).toBe(700n * WEI);
    const last = newGlideState(S1_EMISSION_WEI, BASE);
    last.minted = S1_EMISSION_WEI - 100n * WEI; last.lifetimeMinted = last.minted; last.servedBps = 10_000n;
    repegIfNeeded(last, 59, 60, ONCHAIN);
    expect(last.base).toBe((BASE * 7_000n) / 10_000n); // target 100 < lo 875 → clamp
    const dust = newGlideState(S1_EMISSION_WEI, BASE);
    dust.base = 1n; dust.minted = S1_EMISSION_WEI - 1n; dust.lifetimeMinted = dust.minted; dust.servedBps = 10_000n * 10_000n;
    repegIfNeeded(dust, 2, 60, ONCHAIN);
    expect(dust.base).toBe(1n);
  });

  test('D-20: paces against the 705M allocation when less of it is left than the season budget', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE, MINING_ALLOCATION_WEI - 6_000n * WEI);
    s.servedBps = 100n * 10_000n; // 100 units/day
    repegIfNeeded(s, 1, 60, ONCHAIN);
    expect(s.base).toBe((BASE * 7_000n) / 10_000n); // target 6,000/(59×100) ≈ 1 → clamp
  });

  test('property: next ∈ [0.7·old, 1.3·old], ≤ launch, ≥ 1, and equals the target when in band', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let i = 0; i < 2_000; i++) {
      const s = newGlideState(S1_EMISSION_WEI, S1_LAUNCH_WEI);
      s.base = BigInt(Math.floor(1 + rnd() * 1_250)) * WEI;
      s.minted = BigInt(Math.floor(rnd() * 352_500_000)) * WEI;
      s.lifetimeMinted = s.minted;
      s.servedBps = BigInt(Math.floor(1 + rnd() * 200_000)) * 10_000n;
      const epoch = 1 + Math.floor(rnd() * 59);
      const old = s.base;
      const left = s.emission - s.minted;
      repegIfNeeded(s, epoch, 60, ONCHAIN);
      if (left === 0n) { expect(s.base).toBe(old); continue; }
      const target = left / (BigInt(60 - epoch) * (s.servedBps === 0n ? s.trailing : s.trailing));
      const lo = (old * 7_000n) / 10_000n, hi = (old * 13_000n) / 10_000n;
      expect(s.base >= lo || s.base === 1n).toBe(true);
      expect(s.base <= hi || s.base === S1_LAUNCH_WEI).toBe(true);
      expect(s.base <= S1_LAUNCH_WEI).toBe(true);
      expect(s.base >= 1n).toBe(true);
      if (target >= lo && target <= hi && target <= S1_LAUNCH_WEI) expect(s.base).toBe(target);
    }
  });
});

describe('runGlideSeason', () => {
  test('ideal mode never halts and leaves little unspent under crowding (season.ts parity)', () => {
    const r = runGlideSeason({ scenario: D19_SCENARIOS[3], mode: 'ideal' });
    expect(r.exhaustionDay).toBeNull();
    expect(r.zeroIncomeDays).toBe(0);
    expect(r.unspentClaw / 352_500_000).toBeLessThan(0.01);
    expect(r.maxDayOverspendX).toBeLessThan(1.05);
  });

  test('on-chain mode: a 7-day ramp overspends the first week against the fair share (D-19 b)', () => {
    const r = runGlideSeason({ scenario: D19_SCENARIOS[3], mode: 'onchain' });
    expect(r.mintedShareByDay[6]).toBeGreaterThan(7 / 60);
    expect(r.rewardByDay[0]).toBe(1_250); // day 1 pays the launch rate whatever the crowd
    expect(r.rewardByDay[1]).toBe(875);   // day 2 can only come down 30 %
  });

  test('on-chain mode: a day-1 surge of 30,000 teams drains the budget within days', () => {
    const r = runGlideSeason({ scenario: D19_SCENARIOS[6], mode: 'onchain' });
    expect(r.exhaustionDay).not.toBeNull();
    expect(r.exhaustionDay!).toBeLessThanOrEqual(4);
    expect(r.zeroIncomeDays).toBeGreaterThan(50);
  });

  test('a per-epoch spend ceiling bounds any single day to its multiple of the fair share', () => {
    for (const scenario of D19_SCENARIOS) {
      const r = runGlideSeason({ scenario, mode: 'onchain', params: { ...ONCHAIN, epochSpendCapX: 2 } });
      expect(r.maxDayOverspendX).toBeLessThanOrEqual(2.001);
      expect(r.zeroIncomeDays).toBe(0);
    }
  });
});
