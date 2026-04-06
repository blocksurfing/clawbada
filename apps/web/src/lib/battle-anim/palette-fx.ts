import type { PaletteFxData, PaletteFxEntry, PaletteFxShift, AnimationName } from './types';
import { getIntensity } from './interpolation';

/**
 * Per-class palette FX definitions.
 * Keys are class indices (1-10), matching the rig's 1-indexed class system.
 * Each class defines per-animation color shift effects with intensity keyframes.
 */
export const PALETTE_FX: PaletteFxData = {
  1: {
    idle: { all: [
      { role: 9, target: 3, kf: [{ frame: 0, v: 0.05 }, { frame: 40, v: 0.2 }, { frame: 80, v: 0.05 }, { frame: 110, v: 0.18 }] },
      { role: 2, target: 9, kf: [{ frame: 0, v: 0.03 }, { frame: 50, v: 0.12 }, { frame: 100, v: 0.03 }] },
    ] },
    attack: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.4 }, { frame: 42, v: 0.15 }, { frame: 60, v: 0 }] },
      { role: 9, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.5 }, { frame: 38, v: 0.2 }, { frame: 60, v: 0 }] },
    ] },
    defend: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 10, v: 0.7 }, { frame: 20, v: 0.5 }, { frame: 40, v: 0.6 }, { frame: 50, v: 0.3 }, { frame: 55, v: 0 }] },
      { role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 10, v: 0.8 }, { frame: 20, v: 0.6 }, { frame: 40, v: 0.7 }, { frame: 50, v: 0.3 }, { frame: 55, v: 0 }] },
      { role: 1, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 10, v: 0.6 }, { frame: 40, v: 0.5 }, { frame: 55, v: 0 }] },
      { role: 0, target: 1, kf: [{ frame: 0, v: 0 }, { frame: 12, v: 0.4 }, { frame: 40, v: 0.4 }, { frame: 55, v: 0 }] },
    ] },
    special: {
      0: [
        { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.4 }, { frame: 45, v: 0.8 }, { frame: 55, v: 1.0 }, { frame: 70, v: 0.5 }, { frame: 90, v: 0 }] },
        { role: 1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.6 }, { frame: 55, v: 0.9 }, { frame: 70, v: 0.4 }, { frame: 90, v: 0 }] },
        { role: 0, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.5 }, { frame: 55, v: 0.8 }, { frame: 70, v: 0.3 }, { frame: 90, v: 0 }] },
      ],
      all: [
        { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.4 }, { frame: 55, v: 0.7 }, { frame: 75, v: 0.3 }, { frame: 90, v: 0 }] },
        { role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.3 }, { frame: 55, v: 0.6 }, { frame: 75, v: 0.2 }, { frame: 90, v: 0 }] },
      ],
    },
  },
  2: {
    idle: {
      1: [{ role: -1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 30, v: 0.35 }, { frame: 60, v: 0 }, { frame: 90, v: 0.35 }] }],
      all: [{ role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 40, v: 0.15 }, { frame: 80, v: 0 }, { frame: 110, v: 0.15 }] }],
    },
    attack: {
      1: [{ role: -1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 18, v: 0 }, { frame: 25, v: 0.8 }, { frame: 30, v: 1.0 }, { frame: 42, v: 0.4 }, { frame: 60, v: 0 }] }],
      all: [{ role: -1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.2 }, { frame: 30, v: 0.4 }, { frame: 42, v: 0.15 }, { frame: 60, v: 0 }] }],
    },
    defend: null,
    special: {
      1: [{ role: -1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.5 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.8 }, { frame: 80, v: 0 }] }],
      all: [{ role: -1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 35, v: 0.2 }, { frame: 45, v: 0.4 }, { frame: 55, v: 0.6 }, { frame: 70, v: 0.3 }, { frame: 80, v: 0 }] }],
    },
  },
  3: {
    idle: { all: [
      { role: 6, target: 8, kf: [{ frame: 0, v: 0.05 }, { frame: 35, v: 0.2 }, { frame: 70, v: 0.05 }, { frame: 100, v: 0.18 }] },
      { role: 4, target: 2, kf: [{ frame: 0, v: 0.03 }, { frame: 50, v: 0.15 }, { frame: 90, v: 0.03 }] },
    ] },
    attack: { all: [
      { role: 3, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 18, v: 0.6 }, { frame: 28, v: 0 }, { frame: 60, v: 0 }] },
      { role: 2, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.7 }, { frame: 38, v: 0.4 }, { frame: 60, v: 0 }] },
      { role: 1, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.5 }, { frame: 38, v: 0.2 }, { frame: 60, v: 0 }] },
    ] },
    defend: null,
    special: { all: [
      { role: 3, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.5 }, { frame: 45, v: 0.8 }, { frame: 55, v: 0 }, { frame: 90, v: 0 }] },
      { role: 2, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.3 }, { frame: 45, v: 0.6 }, { frame: 55, v: 0 }, { frame: 90, v: 0 }] },
      { role: 2, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.7 }, { frame: 75, v: 0.3 }, { frame: 90, v: 0 }] },
      { role: 3, target: 6, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.8 }, { frame: 75, v: 0.3 }, { frame: 90, v: 0 }] },
      { role: 1, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 0.8 }, { frame: 68, v: 0.4 }, { frame: 90, v: 0 }] },
    ] },
  },
  4: {
    idle: {
      3: [{ role: 8, target: 3, kf: [{ frame: 0, v: 0.2 }, { frame: 15, v: 0.5 }, { frame: 30, v: 0.1 }, { frame: 45, v: 0.6 }, { frame: 60, v: 0.2 }, { frame: 75, v: 0.5 }, { frame: 90, v: 0.1 }, { frame: 105, v: 0.4 }] }],
    },
    attack: { all: [
      { role: 8, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.8 }, { frame: 38, v: 0.3 }, { frame: 60, v: 0 }] },
    ] },
    defend: null,
    special: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.2 }, { frame: 35, v: 0.5 }, { frame: 42, v: 0.2 }, { frame: 48, v: 0.6 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.7 }, { frame: 72, v: 0.9 }, { frame: 80, v: 0.3 }, { frame: 90, v: 0 }] },
      { role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 30, v: 0.3 }, { frame: 38, v: 0.6 }, { frame: 44, v: 0.3 }, { frame: 50, v: 0.7 }, { frame: 55, v: 1.0 }, { frame: 68, v: 0.8 }, { frame: 75, v: 0.5 }, { frame: 90, v: 0 }] },
      { role: 1, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.4 }, { frame: 55, v: 0.8 }, { frame: 70, v: 0.3 }, { frame: 90, v: 0 }] },
    ] },
  },
  5: {
    idle: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0.05 }, { frame: 30, v: 0.25 }, { frame: 60, v: 0.05 }, { frame: 90, v: 0.2 }] },
      { role: 5, target: 8, kf: [{ frame: 0, v: 0.1 }, { frame: 40, v: 0.3 }, { frame: 80, v: 0.1 }] },
    ] },
    attack: { all: [
      { role: 2, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.4 }, { frame: 42, v: 0.15 }, { frame: 60, v: 0 }] },
      { role: 5, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.3 }, { frame: 38, v: 0.1 }, { frame: 60, v: 0 }] },
    ] },
    defend: null,
    special: { all: [
      { role: 2, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.3 }, { frame: 45, v: 0.7 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.9 }, { frame: 75, v: 0.5 }, { frame: 90, v: 0 }] },
      { role: 3, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.4 }, { frame: 45, v: 0.8 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.8 }, { frame: 75, v: 0.3 }, { frame: 90, v: 0 }] },
      { role: 1, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 35, v: 0.5 }, { frame: 55, v: 0.9 }, { frame: 65, v: 0.7 }, { frame: 90, v: 0 }] },
      { role: 6, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 35, v: 0.4 }, { frame: 55, v: 0.9 }, { frame: 70, v: 0.4 }, { frame: 90, v: 0 }] },
      { role: 8, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.6 }, { frame: 55, v: 1.0 }, { frame: 70, v: 0.5 }, { frame: 90, v: 0 }] },
    ] },
  },
  6: {
    idle: { all: [
      { role: 8, target: 3, kf: [{ frame: 0, v: 0.05 }, { frame: 30, v: 0.2 }, { frame: 60, v: 0.05 }, { frame: 90, v: 0.18 }] },
      { role: 2, target: 8, kf: [{ frame: 0, v: 0.03 }, { frame: 45, v: 0.15 }, { frame: 90, v: 0.03 }] },
    ] },
    attack: { all: [
      { role: 8, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.4 }, { frame: 42, v: 0.15 }, { frame: 60, v: 0 }] },
    ] },
    defend: { all: [
      { role: 2, target: 3, kf: [{ frame: 0, v: 0 }, { frame: 10, v: 0.3 }, { frame: 40, v: 0.3 }, { frame: 55, v: 0 }] },
    ] },
    special: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.1 }, { frame: 45, v: 0.4 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.7 }, { frame: 75, v: 0.3 }, { frame: 90, v: 0 }] },
      { role: 1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 0.8 }, { frame: 65, v: 0.5 }, { frame: 75, v: 0.1 }, { frame: 90, v: 0 }] },
      { role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.3 }, { frame: 55, v: 1.0 }, { frame: 70, v: 0.5 }, { frame: 90, v: 0 }] },
      { role: 0, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 0.5 }, { frame: 68, v: 0.2 }, { frame: 90, v: 0 }] },
    ] },
  },
  7: {
    idle: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0.05 }, { frame: 45, v: 0.22 }, { frame: 90, v: 0.05 }] },
      { role: 0, target: 8, kf: [{ frame: 0, v: 0.02 }, { frame: 60, v: 0.12 }, { frame: 110, v: 0.02 }] },
    ] },
    attack: {
      1: [{ role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.5 }, { frame: 42, v: 0.3 }, { frame: 60, v: 0 }] }],
    },
    defend: null,
    special: {
      1: [
        { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.5 }, { frame: 55, v: 1.0 }, { frame: 70, v: 0.7 }, { frame: 90, v: 0 }] },
        { role: 0, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 0.6 }, { frame: 70, v: 0.3 }, { frame: 90, v: 0 }] },
      ],
      all: [
        { role: 3, target: 2, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.3 }, { frame: 55, v: 0.5 }, { frame: 75, v: 0.2 }, { frame: 90, v: 0 }] },
      ],
    },
  },
  8: {
    idle: { all: [
      { role: 5, target: 8, kf: [{ frame: 0, v: 0.1 }, { frame: 30, v: 0.3 }, { frame: 60, v: 0.1 }, { frame: 90, v: 0.3 }] },
    ] },
    attack: { all: [
      { role: 5, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.7 }, { frame: 42, v: 0.3 }, { frame: 60, v: 0 }] },
    ] },
    defend: null,
    special: { all: [
      { role: 2, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.1 }, { frame: 45, v: 0.3 }, { frame: 55, v: 0.9 }, { frame: 65, v: 0.7 }, { frame: 75, v: 0.4 }, { frame: 90, v: 0 }] },
      { role: 1, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 0.8 }, { frame: 65, v: 0.5 }, { frame: 90, v: 0 }] },
      { role: 5, target: 8, kf: [{ frame: 0, v: 0.2 }, { frame: 35, v: 0.5 }, { frame: 45, v: 0.3 }, { frame: 55, v: 1.0 }, { frame: 65, v: 0.8 }, { frame: 75, v: 0.4 }, { frame: 90, v: 0.2 }] },
    ] },
  },
  9: {
    idle: {
      3: [{ role: 6, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 30, v: 0.3 }, { frame: 60, v: 0 }, { frame: 90, v: 0.3 }] }],
    },
    attack: { all: [
      { role: 5, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.5 }, { frame: 42, v: 0.2 }, { frame: 60, v: 0 }] },
      { role: 6, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.4 }, { frame: 38, v: 0.15 }, { frame: 60, v: 0 }] },
    ] },
    defend: null,
    special: { all: [
      { role: 2, target: 6, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.2 }, { frame: 45, v: 0.5 }, { frame: 55, v: 0.9 }, { frame: 70, v: 0.5 }, { frame: 90, v: 0 }] },
      { role: 5, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.4 }, { frame: 55, v: 1.0 }, { frame: 68, v: 0.6 }, { frame: 90, v: 0 }] },
      { role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 55, v: 0.8 }, { frame: 65, v: 0.5 }, { frame: 90, v: 0 }] },
    ] },
  },
  10: {
    idle: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0.15 }, { frame: 15, v: 0.35 }, { frame: 30, v: 0.1 }, { frame: 45, v: 0.4 }, { frame: 60, v: 0.15 }, { frame: 75, v: 0.35 }, { frame: 90, v: 0.1 }, { frame: 105, v: 0.3 }] },
      { role: 1, target: 5, kf: [{ frame: 0, v: 0.1 }, { frame: 25, v: 0.3 }, { frame: 50, v: 0.1 }, { frame: 75, v: 0.25 }, { frame: 100, v: 0.1 }] },
    ] },
    attack: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0.1 }, { frame: 25, v: 0.8 }, { frame: 30, v: 1.0 }, { frame: 42, v: 0.5 }, { frame: 60, v: 0.1 }] },
      { role: 1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.7 }, { frame: 38, v: 0.3 }, { frame: 60, v: 0 }] },
      { role: 0, target: 5, kf: [{ frame: 0, v: 0 }, { frame: 28, v: 0.5 }, { frame: 38, v: 0.2 }, { frame: 60, v: 0 }] },
    ] },
    defend: null,
    special: { all: [
      { role: 2, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 25, v: 0.3 }, { frame: 35, v: 0.6 }, { frame: 40, v: 0.3 }, { frame: 45, v: 0.7 }, { frame: 50, v: 0.4 }, { frame: 55, v: 1.0 }, { frame: 60, v: 0.8 }, { frame: 65, v: 1.0 }, { frame: 72, v: 0.5 }, { frame: 90, v: 0 }] },
      { role: 3, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 30, v: 0.4 }, { frame: 38, v: 0.7 }, { frame: 44, v: 0.4 }, { frame: 50, v: 0.8 }, { frame: 55, v: 1.0 }, { frame: 62, v: 0.9 }, { frame: 70, v: 0.6 }, { frame: 90, v: 0 }] },
      { role: 1, target: 8, kf: [{ frame: 0, v: 0 }, { frame: 45, v: 0.3 }, { frame: 55, v: 0.9 }, { frame: 65, v: 0.6 }, { frame: 90, v: 0 }] },
      { role: 2, target: 0, kf: [{ frame: 0, v: 0 }, { frame: 70, v: 0 }, { frame: 78, v: 0.3 }, { frame: 86, v: 0.15 }, { frame: 90, v: 0 }] },
    ] },
  },
};

/** Evaluate palette FX shifts for a given class, animation, body part, and frame. */
export function evaluatePaletteFx(
  classIdx: number,
  animName: AnimationName,
  bpIdx: number,
  frame: number,
  totalFrames: number,
): PaletteFxShift[] | null {
  const classFx = PALETTE_FX[classIdx];
  if (!classFx) return null;

  const animFx = classFx[animName];
  if (!animFx) return null;

  const shifts: PaletteFxShift[] = [];
  const sources: PaletteFxEntry[] = [];

  if (animFx.all) sources.push(...animFx.all);
  const partFx = (animFx as Record<string | number, PaletteFxEntry[] | undefined>)[bpIdx];
  if (partFx) sources.push(...partFx);

  for (const effect of sources) {
    const intensity = getIntensity(effect.kf, frame, totalFrames);
    if (intensity > 0.001) {
      shifts.push({ role: effect.role, target: effect.target, intensity });
    }
  }

  return shifts.length > 0 ? shifts : null;
}
