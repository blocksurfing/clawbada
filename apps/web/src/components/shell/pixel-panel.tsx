'use client';

import { useEffect, useRef, type HTMLAttributes } from 'react';

/**
 * Nzib's nine-slice wooden panel (`components/pixel/index.js` + `geometry.js`, baseline 3295433): the art is
 * drawn from the original sheet into a source-resolution canvas displayed at the global 3× pixel. Corners stay
 * fixed; edges AND the centre repeat whole source pixels; a partial end tile clips. No border-image stretch.
 * WoodenPanel.png (192×192): region [0, 0, 48, 48] on a 16 px tile.
 */
const ASSET = { src: '/ui/tileset/WoodenPanel.png', region: [0, 0, 48, 48] as const, tile: 16 };

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Pixel asset failed to load: ${src}`));
      image.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Source-pixel slices: repeat only whole pixels; the final partial tile is clipped. */
export function tileAxis(length: number, tile: number) {
  if (!Number.isInteger(length) || length < tile * 2) throw new Error('Panel too small for fixed corners');
  const parts = [{ source: 0, dest: 0, size: tile }];
  for (let at = tile; at < length - tile; at += tile) parts.push({ source: tile, dest: at, size: Math.min(tile, length - tile - at) });
  parts.push({ source: tile * 2, dest: length - tile, size: tile });
  return parts;
}

const pixelScale = () => {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pixel'));
  return Number.isInteger(value) && value >= 1 ? value : 3;
};

export function PixelPanel({ children, className, ...rest }: HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = ref.current, canvas = canvasRef.current;
    if (!element || !canvas) return;
    let disposed = false, scheduled = 0, image: HTMLImageElement | null = null;
    element.style.setProperty('--panel-tile', String(ASSET.tile));
    const update = () => {
      scheduled = 0;
      if (disposed || !image) return;
      const unit = pixelScale();
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width / unit), height = Math.round(rect.height / unit);
      if (width < ASSET.tile * 2 || height < ASSET.tile * 2) return;
      // Canvas resolution is in source pixels; CSS displays exactly unit × source dimensions.
      if (canvas.width === width && canvas.height === height && element.dataset.pixelReady === 'true') return;
      canvas.width = width; canvas.height = height;
      canvas.style.width = `${width * unit}px`; canvas.style.height = `${height * unit}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      const [sx, sy] = ASSET.region;
      for (const row of tileAxis(height, ASSET.tile)) for (const col of tileAxis(width, ASSET.tile)) {
        ctx.drawImage(image, sx + col.source, sy + row.source, col.size, row.size, col.dest, row.dest, col.size, row.size);
      }
      element.dataset.pixelReady = 'true';
    };
    const schedule = () => { if (!disposed && !scheduled) scheduled = requestAnimationFrame(update); };
    loadImage(ASSET.src).then((img) => { if (!disposed) { image = img; schedule(); } }).catch(console.error);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    void document.fonts.ready.then(schedule);
    return () => { disposed = true; cancelAnimationFrame(scheduled); observer.disconnect(); };
  }, []);

  return (
    <section ref={ref} className={`wooden-panel pixel-panel${className ? ` ${className}` : ''}`} data-pixel-panel="woodenPanel" {...rest}>
      <canvas ref={canvasRef} aria-hidden="true" className="pixel-panel-art" />
      {children}
    </section>
  );
}
