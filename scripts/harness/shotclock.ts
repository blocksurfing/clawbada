/**
 * Shot clock vs playback (smoothness campaign 2026-11-04): the server's deadline covers the earlier turns the page is
 * still animating, so the clock a player SEES starts at its full budget when their turn appears and the server never
 * times them out on animation it sent them.
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts shotclock.ts
 *
 * A Dojo battle against a mirrored bot team with long Specials (Tempest's Maelstrom, Ember, Abyss). On each of the
 * player's turns (TURNS, default 8), when Unity shows the action bar: the clock Unity was given (`[BattleHud] clock`)
 * reads 58–60 s (75 on the first, with the load grace), and the server's own deadline (the battle's state) is at least that far away. Then Defend (3).
 * Muted; resigns through the API at the end.
 */
import type { Browser } from './cdp';

const TURNS = Number(process.env.TURNS ?? 8);

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  await b.goto(`${BASE}/dojo?team=tempest,ember,abyss&tier=elite&purity=6&bot=aggressive&stay=1`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), 'Dojo opened');
  await b.sleep(2000);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  b.drainLogs();
  await b.clickAt(r.x, r.y);
  ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), 'battle opened');
  const t0 = Date.now(); while (Date.now() - t0 < 120000 && !b.logs.some((l) => /intro complete/.test(l))) await b.sleep(250);
  const deadlineLeft = async () => b.eval(`(async () => {
    const id = location.pathname.split('/').pop();
    const tok = JSON.parse(localStorage.getItem('clawbada.session.guest')).token;
    const s = await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/state', { headers: { Authorization: 'Bearer ' + tok } }).then(r => r.json());
    const cur = s.current ?? s.snapshot?.current;
    return cur?.deadline ? { left: cur.deadline - Date.now(), clockMs: cur.clockMs ?? null, playbackMs: cur.playbackMs ?? null } : null;
  })()`) as Promise<{ left: number; clockMs: number | null; playbackMs: number | null } | null>;

  let mark = b.logs.length, seen = 0, shortest = Infinity, maxPlayback = 0;
  const shown: number[] = [];
  const t1 = Date.now();
  while (seen < TURNS && Date.now() - t1 < 420000) {
    if (await b.eval(`/Victory|Defeat|Battle over/i.test(document.querySelector('[data-testid=battle-status-line]')?.textContent || '')`)) break;
    // A new turn of ours = a fresh clock AND the action bar since our last press (the bar also redraws once with
    // "Sending…" after a press — that is not a turn).
    const fresh = b.logs.slice(mark);
    const clockLine = [...fresh].reverse().find((l) => /\[BattleHud\] clock \d+/.test(l));
    if (!clockLine || !fresh.some((l) => /\[BattleHud\] buttons/.test(l))) { await b.sleep(150); continue; }
    const clock = clockLine ? Number(/clock (\d+)/.exec(clockLine)![1]) : NaN;
    const dl = await deadlineLeft();
    seen++;
    shown.push(Math.round(clock / 100) / 10);
    if (dl) { shortest = Math.min(shortest, dl.left); maxPlayback = Math.max(maxPlayback, dl.playbackMs ?? 0); }
    console.log(`  turn ${seen}: clock shown ${(clock / 1000).toFixed(1)} s · server deadline in ${dl ? (dl.left / 1000).toFixed(1) : '?'} s · playback added ${dl?.playbackMs ?? '?'} ms`);
    mark = b.logs.length;
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51, text: '3' });
    await b.sleep(60);
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51 });
    await b.sleep(400);
  }
  ok(seen >= 3, `played ${seen} of the player's turns`);
  // The player's FIRST turn of a fresh battle carries the 15 s load grace (75 s).
  ok(shown.every((s, i) => s >= 58 && s <= (i === 0 ? 75.05 : 60.05)), `the clock starts at its full budget every turn (${shown.join(', ')})`);
  ok(shortest >= 57000, `the server never gave less than the clock shows (shortest ${(shortest / 1000).toFixed(1)} s)`);
  ok(maxPlayback > 0, `the server extended at least one turn for queued playback (max ${maxPlayback} ms)`);
  const errors = b.allLogs.filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
  ok(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 0; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`).catch(() => 0);
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
