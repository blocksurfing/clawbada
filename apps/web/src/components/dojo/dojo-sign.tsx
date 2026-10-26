'use client';

import { useEffect, useRef } from 'react';
import { PIXEL_ASSETS, PIXEL_SCALE_EVENT, loadPixelImage, pixelScale } from '@/components/pixel/pixel-assets';

/** Keep both 32 px end caps (with their ropes); only the 16 px middle repeats (Nzib's `paintDojoSign`). */
function paintSign(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, 64);
  ctx.drawImage(image, 0, 0, 32, 64, 0, 0, 32, 64);
  for (let x = 32; x < width - 32; x += 16) {
    const size = Math.min(16, width - 32 - x);
    ctx.drawImage(image, 32, 0, size, 64, x, 0, size, 64);
  }
  ctx.drawImage(image, 48, 0, 32, 64, width - 32, 0, 32, 64);
}

/**
 * The hanging wooden sign with the page title (`components/dojo-sign.js`): sized to the title, the font shrunk to
 * fit when the header is narrow, two ink swirls beside the word, and the chains repeated up to the top of the window.
 */
export function DojoSign({ title }: { title: string }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const signRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const chainsRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const inkRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];

  useEffect(() => {
    const header = headerRef.current, sign = signRef.current, board = boardRef.current, chains = chainsRef.current;
    const heading = titleRef.current, label = labelRef.current;
    const inks = inkRefs.map((r) => r.current);
    if (!header || !sign || !board || !chains || !heading || !label || inks.some((i) => !i)) return;
    let image: HTMLImageElement | null = null, disposed = false, frame = 0;
    const render = () => {
      frame = 0;
      if (disposed || !image) return;
      const scale = pixelScale(header);
      // On-screen measurements are in window px; the stage scales the whole composition.
      const stage = parseFloat(getComputedStyle(header).getPropertyValue('--dojo-stage-scale')) || 1;
      heading.style.fontSize = '';
      const naturalSize = parseFloat(getComputedStyle(heading).fontSize);
      const range = document.createRange();
      range.selectNodeContents(label);
      const naturalWidth = range.getBoundingClientRect().width / stage;
      const available = Math.floor(header.clientWidth / scale);
      if (available < 80 || !naturalWidth) return;
      const width = Math.min(available, Math.ceil(naturalWidth / scale) + 96);
      // The label interior starts at source x20; keep a further 4 px of breathing room.
      const textWidth = (width - 48 - 40) * scale;
      heading.style.fontSize = `${Math.min(naturalSize, (naturalSize * textWidth) / naturalWidth)}px`;
      sign.style.width = `${width * scale}px`;
      board.width = width; board.height = 64;
      board.style.width = `${width * scale}px`; board.style.height = `${64 * scale}px`;
      paintSign(board.getContext('2d')!, image, width);
      inks.forEach((ink, i) => {
        const ctx = ink!.getContext('2d')!;
        ctx.clearRect(0, 0, 16, 16);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image!, 80, i === 0 ? 32 : 16, 16, 16, 0, 0, 16, 16);
      });
      // Repeat the original 3-row chain cycle upward, keeping its phase.
      const rows = Math.max(0, Math.ceil(sign.getBoundingClientRect().top / (scale * stage)));
      chains.width = width; chains.height = Math.max(1, rows);
      chains.style.width = `${width * scale}px`; chains.style.height = `${rows * scale}px`;
      chains.style.top = `${-rows * scale}px`;
      const ctx = chains.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, chains.width, chains.height);
      for (let y = 0; y < rows; y++) {
        const sy = (((y - rows) % 3) + 3) % 3;
        ctx.drawImage(image, 0, sy, 32, 1, 0, y, 32, 1);
        ctx.drawImage(image, 48, sy, 32, 1, width - 32, y, 32, 1);
      }
      sign.dataset.ready = 'true';
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(render); };
    loadPixelImage(PIXEL_ASSETS.dojoSign.src).then((img) => { image = img; schedule(); }).catch(console.error);
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    void document.fonts.ready.then(schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener(PIXEL_SCALE_EVENT, schedule);
    window.addEventListener('clawbada:dojo-stage', schedule);
    const scroller = header.closest('.dojo-page');
    scroller?.addEventListener('scroll', schedule);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener(PIXEL_SCALE_EVENT, schedule); window.removeEventListener('clawbada:dojo-stage', schedule);
      scroller?.removeEventListener('scroll', schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page-header" ref={headerRef}>
      <div className="dojo-sign" ref={signRef}>
        <canvas className="dojo-sign-chains" ref={chainsRef} aria-hidden="true" />
        <canvas ref={boardRef} aria-hidden="true" />
        <h1 className="page-title" ref={titleRef}>
          <canvas className="dojo-sign-ink" width={16} height={16} ref={inkRefs[0]} aria-hidden="true" />
          <span ref={labelRef}>{title}</span>
          <canvas className="dojo-sign-ink" width={16} height={16} ref={inkRefs[1]} aria-hidden="true" />
        </h1>
      </div>
    </div>
  );
}
