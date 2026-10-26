'use client';

import { useEffect } from 'react';
import { mountPixelCursor } from './pixel-cursor';

/** Nzib's pixel cursor for the whole site (pixel-cursor.ts). Renders nothing. */
export function PixelCursor() {
  useEffect(() => mountPixelCursor(), []);
  return null;
}
