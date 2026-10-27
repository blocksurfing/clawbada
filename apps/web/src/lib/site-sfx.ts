/**
 * The website's own UI sounds (outside the Unity battle): the sidebar pole and the wallet wheel opening and closing,
 * the Shell's three rocks, and the UI selection taps (owner 2026-10-26/27).
 * Files come from scripts/build-sfx.ts (audio-masters/sfx/SFX_UI_*.wav → content-hashed m4a, site-sfx.generated.ts).
 *
 * They obey the same SFX switch and volume as the battle sounds (audio-prefs.ts), at the level Unity mixes its own SFX
 * (0.5 of the volume row). Each sound is one preloaded <audio> element: a press restarts it, and `cut` stops the sounds
 * it replaces (open cuts close and back), so quick presses never stack.
 */
import { getSfxPref, getSfxVolume } from './audio-prefs';
import { SITE_SFX, type SiteSfx } from './site-sfx.generated';

export type { SiteSfx };
/** Level at 100 % SFX volume — Unity's battle SFX mix (arena-music.ts sits its bed under that). */
export const SITE_SFX_GAIN = 0.5;

const elements = new Map<SiteSfx, HTMLAudioElement>();
function element(name: SiteSfx): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  let el = elements.get(name);
  if (!el) {
    el = new Audio(SITE_SFX[name]);
    el.preload = 'auto';
    elements.set(name, el);
  }
  return el;
}

/** Fetch the files ahead of the first press (a click sound must not wait on the network). */
export function preloadSiteSfx(...names: SiteSfx[]): void {
  for (const n of names) element(n)?.load();
}

/** Play a UI sound now (call it from the click). Silent when the SFX switch is off or its volume is 0. */
export function playSiteSfx(name: SiteSfx, opts: { cut?: SiteSfx[] } = {}): void {
  if (!getSfxPref()) return;
  const volume = (getSfxVolume() / 100) * SITE_SFX_GAIN;
  if (volume <= 0) return;
  for (const other of opts.cut ?? []) {
    const o = elements.get(other);
    if (o && !o.paused) { o.pause(); o.currentTime = 0; }
  }
  const el = element(name);
  if (!el) return;
  el.volume = volume;
  el.currentTime = 0;
  void el.play().catch(() => { /* autoplay refused outside a gesture: stay silent */ });
}

/** The UI selection taps (owner 2026-10-27): one of five, picked at random, never the same twice in a row — sidebar
 *  pages, the Shell's Queue / Active / History tabs and lobster picker, the Dojo's tabs. */
export const UI_CLICKS = ['click01', 'click02', 'click03', 'click04', 'click05'] as const satisfies readonly SiteSfx[];
let lastClick = -1;
/** The next tap from the pool (exported for the tests; `random` is injectable). */
export function nextClick(random: () => number = Math.random): (typeof UI_CLICKS)[number] {
  let i = Math.floor(random() * (lastClick < 0 ? UI_CLICKS.length : UI_CLICKS.length - 1));
  if (lastClick >= 0 && i >= lastClick) i++;
  lastClick = i;
  return UI_CLICKS[i];
}
/** Play a selection tap (call it from the click that changes something). */
export function playUiClick(): void {
  playSiteSfx(nextClick(), { cut: [...UI_CLICKS] });
}
export const preloadUiClicks = () => preloadSiteSfx(...UI_CLICKS);
