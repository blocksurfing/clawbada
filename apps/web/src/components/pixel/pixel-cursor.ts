import { PIXEL_ASSETS, PIXEL_SCALE_EVENT, loadPixelImage, pixelScale } from './pixel-assets';

/**
 * Nzib's pixel cursor (design/website 5cb6655 + 72d1135, workbench `components/cursor.js`): five 32 px cells of
 * `/ui/cursor/cursor.png` turned into CSS cursors — the claw, the pressed claw (same anchor, 72d1135), two hourglass
 * frames that alternate every 100 ms over anything `aria-busy="true"`, and not-allowed over disabled controls. Text
 * fields keep the I-beam; touch devices are untouched (`pointer: fine`).
 *
 * One deviation from the drop: his code rounds `--pixel` to 1–3 and draws a 1× image. Here each cell is drawn at the
 * chrome scale × devicePixelRatio and declared with `-webkit-image-set`, so the claw follows the 3 / 2.5 / 2 chrome
 * and stays sharp on retina (2.5× on a 13" MacBook). A plain 1× `url()` is declared first for browsers without
 * cursor image-sets; a browser keeps the last declaration it understands.
 */
export interface CursorFrame { name: 'normal' | 'pointer' | 'loading0' | 'loading1' | 'disabled'; x: number; hotspot: readonly [number, number]; fallback: string }

/** The artist's five cells. Hotspots are source pixels. */
export const CURSOR_FRAMES: readonly CursorFrame[] = [
  { name: 'normal', x: 0, hotspot: [11, 7], fallback: 'default' },
  { name: 'pointer', x: 32, hotspot: [11, 7], fallback: 'pointer' },
  { name: 'loading0', x: 64, hotspot: [16, 16], fallback: 'progress' },
  { name: 'loading1', x: 96, hotspot: [16, 16], fallback: 'progress' },
  { name: 'disabled', x: 128, hotspot: [16, 16], fallback: 'not-allowed' },
];

/** Device pixels per art pixel for a chrome scale on this screen: whole device pixels only (2.5 × 2 = 5). */
export function deviceFactor(scale: number, dpr: number): number {
  return Math.max(1, Math.round(scale * dpr));
}

/** The two declarations for one frame: a 1× fallback (whole-pixel scale) and the sharp image-set. */
export function cursorDeclarations(frame: CursorFrame, scale: number, url1x: string, urlHi: string, factor: number): [string, string] {
  const s1 = Math.max(1, Math.round(scale));
  const plain = `url("${url1x}") ${frame.hotspot[0] * s1} ${frame.hotspot[1] * s1}, ${frame.fallback}`;
  const resolution = +(factor / scale).toFixed(4);
  const hx = Math.round(frame.hotspot[0] * scale), hy = Math.round(frame.hotspot[1] * scale);
  const sharp = `-webkit-image-set(url("${urlHi}") ${resolution}x) ${hx} ${hy}, ${frame.fallback}`;
  return [plain, sharp];
}

function drawCell(sheet: HTMLImageElement, frame: CursorFrame, factor: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32 * factor;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, frame.x, 0, 32, 32, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL();
}

const INTERACTIVE = 'button, a[href], summary, select, label[for], [role="button"], [role="link"], [draggable="true"], [data-cursor="pointer"], [data-cursor="grab"]';
const TEXT = 'textarea, input:not([type]), input:is([type="text"],[type="search"],[type="email"],[type="url"],[type="tel"],[type="password"],[type="number"]), [contenteditable="true"]';
const INPUTS = 'input:is([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="file"],[type="color"])';
const DISABLED = ':disabled, [aria-disabled="true"], [inert]';
const descendants = (s: string) => `:is(${s}), :is(${s}) *`;

/** His rule set, in his order (later wins): normal everywhere, text fields, disabled, busy, pressed. */
export function cursorStylesheet(values: Record<CursorFrame['name'], [string, string]>): string {
  const rule = (selector: string, [plain, sharp]: [string, string] | readonly [string, string]) =>
    `:where(${selector}) { cursor: ${plain} !important; cursor: ${sharp} !important; }`;
  const text = ['text', 'text'] as const;
  return `@media (pointer: fine) {
  ${rule('html, body, body *', values.normal)}
  ${rule(descendants(INTERACTIVE), values.normal)}
  ${rule(descendants(TEXT), text)}
  ${rule(descendants(INPUTS), values.normal)}
  ${rule(descendants(DISABLED), values.disabled)}
  ${rule(`html:not([data-cursor-loading="1"]) :is(${descendants('[aria-busy="true"]')})`, values.loading0)}
  ${rule(`html[data-cursor-loading="1"] :is(${descendants('[aria-busy="true"]')})`, values.loading1)}
  ${rule('html[data-cursor-pressed], html[data-cursor-pressed] *', values.pointer)}
}`;
}

