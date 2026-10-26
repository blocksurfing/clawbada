import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { cursorFrames, cursorValue } from '../components/cursor.js';
import { pixelAssets } from '../pixel-assets.js';

test('cursor frames follow the five artist cells and correct source hotspots', () => {
  assert.deepEqual(cursorFrames.map(f => f.x), [0,32,64,96,128]);
  assert.deepEqual(cursorFrames.map(f => f.hotspot), [[11,7],[11,7],[16,16],[16,16],[16,16]]);
  assert.equal(cursorValue('data:test', cursorFrames[0], 3), 'url("data:test") 33 21, default');
  assert.equal(cursorValue('data:test', cursorFrames[1], 3), 'url("data:test") 33 21, pointer');
});
test('registered cursor export dimensions and alpha tips match original PNG', () => {
  const png = PNG.sync.read(readFileSync(new URL(pixelAssets.cursor.src)));
  assert.equal(png.width, 160); assert.equal(png.height, 32);
  assert.equal(pixelAssets.cursor.width, png.width);
  assert.equal(pixelAssets.cursor.height, png.height);
  const metadata = JSON.parse(readFileSync(new URL('../../site/Misc/Cursor/cursor.json', import.meta.url), 'utf8'));
  assert.deepEqual(metadata.meta.size, { w: png.width, h: png.height });
  assert.equal(Object.keys(metadata.frames).length, cursorFrames.length);
  for (const f of cursorFrames) assert.ok(f.x + 32 <= png.width);
  assert.deepEqual(metadata.meta.frameTags.map(t => [t.name, t.from, t.to]), [
    ['Normal', 0, 0], ['Click', 1, 1], ['Loading', 2, 3], ['Not Allowed', 4, 4],
  ]);
  // Pressed art moves around the same anchor; its hotspot may be transparent.
  assert.deepEqual(cursorFrames[1].hotspot, cursorFrames[0].hotspot);
  for (const f of cursorFrames.slice(0,1)) {
    const [x,y] = f.hotspot;
    assert.ok(png.data[((y * png.width) + f.x + x) * 4 + 3] > 0);
  }
  assert.deepEqual(pixelAssets.cursor.frame, [32,32]);
});
