import test from 'node:test';
import assert from 'node:assert/strict';
import { paintDojoSign } from '../components/dojo-sign.js';
import { pixelAssets } from '../pixel-assets.js';
import { pixelSourceWatch } from '../tools/pixel-source-watch.js';

test('Dojo sign keeps 32px caps and repeats/clips only the 16px middle', () => {
  for (const width of [80, 91, 128, 153]) {
    const calls = [];
    const image = {};
    const ctx = { clearRect() {}, drawImage(...args) { calls.push(args); } };
    paintDojoSign(ctx, image, width);
    assert.equal(ctx.imageSmoothingEnabled, false);
    assert.deepEqual(calls[0], [image, 0, 0, 32, 64, 0, 0, 32, 64]);
    assert.deepEqual(calls.at(-1), [image, 48, 0, 32, 64, width - 32, 0, 32, 64]);
    let end = 32;
    for (const [, sx, sy, sw, sh, dx, dy, dw, dh] of calls.slice(1, -1)) {
      assert.equal(sx, 32); assert.equal(sy, 0); assert.equal(dy, 0);
      assert.equal(sw, dw); assert.equal(sh, dh); assert.equal(sh, 64);
      assert.ok(sw <= 16); assert.equal(dx, end); end += dw;
    }
    assert.equal(end, width - 32);
  }
});
test('Dojo sign source registration validates original export', () => {
  const watched = [];
  pixelSourceWatch({ dojoSign: pixelAssets.dojoSign }).buildStart.call({ addWatchFile(file) { watched.push(file); } });
  assert.equal(watched.length, 1);
  assert.match(watched[0], /The Dojo\/Wooden_Sign.png$/);
});