/** Install the cursor; returns the teardown. */
export function mountPixelCursor(): () => void {
  const root = document.documentElement;
  const fine = matchMedia('(pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const style = document.createElement('style');
  style.dataset.pixelCursor = '';
  document.head.append(style);
  let disposed = false, sheet: HTMLImageElement | null = null, timer = 0, frame = 0, point: [number, number] | null = null, pending = 0, dragging = false;
  let dprQuery: MediaQueryList | null = null;

  const render = () => {
    if (disposed || !sheet) return;
    const scale = pixelScale();
    const dpr = window.devicePixelRatio || 1;
    const factor = deviceFactor(scale, dpr);
    const s1 = Math.max(1, Math.round(scale));
    const values = Object.fromEntries(CURSOR_FRAMES.map((f) => [f.name, cursorDeclarations(f, scale, drawCell(sheet!, f, s1), drawCell(sheet!, f, factor), factor)])) as Record<CursorFrame['name'], [string, string]>;
    style.textContent = cursorStylesheet(values);
    root.dataset.cursorScale = String(scale);
    // A DPR change (window dragged to another screen, browser zoom) redraws at the new resolution.
    dprQuery?.removeEventListener('change', render);
    dprQuery = matchMedia(`(resolution: ${dpr}dppx)`);
    dprQuery.addEventListener('change', render);
  };

  const stop = () => { clearInterval(timer); timer = 0; frame = 0; root.removeAttribute('data-cursor-loading'); };
  // The busy hit-test runs at most once a frame (the battle page moves the pointer a lot).
  const refresh = () => {
    pending = 0;
    if (disposed) return;
    const target = point && document.elementFromPoint(point[0], point[1]);
    const busy = fine.matches && !document.hidden && !!target?.closest('[aria-busy="true"]');
    if (!busy || reduced.matches) stop();
    else if (!timer) timer = window.setInterval(() => { frame = 1 - frame; if (frame) root.setAttribute('data-cursor-loading', '1'); else root.removeAttribute('data-cursor-loading'); }, 100);
  };
  const schedule = () => { if (!pending && !disposed) pending = requestAnimationFrame(refresh); };

  const setPressed = (on: boolean) => root.toggleAttribute('data-cursor-pressed', on);
  const resetPress = () => { dragging = false; setPressed(false); };
  const down = (e: PointerEvent) => { if (e.pointerType === 'mouse' && e.button === 0) setPressed(true); };
  const up = (e: PointerEvent) => { if (e.button === 0) resetPress(); };
  const cancel = () => { if (!dragging) resetPress(); };
  const dragStart = () => { dragging = true; setPressed(true); };
  const visibility = () => { if (document.hidden) resetPress(); schedule(); };
  const move = (e: PointerEvent) => {
    point = [e.clientX, e.clientY];
    if (e.pointerType === 'mouse' && !dragging) setPressed(!!(e.buttons & 1));
    schedule();
  };
  const leave = () => { point = null; schedule(); };

  const observer = new MutationObserver(schedule);
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
  document.addEventListener('scroll', schedule, true);
  fine.addEventListener('change', schedule);
  reduced.addEventListener('change', schedule);
  window.addEventListener(PIXEL_SCALE_EVENT, render);
  loadPixelImage(PIXEL_ASSETS.cursor.src).then((img) => { sheet = img; render(); schedule(); }).catch(console.error);

  return () => {
    disposed = true;
    stop();
    cancelAnimationFrame(pending);
    observer.disconnect();
    style.remove();
    resetPress();
    delete root.dataset.cursorScale;
    dprQuery?.removeEventListener('change', render);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerleave', leave);
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('blur', resetPress);
    document.removeEventListener('dragstart', dragStart, true);
    document.removeEventListener('dragend', resetPress, true);
    document.removeEventListener('drop', resetPress, true);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('scroll', schedule, true);
    fine.removeEventListener('change', schedule);
    reduced.removeEventListener('change', schedule);
    window.removeEventListener(PIXEL_SCALE_EVENT, render);
  };
}
