import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector}`); await b.clickAt(r.x, r.y);
}
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  const dpr = Number(process.env.DPR ?? '2');
  await b.send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.VW ?? '1400'), height: Number(process.env.VH ?? '900'), deviceScaleFactor: dpr, mobile: false });
  await b.goto('http://127.0.0.1:3000/game/battle?preset=trio_bulwark');
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let a = 0; a < 4; a++) { await b.sleep(800); await rectClick(b, 'button', 'burner wallet').catch(() => {}); if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break; }
  await b.sleep(500); await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  const t0 = Date.now();
  while (Date.now() - t0 < 150000 && !b.logs.some((l) => /\[BattleHud\] cells/.test(l) && /\(0,4\)/.test(l))) await b.sleep(500);
  const layout = b.logs.filter((l) => /\[BattleHud\] layout/.test(l)).slice(-1)[0] ?? '';
  const cells = b.logs.filter((l) => /\[BattleHud\] cells/.test(l)).slice(-1)[0] ?? '';
  console.log(layout.replace(/^\[log\] /, ''));
  console.log(cells.replace(/^\[log\] /, ''));
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`); await b.sleep(1000);
  const before = b.logs.filter((l) => /\[BattleHud\] layout/.test(l)).length;
  // Enter fullscreen through the real button (needs a user gesture — a CDP mouse click counts).
  const fb = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(x => /FULL/.test(x.textContent)); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  console.log('fullscreen button', JSON.stringify(fb));
  if (fb) { await b.clickAt(fb.x, fb.y); await b.sleep(3000); }
  console.log('fullscreenElement', await b.eval(`document.fullscreenElement ? document.fullscreenElement.tagName + '.' + document.fullscreenElement.className.slice(0, 40) : 'none'`));
  const geom2 = await b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { bw: c.width, bh: c.height, cssW: r.width, cssH: r.height, x: r.x, y: r.y, win: [innerWidth, innerHeight] } })()`);
  console.log('canvas after fullscreen', JSON.stringify(geom2));
  // Force a layout dump in Unity by waiting for the next player turn log, else just screenshot.
  await b.sleep(4000);
  await b.screenshot(`${S}/fs-probe.png`);
  const lays = b.logs.filter((l) => /\[BattleHud\] (layout|ready)/.test(l));
  console.log('layout lines after fullscreen:', lays.length - before, (lays.slice(-1)[0] ?? '').replace(/^\[log\] /, '').slice(0, 260));
  const geom = await b.eval(`(() => { const c = document.querySelector('canvas'); return { bw: c.width, bh: c.height, css: c.getBoundingClientRect().width } })()`);
  console.log('canvas', JSON.stringify(geom));
}
