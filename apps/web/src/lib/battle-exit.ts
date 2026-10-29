/**
 * The way out of a battle (owner 2026-10-29: "the looney tunes zoom out, 1.5 second fade out, when closing out a battle
 * after the clock runs down showing victory / defeat"). The mirror of the way in (lib/battle-entry.ts):
 *
 *   closing — a navy circle closes on the middle of the Victory / Defeat screen (EXIT_IRIS_CLOSE_MS, ease-in);
 *   closed  — all navy: the battle view leaves fullscreen, Unity quits and the page switches to the Dojo or The Shell
 *             underneath, where none of it is seen;
 *   opening — once the new page is up, it opens through a circle growing from the middle (EXIT_IRIS_OPEN_MS, ease-out).
 *
 * State lives here (module-level, like the entry) so the overlay in the root layout survives the navigation. Reduced
 * motion skips it all: the battle closes as before.
 */
import { useSyncExternalStore } from 'react';
import { reducedMotion } from './battle-entry';

export const EXIT_IRIS_CLOSE_MS = 1500;
/** Navy held after the circle shuts, before the battle view starts tearing down (lets the last frame land). */
export const EXIT_NAVY_BEAT_MS = 150;
export const EXIT_IRIS_OPEN_MS = 900;
/** If the next page never reports in (a failed navigation), open anyway after this long in navy. */
const ARRIVAL_SAFETY_MS = 8000;

export type ExitPhase = 'idle' | 'closing' | 'closed' | 'opening';
export interface BattleExitState { phase: ExitPhase; startedAt: number }

const IDLE: BattleExitState = { phase: 'idle', startedAt: 0 };
let state: BattleExitState = IDLE;
const listeners = new Set<() => void>();
let timers: ReturnType<typeof setTimeout>[] = [];
const emit = (next: BattleExitState) => { state = next; listeners.forEach((l) => l()); };
const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
const clear = () => { timers.forEach(clearTimeout); timers = []; };

/**
 * Start the zoom-out over the result. Resolves once the screen is all navy — the caller then closes the battle view and
 * navigates. Resolves at once under reduced motion (nothing is drawn).
 */
export function startBattleExit(): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  if (state.phase !== 'idle') return Promise.resolve();
  clear();
  emit({ phase: 'closing', startedAt: Date.now() });
  return new Promise((resolve) => {
    later(EXIT_IRIS_CLOSE_MS, () => emit({ ...state, phase: 'closed' }));
    later(EXIT_IRIS_CLOSE_MS + EXIT_NAVY_BEAT_MS, resolve);
    later(EXIT_IRIS_CLOSE_MS + EXIT_NAVY_BEAT_MS + ARRIVAL_SAFETY_MS, () => { if (state.phase === 'closed') openBattleExit(); });
  });
}

/** The next page is on screen: open the circle on it. Called by the overlay when the route has left /battle. */
export function openBattleExit(): void {
  if (state.phase !== 'closed') return;
  clear();
  emit({ ...state, phase: 'opening' });
  later(EXIT_IRIS_OPEN_MS, () => emit(IDLE));
}

export function getExitState(): BattleExitState {
  return state;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useBattleExit(): BattleExitState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}

/** Tests only. */
export function _resetBattleExitForTests(): void {
  clear();
  state = IDLE;
}
