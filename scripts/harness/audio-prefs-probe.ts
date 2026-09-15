import type { Browser } from './cdp';
/** Music / SFX toggles in the in-battle options menu: press each row, check the React side
 *  reacts (bed fades, SFX plays stop), the echo refreshes Unity's labels, prefs persist across
 *  a reload, and turning both back on restores playback. Counts, not ears. */
const PRESET = process.env.PRESET ?? 'trio_tempest';
const ORIGIN = 'http://127.0.0.1:3000';

function parseRects(line: string) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const m of line.matchAll(/([\w:]+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  return out;
}
async function canvasGeom(b: Browser) {
  return b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`) as Promise<{ x: number; y: number; w: number; h: number; bw: number; bh: number }>;
}
function toCss(g: { x: number; y: number; w: number; h: number; bw: number; bh: number }, ux: number, uy: number) {
  return { x: g.x + ux * (g.w / g.bw), y: g.y + (g.bh - uy) * (g.h / g.bh) };
}
async function clickRect(b: Browser, r: { x: number; y: number; w: number; h: number }) {
  const g = await canvasGeom(b); const p = toCss(g, r.x + r.w / 2, r.y + r.h / 2); await b.clickAt(p.x, p.y); await b.sleep(400);
}
const lastOptions = (b: Browser) => [...b.logs].reverse().find((l) => /\[BattleHud\] options/.test(l)) ?? '';
async function openMenu(b: Browser) {
  const rects = parseRects(lastOptions(b));
  if (!rects.gear) throw new Error('no gear rect logged');
  await clickRect(b, rects.gear); await b.sleep(300);
  return parseRects(lastOptions(b));
}
const count = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).length;
const audioState = (b: Browser) => b.eval(`(() => { const m = window.__clawbadaArenaMusic; return m ? { paused: m.audio.paused, volume: +m.audio.volume.toFixed(2) } : null; })()`);
const prefs = (b: Browser) => b.eval(`({ music: localStorage.getItem('clawbada_music'), sfx: localStorage.getItem('clawbada_sfx') })`);

async function connectAndStart(b: Browser) {
  await b.goto(`${ORIGIN}/game/battle?preset=${PRESET}&auto=1&speed=3`);
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
  // Unity sometimes aborts on init under headless SwiftShader ("GLctx"); a reload of the same
  // battle page recovers it (localStorage survives). Try up to 3 loads before giving up.
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`  (Unity did not bind — reloading ${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l)) && b.logs.some((l) => /\[BattleHud\] options gear=/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) throw new Error('Unity never bound (init crashed 3x)');
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  await b.sleep(1500);
}

export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

  await b.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await connectAndStart(b);
  console.log('battle:', await b.eval('location.pathname'));
  expect(count(b, /\[BattleBridge\] SetAudioPrefs music=True sfx=True/) >= 1, 'init pushed prefs to Unity (music=True sfx=True)');

  // 1) Music off from the menu
  let rects = await openMenu(b);
  expect(!!rects['music:on'] && !!rects['sfx:on'], `menu shows music:on sfx:on (${Object.keys(rects).join(',')})`);
  await clickRect(b, rects['music:on']);
  await b.sleep(1200);
  expect(count(b, /\[BattleHud\] music off/) === 1, 'Unity logged music off');
  expect(count(b, /\[ArenaMusic\] toggled off/) === 1, 'React bed reacted: toggled off — fading out');
  expect(count(b, /\[BattleBridge\] SetAudioPrefs music=False sfx=True/) >= 1, 'echo refreshed Unity (music=False sfx=True)');
  const a1 = await audioState(b) as any;
  expect(!!a1 && a1.paused === true, `<audio> paused after fade (${JSON.stringify(a1)})`);

  // 2) SFX off from the menu — plays must stop while turns continue
  rects = parseRects(lastOptions(b));
  if (!rects['sfx:on']) rects = await openMenu(b);
  await clickRect(b, rects['sfx:on']);
  await b.sleep(300);
  expect(count(b, /\[BattleHud\] sfx off/) === 1, 'Unity logged sfx off');
  expect(count(b, /\[BattleBridge\] SetAudioPrefs music=False sfx=False/) >= 1, 'echo refreshed Unity (music=False sfx=False)');
  const playsBefore = count(b, /\[BattleSfx\] .* @ /), turnsBefore = count(b, /PlayTurn:/);
  await b.sleep(15000);
  const playsAfter = count(b, /\[BattleSfx\] .* @ /), turnsAfter = count(b, /PlayTurn:/);
  expect(turnsAfter > turnsBefore, `turns kept coming with SFX off (${turnsBefore} → ${turnsAfter})`);
  expect(playsAfter === playsBefore, `no SFX plays with SFX off (${playsBefore} → ${playsAfter})`);
  console.log('prefs stored:', JSON.stringify(await prefs(b)));

  // Hand the stored preferences to the fresh-Chrome second script (a same-tab reload would
  // start a second Unity instance in this Chrome, which the WebGL-context leak makes unreliable).
  await Bun.write(`${import.meta.dir}/out/audio-prefs.json`, JSON.stringify(await prefs(b)));

  console.log(fails.length ? `FAILED: ${fails.length}` : 'ALL CHECKS PASSED');
}
