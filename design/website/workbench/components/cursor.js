import { pixelAssets } from '../pixel-assets.js';

// Artist's five 32px cells. Hotspots are source pixels, before integer scaling.
export const cursorFrames = Object.freeze([
  { name: 'normal', x: 0, hotspot: [11, 7], fallback: 'default' },
  { name: 'pointer', x: 32, hotspot: [11, 8], fallback: 'pointer' },
  { name: 'loading0', x: 64, hotspot: [16, 16], fallback: 'progress' },
  { name: 'loading1', x: 96, hotspot: [16, 16], fallback: 'progress' },
  { name: 'disabled', x: 128, hotspot: [16, 16], fallback: 'not-allowed' },

]);
export function cursorValue(url, frame, scale) {
  return `url("${url}") ${frame.hotspot[0] * scale} ${frame.hotspot[1] * scale}, ${frame.fallback}`;
}

export function mountCursor() {
  const root = document.documentElement;
  const fine = matchMedia('(pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const style = document.createElement('style');
  style.dataset.workbenchCursor = '';
  document.head.append(style);
  let disposed = false;
  let timer;
  let frame = 0;
  let point = null;
  let values;
  const stop = () => { clearInterval(timer); timer = undefined; frame = 0; };
  function refresh() {
    if (!values || disposed) return;
    const target = point && document.elementFromPoint(...point);
    const busy = fine.matches && !document.hidden && target?.closest('[aria-busy="true"]');
    if (!busy || reduced.matches) {
      stop();
      root.style.setProperty('--cursor-loading', values.loading0);
    } else if (!timer) {
      timer = setInterval(() => {
        frame = 1 - frame;
        root.style.setProperty('--cursor-loading', values[`loading${frame}`]);
      }, 100);
    }
  }
  let dragging = false;
  const setPressed = pressed => root.toggleAttribute('data-cursor-pressed', pressed);
  const resetPress = () => { dragging = false; setPressed(false); };
  const down = event => {
    if (event.pointerType === 'mouse' && event.button === 0) setPressed(true);
  };
  const up = event => { if (event.button === 0) resetPress(); };
  const cancel = () => { if (!dragging) resetPress(); };
  const dragStart = () => { dragging = true; setPressed(true); };
  const visibility = () => { if (document.hidden) resetPress(); refresh(); };
  const move = event => {
    point = [event.clientX, event.clientY];
    if (event.pointerType === 'mouse' && !dragging) setPressed(Boolean(event.buttons & 1));
    refresh();
  };
  const leave = () => { point = null; refresh(); };
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerleave', leave);
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', resetPress);
  document.addEventListener('dragstart', dragStart, true);
  document.addEventListener('dragend', resetPress, true);
  document.addEventListener('drop', resetPress, true);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('scroll', refresh, true);
  fine.addEventListener('change', refresh);
  reduced.addEventListener('change', refresh);
  const image = new Image();
  image.onload = () => {
    if (disposed) return;
    // Shared 3px token; 96px canvas, at most 42x60 occupied pixels in current art.
    const scale = Math.max(1, Math.min(3, Math.round(parseFloat(getComputedStyle(root).getPropertyValue('--pixel')) || 3)));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32 * scale;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    values = Object.fromEntries(cursorFrames.map(frame => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, frame.x, 0, 32, 32, 0, 0, canvas.width, canvas.height);
      return [frame.name, cursorValue(canvas.toDataURL(), frame, scale)];
    }));
    values.text = 'text';
    root.style.setProperty('--cursor-loading', values.loading0);
    const rule = (selector, value) => `:where(${selector}) { cursor: ${value} !important; }`;
    const descendants = selector => `:is(${selector}), :is(${selector}) *`;
    style.textContent = `@media (pointer: fine) {
      ${rule('html, body, body *', values.normal)}
      ${rule(descendants('button, a[href], summary, select, label[for], [role="button"], [role="link"], [draggable="true"], [data-cursor="pointer"], [data-cursor="grab"], [style*="cursor: grab"], [style*="cursor:grab"]'), values.normal)}
      ${rule(descendants('textarea, input:not([type]), input:is([type="text"],[type="search"],[type="email"],[type="url"],[type="tel"],[type="password"],[type="number"]), [contenteditable="true"]'), values.text)}
      ${rule(descendants('input:is([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="file"],[type="color"])'), values.normal)}
      ${rule(descendants(':disabled, [aria-disabled="true"], [inert]'), values.disabled)}
      ${rule(descendants('[aria-busy="true"]'), 'var(--cursor-loading)')}
      ${rule('html[data-cursor-pressed], html[data-cursor-pressed] *', values.pointer)}
    }`;
    refresh();
  };
  image.src = pixelAssets.cursor.src;
  return () => {
    disposed = true;
    stop();
    image.onload = null;
    observer.disconnect();
    style.remove();
    root.style.removeProperty('--cursor-loading');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerleave', leave);
    resetPress();
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('blur', resetPress);
    document.removeEventListener('dragstart', dragStart, true);
    document.removeEventListener('dragend', resetPress, true);
    document.removeEventListener('drop', resetPress, true);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('scroll', refresh, true);
    fine.removeEventListener('change', refresh);
    reduced.removeEventListener('change', refresh);
  };
}
