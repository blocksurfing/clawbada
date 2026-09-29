import type { Browser } from './cdp';
import { waitForIntro } from './intro-wait';
/** Nzib's HUD (2026-09-27): screenshots of the avatar + button row idle, hovered and pressed.
 *  `TRIO=Sentinel bun cdp.ts ui-feel.ts` → out/ui-feel-<class>-{idle,hover,press}.png */
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
  // PLAY=n: Defend through n own turns first, so the avatar has swapped lobsters several times (the stale-clone bug).
  const turnNo = `(document.body.innerText.match(/Turn (\\d+)/i) || [])[1]`;
  for (let k = 0; k < Number(process.env.PLAY ?? 0); k++) {
    const g0 = await b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`);
    const mm = (grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '').match(/defend=\((-?\d+),(-?\d+),(\d+),(\d+)\)/);
    if (!mm) break;
    const before = await b.eval(turnNo);
    await b.clickAt(g0.x + (+mm[1] + +mm[3] / 2) * g0.w / g0.bw, g0.y + (g0.bh - (+mm[2] + +mm[4] / 2)) * g0.h / g0.bh);
    await b.waitFor(`${turnNo} !== ${JSON.stringify(before)}`, 25000, 200);
    await b.waitFor(`/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`, 60000, 300);
    await b.sleep(900);
  }
  const line = grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '';
  const m = line.match(/defend=\((-?\d+),(-?\d+),(\d+),(\d+)\)/);
  if (!m) { console.log('FAIL no buttons line'); return; }
  const g = await b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`);
  const ux = +m[1] + +m[3] / 2, uy = +m[2] + +m[4] / 2;
  const x = g.x + ux * g.w / g.bw, y = g.y + (g.bh - uy) * g.h / g.bh;
  await b.screenshot(`${S}/ui-feel-${CLASS}-idle.png`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await b.sleep(400);
  await b.screenshot(`${S}/ui-feel-${CLASS}-hover.png`);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await b.sleep(300);
  await b.screenshot(`${S}/ui-feel-${CLASS}-press.png`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 400, y: y - 300, button: 'left' });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 400, y: y - 300, button: 'left', clickCount: 1 });
  for (const l of grab(b, /\[BattleHud\] portrait |Exception|Can.t remove/).slice(-12)) console.log(l.trim());
  console.log(`ui-feel ${CLASS}: shots written; ${line}`);
  console.log('audio prefs:', await b.eval(`localStorage.getItem('clawbada_music') + '/' + localStorage.getItem('clawbada_sfx')`), (grab(b, /SetAudioPrefs/).slice(-1)[0] ?? '').trim());
}
