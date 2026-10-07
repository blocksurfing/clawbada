import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'random_evolved';
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const WAIT_MS = Number(process.env.WAIT_MS ?? 90000);

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}

/** Diagnostic: start a practice battle, wait, dump everything the page logged + a screenshot. */
export default async function (b: Browser) {
  await b.send('Network.clearBrowserCache', {});
  await b.goto(`${BASE}/game/battle?preset=${PRESET}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  const reached = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  console.log(`[diag] battle page reached: ${reached} url=${await b.eval('location.href')}`);
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT_MS) {
    if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { console.log(`[diag] HUD bound after ${((Date.now() - t0) / 1000).toFixed(1)} s`); break; }
    await b.sleep(1000);
  }
  await b.screenshot(`${S}/diag-bind.png`);
  const canvas = await b.eval(`(() => { const c = document.querySelector('canvas'); return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null; })()`);
  console.log('[diag] canvas', JSON.stringify(canvas));
  const scripts = await b.eval(`Array.from(document.scripts).map(s => s.src).filter(s => /unity/i.test(s))`);
  console.log('[diag] unity scripts', JSON.stringify(scripts));
  console.log(`[diag] ${b.logs.length} console lines; non-HUD/Battle lines follow:`);
  for (const l of b.logs) if (!/^\[log\] \[(BattleHud|HexGrid|Audio|BattleSfx)/.test(l)) console.log('  ', l.slice(0, 300));
}
