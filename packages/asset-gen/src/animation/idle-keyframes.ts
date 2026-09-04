/**
 * Idle animation keyframe data, ported from animation-rig-v2.html.
 *
 * 120 frames at 60 FPS = 2 second loop.
 * Default playback at 2x speed (1 second loop).
 */

export const IDLE_TOTAL_FRAMES = 120;
export const IDLE_FPS = 60;
export const ANIM_PAD = 8;
export const PADDED_SIZE = 64 + ANIM_PAD * 2; // 80

// ── Easing functions ──

const EASING: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => { const t1 = t - 1; return t1 * t1 * t1 + 1; },
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
};

// ── Keyframe types ──

export interface IdleKeyframe {
  frame: number;
  dx: number;
  dy: number;
  ease?: string;
}

// ── Per-body-part idle keyframes ──
// Body parts: 0=Carapace, 1=Claws, 2=Tail, 3=Antennae, 4=Eyes, 5=Legs

export const IDLE_KEYFRAMES: Record<number, IdleKeyframe[]> = {
  0: [ // Carapace — vertical bob
    { frame: 0,  dx: 0, dy: 0 },
    { frame: 30, dx: 0, dy: -1, ease: 'easeInOutQuad' },
    { frame: 60, dx: 0, dy: 0,  ease: 'easeInOutQuad' },
    { frame: 90, dx: 0, dy: 1,  ease: 'easeInOutQuad' },
  ],
  1: [ // Claws — horizontal wiggle
    { frame: 0,  dx: 0,  dy: 0 },
    { frame: 30, dx: -1, dy: 0, ease: 'easeInOutQuad' },
    { frame: 60, dx: 0,  dy: 0, ease: 'easeInOutQuad' },
    { frame: 90, dx: 1,  dy: 0, ease: 'easeInOutQuad' },
  ],
  2: [ // Tail — horizontal shimmy (opposite to claws)
    { frame: 0,  dx: 0, dy: 0 },
    { frame: 30, dx: 1, dy: 0, ease: 'easeInOutQuad' },
    { frame: 60, dx: 0, dy: 0, ease: 'easeInOutQuad' },
    { frame: 90, dx: -1, dy: 0, ease: 'easeInOutQuad' },
  ],
  3: [ // Antennae — diagonal wiggle
    { frame: 0,  dx: 1,  dy: 0 },
    { frame: 30, dx: 0,  dy: -1, ease: 'easeInOutQuad' },
    { frame: 60, dx: -1, dy: 0,  ease: 'easeInOutQuad' },
    { frame: 90, dx: 0,  dy: 1,  ease: 'easeInOutQuad' },
  ],
  4: [ // Eyes — vertical bob (same as carapace)
    { frame: 0,  dx: 0, dy: 0 },
    { frame: 30, dx: 0, dy: -1, ease: 'easeInOutQuad' },
    { frame: 60, dx: 0, dy: 0,  ease: 'easeInOutQuad' },
    { frame: 90, dx: 0, dy: 1,  ease: 'easeInOutQuad' },
  ],
  5: [], // Legs — stationary
};

// ── Interpolation ──

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Get the interpolated offset for a body part at a given animation frame.
 * Matches the rig's getOffset() function exactly.
 */
export function getIdleOffset(
  bodyPart: number,
  frame: number,
  totalFrames: number = IDLE_TOTAL_FRAMES,
): { dx: number; dy: number } {
  const keyframes = IDLE_KEYFRAMES[bodyPart];
  if (!keyframes || keyframes.length === 0) return { dx: 0, dy: 0 };

  const f = frame % totalFrames;

  // Find surrounding keyframes
  let prev = keyframes[keyframes.length - 1];
  let next = keyframes[0];

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].frame <= f) prev = keyframes[i];
    if (keyframes[i].frame > f) {
      next = keyframes[i];
      break;
    }
    if (i === keyframes.length - 1) {
      next = { ...keyframes[0], frame: totalFrames };
    }
  }

  // No interpolation needed
  if (prev.frame === next.frame || (next.frame <= prev.frame && next.frame !== totalFrames)) {
    return { dx: Math.round(prev.dx), dy: Math.round(prev.dy) };
  }

  // Compute interpolation progress
  let t: number;
  if (next.frame > prev.frame) {
    t = (f - prev.frame) / (next.frame - prev.frame);
  } else {
    const span = (totalFrames - prev.frame) + next.frame;
    const elapsed = f >= prev.frame ? f - prev.frame : (totalFrames - prev.frame) + f;
    t = span > 0 ? elapsed / span : 0;
  }

  // Apply easing
  const easeFn = next.ease ? (EASING[next.ease] ?? EASING.linear) : EASING.linear;
  t = easeFn(t);

  return {
    dx: Math.round(lerp(prev.dx, next.dx, t)),
    dy: Math.round(lerp(prev.dy, next.dy, t)),
  };
}

/**
 * Sample N evenly-spaced frame indices from the full animation.
 * E.g., sampleFrames(16, 120) → [0, 8, 15, 23, 30, ...]
 */
export function sampleFrameIndices(numFrames: number, totalFrames: number = IDLE_TOTAL_FRAMES): number[] {
  const step = totalFrames / numFrames;
  return Array.from({ length: numFrames }, (_, i) => Math.round(i * step));
}
