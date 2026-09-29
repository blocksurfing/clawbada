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

/**
 * Volumes (user 2026-09-29: "the music is too loud relative to the SFX"), 0–100, separate from the on/off switches
 * above (which stay the mute — and what the harness sets). Battle music defaults to 50 (half its old level), SFX to
 * 100 (as mixed). Changes are announced on VOLUME_EVENT.
 */
export const VOLUME_EVENT = 'clawbada:volume';
const BATTLE_MUSIC_VOL_KEY = 'clawbada_battle_music_vol';
const SFX_VOL_KEY = 'clawbada_sfx_vol';
export const DEFAULT_BATTLE_MUSIC_VOL = 50;
export const DEFAULT_SFX_VOL = 100;
const readVol = (key: string, fallback: number) => {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
  } catch { return fallback; }
};
const writeVol = (key: string, v: number) => {
  const clamped = Math.min(100, Math.max(0, Math.round(v)));
  try { localStorage.setItem(key, String(clamped)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(VOLUME_EVENT));
};
export const getBattleMusicVolume = () => readVol(BATTLE_MUSIC_VOL_KEY, DEFAULT_BATTLE_MUSIC_VOL);
export const setBattleMusicVolume = (v: number) => writeVol(BATTLE_MUSIC_VOL_KEY, v);
export const getSfxVolume = () => readVol(SFX_VOL_KEY, DEFAULT_SFX_VOL);
export const setSfxVolume = (v: number) => writeVol(SFX_VOL_KEY, v);

export type AudioPrefChange =
  | { kind: 'music' | 'sfx'; on: boolean }
  | { kind: 'musicVol' | 'sfxVol'; value: number };

/** Persist an options-menu change from Unity (the echo back to Unity follows from the event). */
export function applyAudioPrefChange(p: AudioPrefChange) {
  switch (p.kind) {
    case 'music': return setBattleMusicPref(p.on);
    case 'sfx': return setSfxPref(p.on);
    case 'musicVol': return setBattleMusicVolume(p.value);
    case 'sfxVol': return setSfxVolume(p.value);
  }
}
