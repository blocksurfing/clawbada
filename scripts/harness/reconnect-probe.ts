import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
const myTurn = `/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`;
async function canvasGeom(b: Browser) { return b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`); }
function toCss(g: any, ux: number, uy: number) { const sx = g.w / g.bw, sy = g.h / g.bh; return { x: g.x + ux * sx, y: g.y + (g.bh - uy) * sy }; }
function parseButtons(line: string) { const out: Record<string, any> = {}; for (const m of line.matchAll(/(\w+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] }; return out; }
function parseCells(line: string) { const out = new Map<string, any>(); for (const m of line.matchAll(/\((\d+),(\d+)\)=\((-?\d+),(-?\d+)\)/g)) out.set(`${m[1]},${m[2]}`, { x: +m[3], y: +m[4] }); return out; }

/** Random·Apex battle (high damage → early deaths). Attack when possible until a lobster dies,
 *  then drop the network for a few seconds so the WS reconnects and a fresh snapshot arrives.
 *  Expect: no second InitBattle, dead lobsters stay corpses, overlays stay on their units. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  // Record every WebSocket the page opens so the test can close the live one on demand.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const O = window.WebSocket; const list = []; window.__wsList = list; const W = function(...a) { const w = new O(...a); list.push(w); return w; }; W.prototype = O.prototype; Object.assign(W, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); window.WebSocket = W; })();` });
  await b.goto('http://127.0.0.1:3000/game/battle?preset=random_apex');
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let a = 0; a < 4; a++) { await b.sleep(800); await rectClick(b, 'button', 'burner wallet').catch(() => {}); if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break; }
  await b.sleep(400); await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  const t0 = Date.now(); while (Date.now() - t0 < 150000 && !b.logs.some((l) => /\[BattleHud\] bind/.test(l))) await b.sleep(500);
  expect(b.logs.some((l) => /\[BattleHud\] bind/.test(l)), 'HUD bound');
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);

  let cells = new Map<string, any>(); let died = false; const started = Date.now();
  while (Date.now() - started < 6 * 60_000) {
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    if (/†/.test(await b.eval('document.body.innerText'))) { died = true; break; }
    const mine = await b.waitFor(myTurn, 30000, 300);
    if (!mine) continue;
    await b.sleep(700);
    const fresh = parseCells(grab(b, /\[BattleHud\] cells/).slice(-1)[0] ?? ''); if (fresh.size >= 20) cells = fresh;
    const g = await canvasGeom(b); const btns = parseButtons(grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '');
    const sel = await b.eval(`window.__clawbada_selection ? JSON.parse(JSON.stringify(window.__clawbada_selection)) : null`) as any;
    const target = sel?.attackTargets?.[0]; const lob = target ? (sel.lobsters || []).find((l: any) => l.id === target) : null; const cell = lob ? cells.get(`${lob.col},${lob.row}`) : null;
    if (cell) { const p = toCss(g, cell.x, cell.y); await b.clickAt(p.x, p.y); }
    else if (btns.defend) { const p = toCss(g, btns.defend.x + btns.defend.w / 2, btns.defend.y + btns.defend.h / 2); await b.clickAt(p.x, p.y); }
    await b.sleep(1500);
  }
  expect(died, 'a lobster died before the reconnect test');
  await b.sleep(2500);
  await b.screenshot(`${S}/reconnect-before.png`);
  const initsBefore = grab(b, /\[BattleManager\] Initialized battle/).length;

  // Close the live battle socket: the client reconnects with backoff and receives a fresh snapshot.
  const closed = await b.eval(`(() => { const open = (window.__wsList || []).filter(w => w.readyState === 1); open.forEach(w => w.close()); return open.length; })()`);
  console.log('closed sockets:', closed);
  const reconnected = await b.waitFor(`(window.__wsList || []).filter(w => w.readyState === 1).length > 0`, 30000, 500);
  const synced = await b.waitFor(`true`, 10, 10); void synced;
  const t1 = Date.now(); while (Date.now() - t1 < 20000 && grab(b, /\[BattleStage\] reconnect snapshot/).length === 0) await b.sleep(500);
  await b.sleep(3000);
  await b.screenshot(`${S}/reconnect-after.png`);
  const initsAfter = grab(b, /\[BattleManager\] Initialized battle/).length;
  const syncs = grab(b, /\[BattleStage\] reconnect snapshot/);
  const spawnDead = grab(b, /\[LobsterController\] spawn dead/);
  console.log(`inits before ${initsBefore} after ${initsAfter}; reconnect syncs ${syncs.length}; spawn-dead logs ${spawnDead.length}; reconnected=${reconnected}`);
  expect(initsAfter === initsBefore, 'no Unity re-init on reconnect (SyncUnits path)');
  expect(syncs.length >= 1, 'reconnect snapshot handed to Unity as SyncUnits');
  const exc = b.logs.filter((l) => /\[exception\]|NullReference|GLctx/.test(l) && !/Family Accounts/.test(l));
  expect(exc.length === 0, 'no exceptions: ' + exc.slice(0, 2).join(' | '));
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL CHECKS PASSED');
}
