import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CURSOR_FRAMES, cursorDeclarations, cursorStylesheet, deviceFactor } from './pixel-cursor';
import { PIXEL_ASSETS } from './pixel-assets';

describe('pixel cursor', () => {
  test('frames follow the artist cells and hotspots (his cursor.test.mjs)', () => {
    expect(CURSOR_FRAMES.map((f) => f.x)).toEqual([0, 32, 64, 96, 128]);
    expect(CURSOR_FRAMES.map((f) => f.hotspot)).toEqual([[11, 7], [11, 7], [16, 16], [16, 16], [16, 16]]);
    expect(CURSOR_FRAMES.map((f) => f.fallback)).toEqual(['default', 'pointer', 'progress', 'progress', 'not-allowed']);
    // The pressed claw keeps the normal claw's anchor (72d1135).
    expect(CURSOR_FRAMES[1].hotspot).toEqual(CURSOR_FRAMES[0].hotspot);
  });

  test('the sheet on disk is 160×32, as registered', () => {
    const png = readFileSync(new URL('../../../public/ui/cursor/cursor.png', import.meta.url));
    expect(png.readUInt32BE(16)).toBe(160);
    expect(png.readUInt32BE(20)).toBe(32);
    expect([PIXEL_ASSETS.cursor.width, PIXEL_ASSETS.cursor.height]).toEqual([160, 32]);
  });

  test('whole device pixels per art pixel', () => {
    expect(deviceFactor(3, 1)).toBe(3);
    expect(deviceFactor(2.5, 2)).toBe(5);
    expect(deviceFactor(2, 2)).toBe(4);
    expect(deviceFactor(2, 1.25)).toBe(3);
  });

  test('declarations: 1× fallback at a whole scale, sharp image-set at the chrome scale', () => {
    const [plain, sharp] = cursorDeclarations(CURSOR_FRAMES[0], 3, 'data:a', 'data:b', 3);
    expect(plain).toBe('url("data:a") 33 21, default');
    expect(sharp).toBe('-webkit-image-set(url("data:b") 1x) 33 21, default');
    // 13" MacBook: 2.5× chrome on a 2× screen → a 160 px image shown at 80 CSS px, hotspot at 2.5 × source.
    const [plain25, sharp25] = cursorDeclarations(CURSOR_FRAMES[0], 2.5, 'data:a', 'data:b', 5);
    expect(plain25).toBe('url("data:a") 33 21, default');
    expect(sharp25).toBe('-webkit-image-set(url("data:b") 2x) 28 18, default');
    expect(cursorDeclarations(CURSOR_FRAMES[4], 2, 'a', 'b', 4)[1]).toBe('-webkit-image-set(url("b") 2x) 32 32, not-allowed');
  });

  test('the rule set keeps his order and stays fine-pointer only', () => {
    const d = (n: string) => [`url("${n}") 0 0, default`, `-webkit-image-set(url("${n}") 1x) 0 0, default`] as [string, string];
    const css = cursorStylesheet({ normal: d('N'), pointer: d('P'), loading0: d('L0'), loading1: d('L1'), disabled: d('D') });
    expect(css.startsWith('@media (pointer: fine)')).toBe(true);
    const order = ['"N"', 'cursor: text', '"D"', '"L0"', '"L1"', '"P"'].map((k) => css.indexOf(k));
    expect(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]))).toBe(true);
    expect(css).toContain('html[data-cursor-pressed]');
  });
});
