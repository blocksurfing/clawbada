import type { Browser } from './cdp';
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector}`); await b.clickAt(r.x, r.y);
}
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
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
  const geom = await b.eval(`(() => { const c = document.querySelector('canvas'); return { bw: c.width, bh: c.height, css: c.getBoundingClientRect().width } })()`);
  console.log('canvas', JSON.stringify(geom));
}
