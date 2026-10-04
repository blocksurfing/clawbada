import { describe, test, expect } from 'bun:test';
import { stakeFor, stakesFor, stakeReferenceWei } from '../stakes';
import { LAUNCH_STAKES } from '../constants';

const C = 10n ** 18n;

/** The same hand-computed vectors as test/BattleArenaStakePeg.t.sol (the human check). */
const VECTORS: Array<[bigint, [bigint, bigint, bigint]]> = [
  [1_250n, [2_500n, 10_000n, 50_000n]],
  [625n, [1_500n, 6_000n, 30_000n]],
  [163n, [760n, 3_043n, 15_216n]],
  [80n, [628n, 2_512n, 12_560n]],
  [49n, [578n, 2_313n, 11_568n]],
  [25n, [540n, 2_160n, 10_800n]],
  [0n, [2_500n, 10_000n, 50_000n]],
];

describe('stakeFor (D-E damped live peg — mirror of BattleArena.stakeFor)', () => {
  test('matches the contract vectors at the provisional 20 % fixed share', () => {
    for (const [ref, want] of VECTORS) {
      expect([...stakesFor(ref * C)]).toEqual(want.map((w) => w * C));
    }
  });

  test('fixed-share endpoints and a 10 % share', () => {
    expect(stakesFor(625n * C, 10_000n)).toEqual([2_500n * C, 10_000n * C, 50_000n * C]);
    expect(stakesFor(625n * C, 0n)).toEqual([1_250n * C, 5_000n * C, 25_000n * C]);
    expect(stakesFor(163n * C, 1_000n)).toEqual([543n * C, 2_173n * C, 10_868n * C]);
  });

  test('fallback order: daily sample, then the live rate, then genesis; capped at genesis', () => {
    expect(stakeFor(0, 0n, 2_000n, 800n * C)).toBe(1_780n * C);
    expect(stakeFor(0, 900n * C, 2_000n, 500n * C)).toBe(1_940n * C);
    expect(stakeFor(0, 0n, 2_000n, 0n)).toBe(2_500n * C);
    expect(stakeFor(2, 3_000n * C)).toBe(50_000n * C);
    expect(stakeReferenceWei(0n, 3_000n * C)).toBe(1_250n * C);
  });

  test('whole CLAW, never above launch, monotone in the reference', () => {
    let prev = [0n, 0n, 0n];
    for (let ref = 1n; ref <= 1_250n; ref += 7n) {
      const s = stakesFor(ref * C);
      for (let b = 0; b < 3; b++) {
        expect(s[b] % C).toBe(0n);
        expect(s[b]).toBeLessThanOrEqual(LAUNCH_STAKES[b] * C);
        expect(s[b]).toBeGreaterThanOrEqual(prev[b]);
      }
      prev = s;
    }
  });

  test('rejects a bad bracket or share', () => {
    expect(() => stakeFor(3, 1_250n * C)).toThrow('Invalid stake bracket');
    expect(() => stakeFor(0, 1_250n * C, 10_001n)).toThrow('Invalid stake fixed share');
  });
});
