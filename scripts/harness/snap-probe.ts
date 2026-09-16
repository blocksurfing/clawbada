import type { Browser } from './cdp';
/** Pixel-perfect check under an emulated device pixel ratio: canvas css/backing size, Unity's
 *  camera mode, and the hex pitch in device pixels (must be exactly 64·k when snapped). */
const ORIGIN = 'http://127.0.0.1:3000';
const DPR = Number(process.env.DPR ?? '1');
const W = Number(process.env.W ?? '1600'), H = Number(process.env.H ?? '1000');
export default async function (b: Browser) {
  await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await b.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`${ORIGIN}/game/battle?preset=trio_tempest&auto=1&speed=3`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let i = 0; i < 4; i++) {
    await b.sleep(800);
    const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent||'').includes('burner wallet')); if (!el) return null; const q = el.getBoundingClientRect(); return {x:q.x+q.width/2,y:q.y+q.height/2}; })()`);
    if (r) await b.clickAt((r as any).x, (r as any).y);
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  const st = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent||'').includes('Start practice')); if (!el) return null; const q = el.getBoundingClientRect(); return {x:q.x+q.width/2,y:q.y+q.height/2}; })()`);
  if (st) await b.clickAt((st as any).x, (st as any).y);
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) { if (b.logs.some((l) => /\[BattleHud\] bind/.test(l)) && b.logs.some((l) => /\[BattleHud\] cells/.test(l))) { inited = true; break; } if (b.logs.some((l) => /GLctx/.test(l))) break; await b.sleep(500); }
  }
  if (!inited) { console.log('FAIL Unity never bound'); return; }
  await b.sleep(1500);
  const geom = await b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { cssW: +r.width.toFixed(2), cssH: +r.height.toFixed(2), backingW: c.width, backingH: c.height, dpr: window.devicePixelRatio, column: c.closest('[data-battle-stage]')?.clientWidth }; })()`) as any;
  console.log('canvas:', JSON.stringify(geom));
  for (const l of b.logs.filter((x) => /\[BattleStage\] canvas (snap|fill)|\[BattleHud\] camera mode/.test(x))) console.log('  ', l.replace(/^\[log\] /, '').slice(0, 160));
  const cells = [...b.logs].reverse().find((l) => /\[BattleHud\] cells/.test(l)) ?? '';
  const pts: Record<string, [number, number]> = {};
  for (const m of cells.matchAll(/\((\d+),(\d+)\)=\((-?\d+),(-?\d+)\)/g)) pts[`${m[1]},${m[2]}`] = [+m[3], +m[4]];
  if (pts['0,0'] && pts['1,0']) {
    const pitch = pts['1,0'][0] - pts['0,0'][0];
    const zoom = pitch / 64;
    console.log(`hex pitch: ${pitch} device px per unit → zoom ${zoom.toFixed(3)}× → ${Number.isInteger(zoom) ? 'INTEGER — pixel-perfect ✓' : 'fractional'}`);
  } else console.log('no cells parsed');
  const exact = geom.backingW % 640 === 0 && geom.backingH % 360 === 0 && geom.backingW / 640 === geom.backingH / 360;
  console.log(`backing ${geom.backingW}×${geom.backingH} is an exact 640k×360k: ${exact}${exact ? ` (k=${geom.backingW / 640})` : ''}`);
}
