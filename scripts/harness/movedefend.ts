import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'trio_ember';
const TURNS = Number(process.env.TURNS ?? '6');
/** Own-turn index (1-based) on which the socket is cut before the Defend press; 0 = never. */
const OFFLINE_TURN = Number(process.env.OFFLINE_TURN ?? '0');
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

/** Replays the reported freeze: on each own turn click a legal move hex, let the preview walk,
 *  press Defend in the Unity bar, and check the turn actually goes out and resolves. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  // Keep a handle on every WebSocket the page opens so the outage can be a real close() —
  // DevTools "offline" emulation leaves an already-open socket alive.
  await b.send('Page.enable');
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__sockets = []; const W = window.WebSocket; window.WebSocket = function (...a) { const s = new W(...a); window.__sockets.push(s); return s; }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });` });
  // SPEED (0.25-4) slows Unity's playback, e.g. to catch a 0.33 s effect in screenshots.
  await b.goto(`${BASE}/game/battle?preset=${PRESET}${process.env.SPEED ? `&speed=${process.env.SPEED}` : ''}`);
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
    if (load > 0) { console.log(`[movedefend] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
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

  const canActNow = async () => { const s = await sel(b); return !!s?.actor && !!(await b.eval(`/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`)); };
  let played = 0, frozen = 0;
  const started = Date.now();
  while (played < TURNS && Date.now() - started < 6 * 60_000) {
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    const mine = await b.waitFor(`/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`, 30000, 250);
    if (!mine) continue;
    await b.sleep(600);
    if (!(await canActNow())) continue;
    const s0 = await sel(b);
    const moves: Array<{ col: number; row: number }> = s0?.moves ?? [];
    const g = await canvasGeom(b);
    const cells = parseCells(grab(b, /\[BattleHud\] cells/).slice(-1)[0] ?? '');
    const turnBefore = Number(await b.eval(`Number((document.body.innerText.match(/Turn (\\d+)/i) || [])[1] || 0)`));
    const nBefore = b.logs.length;
    let moved = false;
    if (moves.length) {
      const mv = moves[Math.floor(moves.length / 2)];
      const c = cells.get(`${mv.col},${mv.row}`);
      if (c) {
        // Touch-move (2026-09-30): first tap picks (nothing moves), second tap commits for good.
        const p = toCss(g, c.x, c.y);
        await b.clickAt(p.x, p.y); await b.sleep(400);
        const picked = await sel(b);
        expect(!!picked?.pendingMove && !picked?.moveTo, `turn ${turnBefore}: the first tap only picks the hex (pending=${JSON.stringify(picked?.pendingMove)} moveTo=${JSON.stringify(picked?.moveTo)})`);
        // Move-target overlay (2026-10-04): Unity paints the picked hex with a white outline + light-green glow and says so.
        const destLine = grab(b, /\[HexGrid\] selection .*dest=\(/).slice(-1)[0] ?? '';
        expect(new RegExp(`dest=\\(${mv.col},${mv.row}\\) .*overlay=True`).test(destLine), `turn ${turnBefore}: Unity painted the dest overlay on (${mv.col},${mv.row}) (${destLine.slice(0, 110) || 'no [HexGrid] selection line'})`);
        if (process.env.DEST_SHOTS && played === 0) {
          await b.screenshot(`${S}/dest-pick-1.png`); await b.sleep(300); await b.screenshot(`${S}/dest-pick-2.png`);
          console.log(`[movedefend] dest frames for (${mv.col},${mv.row}) at canvas px (${c.x},${c.y}) → out/dest-pick-{1,2}.png`);
        }
        await b.clickAt(p.x, p.y); moved = true;
        if (process.env.ARRIVAL_SHOTS && played === 0) {
          // Frame burst through the walk and its arrival ring (FRAMES of the committed move, ~120 ms apart).
          for (let f = 0; f < 12; f++) { await b.screenshot(`${S}/arrival-f${String(f).padStart(2, '0')}.png`); await b.sleep(60); }
          await b.sleep(800);
          for (const l of grab(b, /IntroDust\] ring|LobsterController\] move /)) console.log('[movedefend] ', l.slice(0, 140));
        } else await b.sleep(1200);   // walk (0.35 s/hex) + SetSelection round trip
        const locked = await sel(b);
        expect(!!locked?.moveLocked && locked?.moveTo?.col === mv.col && locked?.moveTo?.row === mv.row, `turn ${turnBefore}: the second tap commits the move`);
        // Any other hex now: the move is final.
        const other = moves.find((m) => m.col !== mv.col || m.row !== mv.row);
        const oc = other ? cells.get(`${other.col},${other.row}`) : null;
        if (oc) {
          const q = toCss(g, oc.x, oc.y);
          await b.clickAt(q.x, q.y); await b.sleep(300); await b.clickAt(q.x, q.y); await b.sleep(600);
          const after = await sel(b);
          expect(after?.moveTo?.col === mv.col && after?.moveTo?.row === mv.row, `turn ${turnBefore}: a second move is refused (${after?.hint})`);
        }
      }
    }
    const s1 = await sel(b);
    const btns = parseButtons(grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '');
    if (!btns.defend) { console.log('[movedefend] no defend button rect'); await b.sleep(1000); continue; }
    const p = toCss(g, btns.defend.x + btns.defend.w / 2, btns.defend.y + btns.defend.h / 2);
    const offline = OFFLINE_TURN > 0 && played + 1 === OFFLINE_TURN;
    if (offline) {
      const n = await b.eval(`(() => { const open = (window.__sockets || []).filter((s) => s.readyState === 1); open.forEach((s) => s.close()); return open.length; })()`);
      console.log(`[movedefend] closed ${n} open socket(s)`);
      const dropped = await b.waitFor(`!/\bLive\b/.test(document.body.innerText)`, 8000, 200);
      console.log(`[movedefend] socket cut before the press — badge left 'Live': ${dropped}`);
    }
    await b.clickAt(p.x, p.y);
    if (offline) {
      await b.sleep(1500);
      const q = b.logs.slice(nBefore).filter((l) => /BattleSession|TurnSelection|LiveBattle\] (submit|server)|BattleHud\] (hint|press)/.test(l)).map((l) => l.replace(/^\[\w+\] /, '').slice(0, 120));
      console.log(`[movedefend] during the outage (${q.length} lines):`); for (const l of q) console.log('    ', l);
    }
    const submitted = await b.waitFor(`false`, 0).then(() => false);
    // Wait for the submit log / turn advance, up to 6 s (12 s across an outage: 1 s reconnect backoff + flush).
    const t1 = Date.now(); let sent = false, advanced = false;
    while (Date.now() - t1 < (offline ? 12000 : 6000)) {
      const fresh = b.logs.slice(nBefore);
      if (fresh.some((l) => /\[LiveBattle\] submit defend/.test(l))) sent = true;
      const turnNow = Number(await b.eval(`Number((document.body.innerText.match(/Turn (\\d+)/i) || [])[1] || 0)`));
      if (turnNow > turnBefore) { advanced = true; break; }
      await b.sleep(250);
    }
    const fresh = b.logs.slice(nBefore).filter((l) => /TurnSelection|LiveBattle\] (server|submit)|ActionSelected|HexClicked|PreviewMove|selection player=true/.test(l)).map((l) => l.replace(/^\[\w+\] /, '').slice(0, 150));
    const hint = (await sel(b))?.hint ?? null;
    played++;
    const flushed = offline && b.logs.slice(nBefore).some((l) => /socket back — sending the queued turn/.test(l));
    const label = `turn ${turnBefore} ${s0?.actor} moved=${moved} (${moves.length} legal, moveTo=${JSON.stringify(s1?.moveTo ?? null)}) → defend: sent=${sent} advanced=${advanced} hint=${JSON.stringify(hint)}${offline ? ` [offline window: queued+flushed=${flushed}]` : ''}`;
    console.log(`[movedefend] ${label}`);
    if (!advanced) { frozen++; console.log('  --- trace:'); for (const l of fresh.slice(-14)) console.log('   ', l); await b.screenshot(`${S}/movedefend-frozen-${played}.png`); }
    void submitted;
    await b.sleep(800);
  }
  expect(played >= Math.min(TURNS, 2), `played ${played} own turns (battle may end early at Elite)`);
  expect(frozen === 0, `every move+Defend resolved (${frozen} did not)`);
  const errs = grab(b, /Exception|GLctx|Uncaught|\[exception\]/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  expect(errs.length === 0, `no exceptions (${errs.length})`);
  for (const l of errs.slice(0, 4)) console.log('  err:', l.slice(0, 160));
  console.log(fails.length ? `[movedefend] FAILED: ${fails.join('; ')}` : '[movedefend] ALL CHECKS PASSED');
}
