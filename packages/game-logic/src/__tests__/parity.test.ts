/**
 * S2 cross-implementation parity (Known-Answer Tests).
 *
 * These vectors are asserted IDENTICALLY against the Solidity library in
 * contracts/test/fuzz/FuzzBattleResolver.t.sol :: test_S2_parity_knownAnswers.
 * If the TypeScript engine and BattleResolver.sol ever diverge from these canonical
 * values (or from each other), one side's KAT fails — locking Solidity⇄TS parity in CI
 * ahead of the S2 BattleResolver.replay() port.
 *
 * Scope: the pure combat math + vrfRollFromRandom (pure in `rand`), which are
 * language-independent. deriveRandom's salt encoding (bytes32 vs string) is the deferred
 * S2 prerequisite (see docs/audits/2026-06-10-fable5-deep-campaign.md) and is intentionally
 * NOT cross-asserted here — pick a canonical salt encoding when replay() is designed.
 */

import { describe, test, expect } from 'bun:test';

import {
  calculateAttackDamage,
  calculateDefendCounter,
  calculateSpecialDamage,
  critChance,
  enhancedProcChance,
  getBaseStats,
  getClassAdvantage,
  scaleStats,
} from '../battle-resolver';
import {
  CLASS_ADV_MULT,
  CLASS_DISADV_MULT,
  CLASS_NEUTRAL_MULT,
  VRF_MAX,
  VRF_MIN,
  VRF_SPAN,
} from '../constants';
import { vrfRollFromRandom } from '../hash';
import { EvolutionTier, LobsterClass } from '../types';

describe('S2 parity — known-answer vectors (mirror of Solidity test_S2_parity_knownAnswers)', () => {
  test('scaleStats: Bulwark @ Apex + legend', () => {
    const s = scaleStats(getBaseStats(LobsterClass.Bulwark), EvolutionTier.Apex, true);
    expect(s.hp).toBe(6160n);
    expect(s.attack).toBe(123n);
    expect(s.armor).toBe(211n);
    expect(s.speed).toBe(140n);
    expect(s.critical).toBe(158n);
  });

  test('calculateAttackDamage(200, 100, ADV, crit, 1000) === 375', () => {
    expect(calculateAttackDamage(200n, 100n, CLASS_ADV_MULT, true, 1000n)).toBe(375n);
  });

  test('calculateSpecialDamage(150, 200, 100, NEUTRAL, purity 6, 1150) === 552', () => {
    expect(calculateSpecialDamage(150n, 200n, 100n, CLASS_NEUTRAL_MULT, 6, 1150n)).toBe(552n);
  });

  test('calculateDefendCounter(150, 120, DISADV, 900) === 27', () => {
    expect(calculateDefendCounter(150n, 120n, CLASS_DISADV_MULT, 900n)).toBe(27n);
  });

  test('critChance(130) === 3939', () => {
    expect(critChance(130n)).toBe(3939n);
  });

  test('enhancedProcChance: in-spec and capped', () => {
    expect(enhancedProcChance(6)).toBe(3500n);
    expect(enhancedProcChance(20)).toBe(10_000n); // R-06 cap parity
  });

  test('vrfRollFromRandom(12345) === 854', () => {
    expect(vrfRollFromRandom(12345n)).toBe(854n);
  });

  test('getClassAdvantage: adv / neutral / disadv', () => {
    expect(getClassAdvantage(LobsterClass.Bulwark, LobsterClass.Mantis)).toBe(CLASS_ADV_MULT); // 0 vs 1
    expect(getClassAdvantage(0 as LobsterClass, 5 as LobsterClass)).toBe(CLASS_NEUTRAL_MULT);
    expect(getClassAdvantage(0 as LobsterClass, 6 as LobsterClass)).toBe(CLASS_DISADV_MULT);
  });
});

describe('F5-04 — canonical VRF roll mapping', () => {
  test('inclusive endpoints: VRF_MAX is reachable', () => {
    expect(vrfRollFromRandom(0n)).toBe(VRF_MIN);
    expect(vrfRollFromRandom(VRF_SPAN - 1n)).toBe(VRF_MAX); // 300 -> 1150
    expect(vrfRollFromRandom(VRF_SPAN)).toBe(VRF_MIN); // 301 wraps
  });

  test('always within [VRF_MIN, VRF_MAX]', () => {
    for (let i = 0; i < 1000; i++) {
      const roll = vrfRollFromRandom(BigInt(i) * 7919n + 13n);
      expect(roll >= VRF_MIN && roll <= VRF_MAX).toBe(true);
    }
  });
});

describe('F5-04 — scaleStats fails closed on invalid tier', () => {
  test('tier outside {0,1,2,3} throws (matches Solidity InvalidTier revert)', () => {
    expect(() => scaleStats(getBaseStats(LobsterClass.Bulwark), 4 as EvolutionTier, false)).toThrow();
  });
});
