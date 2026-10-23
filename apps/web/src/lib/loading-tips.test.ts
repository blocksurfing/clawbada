import { describe, expect, test } from 'bun:test';
import { LOADING_TIPS, pickLoadingTip } from './loading-tips';

describe('loading tips', () => {
  test('thirty tips, each under 90 characters (two lines of the GameplayTip text)', () => {
    expect(LOADING_TIPS.length).toBe(30);
    for (const t of LOADING_TIPS) expect(t.length).toBeLessThanOrEqual(90);
    expect(new Set(LOADING_TIPS).size).toBe(30);
  });

  test('picks from the pool with the given randomness', () => {
    expect(pickLoadingTip(() => 0)).toBe(LOADING_TIPS[0]);
    expect(pickLoadingTip(() => 0.999)).toBe(LOADING_TIPS[29]);
  });
});
