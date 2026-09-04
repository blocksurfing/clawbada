import { describe, expect, test } from 'bun:test';
import { SCENARIOS, runSeason, type SeasonConfig } from '../v3/season';

const cfg = (over: Partial<SeasonConfig>): SeasonConfig => ({
  scenario: SCENARIOS[0], mode: 'fixed', boost: 'none', ...over,
});

describe('runSeason', () => {
  test('static sub-capacity population survives fixed reward (no upgrades)', () => {
    const r = runSeason(cfg({ scenario: { name: 'static', wallets: 750, rampDays: 7, participation: 1, retention: 0 } }));
    expect(r.exhaustionDay).toBeNull();
    expect(r.zeroIncomeDays).toBe(0);
  });
  test('tier progression alone exhausts even the design-rate population', () => {
    // Same order of population as the static case, but retaining income and upgrading:
    // per-team weight climbs 1 -> 3 -> 10 -> 25 and the budget dies mid-season.
    const r = runSeason(cfg({}));
    expect(r.exhaustionDay).not.toBeNull();
    expect(r.exhaustionDay!).toBeLessThan(60);
  });
  test('faucet-scale population exhausts a fixed-reward season early', () => {
    const r = runSeason(cfg({ scenario: SCENARIOS[2] }));
    expect(r.exhaustionDay).not.toBeNull();
    expect(r.exhaustionDay!).toBeLessThan(30);
    expect(r.zeroIncomeDays).toBeGreaterThan(20);
  });
  test('boost on the same budget accelerates exhaustion', () => {
    const none = runSeason(cfg({ scenario: SCENARIOS[2] }));
    const boosted = runSeason(cfg({ scenario: SCENARIOS[2], boost: 'same-budget' }));
    expect(boosted.exhaustionDay!).toBeLessThanOrEqual(none.exhaustionDay!);
  });
  test('glide never halts and spends the budget', () => {
    for (const scenario of SCENARIOS) {
      const r = runSeason(cfg({ scenario, mode: 'glide' }));
      expect(r.exhaustionDay).toBeNull();
      expect(r.zeroIncomeDays).toBe(0);
      expect(r.unspent / 352_500_000).toBeLessThan(0.35); // design-rate leaves headroom by cap; crowded spends ~all
    }
  });
  test('glide reward declines under crowding', () => {
    const r = runSeason(cfg({ scenario: SCENARIOS[2], mode: 'glide' }));
    const [d1, d30, d60] = r.rewardPath.map(p => p.reward);
    expect(d30).toBeLessThan(d1);
    expect(d60).toBeLessThanOrEqual(d30 * 1.05);
    expect(d60).toBeLessThan(300);
  });
  test('glide trades early-adopter front-running for a season that stays alive', () => {
    const fixed = runSeason(cfg({ scenario: SCENARIOS[2] }));
    const glide = runSeason(cfg({ scenario: SCENARIOS[2], mode: 'glide' }));
    // A day-1 team individually did BETTER front-running the fixed budget before the halt —
    // glide's benefit is the other 52 days existing for everyone, not the early cohort's optimum.
    expect(glide.day1TeamEarnings).toBeGreaterThan(fixed.day1TeamEarnings * 0.5);
    expect(glide.day1TeamEarnings).toBeLessThan(fixed.day1TeamEarnings * 1.2);
    expect(fixed.zeroIncomeDays).toBeGreaterThan(40);
    expect(glide.zeroIncomeDays).toBe(0);
  });
  test('carve mode: boost is funded from the carve, mining budget untouched by boost', () => {
    const r = runSeason(cfg({ scenario: SCENARIOS[1], mode: 'glide', boost: 'carve' }));
    expect(r.exhaustionDay).toBeNull();
  });
  test('deterministic', () => {
    const a = runSeason(cfg({ scenario: SCENARIOS[2], mode: 'glide', boost: 'carve' }));
    const b = runSeason(cfg({ scenario: SCENARIOS[2], mode: 'glide', boost: 'carve' }));
    expect(a).toEqual(b);
  });
});
