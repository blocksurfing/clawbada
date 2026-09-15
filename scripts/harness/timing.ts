import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
const myTurn = `/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`;
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

/** Start a Random·Elite practice battle and play to the banner: attack when a target is in
 *  range, otherwise Defend. Screenshots the page at the first own turn and at the end. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto('http://127.0.0.1:3000/game/battle');
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.waitFor(`!!Array.from(document.querySelectorAll('button[role=combobox]')).find(x => x.textContent.includes('Preset'))`, 20000, 250); await b.sleep(400);
  await rectClick(b, 'button[role=combobox]', 'Preset'); await b.waitFor(`document.querySelectorAll('[role=option]').length > 0`, 5000);
  await rectClick(b, '[role=option]', process.env.PRESET_LABEL ?? 'Random team · Elite'); await b.sleep(400);
  const opp = await b.eval(`(() => { const t = Array.from(document.querySelectorAll('button[role=combobox]')).map(x => x.textContent.trim()); return t.join(' | '); })()`);
  console.log('selects:', opp);
  expect(/random/i.test(opp), 'random preset switched the opponent select to random');
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  console.log('battle:', await b.eval('location.pathname'));
  const t0 = Date.now(); let inited = false;
  while (Date.now() - t0 < 150000) { if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; } await b.sleep(500); }
  expect(inited, 'HUD bound');
  const bindLine = grab(b, /\[BattleHud\] bind/).slice(-1)[0] ?? '';
  console.log(bindLine.slice(0, 200));
  const arenaLine = grab(b, /\[BattleManager\] arena/).slice(-1)[0] ?? '';
  console.log(arenaLine.slice(0, 160));
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);

  let shotFirst = false; let turns = 0; const started = Date.now();
  while (Date.now() - started < 5 * 60_000) {
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    const mine = await b.waitFor(myTurn, 30000, 300);
    if (!mine) { if (grab(b, /\[BattleHud\] banner/).length > 0) break; continue; }
    await b.sleep(700);
    if (!shotFirst) { await b.screenshot(`${S}/timing-first-turn.png`); shotFirst = true; }
    const g = await canvasGeom(b);
    const cells = parseCells(grab(b, /\[BattleHud\] cells/).slice(-1)[0] ?? '');
    const btns = parseButtons(grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '');
    const sel = await b.eval(`window.__clawbada_selection ? JSON.parse(JSON.stringify(window.__clawbada_selection)) : null`) as any;
    const target = sel?.attackTargets?.[0];
    const lob = target ? (sel.lobsters || []).find((l: any) => l.id === target) : null;
    const cell = lob ? cells.get(`${lob.col},${lob.row}`) : null;
    if (cell) {
      const p = toCss(g, cell.x, cell.y); await b.clickAt(p.x, p.y);
    } else if (btns.defend) {
      const p = toCss(g, btns.defend.x + btns.defend.w / 2, btns.defend.y + btns.defend.h / 2); await b.clickAt(p.x, p.y);
    } else { await b.sleep(1000); continue; }
    turns++;
    await b.sleep(1500);
  }
  await b.sleep(2500);
  await b.screenshot(`${S}/timing-end.png`);
  const banner = grab(b, /\[BattleHud\] banner/).slice(-1)[0] ?? '';
  console.log(`played ${turns} own turns; banner: ${banner}`);
  expect(banner.length > 0, 'battle reached a result banner');
  const clipLines = Array.from(new Set(grab(b, /\[LobsterController\] attack/).map((l) => l.replace(/^.*\[LobsterController\] /, ''))));
  console.log('attack clips stretched:', clipLines.join(' | '));
  expect(clipLines.some((l) => /clip=(0\.[89]|1\.\d)/.test(l)), 'an attack ran for its full clip length (>= 0.8 s)');
  const watchdog = b.logs.filter((l) => /watchdog/i.test(l));
  expect(watchdog.length === 0, 'no animation watchdog releases: ' + watchdog.slice(0, 2).join(' | '));
  const exc = b.logs.filter((l) => /\[exception\]|NullReference|GLctx/.test(l) && !/Family Accounts/.test(l));
  expect(exc.length === 0, 'no exceptions: ' + exc.slice(0, 3).join(' | '));
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL CHECKS PASSED');
}
