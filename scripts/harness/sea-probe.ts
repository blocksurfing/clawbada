import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'random_evolved';
const TAG = process.env.TAG ?? PRESET;
const FRAMES = Number(process.env.FRAMES ?? 3);
const GAP_MS = Number(process.env.GAP_MS ?? 600);

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));

/** Animated arena art (Nzib's Evolved sea + shoreline foam, 2026-10-02): a burst of canvas frames a
 *  few hundred ms apart once the HUD is bound, so the water's motion shows between frames
 *  (`out/sea-<tag>-N.png`). Defaults to the Evolved preset; `PRESET=random_elite` etc. for others. */
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=${PRESET}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[sea] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log(`[sea] ${TAG}: FAILED — HUD never bound`); return; }
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  // Past the intro (obstacles + lobsters drop, banner, HUD slide-in) so the board is at rest and
  // the only motion in the arena band is the art itself.
  await b.sleep(16000);
  for (let i = 1; i <= FRAMES; i++) {
    await b.screenshot(`${S}/sea-${TAG}-${i}.png`);
    if (i < FRAMES) await b.sleep(GAP_MS);
  }
  for (const l of grab(b, /arena '|SwapArenaArt|no baked content box/)) console.log('[sea-log]', l.slice(0, 200));
  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  console.log(`[sea] ${TAG}: ${FRAMES} frames ${GAP_MS} ms apart in out/, ${errs.length} exceptions`);
  for (const e of errs.slice(0, 5)) console.log('[sea-err]', e.slice(0, 200));
}
