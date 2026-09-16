import type { Browser } from './cdp';
/** All-Bulwark at 1× speed: do Fortify casts overlap (two domes alive at once)? Records the wall
 *  time of each new cast, every [BattleStage] console line, and screenshots any cast that lands
 *  within 7 s of the previous one. */
const ORIGIN = 'http://127.0.0.1:3000';
const SPEED = process.env.SPEED ?? '1';
const TAG = process.env.TAG ?? '';
const S = `${import.meta.dir}/out`;
const count = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).length;
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`${ORIGIN}/game/battle?preset=trio_bulwark&auto=1&speed=${SPEED}`);
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
    while (Date.now() - t0 < 150000) { if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; } if (b.logs.some((l) => /GLctx/.test(l))) break; await b.sleep(500); }
  }
  if (!inited) { console.log('FAIL Unity never bound'); return; }
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  console.log('battle:', await b.eval('location.pathname'));
  const start = Date.now(); let seen = 0; const castTimes: number[] = []; let shots = 0;
  while (Date.now() - start < 120000) {
    const n = count(b, /special Bulwark effect/);
    if (n > seen) {
      const t = (Date.now() - start) / 1000; const gap = castTimes.length ? t - castTimes[castTimes.length - 1] : Infinity;
      castTimes.push(t); seen = n;
      console.log(`cast #${n} at ${t.toFixed(1)}s (gap ${gap === Infinity ? '—' : gap.toFixed(1) + 's'})`);
      if (gap < 13 && shots < 3) { await b.sleep(2500); await b.screenshot(`${S}/overlap${TAG}-${n}.png`); shots++; console.log(`  screenshot overlap-${n}.png (two domes should be alive)`); }
    }
    if (b.logs.some((l) => /Battle over!/.test(l))) break;
    await b.sleep(500);
  }
  const wd = b.logs.filter((l) => /did not report turn .* animation complete/.test(l));
  console.log(`watchdog fired: ${wd.length}×`); for (const l of wd.slice(0, 3)) console.log('  ', l.replace(/^\[(log|warning|warn|error)\] /, '').slice(0, 150));
  console.log('turn routines cut short (Unity):', count(b, /cut short|stopping the running turn/i));
  const gaps = castTimes.slice(1).map((t, i) => t - castTimes[i]);
  console.log('cast gaps (s):', gaps.map((g) => g.toFixed(1)).join(' '), '| min:', gaps.length ? Math.min(...gaps).toFixed(1) : '—');
}
