import { pixelAssets } from '../pixel-assets.js';

// Keep both 32px endcaps (including ropes); only the 16px middle repeats.
export function paintDojoSign(ctx, image, width) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, 64);
  ctx.drawImage(image, 0, 0, 32, 64, 0, 0, 32, 64);
  for (let x = 32; x < width - 32; x += 16) {
    const size = Math.min(16, width - 32 - x);
    ctx.drawImage(image, 32, 0, size, 64, x, 0, size, 64);
  }
  ctx.drawImage(image, 48, 0, 32, 64, width - 32, 0, 32, 64);
}

export function mountDojoSign(root) {
  if (root.dataset.page !== 'dojo') return () => {};
  const title = root.querySelector('.page-title');
  const header = title.parentElement;
  const label = document.createElement('span');
  label.textContent = title.textContent;
  const inks = [32, 16].map(y => {
    const ink = document.createElement('canvas');
    ink.className = 'dojo-sign-ink';
    ink.width = 16; ink.height = 16;
    ink.setAttribute('aria-hidden', 'true');
    ink.dataset.sourceY = y;
    return ink;
  });
  title.replaceChildren(inks[0], label, inks[1]);
  const sign = document.createElement('div');
  sign.className = 'dojo-sign';
  title.before(sign);
  sign.append(title);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  sign.prepend(canvas);
  const chains = document.createElement('canvas');
  chains.className = 'dojo-sign-chains';
  chains.setAttribute('aria-hidden', 'true');
  sign.prepend(chains);
  const image = new Image();
  let disposed = false;
  function render() {
    if (disposed || !image.complete || !image.naturalWidth) return;
    const scale = parseFloat(getComputedStyle(root).getPropertyValue('--pixel'));
    title.style.fontSize = '';
    const naturalSize = parseFloat(getComputedStyle(title).fontSize);
    const measure = document.createRange();
    measure.selectNodeContents(label);
    const naturalWidth = measure.getBoundingClientRect().width;
    const available = Math.floor(header.clientWidth / scale);
    if (available < 80) return;
    const width = Math.min(available, Math.ceil(naturalWidth / scale) + 96);
    // Label interior starts at source x20; retain a further 4px of breathing room.
    const textWidth = (width - 48 - 40) * scale;
    title.style.fontSize = `${Math.min(naturalSize, naturalSize * textWidth / naturalWidth)}px`;
    sign.style.width = `${width * scale}px`;
    canvas.width = width;
    canvas.height = 64;
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${64 * scale}px`;
    paintDojoSign(canvas.getContext('2d'), image, width);
    for (const ink of inks) {
      const ctx = ink.getContext('2d');
      ctx.clearRect(0, 0, 16, 16);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 80, Number(ink.dataset.sourceY), 16, 16, 0, 0, 16, 16);
    }
    // Repeat the original 3-row chain cycle upward, preserving its phase.
    const rows = Math.max(0, Math.ceil(sign.getBoundingClientRect().top / scale));
    chains.width = width;
    chains.height = rows;
    chains.style.width = `${width * scale}px`;
    chains.style.height = `${rows * scale}px`;
    chains.style.top = `${-rows * scale}px`;
    const chainCtx = chains.getContext('2d');
    chainCtx.imageSmoothingEnabled = false;
    for (let y = 0; y < rows; y++) {
      const sy = ((y - rows) % 3 + 3) % 3;
      chainCtx.drawImage(image, 0, sy, 32, 1, 0, y, 32, 1);
      chainCtx.drawImage(image, 48, sy, 32, 1, width - 32, y, 32, 1);
    }
    sign.dataset.ready = 'true';
  }
  image.onload = render;
  image.src = pixelAssets.dojoSign.src;
  const observer = new ResizeObserver(render);
  observer.observe(header);
  document.fonts.ready.then(render);
  window.addEventListener('resize', render);
  root.addEventListener('scroll', render, true);
  return () => { disposed = true; observer.disconnect(); image.onload = null; window.removeEventListener('resize', render); root.removeEventListener('scroll', render, true); };
}
