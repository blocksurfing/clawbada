import { describe, expect, test } from 'bun:test';
import { frameDurations, loadingFrame } from './loading-timeline';

// Nzib's own test from design/website/workbench/tests/loading-timeline.test.mjs, kept with the port.
describe('loading timeline (Aseprite, 10 × 100 ms, loops)', () => {
  test('preserves ten frames and loops', () => {
    expect(frameDurations.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(loadingFrame(i * 100)).toBe(i);
      expect(loadingFrame(i * 100 + 99)).toBe(i);
    }
    expect(loadingFrame(1000)).toBe(0);
    expect(loadingFrame(1200)).toBe(2);
  });

  test('variable durations and negative elapsed', () => {
    expect(loadingFrame(-1)).toBe(0);
    expect(loadingFrame(150, [100, 200])).toBe(1);
    expect(loadingFrame(300, [100, 200])).toBe(0);
  });
});
