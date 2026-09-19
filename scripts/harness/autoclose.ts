import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'trio_ember';
const SPEED = process.env.SPEED ?? '3';
const STAY = process.env.STAY === '1';
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));

/** After the result banner the view closes itself and returns to /game/battle: countdown under the
 *  result, Unity quit, music faded, no exceptions. STAY=1 checks the ?stay=1 opt-out instead. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=${PRESET}&auto=1&speed=${SPEED}${STAY ? '&stay=1' : ''}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  expect(await b.waitFor(`!!Array.from(document.querySelectorAll('button[role=combobox]')).find(x => /·/.test(x.textContent || ''))`, 20000, 250), 'preset from URL');
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  expect(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000), 'battle page opened');
  const href = await b.eval('location.href') as string;
  console.log(`[autoclose] battle: ${href}`);
  expect(STAY ? /stay=1/.test(href) : !/stay=1/.test(href), `stay param ${STAY ? 'carried' : 'absent'}`);
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[autoclose] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  expect(inited, 'HUD bound');
  if (!inited) return;

  // Play to the banner. 100 ms polling so the React countdown start and Unity's banner can be
  // put in order against each other.
  const started = Date.now();
  let shownAt = 0, bannerAt = 0;
  while (Date.now() - started < 300_000) {
    if (!shownAt && grab(b, /\[LiveBattle\] result shown/).length > 0) shownAt = Date.now();
    if (grab(b, /\[BattleHud\] banner/).length > 0) { bannerAt = Date.now(); break; }
    await b.sleep(100);
  }
  if (!bannerAt) bannerAt = Date.now();
  console.log(`[autoclose] countdown started ${shownAt ? `${((shownAt - bannerAt) / 1000).toFixed(1)}s relative to the banner` : 'never (no log)'}`);
  const tail = b.logs.slice(-14).map((l) => l.slice(0, 110));
  for (const l of tail) console.log('  log:', l);
  const banner = grab(b, /\[BattleHud\] banner/)[0] ?? '';
  expect(banner.length > 0, `result banner (${banner})`);
  if (!banner) return;
  await b.sleep(400);
  await b.screenshot(`${S}/autoclose-banner.png`);
  const row = await b.eval(`(document.querySelector('[data-testid=battle-return]')?.innerText || '').replace(/\\n/g, ' ')`) as string;
  console.log(`[autoclose] return row: ${JSON.stringify(row)}`);

  if (STAY) {
    expect(/back to the arena/i.test(row) && !/in \d+s/i.test(row), 'stay=1: plain Back button, no countdown');
    await b.sleep(9000);
    expect(/^\/battle\/p_/.test(await b.eval('location.pathname')), 'stay=1: still on the battle page after 9 s');
    expect(!!(await b.eval(`!!document.querySelector('canvas')`)), 'stay=1: Unity canvas still mounted');
  } else {
    expect(/back to the arena in \d+s/i.test(row), 'countdown shown over the canvas');   // innerText carries the pixel font's uppercase
    const left = await b.waitFor(`location.pathname === '/game/battle'`, 12000, 200);
    const tLeft = Math.round((Date.now() - bannerAt) / 100) / 10;
    expect(left, `returned to /game/battle (${tLeft}s after the banner)`);
    expect(tLeft >= 5 && tLeft <= 9, `left after the countdown, not before or long after (${tLeft}s)`);
    expect(grab(b, /\[BattleStage\] closing/).length === 1, 'stage closed before leaving');
    expect(b.logs.some((l) => /React Unity WebGL: Detaching Unity instance/.test(l)), 'Unity detached (Quit) on unmount');
    expect(grab(b, /\[ArenaMusic\] fade out/).length >= 1, 'arena music faded out');
    await b.sleep(1500);
    const canvases = await b.eval(`Array.from(document.querySelectorAll('canvas')).map(c => ({ w: c.width, h: c.height, id: c.id, parent: (c.parentElement && (c.parentElement.id || c.parentElement.className || c.parentElement.tagName)) || '', battleStage: !!c.closest('[data-battle-stage]') }))`) as Array<{ w: number; h: number; id: string; parent: string; battleStage: boolean }>;
    console.log(`[autoclose] canvases on the arena page: ${JSON.stringify(canvases)}`);
    expect(canvases.length === 0, 'no Unity canvas left on the arena page (cleanup canvas removed once Quit resolved)');
    const consoleErrors = b.logs.filter((l) => /^\[(error|exception)\]/.test(l)).filter((l) => !/Family|Aave|hydrat/i.test(l));
    console.log(`[autoclose] console errors (filtered): ${consoleErrors.length}`);
    for (const l of consoleErrors.slice(0, 5)) console.log('  err:', l.slice(0, 160));
    expect(!!(await b.eval(`!!Array.from(document.querySelectorAll('button')).find(x => (x.textContent || '').includes('Start practice'))`)), 'picker is back');
    await b.screenshot(`${S}/autoclose-after.png`);
  }
  const errs = grab(b, /Exception|GLctx|Uncaught|\[exception\]/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  expect(errs.length === 0, `no exceptions (${errs.length})`);
  for (const l of errs.slice(0, 4)) console.log('  err:', l.slice(0, 160));
  console.log(fails.length ? `[autoclose] FAILED: ${fails.join('; ')}` : '[autoclose] ALL CHECKS PASSED');
}
