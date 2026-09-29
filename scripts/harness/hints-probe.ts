import type { Browser } from './cdp';
import { waitForIntro } from './intro-wait';
/** Nzib's HUD (2026-09-27): the hint line under the shot clock, and the options
 *  menu's Hints toggle hiding it and bringing it back. `bun cdp.ts hints-probe.ts` → out/hints-{on,menu,off}.png */
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
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  const t0 = Date.now();
  while (Date.now() - t0 < 150000 && !b.logs.some((l) => /\[BattleHud\] bind/.test(l))) await b.sleep(500);
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  await b.waitFor(`/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`, 60000, 300);
  await waitForIntro(b);
  await b.sleep(900);
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  const g = await b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`);
  const click = async (line: string, key: string) => {
    const m = line.match(new RegExp(`${key}=\\((-?\\d+),(-?\\d+),(\\d+),(\\d+)\\)`));
    if (!m) return false;
    const ux = +m[1] + +m[3] / 2, uy = +m[2] + +m[4] / 2;
    await b.clickAt(g.x + ux * g.w / g.bw, g.y + (g.bh - uy) * g.h / g.bh);
    return true;
  };
  const hintsBefore = grab(b, /\[BattleHud\] hint /).length;
  // Attack arms targeting and raises a guidance hint (select an enemy / none in range).
  await click(grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '', 'attack');
  await b.sleep(700);
  const hint = grab(b, /\[BattleHud\] hint /).slice(hintsBefore)[0] ?? '';
  expect(!!hint, `a hint showed (${hint})`);
  await b.screenshot(`${S}/hints-on.png`);
  await click(grab(b, /\[BattleHud\] options gear/).slice(-1)[0] ?? '', 'gear');
  await b.sleep(500);
  const menu = grab(b, /\[BattleHud\] options gear/).slice(-1)[0] ?? '';
  expect(/hints:on=/.test(menu), `menu shows Hints: On (${menu})`);
  await click(menu, 'hints:on');
  await b.sleep(500);
  expect(grab(b, /\[BattleHud\] hints off/).length > 0, 'pressing the row turned hints off');
  await b.screenshot(`${S}/hints-menu.png`);
  await click(grab(b, /\[BattleHud\] options gear/).slice(-1)[0] ?? '', 'close');
  await b.sleep(400);
  await b.screenshot(`${S}/hints-off.png`);
  // Back on so later probes see hints (the setting persists in PlayerPrefs).
  await click(grab(b, /\[BattleHud\] options gear/).slice(-1)[0] ?? '', 'gear');
  await b.sleep(1000);
  await click(grab(b, /\[BattleHud\] options gear/).slice(-1)[0] ?? '', 'hints:off');
  await b.sleep(400);
  expect(grab(b, /\[BattleHud\] hints on/).length > 0, 'pressing again turned hints back on');
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL CHECKS PASSED');
}
