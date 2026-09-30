import type { Browser } from './cdp';
import { waitForIntro } from './intro-wait';
/** Volume rows (user 2026-09-29): the options menu's Music / SFX − and + step the level by 10 %, React persists it
 *  (localStorage) and echoes it back to Unity. `bun cdp.ts volume-probe.ts` → out/volume-menu.png */
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
  const menuLine = () => grab(b, /\[BattleHud\] options gear/).slice(-1)[0] ?? '';
  const store = (k: string) => b.eval(`localStorage.getItem(${JSON.stringify(k)})`);
  await click(menuLine(), 'gear');
  await b.sleep(500);
  expect(/musicDown:50=/.test(menuLine()) && /sfxUp:100=/.test(menuLine()), `defaults: music 50 %, SFX 100 % (${menuLine()})`);
  await click(menuLine(), 'musicDown:50');
  await b.sleep(500);
  expect(grab(b, /\[BattleHud\] music volume 40/).length > 0, 'Music − → 40 %');
  await click(menuLine(), 'musicUp:40');
  await b.sleep(500);
  await click(menuLine(), 'musicUp:50');
  await b.sleep(500);
  expect(grab(b, /\[BattleHud\] music volume 60/).length > 0, 'Music + + → 60 %');
  await click(menuLine(), 'sfxDown:100');
  await b.sleep(500);
  await click(menuLine(), 'sfxDown:90');
  await b.sleep(500);
  expect(grab(b, /\[BattleHud\] sfx volume 80/).length > 0, 'SFX − − → 80 %');
  expect(await store('clawbada_battle_music_vol') === '60', `music volume persisted (${await store('clawbada_battle_music_vol')})`);
  expect(await store('clawbada_sfx_vol') === '80', `SFX volume persisted (${await store('clawbada_sfx_vol')})`);
  expect(grab(b, /SetAudioPrefs .*musicVol=60 sfxVol=80/).length > 0, 'React echoed both volumes back to Unity');
  expect(/music:off=/.test(menuLine()) && /sfx:off=/.test(menuLine()), 'the harness mute still holds (rows show Off)');
  await b.screenshot(`${S}/volume-menu.png`);
  await click(menuLine(), 'close');
  await b.eval(`localStorage.removeItem('clawbada_battle_music_vol'); localStorage.removeItem('clawbada_sfx_vol')`);
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL CHECKS PASSED');
}
