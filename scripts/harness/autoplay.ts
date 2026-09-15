import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const CLASS = process.env.TRIO ?? 'Specter';
const SPEED = process.env.SPEED ?? '2';
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
const turnNo = `Number((document.body.innerText.match(/Turn (\\d+)/i) || [])[1] || 0)`;

/** Review tools: ?auto=1&speed=N — the battle must advance with NO clicks after Start practice. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=trio_${CLASS.toLowerCase()}&auto=1&speed=${SPEED}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  expect(!!(await b.waitFor(`!!Array.from(document.querySelectorAll('button[role=combobox]')).find(x => x.textContent.includes('Trio · ${CLASS}'))`, 20000, 250)), 'preset from URL');
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  const href = await b.eval('location.href') as string;
  console.log(`[auto] battle: ${href}`);
  expect(/auto=1/.test(href) && new RegExp(`speed=${SPEED}`).test(href), 'auto/speed params carried to the battle URL');
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[auto] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  expect(inited, 'HUD bound');
  if (!inited) return;
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  const t0 = Number(await b.eval(turnNo));
  const started = Date.now();
  let shots = 0;
  while (Date.now() - started < 120_000) {
    await b.sleep(10_000);
    if (shots < 3 && Date.now() - started > 30_000 * (shots + 1)) { await b.screenshot(`${S}/autoplay-${CLASS}-${shots}.png`); shots++; }
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
  }
  const t1 = Number(await b.eval(turnNo));
  const auto = grab(b, /\[LiveBattle\] autoplay/);
  const speed = grab(b, /\[BattleBridge\] SetSpeed/);
  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  console.log(`[auto] turns ${t0} → ${t1}; autoplay submissions ${auto.length}; speed logs: ${speed.join(' | ') || 'none'}`);
  for (const l of auto.slice(0, 6)) console.log('[auto-log]', l.slice(0, 140));
  expect(auto.length >= 3, `at least 3 autoplay submissions (${auto.length})`);
  expect(t1 - t0 >= 4, `turn counter advanced without clicks (${t0} → ${t1})`);
  expect(speed.some((l) => new RegExp(`SetSpeed ${Number(SPEED).toFixed(2)}x`).test(l)), `Unity applied speed ${SPEED}x`);
  expect(errs.length === 0, `no Unity/page exceptions: ${errs.slice(0, 2).join(' | ')}`);
  await b.screenshot(`${S}/autoplay-${CLASS}-final.png`);
  console.log(fails.length === 0 ? '[auto] ALL CHECKS PASSED' : `[auto] FAILED: ${fails.join('; ')}`);
}
