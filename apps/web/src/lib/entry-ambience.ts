/**
 * The breeze under the web loading loop — a gentle ambient bed that fades in as the Shifu screen fades in from the
 * navy curtain and fades out at the handover to the Unity training scene (owner 2026-10-23). Same HTML5 <audio>
 * pattern as the arena bed (arena-music.ts): streamed from a content-hashed file, never in the Unity bundle.
 *
 * THE TRACK IS A PLACEHOLDER until its master exists. The name is fixed here so the drop needs no code:
 *   audio-masters/music/AMB_Loading_Breeze.wav  →  bun scripts/build-music.ts  →  /audio/music/AMB_Loading_Breeze.<hash>.m4a
 *   → ENTRY_AMBIENCE in arena-music.generated.ts (null today, so the entry is silent and says so in the console).
 *
 * It belongs to the battle, so it follows the BATTLE music preference and volume (the in-battle options menu's
 * Music row), exactly like the arena bed — not the site theme's toggle (user 2026-09-28: separate controls).
 */
import { ENTRY_AMBIENCE } from './arena-music.generated';
import { BATTLE_MUSIC_EVENT, DEFAULT_BATTLE_MUSIC_VOL, VOLUME_EVENT, getBattleMusicPref, getBattleMusicVolume } from './audio-prefs';

/** The breeze's level at the DEFAULT battle volume (owner 2026-10-23: wind volume 95%); the volume row
 *  still scales it (0.95 × volume / 50), capped at full. */
const DEFAULT_GAIN = 0.95;
/** Fade in with the loop, fade out at the hand-over (owner 2026-10-23: 1 s each). */
export const BREEZE_FADE_IN_MS = 1000;
export const BREEZE_FADE_OUT_MS = 1000;
const CANCEL_FADE_MS = 300;

const gain = () => Math.min(1, DEFAULT_GAIN * getBattleMusicVolume() / DEFAULT_BATTLE_MUSIC_VOL);
const log = (...a: unknown[]) => console.log('[EntryAmbience]', ...a);

let audio: HTMLAudioElement | null = null;
let fadeTimer: number | null = null;
let startTimer: number | null = null;
let active = false;                      // between startEntryAmbience and stopEntryAmbience

function element(): HTMLAudioElement | null {
  if (!ENTRY_AMBIENCE) return null;
  if (!audio) {
    audio = new Audio(ENTRY_AMBIENCE);
    audio.loop = true;
    audio.preload = 'auto';
  }
  return audio;
}

function fadeTo(target: number, ms: number, then?: () => void) {
  if (!audio) return;
  if (fadeTimer !== null) window.clearInterval(fadeTimer);
  const from = audio.volume, start = performance.now();
  fadeTimer = window.setInterval(() => {
    if (!audio) return;
    const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
    audio.volume = from + (target - from) * t;
    if (t >= 1) { window.clearInterval(fadeTimer!); fadeTimer = null; then?.(); }
  }, 50);
}

function play() {
  startTimer = null;
  const el = element();
  if (!active || !el) return;
  if (fadeTimer !== null) { window.clearInterval(fadeTimer); fadeTimer = null; }
  el.volume = 0;
  try { el.currentTime = 0; } catch { /* not loaded yet: it starts from 0 anyway */ }
  const t0 = performance.now();
  el.play().then(() => {
    log(`${ENTRY_AMBIENCE!.split('/').pop()} playing after ${Math.round(performance.now() - t0)} ms → fade to ${gain().toFixed(3)} over ${BREEZE_FADE_IN_MS} ms`);
    fadeTo(gain(), BREEZE_FADE_IN_MS);
  }).catch((e) => log('play blocked:', e?.name ?? e));
}

/** Create the element early (the overlay's mount) so the first press plays without a fetch in the way. */
export function preloadEntryAmbience() {
  element();
}

/** The entry started: the breeze begins after `delayMs` (the navy curtain), fading in. No-op while one is active. */
export function startEntryAmbience(delayMs = 0) {
  if (active) return;
  active = true;
  (window as unknown as { __clawbadaEntryAmbience?: unknown }).__clawbadaEntryAmbience = { url: ENTRY_AMBIENCE, get audio() { return audio; } };
  if (!ENTRY_AMBIENCE) { log('no breeze track yet (AMB_Loading_Breeze) — the entry is silent'); return; }
  if (!getBattleMusicPref()) { log('battle music is off — breeze not started'); return; }
  if (startTimer !== null) window.clearTimeout(startTimer);
  startTimer = window.setTimeout(play, delayMs);
}

/** The loop is leaving (the handover to the Unity training scene) or was cancelled: fade out and stop. */
export function stopEntryAmbience(fadeMs = BREEZE_FADE_OUT_MS) {
  if (!active) return;
  active = false;
  if (startTimer !== null) { window.clearTimeout(startTimer); startTimer = null; }
  if (audio && !audio.paused) { log(`fade out over ${fadeMs} ms`); fadeTo(0, fadeMs, () => audio?.pause()); }
}

/** A cancelled entry (the start failed, Unity unavailable, the page left): a quick fade, not the handover's. */
export function cancelEntryAmbience() {
  stopEntryAmbience(CANCEL_FADE_MS);
}

// Live reaction to the battle-music toggle and the volume row while the loop is up (the arena bed does the same).
if (typeof window !== 'undefined') {
  window.addEventListener(BATTLE_MUSIC_EVENT, (e) => {
    const on = (e as CustomEvent<'on' | 'off'>).detail === 'on';
    if (!active || !ENTRY_AMBIENCE) return;
    if (!on && audio && !audio.paused) { log('toggled off — fading out'); fadeTo(0, 600, () => audio?.pause()); }
    if (on && (!audio || audio.paused) && startTimer === null) play();
  });
  window.addEventListener(VOLUME_EVENT, () => {
    if (!active || !audio || audio.paused) return;
    fadeTo(gain(), 200);
  });
}
