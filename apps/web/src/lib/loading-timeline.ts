/**
 * Frame timing of Nzib's web loading loop ("Loading Screen - Web.aseprite", design/website 57ed790): ten frames of
 * 100 ms, looping. Ported from his workbench `loading-timeline.js` unchanged so the React overlay plays the loop at
 * the speed he authored it.
 */
export const frameDurations: readonly number[] = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];

/** The frame index showing at `elapsed` ms into the loop (negative = frame 0). */
export function loadingFrame(elapsed: number, durations: readonly number[] = frameDurations): number {
  const total = durations.reduce((sum, d) => sum + d, 0);
  let time = Math.max(0, elapsed) % total;
  for (let frame = 0; frame < durations.length; frame++) {
    if (time < durations[frame]) return frame;
    time -= durations[frame];
  }
  return 0;
}
