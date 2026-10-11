import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const moduleURL = new URL('../components/pixel/geometry.js', import.meta.url);
test('pixel grid uses integer scale, whole-pixel tile clipping and non-fractional tracks', async () => {
  assert.ok(existsSync(moduleURL), 'shared pixel geometry exists');
  const { gridTracks, tileAxis, frameRect } = await import(moduleURL);
  for (const width of [354, 699, 1057, 1213]) {
    const g = gridTracks(width, 3, 24, 270, 3);
    assert.ok(g.columns >= 1 && g.columns <= 3);
    assert.equal(g.width % 3, 0);
    assert.ok(g.columns*g.width+(g.columns-1)*24 <= width);
  }
  const segments = tileAxis(53, 16);
  assert.deepEqual(segments, [{source:0,dest:0,size:16},{source:16,dest:16,size:16},{source:16,dest:32,size:5},{source:32,dest:37,size:16}]);
  assert.deepEqual(frameRect({width:192,height:16,frame:[16,16]},8), {x:128,y:0,width:16,height:16});
  assert.throws(() => frameRect({width:192,height:16,frame:[16,16]},12));
});
