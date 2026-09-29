/**
 * Site-wide audio preferences — the single source of truth for "site music on/off", "battle music on/off" and
 * "SFX on/off". Site music (the theme) and battle music (the arena bed) are SEPARATE controls (user 2026-09-28). Persisted in localStorage; every change is announced as a window event so
 * the pieces that act on them stay in sync without knowing about each other:
 *   music → arena-music.ts (battle bed) and music-toggle.tsx (theme + icon)
 *   sfx   → BattleStage.tsx pushes both to Unity, whose BattleSfx.Enabled obeys it
 * The in-battle options menu (Unity) is a *view* of these: a row press comes back through
 * onAudioPref, is persisted here, and the echo refreshes its labels.
 * Absent = on for both.
 */
export const MUSIC_EVENT = 'clawbada:music';
/** Battle music (the arena bed) is its own control (user 2026-09-28): the site theme being off must not mute battles. */
export const BATTLE_MUSIC_EVENT = 'clawbada:battle-music';
export const SFX_EVENT = 'clawbada:sfx';
const MUSIC_KEY = 'clawbada_music';
const BATTLE_MUSIC_KEY = 'clawbada_battle_music';
const SFX_KEY = 'clawbada_sfx';

const read = (key: string) => { try { return localStorage.getItem(key) !== 'off'; } catch { return true; } };
const write = (key: string, on: boolean, event: string) => {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent<'on' | 'off'>(event, { detail: on ? 'on' : 'off' }));
};

/** The site theme (music-toggle.tsx). */
export const getMusicPref = () => read(MUSIC_KEY);
/** The battle bed (arena-music.ts) — the in-battle options menu's Music row. */
export const getBattleMusicPref = () => read(BATTLE_MUSIC_KEY);
export const setBattleMusicPref = (on: boolean) => write(BATTLE_MUSIC_KEY, on, BATTLE_MUSIC_EVENT);
export const getSfxPref = () => read(SFX_KEY);
export const setMusicPref = (on: boolean) => write(MUSIC_KEY, on, MUSIC_EVENT);
export const setSfxPref = (on: boolean) => write(SFX_KEY, on, SFX_EVENT);
export type AudioPrefChange = { kind: 'music' | 'sfx'; on: boolean };
