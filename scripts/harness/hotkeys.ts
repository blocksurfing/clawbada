/**
 * Action-bar hotkeys (Nzib's suggestion, owner 2026-11-01): 1–3 / A S D press Attack, Special, Defend like a
 * click; Space/Enter is the second tap (commits a picked move hex, confirms a selected target).
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts hotkeys.ts
 *
 * One practice battle, not played by the probe except through the keyboard:
 *  turn 1: tap a reachable hex (picked), Space commits it, then 3 Defends;
 *  turn 2: 1 arms Attack (nothing sent), W does nothing (Wait was removed 2026-11-03), then 3 Defends;
 *  turn 3: A arms Attack, D Defends.
 * Muted; resigns through the API at the end (one live practice battle per player).
 */
import type { Browser } from './cdp';

const KEYS: Record<string, { key: string; code: string; vk: number }> = {
  '1': { key: '1', code: 'Digit1', vk: 49 }, '3': { key: '3', code: 'Digit3', vk: 51 },
  a: { key: 'a', code: 'KeyA', vk: 65 }, d: { key: 'd', code: 'KeyD', vk: 68 }, w: { key: 'w', code: 'KeyW', vk: 87 },
  space: { key: ' ', code: 'Space', vk: 32 },
};

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const key = async (name: string) => {
    const k = KEYS[name];
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.key });
    await b.sleep(80);
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk });
  };
  const since = (n: number, re: RegExp) => b.logs.slice(n).some((l) => re.test(l));
  const waitLog = async (n: number, re: RegExp, ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { if (since(n, re)) return true; await b.sleep(150); } return false; };
  const turnStarts = () => b.logs.filter((l) => /\[BattleHud\] buttons/.test(l)).length;

  await b.goto(`${BASE}/dojo?team=sentinel,mantis,kraken&tier=elite&bot=balanced&stay=1`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), 'Dojo opened');
  await b.sleep(2500);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  b.drainLogs();
  await b.clickAt(r.x, r.y);
  ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), 'battle opened');
  ok(await waitLog(0, /\[BattleStage\] intro complete/, 120000), 'intro done');

  const g = await b.eval(`(() => { const c = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0]; const q = c.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, bw: c.width, bh: c.height }; })()`) as { x: number; y: number; w: number; h: number; bw: number; bh: number };
  const toCss = (ux: number, uy: number) => ({ x: g.x + ux * g.w / g.bw, y: g.y + (g.bh - uy) * g.h / g.bh });
  // "Your turn" is React's; the keys work once Unity has shown the action bar (its `buttons` line). On production
  // the bar lands a beat after the text (network round trip), and a key pressed before it is ignored by design.
  let mark = 0;
  const myTurn = async (ms = 60000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await b.eval(`/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`) && since(mark, /\[BattleHud\] buttons/)) return true;
      await b.sleep(250);
    }
    return false;
  };

  // Turn 1: pick a hex by tap, Space commits it, 3 Defends.
  ok(await myTurn(), 'player turn 1');
  await b.sleep(800);
  const cellsLine = b.logs.filter((l) => /\[BattleHud\] cells/.test(l)).slice(-1)[0] ?? '';
  const cells = [...cellsLine.matchAll(/\((\d+),(\d+)\)=\((-?\d+),(-?\d+)\)/g)].map((m) => ({ col: +m[1], row: +m[2], x: +m[3], y: +m[4] }));
  console.log(`[hotkeys] ${cells.length} cells, canvas ${JSON.stringify(g)}, first ${JSON.stringify(cells[0])}, allLogs cells ${b.allLogs.filter((l) => /\[BattleHud\] cells/.test(l)).length}`);
  let n = b.logs.length, picked = false;
  for (const c of cells) {
    const p = toCss(c.x, c.y);
    await b.clickAt(p.x, p.y);
    if (await waitLog(n, /\[TurnSelection\] move picked/, 500)) { picked = true; break; }
    if (process.env.DEBUG) console.log(`[hotkeys] click (${c.col},${c.row}) → ${b.logs.slice(n).filter((l) => /TurnSelection|HexInput|hex/i.test(l)).join(' | ').slice(0, 160)}`);
    n = b.logs.length;
  }
  ok(picked, 'a tap picked a move hex');
  n = b.logs.length;
  await key('space');
  ok(await waitLog(n, /\[TurnSelection\] move committed/, 3000), 'Space commits the picked hex');
  await b.sleep(1500);
  n = b.logs.length;
  await key('3');
  ok(await waitLog(n, /\[BattleHud\] press defend/, 2000) && await waitLog(n, /unity action defend/, 2000), '3 presses Defend');
  mark = b.logs.length;

  // Turn 2: 1 arms Attack (nothing sent), W does nothing (no Wait any more), 3 Defends.
  ok(await myTurn(), 'player turn 2');
  await b.sleep(800);
  n = b.logs.length;
  await key('1');
  ok(await waitLog(n, /\[BattleHud\] press attack/, 2000), '1 presses Attack');
  await b.sleep(400);
  n = b.logs.length;
  await key('w');
  ok(!(await waitLog(n, /\[BattleHud\] press /, 800)), 'W does nothing (Wait removed)');
  n = b.logs.length;
  await key('3');
  ok(await waitLog(n, /\[BattleHud\] press defend/, 2000), '3 presses Defend');
  mark = b.logs.length;

  // Turn 3: A arms Attack, D Defends.
  ok(await myTurn(), 'player turn 3');
  await b.sleep(800);
  n = b.logs.length;
  await key('a');
  ok(await waitLog(n, /\[BattleHud\] press attack/, 2000), 'A presses Attack');
  await b.sleep(300);
  n = b.logs.length;
  await key('d');
  ok(await waitLog(n, /\[BattleHud\] press defend/, 2000), 'D presses Defend');
  mark = b.logs.length;
  ok(await myTurn(), 'the battle carries on (player turn 4)');

  const errors = b.allLogs.filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
  ok(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 0; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`);
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
