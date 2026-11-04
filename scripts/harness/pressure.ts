/**
 * Pressure tube + action cluster (Nzib's drop 2cc98d1 / 107c18b, owner 2026-11-03).
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts pressure.ts
 *
 * One Dojo battle (tanky Apex teams so it runs long):
 *  1. first player turn — screenshot (out/pressure-start.png: cluster + cold tube), then a MOUSE click on Defend's hit
 *     area (from the `[BattleHud] buttons` line) presses Defend;
 *  2. the probe Defends every turn with the 3 key (the bot attacks; tanky teams last past turn 40) — every `[BattleHud] pressure` line matches the rule (bonus = (turn − 40) × 3, stage 0 / ≤30 / ≤60 / beyond,
 *     fill = min(1, bonus / 90)); screenshots when the bonus first passes 15 / 45 / 75 (out/pressure-<bonus>.png).
 * Muted; resigns through the API at the end.
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  const S = `${import.meta.dir}/out`;
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const shot = async (name: string) => { const r = await b.send('Page.captureScreenshot', { format: 'png' }); await Bun.write(`${S}/${name}.png`, Buffer.from(r.data, 'base64')); };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });

  await b.goto(`${BASE}/dojo?team=bulwark,sentinel,leviathan&tier=apex&bot=balanced&stay=1`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), 'Dojo opened');
  await b.sleep(2000);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  b.drainLogs();
  await b.clickAt(r.x, r.y);
  ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), 'battle opened');
  const t0 = Date.now(); while (Date.now() - t0 < 120000 && !b.logs.some((l) => /intro complete/.test(l))) await b.sleep(250);
  const cold = b.logs.find((l) => /\[BattleHud\] pressure turn=0 bonus=0% stage=0/.test(l));
  ok(!!cold, `the tube starts cold (${(cold ?? 'no pressure line').replace(/^\[log\] /, '')})`);

  // 1. First player turn: screenshot, then click Defend with the mouse.
  const t1 = Date.now();
  while (Date.now() - t1 < 60000 && !(await b.eval(`/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`))) await b.sleep(250);
  const t2 = Date.now(); while (Date.now() - t2 < 10000 && !b.logs.some((l) => /\[BattleHud\] buttons/.test(l))) await b.sleep(200);
  await b.sleep(600);
  await shot('pressure-start');
  const line = b.logs.filter((l) => /\[BattleHud\] buttons/.test(l)).slice(-1)[0] ?? '';
  const rects: Record<string, number[]> = {};
  for (const m of line.matchAll(/(\w+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) rects[m[1]] = [+m[2], +m[3], +m[4], +m[5]];
  ok(!!rects.attack && !!rects.special && !!rects.defend && !rects.wait, `three buttons, no Wait (${Object.keys(rects).join(', ')})`);
  const g = await b.eval(`(() => { const c = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0]; const q = c.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, bw: c.width, bh: c.height }; })()`) as { x: number; y: number; w: number; h: number; bw: number; bh: number };
  if (rects.defend) {
    const [x, y, w, h] = rects.defend;
    const n = b.logs.length;
    await b.clickAt(g.x + (x + w / 2) * g.w / g.bw, g.y + (g.bh - (y + h / 2)) * g.h / g.bh);
    const t3 = Date.now(); while (Date.now() - t3 < 3000 && !b.logs.slice(n).some((l) => /\[BattleHud\] press defend/.test(l))) await b.sleep(100);
    ok(b.logs.slice(n).some((l) => /\[BattleHud\] press defend/.test(l)), 'a mouse click on Defend presses Defend');
  }

  // 2. Defend every turn to the end (or 8 minutes): check every pressure line, screenshot as it builds.
  let pressed = b.logs.length;
  const want = [15, 45, 75];
  const t4 = Date.now();
  let bad = 0, seen = 0, maxBonus = 0;
  while (Date.now() - t4 < 480000) {
    const lines = b.logs.filter((l) => /\[BattleHud\] pressure turn=/.test(l));
    for (const l of lines.slice(seen)) {
      const m = /turn=(\d+) bonus=(\d+)% stage=(\d) fill=([\d.]+)/.exec(l)!;
      const [turn, bonus, stage, fill] = [+m[1], +m[2], +m[3], +m[4]];
      const eb = Math.max(0, turn - 40) * 3, es = eb <= 0 ? 0 : eb <= 30 ? 1 : eb <= 60 ? 2 : 3, ef = Math.min(1, eb / 90);
      if (bonus !== eb || stage !== es || Math.abs(fill - ef) > 0.006) { bad++; console.log(`  mismatch: ${l}`); }
      maxBonus = Math.max(maxBonus, bonus);
      while (want.length && bonus >= want[0]) { await shot(`pressure-${want.shift()}`); }
    }
    seen = lines.length;
    if (await b.eval(`/Victory|Defeat|Battle over/i.test(document.querySelector('[data-testid=battle-status-line]')?.textContent || '')`)) break;
    // A new action bar since our last press = our turn again: Defend.
    if (b.logs.slice(pressed).some((l) => /\[BattleHud\] buttons/.test(l))) {
      await b.sleep(300);
      pressed = b.logs.length;
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51, text: '3' });
      await b.sleep(60);
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '3', code: 'Digit3', windowsVirtualKeyCode: 51 });
    }
    await b.sleep(400);
  }
  ok(seen > 0 && bad === 0, `every pressure reading matches the rule (${seen} readings, highest +${maxBonus}%)`);
  ok(maxBonus > 0, 'pressure started during the battle');
  const errors = b.allLogs.filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
  ok(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 0; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`).catch(() => 0);
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
