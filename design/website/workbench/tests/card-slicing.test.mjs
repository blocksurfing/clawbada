import test from 'node:test';
import assert from 'node:assert/strict';
import { tileAxis } from '../components/pixel/geometry.js';

const pixels = parts => parts.flatMap(p => Array.from({length:p.size}, (_,i)=>p.source+i));
test('16px card slices preserve grouped corners and all source pixels', () => {
  for (const length of [64,65,79,96,117,160]) {
    const parts = tileAxis(length,16,32);
    assert.deepEqual(pixels(parts), pixels(tileAxis(length,32)));
    assert.ok(parts.every(p=>p.size<=16));
    assert.deepEqual(parts.map(p=>p.dest), parts.map((_,i)=>parts.slice(0,i).reduce((s,p)=>s+p.size,0)));
  }
});
