'use client';

import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';
import { PIXEL_ASSETS, frameRect, loadPixelImage, type SpriteAssetName } from './pixel-assets';

interface PixelSpriteProps extends HTMLAttributes<HTMLSpanElement> {
  asset: SpriteAssetName;
  frame?: number;
}

/**
 * One frame of a pixel sheet at the global 3× scale (Nzib's `[data-pixel-sprite]`): a source-resolution canvas
 * sized by `--sprite-width/height`, never a stretched background. Decorative by default (`aria-hidden`);
 * pass `role="img"` + `aria-label` when it carries meaning.
 */
export function PixelSprite({ asset, frame = 0, className, style, ...rest }: PixelSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheet = PIXEL_ASSETS[asset];
  const rect = frameRect(sheet, frame);
  useEffect(() => {
    let disposed = false;
    loadPixelImage(sheet.src).then((image) => {
      const canvas = canvasRef.current;
      if (disposed || !canvas) return;
      canvas.width = rect.width; canvas.height = rect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    }).catch(console.error);
    return () => { disposed = true; };
  }, [sheet.src, rect.x, rect.y, rect.width, rect.height]);
  const vars = { '--sprite-width': rect.width, '--sprite-height': rect.height, ...style } as CSSProperties;
  return (
    <span aria-hidden={rest.role ? undefined : 'true'} className={`pixel-sprite${className ? ` ${className}` : ''}`} data-pixel-sprite={asset} data-frame={frame} style={vars} {...rest}>
      <canvas ref={canvasRef} aria-hidden="true" width={rect.width} height={rect.height} />
    </span>
  );
}
