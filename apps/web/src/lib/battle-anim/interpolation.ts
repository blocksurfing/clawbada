import type { Keyframe, IntensityKeyframe, EasingName } from './types';
import { EASING } from './easing';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRGB(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Interpolate animation keyframe offsets at a given frame, with easing. */
export function getOffset(
  keyframes: Keyframe[],
  frame: number,
  totalFrames: number,
): { dx: number; dy: number } {
  if (!keyframes || keyframes.length === 0) return { dx: 0, dy: 0 };

  const f = frame % totalFrames;
  let prev = keyframes[keyframes.length - 1];
  let next = keyframes[0];

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].frame <= f) prev = keyframes[i];
    if (keyframes[i].frame > f) {
      next = keyframes[i];
      break;
    }
    if (i === keyframes.length - 1)
      next = { ...keyframes[0], frame: totalFrames };
  }

  if (
    prev.frame === next.frame ||
    (next.frame <= prev.frame && next.frame !== totalFrames)
  ) {
    return { dx: Math.round(prev.dx), dy: Math.round(prev.dy) };
  }

  let t: number;
  if (next.frame > prev.frame) {
    t = (f - prev.frame) / (next.frame - prev.frame);
  } else {
    const span = totalFrames - prev.frame + next.frame;
    const elapsed =
      f >= prev.frame ? f - prev.frame : totalFrames - prev.frame + f;
    t = span > 0 ? elapsed / span : 0;
  }

  const easeName = next.ease as EasingName | undefined;
  const easeFn = easeName ? (EASING[easeName] ?? EASING.linear) : EASING.linear;
  t = easeFn(t);

  return {
    dx: Math.round(lerp(prev.dx, next.dx, t)),
    dy: Math.round(lerp(prev.dy, next.dy, t)),
  };
}

/** Interpolate an intensity value (0-1) from intensity keyframes at a given frame. */
export function getIntensity(
  keyframes: IntensityKeyframe[],
  frame: number,
  totalFrames: number,
): number {
  if (!keyframes || keyframes.length === 0) return 0;

  const f = frame % totalFrames;
  let prev = keyframes[keyframes.length - 1];
  let next = keyframes[0];

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].frame <= f) prev = keyframes[i];
    if (keyframes[i].frame > f) {
      next = keyframes[i];
      break;
    }
    if (i === keyframes.length - 1)
      next = { ...keyframes[0], frame: totalFrames };
  }

  if (prev.frame === next.frame) return prev.v;

  let t: number;
  if (next.frame > prev.frame) {
    t = (f - prev.frame) / (next.frame - prev.frame);
  } else {
    const span = totalFrames - prev.frame + next.frame;
    const elapsed =
      f >= prev.frame ? f - prev.frame : totalFrames - prev.frame + f;
    t = span > 0 ? elapsed / span : 0;
  }

  const easeName = next.ease as EasingName | undefined;
  const easeFn = easeName ? (EASING[easeName] ?? EASING.linear) : EASING.linear;
  t = easeFn(t);

  return prev.v + (next.v - prev.v) * t;
}
