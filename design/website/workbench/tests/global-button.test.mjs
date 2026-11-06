import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelAssets } from '../pixel-assets.js';
import { readFileSync } from 'node:fs';
test('Enter Dojo uses the shared global button tileset', () => {
 assert.ok(pixelAssets.globalButton);
 assert.deepEqual(pixelAssets.globalButton.region, [0,0,48,48]);
 assert.equal(pixelAssets.globalButton.tile,16);
 assert.deepEqual(pixelAssets.globalButton.pressedRegion, [48,0,48,48]);
 const code=readFileSync(new URL('../coming-soon.js',import.meta.url),'utf8');
 assert.match(code,/data-pixel-panel="globalGoldenButton"/);
 assert.deepEqual(pixelAssets.globalGoldenButton.region, [96,0,48,48]);
 assert.deepEqual(pixelAssets.globalGoldenButton.pressedRegion, [144,0,48,48]);
});
