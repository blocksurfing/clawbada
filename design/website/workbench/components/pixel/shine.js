// Opt-in artist shine; mask against the final nine-sliced canvas, never repeat tiles.
import { tileAxis } from './geometry.js';
const maskSource = new URL('../../../site/Tileset/GoldenShineMask.png', import.meta.url).href;
const source = new URL('../../../site/Effects/Shining/Shine.png', import.meta.url).href;
export function mountButtonShine(root) {
  const entries = [...root.querySelectorAll('[data-button-shine][data-pixel-panel="globalGoldenButton"]')].map(element => {
    const canvas = document.createElement('canvas');
    canvas.className = 'pixel-button-shine';
    canvas.setAttribute('aria-hidden', 'true');
    element.append(canvas);
    return { element, canvas };
  });
  const image = new Image(); image.src = source;
  const maskImage = new Image(); maskImage.src = maskSource;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let id = 0, disposed = false;
  const start = performance.now();
  // Inspection-only URL option; normal preview keeps its periodic animation.
  const freezeShine = new URLSearchParams(location.search).get('shine') === 'paused';
  function draw(now) {
    if (disposed) return;
    for (const {element, canvas} of entries) {
      const base = element.querySelector('.pixel-panel-art--normal');
      if (!base || element.dataset.pixelReady !== 'true') continue;
      if (canvas.width !== base.width || canvas.height !== base.height) {
        canvas.width = base.width; canvas.height = base.height;
      }
      canvas.style.width = base.style.width; canvas.style.height = base.style.height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const phase = freezeShine ? 4400 : (now-start) % 5000;
      if (reduced.matches || document.hidden || element.matches(':active') || phase < 4000 || phase >= 4800 || !image.complete || !image.naturalWidth || !maskImage.complete || !maskImage.naturalWidth) continue;
      const progress = (phase-4000)/800;
      const height = Math.max(canvas.height, image.height);
      const width = Math.round(image.width * height/image.height);
      const x = Math.round(canvas.width - progress*(canvas.width+width));
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(image,x,0,width,height);
      ctx.globalAlpha = 1;
      // No canvas readback: privacy protections can perturb getImageData colors.
      const mask = document.createElement('canvas');
      mask.width=canvas.width; mask.height=canvas.height;
      const mc=mask.getContext('2d'); mc.imageSmoothingEnabled=false;
      for (const row of tileAxis(canvas.height,16)) for (const col of tileAxis(canvas.width,16)) {
        mc.drawImage(maskImage,96+col.source,row.source,col.size,row.size,col.dest,row.dest,col.size,row.size);
      }
      ctx.globalCompositeOperation='destination-in';
      ctx.drawImage(mask,0,0);
      ctx.globalCompositeOperation='source-over';
    }
    if (entries.length) id = requestAnimationFrame(draw);
  }
  if (entries.length) id = requestAnimationFrame(draw);
  return () => { disposed = true; cancelAnimationFrame(id); entries.forEach(({canvas})=>canvas.remove()); };
}
