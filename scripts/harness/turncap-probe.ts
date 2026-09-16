import type { Browser } from './cdp';
/** Nzib's scenario: all-Bulwark battle run to the 100-turn cap. Watch the Special cadence in the
 *  final seconds and screenshot the DEFEAT/VICTORY banner moment to count domes. */
const ORIGIN = 'http://127.0.0.1:3000';
const S = `${import.meta.dir}/out`;
const count = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).length;
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`${ORIGIN}/game/battle?preset=trio_bulwark&auto=1&speed=4`);
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
  // Sample the Special cadence every 2 s until the battle ends (cap 420 s).
  const samples: { t: number; specials: number; turns: number; playTurns: number }[] = [];
  const start = Date.now(); let ended = false;
  while (Date.now() - start < 420000) {
    samples.push({ t: Math.round((Date.now() - start) / 1000), specials: count(b, /special Bulwark effect/), turns: count(b, /"action":/), playTurns: count(b, /PlayTurn:/) });
    if (b.logs.some((l) => /Battle over!/.test(l))) { ended = true; break; }
    await b.sleep(2000);
  }
  console.log('ended:', ended, 'after', samples.at(-1)?.t, 's; PlayTurn total', samples.at(-1)?.playTurns, '; Fortify casts total', samples.at(-1)?.specials);
  await b.screenshot(`${S}/turncap-banner-0s.png`); await b.sleep(1500); await b.screenshot(`${S}/turncap-banner-1.5s.png`); await b.sleep(4000); await b.screenshot(`${S}/turncap-banner-5.5s.png`);
  console.log('last 10 samples (t, Fortify casts, PlayTurns):', samples.slice(-10).map((s) => `${s.t}s:${s.specials}/${s.playTurns}`).join(' '));
  const banner = await b.eval(`(document.body.innerText.match(/(VICTORY|DEFEAT|DRAW)[^\\n]*\\n?[^\\n]*/) || [''])[0]`);
  console.log('banner:', JSON.stringify(banner));
  for (const l of b.logs.filter((x) => /Battle over!|BattleEnd|turn_cap|turn cap/.test(x)).slice(-4)) console.log('  end:', l.replace(/^\[log\] /, '').slice(0, 160));
  const tail = b.logs.filter((x) => /PlayTurn:/.test(x)).slice(-6).map((x) => { const m = x.match(/"turn":(\d+).*?"lobsterId":"([^"]+)".*?"action":"([^"]*)"/); return m ? `${m[1]}:${m[2]}:${m[3]}` : '?'; });
  console.log('last PlayTurns:', tail.join(' '));
}
