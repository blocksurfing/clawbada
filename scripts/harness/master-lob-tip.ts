/**
 * The Master Lob guidance toggle's note on the Dojo (owner 2026-11-07: after a click it stayed up when the pointer left).
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts master-lob-tip.ts
 * Hover shows the note; pointer away hides it; click, then pointer away → hidden (the click's focus does not pin it);
 * keyboard focus (Tab) shows it.
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  await b.goto(`${BASE}/dojo`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-master-lob]')`, 60000, 200), 'toggle shown');
  await b.sleep(1500);
  const visible = () => b.eval(`getComputedStyle(document.querySelector('#dojo-master-lob-tooltip')).visibility === 'visible' && document.querySelector('#dojo-master-lob-tooltip').matches(':popover-open')`) as Promise<boolean>;
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-master-lob]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  const away = { x: r.x + 400, y: r.y - 200 };
  const move = (p: { x: number; y: number }) => b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });

  await move(r); await b.sleep(300);
  ok(await visible(), 'hover shows the note');
  await move(away); await b.sleep(300);
  ok(!(await visible()), 'pointer away hides it');
  await move(r); await b.sleep(200);
  const before = await b.eval(`document.querySelector('[data-testid=dojo-master-lob]').getAttribute('aria-pressed')`);
  await b.clickAt(r.x, r.y); await b.sleep(300);
  const after = await b.eval(`document.querySelector('[data-testid=dojo-master-lob]').getAttribute('aria-pressed')`);
  ok(before !== after, `the click toggles guidance (${before} → ${after})`);
  await move(away); await b.sleep(400);
  ok(!(await visible()), 'after a click, pointer away hides it');
  // Put it back as it was, then keyboard focus.
  await move(r); await b.clickAt(r.x, r.y); await move(away); await b.sleep(300);
  await b.eval(`document.activeElement?.blur()`);
  await b.eval(`document.querySelector('[data-testid=dojo-master-lob]').focus({ focusVisible: true })`);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  await b.sleep(300);
  const fv = await b.eval(`document.querySelector('[data-testid=dojo-master-lob]').matches(':focus-visible')`);
  ok(!fv || await visible(), `keyboard focus shows it (focus-visible ${fv})`);
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
