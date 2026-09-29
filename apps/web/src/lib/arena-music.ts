/**
 * Arena music — a looping HTML5 <audio> bed under the battle, owned by React rather than
 * Unity. Same pattern as the landing-page theme (music-toggle.tsx), and for the same reasons
 * it beats bundling: the track streams progressively (plays within a second of a 2.8 MB
 * file), is cached by the browser independently of Unity rebuilds (content-hashed URL, served
 * immutable), only the arena you enter is downloaded, and decoding is incremental instead of
 * ~69 MB of PCM per track in the WebGL heap.
 *
 * The track simply loops if a battle outlasts it (fade-out tail and all — chosen, not a bug),
 * fades in as the battle begins and out as it ends. It honours the BATTLE music preference
 * (`clawbada_battle_music`, the in-battle options menu) — separate from the site theme's (user 2026-09-28) — and
 * reacts to it live via `clawbada:battle-music`. The theme fades out as soon as a battle view opens (before Unity
 * loads) and comes back when the view closes, if the site music is on.
 */
import { ARENA_MUSIC, type ArenaTier } from './arena-music.generated';
import { getThemeAudio } from '@/components/music-toggle';
import { BATTLE_MUSIC_EVENT, getBattleMusicPref, getMusicPref } from './audio-prefs';
export { BATTLE_MUSIC_EVENT };

const GAIN = 0.35;          // under Unity's SFX at 0.5 and the theme's 0.4
const FADE_IN_MS = 1500;
const FADE_OUT_MS = 2000;

let audio: HTMLAudioElement | null = null;
let fadeTimer: number | null = null;
let activeTier: ArenaTier | null = null;   // non-null while a battle is in progress
let themeWasPlaying = false;

const log = (...a: unknown[]) => console.log('[ArenaMusic]', ...a);
const prefOff = () => !getBattleMusicPref();
const THEME_GAIN = 0.4;
const THEME_FADE_MS = 800;
let inBattleView = false;

/** True while a battle view is open (the theme stays off, whatever its toggle says). */
export function isArenaMusicActive(): boolean { return activeTier !== null || inBattleView; }

/** A battle view opened: fade the site theme out now — before Unity loads — and remember to bring it back. */
export function enterBattleView() {
  inBattleView = true;
  const theme = getThemeAudio();
  if (theme.paused) return;
  themeWasPlaying = true;
  const from = theme.volume, start = performance.now();
  const timer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / THEME_FADE_MS);
    theme.volume = from * (1 - t);
    if (t >= 1) { window.clearInterval(timer); theme.pause(); theme.volume = THEME_GAIN; log('theme faded out for the battle'); }
  }, 50);
}

/** The battle view closed: the theme returns if it was playing and the site music is still on. */
export function leaveBattleView() {
  inBattleView = false;
  if (activeTier !== null) return;   // stopArenaMusic hands back once its fade ends
  resumeThemeIfWanted();
}

function resumeThemeIfWanted() {
  if (themeWasPlaying && getMusicPref() && !inBattleView) {
    const theme = getThemeAudio();
    theme.volume = THEME_GAIN;
    theme.play().catch(() => {});
    log('theme resumed');
  }
  themeWasPlaying = false;
}

function fadeTo(target: number, ms: number, then?: () => void) {
  if (!audio) return;
  if (fadeTimer !== null) window.clearInterval(fadeTimer);
  const from = audio.volume, start = performance.now();
  fadeTimer = window.setInterval(() => {
    if (!audio) return;
    const t = Math.min(1, (performance.now() - start) / ms);
    audio.volume = from + (target - from) * t;
    if (t >= 1) { window.clearInterval(fadeTimer!); fadeTimer = null; then?.(); }
  }, 50);
}

function play(tier: ArenaTier) {
  const url = ARENA_MUSIC[tier];
  if (!url) { log(`no track for ${tier} — silent`); return; }
  if (!audio || !audio.src.endsWith(url)) {
    audio?.pause();
    audio = new Audio(url);
    audio.loop = true;
    audio.preload = 'auto';
  }
  audio.volume = 0;
  const t0 = performance.now();
  audio.play().then(() => {
    log(`${url.split('/').pop()} (${tier}) playing after ${Math.round(performance.now() - t0)} ms → fade to ${GAIN} over ${FADE_IN_MS} ms`);
    fadeTo(GAIN, FADE_IN_MS);
  }).catch((e) => log('play blocked:', e?.name ?? e));
  (window as unknown as { __clawbadaArenaMusic?: unknown }).__clawbadaArenaMusic = { audio, tier };
}

/** Call when the battle is known: starts the bed for that arena (unless music is off). */
export function startArenaMusic(tier: ArenaTier) {
  activeTier = tier;
  const theme = getThemeAudio();
  if (!theme.paused) { themeWasPlaying = true; theme.pause(); log('theme paused for the battle'); }
  if (prefOff()) { log(`battle music is off — ${tier} bed not started`); return; }
  play(tier);
}

/** Call when the battle ends or the view unmounts: fades out, then hands back to the theme. */
export function stopArenaMusic() {
  if (activeTier === null) return;
  activeTier = null;
  const resumeTheme = () => { if (!inBattleView) resumeThemeIfWanted(); };
  if (audio && !audio.paused) {
    log(`fade out over ${FADE_OUT_MS} ms`);
    fadeTo(0, FADE_OUT_MS, () => { audio?.pause(); resumeTheme(); });
  } else resumeTheme();
}

// Live reaction to the toggle: off → fade the bed out; on mid-battle → start it.
if (typeof window !== 'undefined') {
  window.addEventListener(BATTLE_MUSIC_EVENT, (e) => {
    const on = (e as CustomEvent<'on' | 'off'>).detail === 'on';
    if (activeTier === null) return;
    if (!on && audio && !audio.paused) { log('toggled off — fading out'); fadeTo(0, 600, () => audio?.pause()); }
    if (on && (!audio || audio.paused)) play(activeTier);
  });
}
