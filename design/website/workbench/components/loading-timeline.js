// Source: Loading Screen - Web.aseprite, 10 frames, 100ms each.
export const frameDurations = [100,100,100,100,100,100,100,100,100,100];
export function loadingFrame(elapsed, durations = frameDurations) {
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  let time = Math.max(0, elapsed) % total;
  for (let frame = 0; frame < durations.length; frame++) {
    if (time < durations[frame]) return frame;
    time -= durations[frame];
  }
  return 0;
}
