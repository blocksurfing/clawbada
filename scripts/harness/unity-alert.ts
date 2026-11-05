/**
 * Unity's alert box (2026-11-05). Unity's WebGL loader answers ANY window error or unhandled rejection with a blocking
 * alert("An error occurred running the Unity content…"); a wallet library's rejection on a fresh battle-page load (the
 * Family Accounts connector, on localhost) stopped the page dead. apps/web/src/lib/unity-error-guard.ts keeps errors
 * that aren't Unity's away from it.
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts unity-alert.ts
 *
 * 1. A live Dojo battle: once Unity is up, the page throws an ordinary error and an unhandled rejection → no dialog,
 *    the page still answers, the guard logged both.
 * 2. The battle resigned, then opened fresh (`?stay=1`, so the page stays on the result) → no dialog for 15 s.
 * 3. An error that looks like Unity's own (a wasm stack) still reaches Unity's handler (its alert opens; dismissed).
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Page.enable');
  const dialogs: string[] = [];
  b.on('Page.javascriptDialogOpening', (p: any) => { dialogs.push(String(p.message).slice(0, 160)); });
  const dismiss = async () => { try { await b.send('Page.handleJavaScriptDialog', { accept: true }); } catch { /* none open */ } };
  const responsive = async () => { try { return (await b.eval('1')) === 1; } catch { return false; } };

  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  await b.goto(`${BASE}/dojo?team=bulwark,mantis,kraken&tier=elite&bot=balanced`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), 'Dojo opened');
  await b.sleep(2000);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  await b.clickAt(r.x, r.y);
  ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), 'battle opened');
  const id = await b.eval(`location.pathname.split('/').pop()`) as string;
  let up = false;
  for (const t0 = Date.now(); Date.now() - t0 < 90000 && !up; ) { up = b.allLogs.some((l) => l.includes('[BattleHud] ready')); if (!up) await b.sleep(500); }
  ok(up, 'Unity is running');

  // 1. Ordinary page errors while Unity runs.
  b.drainLogs();
  dialogs.length = 0;
  await b.eval(`setTimeout(() => { throw new Error('probe: an ordinary page error'); }, 0); Promise.reject(new Error('probe: an unhandled rejection')); 1`);
  await b.sleep(3000);
  ok(dialogs.length === 0, `no alert for the page's own errors${dialogs.length ? ` (got: ${dialogs[0]})` : ''}`);
  await dismiss();
  ok(await responsive(), 'the page still answers');
  const kept = b.logs.filter((l) => l.includes('[UnityErrorGuard]')).length;
  ok(kept >= 2, `the guard logged both (${kept})`);

  // 2. A fresh load of the finished battle, staying on the result.
  const status = await b.eval(`(async () => { const tok = JSON.parse(localStorage.getItem('clawbada.session.guest')).token; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/${id}/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`);
  ok(status === 200, `resigned (${status})`);
  await b.waitFor(`location.pathname === '/dojo'`, 120000, 250);
  dialogs.length = 0;
  b.drainLogs();
  await b.goto(`${BASE}/battle/${id}?stay=1`);
  await b.sleep(15000);
  ok(dialogs.length === 0, `fresh load of the finished battle: no alert in 15 s${dialogs.length ? ` (got: ${dialogs[0]})` : ''}`);
  await dismiss();
  ok(await responsive(), 'the page still answers');
  const guarded = b.logs.filter((l) => l.includes('[UnityErrorGuard]'));
  if (guarded.length) console.log(`  (kept from the alert on load: ${guarded[0].slice(0, 160)})`);

  // 3. Unity's own errors still reach Unity.
  dialogs.length = 0;
  await b.eval(`setTimeout(() => { const e = new Error('probe: a Unity-shaped error'); e.stack = 'Error: probe\\n    at wasm://wasm/0a1b2c3d:wasm-function[1]:0x10'; throw e; }, 0); 1`);
  await b.sleep(2000);
  ok(dialogs.length === 1, `a Unity-shaped error still reaches Unity's handler (${dialogs.length} alert)`);
  await dismiss();
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
