/**
 * The Victory / Defeat stingers under Unity's result screen (owner 2026-10-28). Same HTML5 <audio> pattern as the
 * arena bed and the breeze: content-hashed files from scripts/build-music.ts, never in the Unity bundle.
 *
 *   audio-masters/music/BGM_Result_Victory.wav, BGM_Result_Defeat.wav  →  bun scripts/build-music.ts
 *   → RESULT_MUSIC in arena-music.generated.ts (null until a master exists: that result is silent and says so).
 *
 * They follow the SFX switch and the SFX volume (owner 2026-10-28), not the Music row — the owner plays with battle
 * music off. Played once (no loop); the page leaves 8 s after the result appears (LiveBattle RETURN_SECONDS) and
 * fades the stinger out on the way.
 */
import { RESULT_MUSIC } from './arena-music.generated';
import { SFX_EVENT, getSfxPref, getSfxVolume } from './audio-prefs';
import { fadeLevel, isSmooth, levelOf, setLevel } from './audio-graph';

export type ResultKind = 'victory' | 'defeat';

/** At 100 % SFX volume: level with Unity's own SFX (0.5), above the arena bed's 0.35. */
const RESULT_GAIN = 0.5;
const FADE_IN_MS = 250;
export const RESULT_FADE_OUT_MS = 1000;

const log = (...a: unknown[]) => console.log('[ResultMusic]', ...a);
const gain = () => RESULT_GAIN * (getSfxVolume() / 100);

let audio: HTMLAudioElement | null = null;
let playing: ResultKind | null = null;

/** Create both elements' first fetch early (the battle page mounts long before the result), so it starts on cue. */
export function preloadResultMusic() {
  for (const url of Object.values(RESULT_MUSIC)) {
    if (!url) continue;
    const el = new Audio(url);
    el.preload = 'auto';
  }
}

export function playResultMusic(kind: ResultKind) {
  const url = RESULT_MUSIC[kind];
  (window as unknown as { __clawbadaResultMusic?: unknown }).__clawbadaResultMusic = { kind, url, get audio() { return audio; }, get level() { return audio ? levelOf(audio) : null; }, get smooth() { return audio ? isSmooth(audio) : false; } };
  if (!url) { log(`no ${kind} track yet (BGM_Result_${kind === 'victory' ? 'Victory' : 'Defeat'}) — silent`); return; }
  if (!getSfxPref()) { log(`sound effects are off — ${kind} not played`); return; }
  stopResultMusic(0);
  const el = new Audio(url);
  el.loop = false;
  el.addEventListener('ended', () => log(`${kind} track finished`), { once: true });
  audio = el;
  playing = kind;
  setLevel(el, 0);
  el.play().then(() => {
    log(`${url.split('/').pop()} playing → fade to ${gain().toFixed(3)} over ${FADE_IN_MS} ms`);
    fadeLevel(el, gain(), FADE_IN_MS);
  }).catch((e) => log('play blocked:', e?.name ?? e));
}

/** The page is leaving the result (auto-return, Back now, unmount): fade out and stop. */
export function stopResultMusic(fadeMs = RESULT_FADE_OUT_MS) {
  const el = audio;
  if (!el) return;
  audio = null;
  playing = null;
  if (el.paused) return;
  if (fadeMs <= 0) { el.pause(); return; }
  log(`fade out over ${fadeMs} ms`);
  fadeLevel(el, 0, fadeMs, () => el.pause());
}

// Turning sound effects off while a stinger plays silences it.
if (typeof window !== 'undefined') {
  window.addEventListener(SFX_EVENT, (e) => {
    if ((e as CustomEvent<'on' | 'off'>).detail === 'off' && playing) { log('toggled off — fading out'); stopResultMusic(300); }
  });
}
