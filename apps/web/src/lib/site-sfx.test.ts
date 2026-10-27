import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_SFX } from './site-sfx.generated';
import { sfxKey } from '../../../../scripts/build-sfx';

describe('site sfx', () => {
  test('the sidebar and the wallet wheel have their open and close sounds', () => {
    expect(Object.keys(SITE_SFX).sort()).toEqual(['sidebarClose', 'sidebarOpen', 'wheelClose', 'wheelOpen']);
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
