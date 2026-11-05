import { describe, expect, test } from 'bun:test';
import { LOADING_TIPS, pickLoadingTip } from './loading-tips';

describe('loading tips', () => {
  test('thirty-one tips (Package B added the pressure tip), each under 90 characters (two lines of the GameplayTip text)', () => {
    expect(LOADING_TIPS.length).toBe(31);
    for (const t of LOADING_TIPS) expect(t.length).toBeLessThanOrEqual(90);
    expect(new Set(LOADING_TIPS).size).toBe(LOADING_TIPS.length);
  });

  test('picks from the pool with the given randomness', () => {
    expect(pickLoadingTip(() => 0)).toBe(LOADING_TIPS[0]);
    expect(pickLoadingTip(() => 0.999)).toBe(LOADING_TIPS[LOADING_TIPS.length - 1]);
  });
});
