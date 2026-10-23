import test from 'node:test';
import assert from 'node:assert/strict';
import { loadingFrame, frameDurations } from '../components/loading-timeline.js';
test('Aseprite loading timeline preserves 10 x 100ms frames and loops', () => {
 assert.equal(frameDurations.length,10);
 for(let i=0;i<10;i++) { assert.equal(loadingFrame(i*100),i); assert.equal(loadingFrame(i*100+99),i); }
 assert.equal(loadingFrame(1000),0); assert.equal(loadingFrame(1200),2);
});
test('variable durations and negative elapsed', () => {
 assert.equal(loadingFrame(-1),0); assert.equal(loadingFrame(150,[100,200]),1); assert.equal(loadingFrame(300,[100,200]),0);
});
