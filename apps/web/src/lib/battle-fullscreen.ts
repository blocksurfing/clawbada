/**
 * Battles open in fullscreen (user 2026-09-29: "pushed to full screen for a battle just as the screen shows Unity
 * Loading"). Browsers only grant fullscreen inside a user gesture, and the battle stage mounts seconds after the Start
 * click (API call, navigation, snapshot) — too late. So the Start click itself puts the whole PAGE into fullscreen
 * (document.documentElement), the client-side navigation keeps it, and BattleStage lays itself over the page
 * (fixed, full-bleed) while the page is fullscreen. Leaving the battle — or pressing Esc / EXIT — leaves fullscreen.
 */
export function requestBattleFullscreen(): void {
  if (typeof document === 'undefined' || document.fullscreenElement) return;
  const el = document.documentElement;
  if (!el.requestFullscreen) return;   // iPhone Safari: no element fullscreen — the battle just opens in the page
  void el.requestFullscreen().catch(() => { /* denied (no gesture, iframe policy): carry on windowed */ });
}

/** Undo requestBattleFullscreen when the battle never opened (the start call failed). */
export function exitBattleFullscreen(): void {
  if (typeof document === 'undefined' || document.fullscreenElement !== document.documentElement) return;
  void document.exitFullscreen().catch(() => {});
}
