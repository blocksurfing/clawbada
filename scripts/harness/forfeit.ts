import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const CLASS = process.env.TRIO ?? 'Specter';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));

async function canvasGeom(b: Browser) {
  return b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`) as Promise<{ x: number; y: number; w: number; h: number; bw: number; bh: number }>;
}
function toCss(g: { x: number; y: number; w: number; h: number; bw: number; bh: number }, ux: number, uy: number) {
  const sx = g.w / g.bw, sy = g.h / g.bh;
  return { x: g.x + ux * sx, y: g.y + (g.bh - uy) * sy };
}
/** Parse `[BattleHud] options gear=(x,y,w,h) forfeit=(…)` — Unity screen px, y up. */
function parseRects(line: string) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const m of line.matchAll(/(\w+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  return out;
}

/** Click the gear → Forfeit → Yes, and prove the battle ends by forfeit. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=trio_${CLASS.toLowerCase()}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  console.log(`[forfeit] battle: ${await b.eval('location.pathname')}`);

  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[forfeit] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
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
  await b.sleep(1500);

  const g = await canvasGeom(b);
  const gearLine = grab(b, /\[BattleHud\] options gear=/).slice(-1)[0] ?? '';
  const gear = parseRects(gearLine).gear;
  expect(!!gear, `gear rect logged (${gearLine.slice(0, 80)})`);
  if (!gear) return;
  // Top-right corner of the canvas: assert placement, not just existence.
  expect(gear.x + gear.w > g.bw * 0.9 && gear.y + gear.h > g.bh * 0.9, `gear sits in the top-right corner (x=${gear.x} y=${gear.y} of ${g.bw}x${g.bh})`);
  await b.screenshot(`${S}/forfeit-1-board.png`);

  let p = toCss(g, gear.x + gear.w / 2, gear.y + gear.h / 2);
  await b.clickAt(p.x, p.y);
  await b.sleep(700);
  const openLine = grab(b, /\[BattleHud\] options gear=.*forfeit=/).slice(-1)[0] ?? '';
  const rows = parseRects(openLine);
  expect(!!rows.forfeit, 'options panel opened with a Forfeit row');
  await b.screenshot(`${S}/forfeit-2-menu.png`);
  if (!rows.forfeit) return;

  p = toCss(g, rows.forfeit.x + rows.forfeit.w / 2, rows.forfeit.y + rows.forfeit.h / 2);
  await b.clickAt(p.x, p.y);
  await b.sleep(700);
  const confirmLine = grab(b, /\[BattleHud\] options gear=.*yes=/).slice(-1)[0] ?? '';
  const confirm = parseRects(confirmLine);
  expect(!!confirm.yes, 'confirm step shown');
  await b.screenshot(`${S}/forfeit-3-confirm.png`);
  if (!confirm.yes) return;

  p = toCss(g, confirm.yes.x + confirm.yes.w / 2, confirm.yes.y + confirm.yes.h / 2);
  await b.clickAt(p.x, p.y);

  // Wait on the result banner, not the word "forfeit" — the failure message contains it too.
  const ended = await b.waitFor(`/DEFEAT|VICTORY/.test(document.body.innerText)`, 20000, 300);
  await b.sleep(1200);
  await b.screenshot(`${S}/forfeit-4-result.png`);
  const accepted = grab(b, /\[LiveBattle\] forfeit accepted/);
  const failed = grab(b, /forfeit failed|Forfeit failed/);
  const banner = await b.eval(`(document.body.innerText.match(/(DEFEAT|VICTORY)[\\s\\S]{0,40}/) || [])[0] || ''`);
  console.log(`[forfeit] accepted=${accepted.length} banner=${JSON.stringify(String(banner).replace(/\\n/g, ' ').slice(0, 60))}`);
  expect(accepted.length === 1, `React reported the forfeit accepted (${accepted[0] ?? 'none'})`);
  expect(failed.length === 0, `no forfeit error (${failed[0] ?? ''})`);
  expect(!!ended, 'result banner shown after the forfeit');
  expect(/DEFEAT/.test(String(banner)), `defeat banner for the resigning player (${String(banner).slice(0, 40)})`);
  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  expect(errs.length === 0, `no Unity/page exceptions: ${errs.slice(0, 2).join(' | ')}`);

  console.log(fails.length === 0 ? '[forfeit] ALL CHECKS PASSED' : `[forfeit] FAILED: ${fails.join('; ')}`);
}
