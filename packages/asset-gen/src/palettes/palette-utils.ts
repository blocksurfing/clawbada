import type { HSL, RGBA } from '../types';

/** Parse a hex color string (#RRGGBB or #RGB) to RGBA with full opacity. */
export function hexToRGBA(hex: string): RGBA {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255,
  ];
}

/** Convert RGBA to hex string (#RRGGBB, ignores alpha). */
export function rgbaToHex(color: RGBA): string {
  return (
    '#' +
    color[0].toString(16).padStart(2, '0') +
    color[1].toString(16).padStart(2, '0') +
    color[2].toString(16).padStart(2, '0')
  );
}

/** Convert RGB to HSL. Input/output ranges: R/G/B 0-255, H 0-360, S/L 0-1. */
export function rgbToHSL(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === rn) {
      h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
    } else if (max === gn) {
      h = ((bn - rn) / delta + 2) * 60;
    } else {
      h = ((rn - gn) / delta + 4) * 60;
    }
  }

  return [h, s, l];
}

/** Convert HSL to RGB. Input: H 0-360, S/L 0-1. Output: R/G/B 0-255. */
export function hslToRGB(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; // Normalize hue

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let rn: number, gn: number, bn: number;

  if (h < 60) {
    [rn, gn, bn] = [c, x, 0];
  } else if (h < 120) {
    [rn, gn, bn] = [x, c, 0];
  } else if (h < 180) {
    [rn, gn, bn] = [0, c, x];
  } else if (h < 240) {
    [rn, gn, bn] = [0, x, c];
  } else if (h < 300) {
    [rn, gn, bn] = [x, 0, c];
  } else {
    [rn, gn, bn] = [c, 0, x];
  }

  return [
    Math.round((rn + m) * 255),
    Math.round((gn + m) * 255),
    Math.round((bn + m) * 255),
  ];
}

/** Convert RGBA to HSL (ignores alpha). */
export function rgbaToHSL(color: RGBA): HSL {
  return rgbToHSL(color[0], color[1], color[2]);
}

/** Convert HSL to RGBA with full opacity. */
export function hslToRGBA(hsl: HSL): RGBA {
  const [r, g, b] = hslToRGB(hsl[0], hsl[1], hsl[2]);
  return [r, g, b, 255];
}

/** Apply an HSL transform to an RGBA color. */
export function shiftHSL(
  color: RGBA,
  hueRotation: number,
  satMult: number,
  lightMult: number,
): RGBA {
  const [h, s, l] = rgbaToHSL(color);
  const [r, g, b] = hslToRGB(
    h + hueRotation,
    Math.min(1, Math.max(0, s * satMult)),
    Math.min(1, Math.max(0, l * lightMult)),
  );
  return [r, g, b, color[3]];
}

/**
 * Tint an RGBA color toward a target color.
 * strength = 0 → original, strength = 1 → fully tinted.
 */
export function tintColor(color: RGBA, target: RGBA, strength: number): RGBA {
  const s = Math.min(1, Math.max(0, strength));
  return [
    Math.round(color[0] + (target[0] - color[0]) * s),
    Math.round(color[1] + (target[1] - color[1]) * s),
    Math.round(color[2] + (target[2] - color[2]) * s),
    color[3],
  ];
}

/** Lighten an RGBA color by increasing lightness. Amount in [0, 1]. */
export function lighten(color: RGBA, amount: number): RGBA {
  const [h, s, l] = rgbaToHSL(color);
  const [r, g, b] = hslToRGB(h, s, Math.min(1, l + amount));
  return [r, g, b, color[3]];
}

/** Darken an RGBA color by decreasing lightness. Amount in [0, 1]. */
export function darken(color: RGBA, amount: number): RGBA {
  const [h, s, l] = rgbaToHSL(color);
  const [r, g, b] = hslToRGB(h, s, Math.max(0, l - amount));
  return [r, g, b, color[3]];
}

/** Saturate an RGBA color by multiplying saturation. Factor > 1 = more saturated. */
export function saturate(color: RGBA, factor: number): RGBA {
  const [h, s, l] = rgbaToHSL(color);
  const [r, g, b] = hslToRGB(h, Math.min(1, s * factor), l);
  return [r, g, b, color[3]];
}

/** Clamp a number to [0, 255]. */
export function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Linear interpolation between two RGBA colors. t in [0, 1]. */
export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    clamp255(a[0] + (b[0] - a[0]) * t),
    clamp255(a[1] + (b[1] - a[1]) * t),
    clamp255(a[2] + (b[2] - a[2]) * t),
    clamp255(a[3] + (b[3] - a[3]) * t),
  ];
}
