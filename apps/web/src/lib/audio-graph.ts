/**
 * Smooth fades for the site's <audio> beds (the loading-screen breeze, the arena music). A fade used to be a main-thread
 * timer nudging `el.volume` every 50 ms; when the page froze — the Dojo → battle page switch blocks it for 0.3–0.7 s,
 * exactly as the music's fade-in ends — the ramp stalled and then jumped, an audible stutter (owner 2026-10-26: "a
 * stutter as soon as the fade in ends", ~2 s after Train).
 *
 * Here each element plays through one shared AudioContext (MediaElementSource → GainNode → speakers) and a fade is a
 * gain ramp scheduled on the AUDIO thread, which no page work can interrupt. The context is created and resumed inside
 * the Train click (primeAudio) — browsers only start audio from a gesture — which also wakes the output before any
 * sound plays. Until a running context exists (a battle page reloaded without a click), elements keep the old
 * `el.volume` timer; an element is only ever routed through the context while it is running, so it can never go silent.
 */
let ctx: AudioContext | null = null;
const log = (...a: unknown[]) => console.log('[AudioGraph]', ...a);
const nameOf = (el: HTMLMediaElement) => (el.currentSrc || el.src).split('/').pop();
const gains = new WeakMap<HTMLMediaElement, GainNode>();
/** The automation we scheduled on each gain. Reading `gain.value` right after scheduling returns the OLD value until the
 *  audio thread catches up — a fade-in that started from that stale reading began at full volume and ramped DOWN. The
 *  current level is computed from this record instead. */
interface Ramp { from: number; to: number; t0: number; t1: number }
const ramps = new WeakMap<HTMLMediaElement, Ramp>();
function rampLevel(r: Ramp, now: number): number {
  if (now >= r.t1 || r.t1 <= r.t0) return r.to;
  if (now <= r.t0) return r.from;
  return r.from + (r.to - r.from) * ((now - r.t0) / (r.t1 - r.t0));
}
const timers = new WeakMap<HTMLMediaElement, { interval?: number; done?: number }>();

/** Create / resume the shared context. Call inside a user gesture (the Train click). */
export function primeAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) ctx = new AudioContext({ latencyHint: 'playback' });
    if (ctx.state !== 'running') void ctx.resume();
  } catch { /* no Web Audio: the volume fallback stays */ }
}

function gainFor(el: HTMLMediaElement): GainNode | null {
  const existing = gains.get(el);
  if (existing) return existing;
  if (!ctx || ctx.state !== 'running') return null;
  try {
    const g = ctx.createGain();
    g.gain.value = el.volume;
    ramps.set(el, { from: el.volume, to: el.volume, t0: ctx.currentTime, t1: ctx.currentTime });
    ctx.createMediaElementSource(el).connect(g).connect(ctx.destination);
    el.volume = 1;   // the level now lives on the gain
    gains.set(el, g);
    log(`${nameOf(el)} routed through the shared context at gain ${g.gain.value.toFixed(3)}`);
    return g;
  } catch { return null; }
}

function clear(el: HTMLMediaElement) {
  const t = timers.get(el);
  if (t?.interval !== undefined) window.clearInterval(t.interval);
  if (t?.done !== undefined) window.clearTimeout(t.done);
  timers.delete(el);
}

/** The element's audible level, 0–1 (the gain when routed, else its volume). */
export function levelOf(el: HTMLMediaElement): number {
  const r = ramps.get(el);
  return gains.has(el) && r && ctx ? rampLevel(r, ctx.currentTime) : el.volume;
}

/** Jump to a level at once (cancels any fade). */
export function setLevel(el: HTMLMediaElement, value: number): void {
  clear(el);
  const g = gainFor(el);
  if (g && ctx) {
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(value, now);
    ramps.set(el, { from: value, to: value, t0: now, t1: now });
  } else el.volume = value;
}

/** Fade to `target` over `ms`, then call `then`. On the audio thread when routed; the volume timer otherwise. */
export function fadeLevel(el: HTMLMediaElement, target: number, ms: number, then?: () => void): void {
  clear(el);
  const g = gainFor(el);
  if (g && ctx) {
    const now = ctx.currentTime;
    const from = levelOf(el);   // where our own automation has the gain now — never the not-yet-updated gain.value
    const end = now + Math.max(0, ms) / 1000;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(from, now);
    g.gain.linearRampToValueAtTime(target, end);
    ramps.set(el, { from, to: target, t0: now, t1: end });
    log(`${nameOf(el)} ramp ${from.toFixed(3)} → ${target.toFixed(3)} over ${ms} ms`);
    timers.set(el, { done: window.setTimeout(() => { timers.delete(el); then?.(); }, ms) });
    return;
  }
  const from = el.volume, start = performance.now();
  log(`${nameOf(el)} volume fade ${from.toFixed(3)} → ${target.toFixed(3)} over ${ms} ms (context ${ctx ? ctx.state : 'none'})`);
  const interval = window.setInterval(() => {
    const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
    el.volume = from + (target - from) * t;
    if (t >= 1) { clear(el); then?.(); }
  }, 50);
  timers.set(el, { interval });
}

/** Whether `el` is routed through the shared context (diagnostics). */
export const isSmooth = (el: HTMLMediaElement) => gains.has(el);
