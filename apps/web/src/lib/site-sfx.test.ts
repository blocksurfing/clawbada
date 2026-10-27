import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_SFX } from './site-sfx.generated';
import { UI_CLICKS, nextClick } from './site-sfx';
import { sfxKey } from '../../../../scripts/build-sfx';

describe('site sfx', () => {
  test('the sidebar, the wallet wheel, the three Shell rocks and the five taps have their sounds', () => {
    expect(Object.keys(SITE_SFX).sort()).toEqual(['click01', 'click02', 'click03', 'click04', 'click05', 'rock01', 'rock02', 'rock03', 'sidebarClose', 'sidebarOpen', 'wheelClose', 'wheelOpen']);
  });
  test('taps come from all five, never the same one twice in a row', () => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const picks = Array.from({ length: 500 }, () => nextClick(random));
    expect(new Set(picks).size).toBe(UI_CLICKS.length);
    expect(picks.every((p, i) => i === 0 || p !== picks[i - 1])).toBe(true);
    // The extremes of random() stay in range.
    expect(UI_CLICKS).toContain(nextClick(() => 0));
    expect(UI_CLICKS).toContain(nextClick(() => 0.9999999));
  });
  test('every generated URL is a built, content-hashed file in public/', () => {
    for (const url of Object.values(SITE_SFX)) {
      expect(url).toMatch(/^\/audio\/sfx\/SFX_UI_[A-Za-z0-9_]+\.[0-9a-f]{8}\.m4a$/);
      expect(existsSync(join(import.meta.dir, '../../public', url))).toBe(true);
    }
  });
  test('master names map to camelCase keys', () => {
    expect(sfxKey('SFX_UI_Sidebar_Open')).toBe('sidebarOpen');
    expect(sfxKey('SFX_UI_Sidebar_Close')).toBe('sidebarClose');
    expect(sfxKey('SFX_UI_Click')).toBe('click');
  });
});
