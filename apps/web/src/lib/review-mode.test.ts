import { describe, test, expect } from 'bun:test';
import { reviewModeOn, reviewParams, REVIEW_FLAG, REVIEW_KEYS } from './review-mode';

const store = (value: string | null) => ({ getItem: (k: string) => (k === REVIEW_FLAG ? value : null) });

describe('review mode', () => {
  test('a production build is in review mode only when this browser opted in locally', () => {
    expect(reviewModeOn(store(null), true)).toBe(false);
    expect(reviewModeOn(store('0'), true)).toBe(false);
    expect(reviewModeOn(store('yes'), true)).toBe(false);
    expect(reviewModeOn(store('1'), true)).toBe(true);
  });

  test('no storage, or storage that throws, is not an opt-in', () => {
    expect(reviewModeOn(undefined, true)).toBe(false);
    expect(reviewModeOn({ getItem: () => { throw new Error('blocked'); } }, true)).toBe(false);
  });

  test('a development build is always in review mode', () => {
    expect(reviewModeOn(store(null), false)).toBe(true);
  });
});

describe('reviewParams', () => {
  const link = '?auto=1&autodelay=900&speed=0.25&stay=1&perf=1&room=r_1&coach=1';

  test('a browser that has not opted in obeys and forwards none of them — whatever the link says', () => {
    expect([...reviewParams(link, false).keys()]).toEqual([]);
    expect(reviewParams('?auto=special', false).get('auto')).toBeNull();
  });

  test('an opted-in browser gets the review parameters, and only those', () => {
    const p = reviewParams(link, true);
    expect(Object.fromEntries(p)).toEqual({ auto: '1', autodelay: '900', speed: '0.25', stay: '1', perf: '1' });
    expect(p.has('room')).toBe(false);
    expect(p.has('coach')).toBe(false);
  });

  test('the set of review parameters', () => {
    expect([...REVIEW_KEYS]).toEqual(['auto', 'autodelay', 'speed', 'stay', 'perf']);
  });
});
