import { describe, expect, test } from 'bun:test';
import { musicPress, siteMusicOn } from './site-music';

describe('site music', () => {
  test('a new browser (no stored choice reads as wanted) with nothing playing shows off, and one press starts the theme', () => {
    const on = siteMusicOn(true, false, false);
    expect(on).toBe(false);
    expect(musicPress(on, false)).toBe('start');
  });
  test('a stored "on" the browser would not autoplay is the same: off, and one press starts it', () => {
    expect(musicPress(siteMusicOn(true, false, false), false)).toBe('start');
  });
  test('a playing theme shows on, and a press stops it', () => {
    const on = siteMusicOn(true, true, false);
    expect(on).toBe(true);
    expect(musicPress(on, false)).toBe('stop');
  });
  test('a theme silenced for a battle and due back still shows on, and a press switches it off', () => {
    const on = siteMusicOn(true, false, true);
    expect(on).toBe(true);
    expect(musicPress(on, true)).toBe('stop');
  });
  test('switched off, it shows off whatever else is true', () => {
    expect(siteMusicOn(false, false, true)).toBe(false);
    expect(siteMusicOn(false, true, false)).toBe(false);
  });
  test('inside a battle a press never starts the theme: it is marked to come in afterwards', () => {
    expect(musicPress(false, true)).toBe('start-after-battle');
  });
});
