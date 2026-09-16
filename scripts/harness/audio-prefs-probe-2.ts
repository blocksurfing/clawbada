import type { Browser } from './cdp';
/** Fresh Chrome: seed the preferences the first script stored, start a NEW battle, and check
 *  they are honoured from the first frame — then turn both back on mid-battle. */
const PRESET = process.env.PRESET ?? 'trio_tempest';
const ORIGIN = 'http://127.0.0.1:3000';
const SP = `${import.meta.dir}/out`;

function parseRects(line: string) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const m of line.matchAll(/([\w:]+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  return out;
}
async function canvasGeom(b: Browser) {
  return b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`) as Promise<{ x: number; y: number; w: number; h: number; bw: number; bh: number }>;
}
async function clickRect(b: Browser, r: { x: number; y: number; w: number; h: number }) {
  const g = await canvasGeom(b); await b.clickAt(g.x + (r.x + r.w / 2) * (g.w / g.bw), g.y + (g.bh - (r.y + r.h / 2)) * (g.h / g.bh)); await b.sleep(400);
}
const lastOptions = (b: Browser) => [...b.logs].reverse().find((l) => /\[BattleHud\] options/.test(l)) ?? '';
async function openMenu(b: Browser) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rects = parseRects(lastOptions(b)); if (!rects.gear) throw new Error('no gear rect logged');
    await clickRect(b, rects.gear); await b.sleep(600);
    const after = parseRects(lastOptions(b));
    if (Object.keys(after).length > 1) return after;
    console.log(`  (gear click ${attempt + 1} did not open the panel; battle over? ${b.logs.some((l) => /Battle over!/.test(l))}; last options: ${lastOptions(b).replace(/^\[log\] /, '').slice(0, 120)})`);
  }
  return parseRects(lastOptions(b));
}
const count = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).length;

export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  const seed = JSON.parse(await Bun.file(`${SP}/audio-prefs.json`).text()) as { music: string | null; sfx: string | null };
  console.log('seeding prefs from script 1:', JSON.stringify(seed));

  await b.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  // Seed on the picker page itself — an extra page load before the battle is one more chance
  // for headless Chrome to burn the WebGL context Unity needs. Prefs are read at battle start.
  await b.goto(`${ORIGIN}/game/battle?preset=${PRESET}&auto=1&speed=1`); // real time: the battle must outlive every window below
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  await b.eval(`(() => { localStorage.setItem('clawbada_music', ${JSON.stringify(seed.music ?? 'off')}); localStorage.setItem('clawbada_sfx', ${JSON.stringify(seed.sfx ?? 'off')}); return true; })()`);
  console.log('seeded on picker:', await b.eval(`JSON.stringify({ music: localStorage.getItem('clawbada_music'), sfx: localStorage.getItem('clawbada_sfx') })`));
  for (let i = 0; i < 4; i++) {
    await b.sleep(800);
    const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent||'').includes('burner wallet')); if (!el) return null; const q = el.getBoundingClientRect(); return {x:q.x+q.width/2,y:q.y+q.height/2}; })()`);
    if (r) await b.clickAt((r as any).x, (r as any).y);
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  const st = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent||'').includes('Start practice')); if (!el) return null; const q = el.getBoundingClientRect(); return {x:q.x+q.width/2,y:q.y+q.height/2}; })()`);
  if (st) await b.clickAt((st as any).x, (st as any).y);
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  // Unity sometimes aborts on init under headless SwiftShader ("GLctx"); a reload of the same
  // battle page recovers it (localStorage survives). Try up to 3 loads before giving up.
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`  (Unity did not bind — GLctx seen: ${b.logs.some((l) => /GLctx/.test(l))}; reloading ${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l)) && b.logs.some((l) => /\[BattleHud\] options gear=/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log('FAIL Unity never bound (init crashed 3x) — aborting'); return; }
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  await b.sleep(1500);
  console.log('battle:', await b.eval('location.pathname'));

  expect(count(b, /\[BattleBridge\] SetAudioPrefs music=False sfx=False/) >= 1, 'new session: Unity received music=False sfx=False on init');
  expect(count(b, /\[ArenaMusic\] music preference is off/) >= 1, 'new session: bed did not start (preference off)');
  expect(count(b, /\[ArenaMusic\] .* playing after/) === 0, 'new session: no bed playback at all');
  let rects = await openMenu(b);
  expect(!!rects['music:off'] && !!rects['sfx:off'], `menu opens showing music:off sfx:off (${Object.keys(rects).join(',')})`);
  const t0 = count(b, /PlayTurn:/), p0 = count(b, /\[BattleSfx\] .* @ /); await b.sleep(10000); const p1 = count(b, /\[BattleSfx\] .* @ /), t1 = count(b, /PlayTurn:/);
  expect(p1 === p0 && t1 > t0, `new session: SFX silent while turns run (plays ${p0} → ${p1}, turns ${t0} → ${t1})`);
  console.log('  battle over before toggling back on?', b.logs.some((l) => /Battle over!/.test(l)));

  await clickRect(b, rects['music:off']); await b.sleep(2500);
  expect(count(b, /\[ArenaMusic\] .* playing after/) >= 1, 'music on mid-battle → bed started');
  expect(count(b, /\[BattleBridge\] SetAudioPrefs music=True sfx=False/) >= 1, 'echo refreshed Unity (music=True sfx=False)');
  rects = parseRects(lastOptions(b)); if (!rects['sfx:off']) rects = await openMenu(b);
  await clickRect(b, rects['sfx:off']);
  const u0 = count(b, /PlayTurn:/), q0 = count(b, /\[BattleSfx\] .* @ /); await b.sleep(20000); const q1 = count(b, /\[BattleSfx\] .* @ /), u1 = count(b, /PlayTurn:/);
  const over = b.logs.some((l) => /Battle over!/.test(l));
  expect(count(b, /\[BattleBridge\] SetAudioPrefs music=True sfx=True/) >= 1, 'echo refreshed Unity (music=True sfx=True)');
  expect(u1 > u0, `turns still running during the resume window (${u0} → ${u1}, battle over: ${over})`);
  expect(q1 > q0, `SFX plays resumed after sfx on (${q0} → ${q1})`);
  console.log('prefs now:', await b.eval(`JSON.stringify({ music: localStorage.getItem('clawbada_music'), sfx: localStorage.getItem('clawbada_sfx') })`));
  console.log(fails.length ? `FAILED: ${fails.length}` : 'ALL CHECKS PASSED');
}
