/**
 * Keeps the page's own errors away from Unity's alert box (2026-11-05).
 *
 * Unity's WebGL loader listens for EVERY window `error` and `unhandledrejection` while the player runs and answers the
 * first one with a blocking `alert("An error occurred running the Unity content on this page…")`. react-unity-webgl
 * gives no way to pass Unity an `errorHandler`, so an error that has nothing to do with Unity — a wallet library's
 * rejected promise, an extension's injected script, a failed fetch someone forgot to catch — stopped the whole battle
 * page behind a dialog. On localhost the Family Accounts connector rejects ~5 s after a fresh load, which is the
 * "freeze" a page joining a finished battle hit (2026-11-04): it was this alert, not the result screen.
 *
 * The guard listens in the CAPTURE phase on window, which runs before Unity's own (bubble-phase) listener on the same
 * target, and stops errors that did not come from Unity: they are logged as a warning instead. Unity's own errors
 * (its framework runs from a blob: URL, its code is wasm) still reach Unity's handler unchanged.
 */

/** True when an error's source or stack points into the Unity player: its framework script (a blob: URL once
 *  decompressed, or the unity-build file itself) or its WebAssembly. */
export function isUnityError(where: string): boolean {
  return /unity-build|blob:|wasm/i.test(where);
}

function describe(e: ErrorEvent | PromiseRejectionEvent): { message: string; where: string } {
  const err: unknown = 'reason' in e ? e.reason : e.error;
  const asErr = err as { message?: unknown; stack?: unknown; fileName?: unknown } | null;
  const message = String(asErr?.message ?? ('message' in e ? e.message : '') ?? err ?? '');
  const where = [('filename' in e ? e.filename : ''), asErr?.fileName, asErr?.stack].filter(Boolean).map(String).join('\n');
  return { message, where };
}

/** Install the guard; returns its remover. Safe to call during SSR (does nothing). */
export function installUnityErrorGuard(): () => void {
  if (typeof window === 'undefined') return () => {};
  const guard = (e: Event) => {
    // Resource load errors (an <img> 404) reach a window capture listener too; they are not Unity's business.
    if (e.target !== window) return;
    const { message, where } = describe(e as ErrorEvent | PromiseRejectionEvent);
    if (isUnityError(where)) return;
    e.stopImmediatePropagation();
    console.warn(`[UnityErrorGuard] page error kept from Unity's alert: ${message.slice(0, 300)}`);
  };
  window.addEventListener('error', guard, true);
  window.addEventListener('unhandledrejection', guard, true);
  return () => {
    window.removeEventListener('error', guard, true);
    window.removeEventListener('unhandledrejection', guard, true);
  };
}
