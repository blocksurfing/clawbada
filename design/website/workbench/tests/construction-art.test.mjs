import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('coming soon mounts the artist animation above the heading', () => {
  const code = readFileSync(new URL('../coming-soon.js', import.meta.url), 'utf8');
  assert.ok(code.includes('construction-art'));
  assert.ok(code.indexOf('<div class="construction-art"') < code.indexOf('<h1'));
  assert.ok(code.includes('Under Construction.png'));
  const data = JSON.parse(readFileSync(new URL('../../site/Under Construction/Under Construction.json', import.meta.url)));
  assert.equal(data.frames.length, 4);
  assert.ok(data.frames.every(f => f.duration === 100 && f.frame.w === 123 && f.frame.h === 46));
});
