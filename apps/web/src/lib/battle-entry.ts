/**
 * The battle entry sequence — what happens between pressing Train (or approving a match) and the arena intro.
 *
 * Owner spec (2026-10-21, "Battle Entry Sequence" doc): the Dojo page fades into Nzib's Shifu-under-the-tree
 * loading loop that says LOADING for at least 12 s, then into the Unity training scene (its own 15 s hold, with a
 * gameplay tip), which fades into the arena intro. This module is the state behind the web half: a module-level
 * store (same pattern as the guest session in use-auth.ts) so the overlay, mounted at the app root, survives the
 * client-side navigation from /dojo to /battle/<id> without a remount or a provider.
 *
 * The way in is two fades (owner 2026-10-23, "slow down the fade to the first loading screen"): the page fades out
 * to the theme's dark navy over ENTRY_CURTAIN_MS, then the Shifu loop fades in from that navy over ENTRY_REVEAL_MS —
 * so the loop is on its way in ENTRY_CURTAIN_MS after the press, and the 12 s hold is counted from THEN, not from
 * the press. A gentle breeze (lib/entry-ambience.ts) fades in with the loop and out at the handover to Unity.
 *
 * Release — when the overlay may fade out — is `max(the 12 s hold, a signal)`:
 *   - `markUnityLoadingShown()`: the Unity training scene is on screen (a player build that reports it) → now;
 *   - `markArenaReady()`: InitBattle was sent to a build that never reports the training scene (an older player)
 *     → after a 1.5 s grace, because a new build sends InitBattle a few frames BEFORE the training scene appears
 *     and releasing on it alone would lift the overlay onto a bare battle scene;
 *   - a 45 s safety: a stuck load must never trap the user behind an opaque overlay.
 * `cancelBattleEntry()` drops it at once (the start failed, Unity is unavailable, the page was left).
 */
import { useSyncExternalStore } from 'react';
import { pickLoadingTip } from './loading-tips';

export type EntryKind = 'practice' | 'battle';
export type EntryPhase = 'idle' | 'web' | 'leaving';

export interface BattleEntryState {
  phase: EntryPhase;
  kind: EntryKind | null;
  /** The gameplay tip chosen for this entry; handed to the Unity training scene (ShowLoading) when the build takes one. */
  tip: string | null;
  startedAt: number;
  /** The Unity training scene reported itself on screen during this entry. */
  unityShown: boolean;
}

/** The Shifu screen's minimum time on screen, counted from the loop (owner 2026-10-23: 12 s; was 4.5 s, then 6 s). */
export const ENTRY_HOLD_MS = 12_000;
/** The page → navy curtain (the way in, first stage). */
export const ENTRY_CURTAIN_MS = 700;
/** Navy → the Shifu loop (the way in, second stage; starts when the curtain is down). */
export const ENTRY_REVEAL_MS = 900;
/** The way out: the loop over the Unity training scene (unchanged). */
export const ENTRY_FADE_MS = 400;
const ARENA_GRACE_MS = 1_500;
const SAFETY_MS = 45_000;

const IDLE: BattleEntryState = { phase: 'idle', kind: null, tip: null, startedAt: 0, unityShown: false };

let state: BattleEntryState = IDLE;
const listeners = new Set<() => void>();
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: BattleEntryState): void {
  state = next;
  for (const l of listeners) l();
}

function clearTimers(): void {
  for (const t of [holdTimer, graceTimer, safetyTimer, fadeTimer]) if (t !== null) clearTimeout(t);
  holdTimer = graceTimer = safetyTimer = fadeTimer = null;
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** When the Shifu loop starts to show: the press plus the curtain (at once under reduced motion). */
export function loopShownAt(): number {
  return state.startedAt + (reducedMotion() ? 0 : ENTRY_CURTAIN_MS);
}

/** Begin the sequence (inside the Train click, or on a battle page that opened without one). No-op while one is active. */
export function startBattleEntry(opts: { kind: EntryKind }): void {
  if (state.phase !== 'idle') return;
  clearTimers();
  emit({ phase: 'web', kind: opts.kind, tip: pickLoadingTip(), startedAt: Date.now(), unityShown: false });
  safetyTimer = setTimeout(() => { console.warn('[BattleEntry] safety release after 45 s'); release(); }, SAFETY_MS);
}

/** The Unity training scene is visible: the web loop may hand over (after the hold). */
export function markUnityLoadingShown(): void {
  if (state.phase !== 'web') return;
  if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
  emit({ ...state, unityShown: true });
  scheduleRelease();
}

/** InitBattle went to Unity. An older build never reports the training scene, so release after a grace unless it does. */
export function markArenaReady(): void {
  if (state.phase !== 'web' || state.unityShown || graceTimer !== null || holdTimer !== null) return;
  graceTimer = setTimeout(() => { graceTimer = null; if (state.phase === 'web') scheduleRelease(); }, ARENA_GRACE_MS);
}

/** Drop the overlay at once: the start failed, Unity is unavailable (plain board), or the battle page was left. */
export function cancelBattleEntry(): void {
  clearTimers();
  if (state.phase !== 'idle') emit(IDLE);
}

export function getEntryState(): BattleEntryState {
  return state;
}

/** The tip picked for the running (or just-finished) entry. */
export function getEntryTip(): string | null {
  return state.tip;
}

function scheduleRelease(): void {
  if (holdTimer !== null) return;
  const wait = Math.max(0, loopShownAt() + ENTRY_HOLD_MS - Date.now());   // the hold counts from the loop, not the press
  holdTimer = setTimeout(() => { holdTimer = null; release(); }, wait);
}

function release(): void {
  if (state.phase !== 'web') return;
  if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
  if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null; }
  if (safetyTimer !== null) { clearTimeout(safetyTimer); safetyTimer = null; }
  emit({ ...state, phase: 'leaving' });
  fadeTimer = setTimeout(() => { fadeTimer = null; emit({ ...IDLE, tip: state.tip }); }, reducedMotion() ? 0 : ENTRY_FADE_MS);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
const serverSnapshot = () => IDLE;

/** The entry state for React (the overlay). */
export function useBattleEntry(): BattleEntryState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Tests only: reset the module state. */
export function _resetBattleEntryForTests(): void {
  clearTimers();
  state = IDLE;
}
