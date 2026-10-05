import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'trio_mantis';
const TURNS = Number(process.env.TURNS ?? '4');
/** Web origin under test (a worktree's dev server can run on another port). */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
async function canvasGeom(b: Browser) {
  return b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`);
}
function toCss(g: { x: number; y: number; w: number; h: number; bw: number; bh: number }, ux: number, uy: number) {
  const sx = g.w / g.bw, sy = g.h / g.bh;
  return { x: g.x + ux * sx, y: g.y + (g.bh - uy) * sy };
}
function parseButtons(line: string) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const m of line.matchAll(/(\w+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  return out;
}
function parseCells(line: string) {
  const out = new Map<string, { x: number; y: number }>();
  for (const m of line.matchAll(/\((\d+),(\d+)\)=\((-?\d+),(-?\d+)\)/g)) out.set(`${m[1]},${m[2]}`, { x: +m[3], y: +m[4] });
  return out;
}
const sel = (b: Browser) => b.eval(`window.__clawbada_selection ? JSON.parse(JSON.stringify(window.__clawbada_selection)) : null`) as Promise<any>;

/** The LOKR field HP bar is gone (user 2026-10-04: redundant with Nzib's team panels). Nothing floats
 *  over a rig at rest, while it is the chosen target, or after it was hit — only the armed-action badge
 *  over the selected target and the damage floats. Targeting itself still works (target panel, submit).
 *  Frames: nofieldbar-clean.png (own turn, at rest), nofieldbar-target.png (an enemy selected, before the
 *  confirm), nofieldbar-lasthit.png (right after the hit). `BASE=http://127.0.0.1:3010` for a worktree. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`${BASE}/game/battle?preset=${PRESET}&stay=1`);
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
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[nofieldbar] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
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

  const myTurn = `/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`;
  let played = 0, attacks = 0, shotClean = false, shotTarget = false, shotHit = false, panelSeen = false;
  const started = Date.now();
  while (played < TURNS && Date.now() - started < 5 * 60_000) {
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    const mine = await b.waitFor(myTurn, 30000, 250);
    if (!mine) continue;
    await b.sleep(700);
    if (!shotClean) { await b.screenshot(`${S}/nofieldbar-clean.png`); shotClean = true; }
    const s = await sel(b);
    if (!s?.actor) continue;
    const g = await canvasGeom(b);
    const cells = parseCells(grab(b, /\[BattleHud\] cells/).slice(-1)[0] ?? '');
    const btns = parseButtons(grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '');
    const target = s.attackTargets?.[0];
    const lob = target ? (s.lobsters || []).find((l: any) => l.id === target) : null;
    const cell = lob ? cells.get(`${lob.col},${lob.row}`) : null;
    if (cell) {
      // Two-step targeting (user 2026-09-25): the first tap selects (target panel + badge), the second confirms.
      const p = toCss(g, cell.x, cell.y);
      const sentBefore = grab(b, /\[LiveBattle\] submit/).length;
      await b.clickAt(p.x, p.y); await b.sleep(700);
      if (grab(b, /\[BattleHud\] target panel/).some((l) => l.includes(target))) panelSeen = true;
      if (!shotTarget) { await b.screenshot(`${S}/nofieldbar-target.png`); shotTarget = true; }
      await b.clickAt(p.x, p.y);
      let sent = false;
      for (const t0 = Date.now(); Date.now() - t0 < 4000 && !sent; ) { sent = grab(b, /\[LiveBattle\] submit/).length > sentBefore; if (!sent) await b.sleep(150); }
      if (sent) attacks++;
      await b.sleep(2500);
      if (!shotHit) { await b.screenshot(`${S}/nofieldbar-lasthit.png`); shotHit = true; }
    } else if (btns.defend) {
      const p = toCss(g, btns.defend.x + btns.defend.w / 2, btns.defend.y + btns.defend.h / 2); await b.clickAt(p.x, p.y);
      await b.sleep(1200);
    } else { await b.sleep(1000); continue; }
    played++;
  }
  await b.sleep(1500);

  console.log(`[nofieldbar] ${played} own turns, ${attacks} attacks sent`);
  expect(attacks > 0, 'at least one attack was selected, confirmed and sent');
  expect(panelSeen, 'the target panel still appears for the selected enemy');
  expect(grab(b, /\[BattleHud\] fieldbar/).length === 0, 'no field-bar state lines: the field HP bar code is gone');
  expect(shotClean && shotTarget && shotHit, 'frames taken: clean, target selected, last hit');
  const errs = grab(b, /Exception|GLctx|Uncaught|\[exception\]/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  expect(errs.length === 0, `no exceptions (${errs.length})`);
  for (const l of errs.slice(0, 4)) console.log('  err:', l.slice(0, 160));
  console.log(fails.length ? `[nofieldbar] FAILED: ${fails.join('; ')}` : '[nofieldbar] ALL CHECKS PASSED');
}
