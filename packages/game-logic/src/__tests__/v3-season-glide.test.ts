import { describe, expect, test } from 'bun:test';
import {
  WEI, ONCHAIN, D19_SINGLE_EPOCH, LEGACY_DAILY, S1_EMISSION_WEI, S1_LAUNCH_WEI, MINING_ALLOCATION_WEI,
  newGlideState, repegIfNeeded, runGlideSeason, D19_SCENARIOS, SHAPE_SCENARIOS,
} from '../v3/season-glide';

const BASE = 1_250n * WEI;
const EPOCHS = 1_440; // 60 days of hourly epochs (MiningPool.SEASON_DURATION / REPEG_EPOCH)

describe('repegIfNeeded reproduces the contract', () => {
  // test/MiningPool.t.sol::test_glideRepegsDownWithDampingClamp — a 125,000 GOLD season, six Base
  // expeditions in hour 0 (7,500 GOLD minted, 6 units served), first touch of a later epoch → 70 % of 1,250.
  test('damping clamp: 1,250 → 875 on the contract\'s own vector', () => {
    const s = newGlideState(BASE * 100n, BASE);
    s.minted = 6n * BASE;
    s.lifetimeMinted = 6n * BASE;
    s.servedBps = 6n * 10_000n;
    repegIfNeeded(s, 4, EPOCHS, ONCHAIN);
    expect(s.base).toBe((BASE * 7_000n) / 10_000n);
    // D-C: the six units sit in a window of four closed epochs (three of them quiet): the published
    // average floors to 1, the target uses the sum (4 × left / (1,436 × 6) ≈ 55 → clamp) — same step.
    expect(s.trailing).toBe(1n);
    const single = newGlideState(BASE * 100n, BASE);
    single.minted = 6n * BASE; single.lifetimeMinted = 6n * BASE; single.servedBps = 6n * 10_000n;
    repegIfNeeded(single, 1, EPOCHS, ONCHAIN);
    expect(single.trailing).toBe(6n); // one closed epoch: the window is that epoch
  });

  test('D-C lazy gaps: a gap inside the window reads the skipped epochs as quiet; a longer one has no signal', () => {
    const inside = newGlideState(S1_EMISSION_WEI, BASE);
    inside.base = 700n * WEI; inside.minted = 200_000n * WEI; inside.lifetimeMinted = inside.minted; inside.servedBps = 200n * 10_000n;
    inside.lastEpoch = 1;
    repegIfNeeded(inside, 3, EPOCHS, ONCHAIN); // epochs 1 (200 units) and 2 (quiet) closed since the last touch
    expect(inside.ring).toEqual([0n, 200n, 0n, 0n]);
    expect(inside.trailing).toBe(66n); // 200 / 3 closed epochs
    expect(inside.base).toBe(910n * WEI); // target far above: +30 %
    const longer = newGlideState(S1_EMISSION_WEI, BASE);
    longer.base = 700n * WEI; longer.minted = 200_000n * WEI; longer.lifetimeMinted = longer.minted; longer.servedBps = 200n * 10_000n;
    longer.lastEpoch = 1;
    repegIfNeeded(longer, 6, EPOCHS, ONCHAIN); // five epochs: the burst is older than the window
    expect(longer.ring).toEqual([0n, 0n, 0n, 0n]);
    expect(longer.trailing).toBe(0n);
    expect(longer.base).toBe(700n * WEI); // hold
  });

  // test_D18_epochCountIncludesThisOne — the target lands in band: 1,000 per unit over the 1,439 epochs left.
  test('D-18: paces over the epochs left including this one', () => {
    const remaining = 1_000n * WEI * 1_439n * 6n;
    const s = newGlideState(remaining + 6n * BASE, BASE);
    s.minted = 6n * BASE; s.lifetimeMinted = s.minted; s.servedBps = 6n * 10_000n;
    repegIfNeeded(s, 1, EPOCHS, ONCHAIN);
    expect(s.base).toBe(1_000n * WEI);
  });

  // test_glideHoldsAtLaunchCapUnderLightDemand — full S1 budget, one Base expedition in hour 0.
  test('launch cap: one expedition against the S1 budget holds 1,250', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE);
    s.minted = BASE; s.lifetimeMinted = BASE; s.servedBps = 10_000n;
    repegIfNeeded(s, 1, EPOCHS, ONCHAIN);
    expect(s.base).toBe(BASE);
  });

  // test_glideNeverExceedsLaunchAfterAdminOverride — an above-launch override snaps back at the next re-peg.
  test('an admin override above launch snaps back to launch', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE);
    s.base = BASE * 2n;
    s.minted = BASE * 2n; s.lifetimeMinted = BASE * 2n; s.servedBps = 10_000n;
    repegIfNeeded(s, 1, EPOCHS, ONCHAIN);
    expect(s.base).toBe(BASE);
  });

  test('epoch 0 is blind and a quiet epoch holds (no demand signal)', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE);
    s.servedBps = 6n * 10_000n;
    repegIfNeeded(s, 0, EPOCHS, ONCHAIN); // same epoch as lastRepegEpoch (0): nothing happens
    expect(s.base).toBe(BASE);
    expect(s.servedBps).toBe(6n * 10_000n);
    const quiet = newGlideState(S1_EMISSION_WEI, BASE);
    repegIfNeeded(quiet, 1, EPOCHS, ONCHAIN);
    expect(quiet.base).toBe(BASE);
  });

  test('D-19(c): an exhausted budget AND a dust remainder hold the last rate; the last epoch paces over 1; dust floor', () => {
    const s = newGlideState(1_000n * WEI, BASE);
    s.base = 700n * WEI; s.minted = 1_000n * WEI; s.lifetimeMinted = s.minted; s.servedBps = 10_000n;
    repegIfNeeded(s, 1, EPOCHS, ONCHAIN);
    expect(s.base).toBe(700n * WEI);
    // test_D19_dustRemainderHoldsTheRate: half a reward left used to keep decaying 30 % a step.
    const dustLeft = newGlideState(BASE * 6n + BASE / 2n, BASE);
    dustLeft.minted = 6n * BASE; dustLeft.lifetimeMinted = dustLeft.minted; dustLeft.servedBps = 6n * 10_000n;
    repegIfNeeded(dustLeft, 1, EPOCHS, ONCHAIN);
    expect(dustLeft.base).toBe(BASE);
    // Less than one Base reward left (100 < 1,250) in the last epoch: hold, whatever the epoch count says.
    const last = newGlideState(S1_EMISSION_WEI, BASE);
    last.minted = S1_EMISSION_WEI - 100n * WEI; last.lifetimeMinted = last.minted; last.servedBps = 10_000n;
    last.lastEpoch = EPOCHS - 2;
    repegIfNeeded(last, EPOCHS - 1, EPOCHS, ONCHAIN);
    expect(last.base).toBe(BASE);
  });

  test('D-18 last epoch: with one Base reward left and a rate under it, the target is paced over exactly one epoch', () => {
    const last = newGlideState(S1_EMISSION_WEI, BASE);
    last.base = 100n * WEI; // the rate has glided down to 100
    last.minted = S1_EMISSION_WEI - 120n * WEI; last.lifetimeMinted = last.minted; last.servedBps = 10_000n;
    last.lastEpoch = EPOCHS - 2; // the epoch before was touched; the window already holds one unit an epoch
    last.ring = [1n, 1n, 1n, 1n];
    repegIfNeeded(last, EPOCHS - 1, EPOCHS, ONCHAIN);
    expect(last.base).toBe(120n * WEI); // target 120 × 4 / (1 epoch × 4 units) = 120, inside [70, 130]
    const dust = newGlideState(S1_EMISSION_WEI, BASE);
    dust.base = 1n; dust.minted = S1_EMISSION_WEI - 1n; dust.lifetimeMinted = dust.minted; dust.servedBps = 10_000n * 10_000n;
    repegIfNeeded(dust, 2, EPOCHS, ONCHAIN);
    expect(dust.base).toBe(1n);
  });

  test('D-20: paces against the 705M allocation when less of it is left than the season budget', () => {
    const s = newGlideState(S1_EMISSION_WEI, BASE, MINING_ALLOCATION_WEI - 6_000n * WEI);
    s.servedBps = 100n * 10_000n; // 100 units in the epoch before
    repegIfNeeded(s, 1, EPOCHS, ONCHAIN);
    expect(s.base).toBe((BASE * 7_000n) / 10_000n); // target 6,000/(1,439×100) ≈ 0.04 → clamp
  });

  test('property: next ∈ [0.7·old, 1.3·old], ≤ launch, ≥ 1, equals the target when in band, holds under one reward', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let i = 0; i < 2_000; i++) {
      const s = newGlideState(S1_EMISSION_WEI, S1_LAUNCH_WEI);
      s.base = BigInt(Math.floor(1 + rnd() * 1_250)) * WEI;
      s.minted = BigInt(Math.floor(rnd() * 352_500_000)) * WEI;
      s.lifetimeMinted = s.minted;
      s.servedBps = BigInt(Math.floor(1 + rnd() * 200_000)) * 10_000n;
      const epoch = 1 + Math.floor(rnd() * (rnd() < 0.8 ? 4 : EPOCHS - 1)); // mostly inside the window
      const old = s.base;
      const left = s.emission - s.minted;
      const served = s.servedBps / 10_000n;
      repegIfNeeded(s, epoch, EPOCHS, ONCHAIN);
      if (epoch > 4) { expect(s.base).toBe(old); continue; } // lastEpoch 0: a gap longer than the window holds
      if (left < old) { expect(s.base).toBe(old); continue; }
      const filled = BigInt(Math.min(4, epoch));
      expect(s.trailing).toBe(served / filled);
      const target = (left * filled) / (BigInt(EPOCHS - epoch) * served);
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
    expect(r.unspentGold / 352_500_000).toBeLessThan(0.01);
    expect(r.maxDayOverspendX).toBeLessThan(1.05);
  });

  test('before D-19: a 7-day ramp overspent the first week against the fair share (D-19 b)', () => {
    const r = runGlideSeason({ scenario: D19_SCENARIOS[3], mode: 'onchain', params: LEGACY_DAILY });
    expect(r.mintedShareByDay[6]).toBeGreaterThan(7 / 60);
    expect(r.rewardByDay[0]).toBe(1_250); // day 1 paid the launch rate whatever the crowd
    expect(r.rewardByDay[1]).toBe(875);   // day 2 could only come down 30 %
  });

  test('before D-19: a day-1 surge of 30,000 teams drained the budget within days', () => {
    const r = runGlideSeason({ scenario: D19_SCENARIOS[6], mode: 'onchain', params: LEGACY_DAILY });
    expect(r.exhaustionDay).not.toBeNull();
    expect(r.exhaustionDay!).toBeLessThanOrEqual(4);
    expect(r.zeroIncomeDays).toBeGreaterThan(50);
  });

  test('on-chain since D-19: every scenario tracks the ideal glide — first week within 1 % of it, no day over 1.5× fair, nothing dry', () => {
    for (const scenario of D19_SCENARIOS) {
      const r = runGlideSeason({ scenario, mode: 'onchain', params: ONCHAIN });
      const ideal = runGlideSeason({ scenario, mode: 'ideal' });
      // A budget spent to the last wei ON the last day is the goal, not an exhaustion.
      expect(r.exhaustionDay === null || r.exhaustionDay === 60).toBe(true);
      expect(r.zeroIncomeDays).toBe(0);
      // Against the ideal's week-one share, not the fair share: at the design rate the rate sits
      // on the launch cap and both controllers rightly spend under it.
      expect(Math.abs(r.mintedShareByDay[6] - ideal.mintedShareByDay[6])).toBeLessThan(0.01);
      // D-C: the 4-hour window lags a day-one surge by up to three hours, so the surge cases'
      // worst day moves from 1.40× / 1.47× (single-epoch) to 1.45× / 1.51× (20K / 30K teams) —
      // inside the 2× hourly ceiling, and the only surge cost of the window.
      expect(r.maxDayOverspendX).toBeLessThan(1.6);
      // The day-60 reward lands within 5 % of the ideal controller's (same population).
      expect(Math.abs(r.rewardByDay[59] / ideal.rewardByDay[59] - 1)).toBeLessThan(0.05);
    }
  }, 120_000); // 18 full seasons at hourly resolution, up to 30,000 teams each: ~5 s alone, far more under suite load

  test('the per-epoch spend ceiling bounds any single day to its multiple of the fair share of what is left, whatever the epoch', () => {
    for (const scenario of D19_SCENARIOS) {
      const r = runGlideSeason({ scenario, mode: 'onchain', params: { ...LEGACY_DAILY, epochSpendCapX: 2 } });
      // Refused starts retry later, so a day after an under-spent one may mint more than 2× the
      // NOMINAL fair day; what the ceiling bounds is each epoch's own cap (2× of what is left,
      // floored at one Apex expedition) — a day never mints more than the sum of its epochs' caps.
      expect(r.maxDayVsCapX).toBeLessThanOrEqual(1.001);
      // With one epoch per day, the second-to-last epoch's cap is 2 × left / 2 = everything left, so a
      // crowd with a backlog can drain the budget one epoch early and the last one gets nothing.
      // One epoch out of 1,440 on-chain; here one day out of 60.
      expect(r.zeroIncomeDays).toBeLessThanOrEqual(1);
    }
  });

  test('D-C: a demand window reads a phase-locked population as the same demand as a smooth one', () => {
    const smooth = runGlideSeason({ scenario: SHAPE_SCENARIOS[0], mode: 'onchain', params: { ...ONCHAIN, estimatorWindow: 24 } });
    const locked = runGlideSeason({ scenario: SHAPE_SCENARIOS[4], mode: 'onchain', params: { ...ONCHAIN, estimatorWindow: 24 } });
    const deployed = runGlideSeason({ scenario: SHAPE_SCENARIOS[4], mode: 'onchain', params: D19_SINGLE_EPOCH });
    expect(Math.abs(locked.rewardByDay[29] / smooth.rewardByDay[29] - 1)).toBeLessThan(0.05);
    expect(deployed.unspentGold).toBeGreaterThan(50_000_000); // the deployed estimator strands the budget
    expect(locked.unspentGold).toBeLessThan(1_000_000);
    // And a daily rhythm pays peak-hour and off-peak starters alike under the window, not under the deployed rule.
    const rhythmWindow = runGlideSeason({ scenario: SHAPE_SCENARIOS[5], mode: 'onchain', params: { ...ONCHAIN, estimatorWindow: 24 } });
    const rhythmDeployed = runGlideSeason({ scenario: SHAPE_SCENARIOS[5], mode: 'onchain', params: D19_SINGLE_EPOCH });
    expect(Math.abs(rhythmWindow.cohortPerUnit.ratio - 1)).toBeLessThan(0.05);
    expect(rhythmDeployed.cohortPerUnit.ratio).toBeLessThan(0.7);
  }, 120_000);
});
