import { describe, expect, test } from 'bun:test';
import { chromePixelScale } from './pixel-assets';

// One pixel size for all pixel art, chosen in device pixels (Nzib's rule, owner 2026-10-29).
describe('chromePixelScale', () => {
  const cases: [string, number, number, number, number][] = [
    ['owner\'s 13" MacBook', 1440, 755, 2, 2.5],
    ['16" MacBook Pro', 1728, 1000, 2, 3],
    ['1080p monitor', 1920, 1080, 1, 3],
    ['the Dojo probe size', 1920, 955, 1, 3],
    ['1366×768 laptop', 1366, 768, 1, 2],
    ['small laptop', 1280, 648, 1, 2],
    ['1440p monitor', 2560, 1300, 1, 4],
    ['4K monitor', 3840, 2000, 1, 7],
    ['Nzib: 2560 screen, browser zoomed to 50 %', 5120, 2600, 0.5, 8],
    ['Windows at 125 %', 1536, 864, 1.25, 2.4],
    ['Windows at 150 %', 1280, 720, 1.5, 2],
  ];
  for (const [name, w, h, dpr, want] of cases) {
    test(`${name}: ${w}×${h} @${dpr} → ${want}`, () => expect(chromePixelScale(w, h, dpr)).toBe(want));
  }

  test('always a whole number of device pixels per art pixel (crisp)', () => {
    for (const dpr of [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      for (const [w, h] of [[1280, 648], [1440, 755], [1920, 1080], [2560, 1300], [3840, 2000]]) {
        const device = chromePixelScale(w, h, dpr) * dpr;
        expect(Math.abs(device - Math.round(device))).toBeLessThan(0.01);
      }
    }
  });

  test('the expanded menu (276 art px) always fits the height above the 2× floor', () => {
    for (const [w, h, dpr] of [[2560, 1300, 1], [3840, 2000, 1], [5120, 2600, 0.5], [1920, 955, 1]]) {
      const s = chromePixelScale(w, h, dpr);
      if (s > 2) expect(276 * s).toBeLessThanOrEqual(h);
    }
  });
});
