import type { Browser } from './cdp';
import { waitForIntro } from './intro-wait';
/** Battles open fullscreen (user 2026-09-29): the Start click puts the page into fullscreen and the stage fills it
 *  while Unity is still loading. `bun cdp.ts fullscreen-probe.ts` → out/fs-{loading,board}.png */
const S = `${import.meta.dir}/out`;
const CLASS = process.env.TRIO ?? 'Sentinel';
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
async function rectClick(b: Browser, selector: string, text: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e => (e.textContent || '').includes(${JSON.stringify(text)})); if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no ${text}`); await b.clickAt(r.x, r.y);
}
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=trio_${CLASS.toLowerCase()}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let i = 0; i < 4; i++) {
    await b.sleep(800); await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.sleep(500);
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  expect(await b.eval(`document.fullscreenElement === document.documentElement`), 'the Start click put the page in fullscreen');
  await b.waitFor(`!!document.querySelector('[data-battle-stage]')`, 60000, 200);
  // vw/vh = what a bare \`position: fixed; inset: 0\` box gets on this screen (headless fullscreen reports 800×600 but
  // lays fixed boxes out at 800×580, so innerWidth/innerHeight are not the reference).
  const cover = `(() => { const r = document.querySelector('[data-battle-stage]').getBoundingClientRect(); const ref = document.createElement('div'); ref.style.cssText = 'position:fixed;inset:0;pointer-events:none'; document.body.appendChild(ref); const q = ref.getBoundingClientRect(); ref.remove(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: q.width, vh: q.height }; })()`;
  const early = await b.eval(cover);
  const loading = await b.eval(`/Loading arena/.test(document.querySelector('[data-battle-stage]').innerText)`);
  console.log(`  stage while loading: ${JSON.stringify(early)} (loading text shown: ${loading})`);
  expect(early.x === 0 && early.y === 0 && early.w === early.vw && early.h === early.vh, 'the stage covers the whole screen as it loads');
  await b.screenshot(`${S}/fs-loading.png`);
  const t0 = Date.now();
  while (Date.now() - t0 < 150000 && !b.logs.some((l) => /\[BattleHud\] bind/.test(l))) await b.sleep(500);
  await waitForIntro(b);
  await b.sleep(800);
  const late = await b.eval(cover);
  expect(late.w === late.vw && late.h === late.vh, `still full-bleed once the battle runs (${JSON.stringify(late)})`);
  expect(await b.eval(`document.fullscreenElement === document.documentElement`), 'still fullscreen after the intro');
  await b.screenshot(`${S}/fs-board.png`);
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL CHECKS PASSED');
}
