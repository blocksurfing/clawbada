import type { Browser } from './cdp';
import { chromePixelScale } from '../../apps/web/src/components/pixel/pixel-assets';

/**
 * Nzib's pixel cursor (components/pixel/pixel-cursor.ts). Headless Chrome can't show the OS cursor, so this reads the
 * computed `cursor` of each kind of element and decodes its image:
 *   · the claw on the page and on controls, the I-beam in text fields, not-allowed on disabled controls, the hourglass
 *     on aria-busy (and it alternates while the pointer is over it), the pressed claw while the button is held;
 *   · each image is 32 × (chrome scale × DPR) device px, declared at the chrome scale, hotspot = source × scale;
 *   · no trace of the old SVG cursors; the same on the Shell and the Market.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts cursor-probe.ts
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const SIZES: [number, number, number][] = [[1440, 755, 2], [1920, 955, 1]];

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  /** The computed cursor of an element: its fallback keyword, hotspot, image-set resolution and decoded image size. */
  const read = (js: string) => b.eval(`(async () => {
    const el = ${js}; if (!el) return null;
    const c = getComputedStyle(el).cursor;
    const m = /image-set\\(url\\("?(data:[^")]+)"?\\) ([\\d.]+)(?:x|dppx)\\) (\\d+) (\\d+), ([a-z-]+)/.exec(c);
    if (!m) return { raw: c.slice(0, 80) };
    const img = new Image(); img.src = m[1]; await img.decode();
    return { res: Number(m[2]), hx: Number(m[3]), hy: Number(m[4]), fallback: m[5], w: img.naturalWidth, h: img.naturalHeight };
  })()`) as Promise<{ res?: number; hx?: number; hy?: number; fallback?: string; w?: number; h?: number; raw?: string } | null>;

  for (const [w, h, dpr] of SIZES) {
    const tag = `${w}×${h} @${dpr}x`;
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    await b.goto(`${BASE}/dojo`);
    await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]') && !!document.querySelector('style[data-pixel-cursor]')?.textContent`, 60000, 250);
    await b.sleep(800);
    const scale = chromePixelScale(w, h, dpr);
    const px = Math.round(32 * Math.round(scale * dpr));
    const expectFrame = (name: string, r: Awaited<ReturnType<typeof read>>, fallback: string, hot: [number, number]) =>
      ok(`${tag} ${name}`, !!r && r.fallback === fallback && r.w === px && r.h === px && Math.abs((r.res ?? 0) - Math.round(scale * dpr) / scale) < 0.01 && r.hx === Math.round(hot[0] * scale) && r.hy === Math.round(hot[1] * scale), JSON.stringify(r));
    expectFrame('claw on the page', await read(`document.body`), 'default', [11, 7]);
    expectFrame('claw on a button', await read(`document.querySelector('[data-team-mode=builder]')`), 'default', [11, 7]);
    expectFrame('claw on a select', await read(`document.querySelector('.dojo-card select')`), 'default', [11, 7]);
    expectFrame('not-allowed on a disabled control', await read(`document.querySelector('[data-testid=dojo-friend-tab]')`), 'not-allowed', [16, 16]);
    const text = await b.eval(`(() => { const i = document.createElement('input'); i.type = 'text'; i.id = '__probe_input'; document.body.append(i); const c = getComputedStyle(i).cursor; i.remove(); return c; })()`);
    ok(`${tag} I-beam in a text field`, text === 'text', String(text));
    // The hourglass: mark the Battle button busy, hover it, and watch the two frames alternate.
    await b.eval(`document.querySelector('[data-testid=dojo-battle]').setAttribute('aria-busy', 'true')`);
    expectFrame('hourglass on aria-busy', await read(`document.querySelector('[data-testid=dojo-battle]')`), 'progress', [16, 16]);
    const bp = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bp.x, y: bp.y });
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) { seen.add(String(await b.eval(`document.documentElement.getAttribute('data-cursor-loading')`))); await b.sleep(45); }
    ok(`${tag} the hourglass animates over a busy control`, seen.has('1') && seen.has('null'), [...seen].join(','));
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: h - 5 });
    await b.eval(`document.querySelector('[data-testid=dojo-battle]').setAttribute('aria-busy', 'false')`);
    await b.sleep(300);
    ok(`${tag} the hourglass stops off the busy control`, (await b.eval(`document.documentElement.getAttribute('data-cursor-loading')`)) === null);
    // The pressed claw while the button is held.
    const spot = { x: Math.round(w * 0.5), y: Math.round(h * 0.45) };
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', buttons: 1, clickCount: 1 });
    await b.sleep(100);
    expectFrame('pressed claw while held', await read(`document.body`), 'pointer', [11, 7]);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', buttons: 0, clickCount: 1 });
    await b.sleep(100);
    ok(`${tag} back to the claw on release`, (await read(`document.body`))?.fallback === 'default');
    ok(`${tag} no old SVG cursor anywhere`, !(await b.eval(`Array.from(document.styleSheets).some(s => { try { return Array.from(s.cssRules).some(r => r.cssText.includes('/assets/cursors/')); } catch (e) { return false; } })`)));
    for (const path of ['/game', '/market']) {
      await b.goto(`${BASE}${path}`);
      await b.waitFor(`!!document.querySelector('style[data-pixel-cursor]')?.textContent`, 60000, 250);
      expectFrame(`claw on ${path}`, await read(`document.body`), 'default', [11, 7]);
    }
  }
  console.log(checks.join('\n'));
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails ? `[cursor] ${fails} FAIL of ${checks.length}` : `[cursor] all ${checks.length} ok`);
}
