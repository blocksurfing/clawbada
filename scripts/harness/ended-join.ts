/**
 * Joining a battle that is already over (bug 2026-11-04: a friend resigned the rematch while both pages were still
 * loading; the server ended it and dropped it from memory before either socket joined, so neither page ever heard
 * `battle_ended` and both sat on the battle page forever).
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts ended-join.ts
 *
 * Plays nothing: opens a Dojo battle, resigns it through the API, lets the page return to the Dojo, then opens the same
 * battle again — a page joining a finished battle. It must go straight back to the Dojo on its own (mounting Unity on a
 * finished battle froze the page).
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  await b.goto(`${BASE}/dojo?team=bulwark,mantis,kraken&tier=elite&bot=balanced`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), 'Dojo opened');
  await b.sleep(2000);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  await b.clickAt(r.x, r.y);
  ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), 'battle opened');
  const id = await b.eval(`location.pathname.split('/').pop()`) as string;
  const status = await b.eval(`(async () => { const tok = JSON.parse(localStorage.getItem('clawbada.session.guest')).token; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/${id}/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`);
  ok(status === 200, `resigned (${status})`);
  ok(await b.waitFor(`location.pathname === '/dojo'`, 120000, 250), 'the live page returns to the Dojo');
  // Now open the finished battle again — a page that joins after the end.
  b.drainLogs();
  await b.goto(`${BASE}/battle/${id}`);
  // Unity's load can stall the page's main thread past a CDP evaluate timeout: poll and ride those out.
  let back = false, path = '';
  for (const t0 = Date.now(); Date.now() - t0 < 60000 && !back; ) {
    try { path = await b.eval('location.pathname') as string; back = path === '/dojo'; } catch { /* page busy loading */ }
    if (!back) await b.sleep(500);
  }
  ok(back, `a page joining the finished battle goes back to the Dojo (${path})`);
  ok(b.logs.some((l) => /already over when this page joined/.test(l)), 'it recognised the battle was already over');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
