'use client';

import { createElement, useEffect, useRef, type HTMLAttributes, type RefObject } from 'react';
import { PIXEL_ASSETS, PIXEL_SCALE_EVENT, loadPixelImage, pixelScale, tileAxis, type PanelAsset, type PanelAssetName } from '@/components/pixel/pixel-assets';

/**
 * Nzib's nine-slice panels (`components/pixel/index.js` + `geometry.js`, drop ee1219f): the art is drawn from
 * the original sheet into a source-resolution canvas displayed at the global 3× pixel. Corners stay fixed;
 * edges AND the centre repeat whole source pixels; a partial end tile clips. No border-image stretch.
 * `usePixelPanel` paints any element (the market's Buy button is a panel too); `PixelPanel` is the element.
 */
export function usePixelPanel(ref: RefObject<HTMLElement | null>, canvasRef: RefObject<HTMLCanvasElement | null>, asset: PanelAsset) {
  useEffect(() => {
    const element = ref.current, canvas = canvasRef.current;
    if (!element || !canvas) return;
    let disposed = false, scheduled = 0, image: HTMLImageElement | null = null;
    element.style.setProperty('--panel-tile', String(asset.tile));
    const update = () => {
      scheduled = 0;
      if (disposed || !image) return;
      // The pixel in effect here, and the layout size (not the on-screen one: the Dojo's stage is scaled by a transform).
      const unit = pixelScale(element);
      const rect = { width: element.offsetWidth, height: element.offsetHeight };
      // Hidden panels have zero bounds; a responsive layout can briefly sit below the fixed corners.
      // Keep the last paint until the observer supplies usable bounds.
      if (!rect.width || !rect.height) return;
      const width = Math.round(rect.width / unit), height = Math.round(rect.height / unit);
      const minimum = (asset.sliceSpan ?? asset.tile) * 2;
      if (width < minimum || (!asset.horizontal && height < minimum)) return;
      // Canvas resolution is in source pixels; CSS displays exactly unit × source dimensions.
      const pad = asset.identityJoins ? 2 : 0;
      if (canvas.width === width + pad * 2 && canvas.height === height + pad * 2 && element.dataset.pixelReady === 'true') return;
      canvas.width = width + pad * 2; canvas.height = height + pad * 2;
      canvas.style.width = `${canvas.width * unit}px`; canvas.style.height = `${canvas.height * unit}px`;
      if (pad) { canvas.style.top = `${-pad * unit}px`; canvas.style.left = `${-pad * unit}px`; }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.translate(pad, pad);
      const [sx, sy] = asset.region;
      const rows = asset.horizontal
        ? Array.from({ length: asset.region[3] / asset.tile }, (_, i) => ({ source: i * asset.tile, dest: i * asset.tile, size: asset.tile }))
        : tileAxis(height, asset.tile, asset.sliceSpan);
      for (const row of rows) for (const col of tileAxis(width, asset.tile, asset.sliceSpan)) {
        ctx.drawImage(image, sx + col.source, sy + row.source, col.size, row.size, col.dest, row.dest, col.size, row.size);
      }
      if (asset.identityJoins) {
        const [x, y] = asset.identityJoins;
        // Only the top-left cream corner of this single tile is opaque: paint its 2×2 outside each junction.
        ctx.drawImage(image, x, y, 2, 2, width, 0, 2, 2);
        ctx.drawImage(image, x, y, 2, 2, 0, height, 2, 2);
      }
      element.dataset.pixelReady = 'true';
    };
    const schedule = () => { if (!disposed && !scheduled) scheduled = requestAnimationFrame(update); };
    loadPixelImage(asset.src).then((img) => { if (!disposed) { image = img; schedule(); } }).catch(console.error);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    void document.fonts.ready.then(schedule);
    window.addEventListener(PIXEL_SCALE_EVENT, schedule);   // the page pixel size changed (pixel-assets.ts chromePixelScale)
    return () => { disposed = true; cancelAnimationFrame(scheduled); observer.disconnect(); window.removeEventListener(PIXEL_SCALE_EVENT, schedule); };
  }, [ref, canvasRef, asset]);
}

type PanelTag = 'section' | 'div' | 'article' | 'form' | 'nav' | 'aside';

interface PixelPanelProps extends HTMLAttributes<HTMLElement> {
  /** Registry name; the wooden panel by default. */
  asset?: PanelAssetName;
  as?: PanelTag;
}

export function PixelPanel({ asset = 'woodenPanel', as = 'section', children, className, ...rest }: PixelPanelProps) {
  const ref = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  usePixelPanel(ref, canvasRef, PIXEL_ASSETS[asset]);
  const classes = `${asset === 'woodenPanel' ? 'wooden-panel ' : ''}pixel-panel${className ? ` ${className}` : ''}`;
  return createElement(
    as,
    { ref, className: classes, 'data-pixel-panel': asset, ...rest },
    createElement('canvas', { ref: canvasRef, 'aria-hidden': 'true', className: 'pixel-panel-art' }),
    children,
  );
}

// Kept for the battle modal and the Shell, which import it from here.
export { tileAxis };
