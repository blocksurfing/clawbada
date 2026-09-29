import type { Browser } from './cdp';
/**
 * Battle-start intro (user 2026-09-28): a fresh practice battle must open on the empty arena, play READY / FIGHT,
 * drop the lobsters in, slide the HUD in — and only THEN start (server `ready`), so no move happens off screen.
 *   TRIO=Kraken bun cdp.ts intro-probe.ts   → out/intro-fNN.jpg frame burst + log-order checks
 */
const S = `${import.meta.dir}/out`;
const CLASS = process.env.TRIO ?? 'Kraken';
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
async function rectClick(b: Browser, selector: string, text: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e => (e.textContent || '').includes(${JSON.stringify(text)})); if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no ${text}`); await b.clickAt(r.x, r.y);
}
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
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
  while (Date.now() - t0 < 150000 && !b.logs.some((l) => /\[BattleIntro\] start/.test(l))) await b.sleep(100);
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  const started = Date.now();
  // Small JPEGs of the canvas only: full-page PNGs take ~1 s each and miss the READY / FIGHT beats.
  const clip = await b.eval(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 0.5 }; })()`);
  for (let f = 0; f < 60 && !b.logs.some((l) => /\[BattleIntro\] done/.test(l)); f++) {
    const r = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip });
    await Bun.write(`${S}/intro-f${String(f).padStart(2, '0')}.jpg`, Buffer.from(r.data, 'base64'));
  }
  await b.screenshot(`${S}/intro-end.png`);
  await b.waitFor(`/Your turn/i.test(document.body.innerText)`, 40000, 300);
  await b.sleep(1500);
  const introMs = Date.now() - started;
  const idx = (re: RegExp) => b.logs.findIndex((l) => re.test(l));
  const done = idx(/\[BattleIntro\] done/), ready = idx(/\[BattleSession\] (ready sent|socket open — sending the queued ready)/);
  const firstPlay = idx(/\[BattleManager\] PlayTurn|\[BattleBridge\] PlayTurn/), held = grab(b, /held until the intro ends/);
  const firstStart = idx(/\[BattleHud\] turn \d+ active=/);
  expect(done >= 0, `intro ran to the end (${introMs} ms incl. the first turn)`);
  expect(ready > done, 'ready was sent after the intro');
  expect(firstStart > done, 'the first turn started after the intro');
  expect(firstPlay < 0 || firstPlay > done, 'no turn animated before the intro ended');
  const grid = grab(b, /ShowSelection held until the intro ends/).length;
  console.log(`  move highlights held during the intro: ${grid}`);
  console.log(`  held during the intro: ${held.length} ${held.slice(0, 3).join(' | ')}`);
  for (const l of grab(b, /\[BattleIntro\]|\[BattleSession\] ready|intro complete/).slice(0, 6)) console.log('  log:', l.slice(0, 140));
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL CHECKS PASSED');
}
