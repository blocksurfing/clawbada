/**
 * The Dojo plants' ninja (Nzib's drop 28dc6ce + his behaviour note, owner 2026-11-08).
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts dojo-ninja.ts
 * Practice battles on the Dojo arena until both directions have been seen (each plant hides a ninja with 50 %, rolled
 * per battle). In each: after the first turn starts,
 *   · an occupied plant clicked → Shake, jump, throw, star, double shake ("play from …", then "impact");
 *     a second click during it is ignored; frames are saved (out/ninja-<side>-<ms>.png);
 *   · an empty plant clicked → it rustles (no ninja); after its hidden 5–10 clicks the ninja bursts out of it and the
 *     whole sequence plays (owner 2026-11-08); clicking the OTHER plant during a sequence does nothing;
 *   · no plant click ever reaches the board (no HexInput click line).
 * Muted; resigns each battle through the API.
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  const OUT = `${import.meta.dir}/out`;
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const waitLog = async (n: number, re: RegExp, ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { const l = b.logs.slice(n).find((x) => re.test(x)); if (l) return l; await b.sleep(100); } return null; };
  const resign = () => b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 0; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`);

  // The sounds (owner's takes, 2026-11-09), from BattleSfx's log: one sequence = shake, jump, voice, whirl, hit, in order.
  const SEQ = ['dojo-shake', 'dojo-jump', 'dojo-voice', 'dojo-star', 'dojo-hit'];
  const sfxOf = (from: number) => b.logs.slice(from).map((l) => l.match(/\[BattleSfx\] (SFX_Dojo_\w+) \((dojo-[a-z]+)\)/)).filter(Boolean).map((m) => ({ clip: m![1], phase: m![2] }));
  const seqOk = (from: number, label: string) => {
    const got = sfxOf(from).filter((x) => x.phase !== 'dojo-rustle');
    ok(got.map((x) => x.phase).join(',') === SEQ.join(','), `${label}: sounds in order (${got.map((x) => x.clip.replace('SFX_Dojo_', '')).join(' → ') || 'none'})`);
  };
  const seen = { left: false, right: false, empty: false };
  for (let battle = 1; battle <= 8 && !(seen.left && seen.right && seen.empty); battle++) {
    await b.goto(`${BASE}/dojo?team=sentinel,mantis,kraken&tier=elite&bot=balanced&stay=1`);
    if (!(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250))) { ok(false, 'Dojo opened'); break; }
    await b.sleep(2500);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs();
    await b.clickAt(r.x, r.y);
    if (!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000))) { ok(false, 'battle opened'); break; }
    const occ = await waitLog(0, /\[DojoNinja\] occupancy/, 120000);
    const pts = await waitLog(0, /\[DojoNinja\] plants screen/, 120000);
    if (!occ || !pts) { ok(false, `battle ${battle}: occupancy + plant points logged`); await resign(); continue; }
    const L = /L=1/.test(occ), R = /R=1/.test(occ);
    const m = pts.match(/L=(-?\d+),(-?\d+) R=(-?\d+),(-?\d+)/)!.slice(1).map(Number);
    console.log(`  battle ${battle}: ${occ.replace(/.*occupancy /, '')}`);
    await b.sleep(1500);
    const g = await b.eval(`(() => { const c = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0]; const q = c.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, bw: c.width, bh: c.height }; })()`) as { x: number; y: number; w: number; h: number; bw: number; bh: number };
    const toCss = (ux: number, uy: number) => ({ x: g.x + ux * g.w / g.bw, y: g.y + (g.bh - uy) * g.h / g.bh });
    const plant = { left: toCss(m[0], m[1]), right: toCss(m[2], m[3]) };

    // An empty plant: a rustle per click, then the surprise ninja at its hidden count; the other plant is locked out meanwhile.
    const empty = !L ? 'left' : !R ? 'right' : null;
    if (empty && !seen.empty) {
      const need = Number(occ.match(new RegExp(`surprise ${empty === 'left' ? 'L' : 'R'}=(\\d+)`))?.[1] ?? 0);
      ok(need >= 5 && need <= 10, `empty ${empty} plant: its surprise count is 5–10 (${need})`);
      const n = b.logs.length;
      for (let k = 1; k < need; k++) { await b.clickAt(plant[empty].x, plant[empty].y); await b.sleep(k === 1 ? 300 : 120); }
      const rustles = b.logs.slice(n).filter((l) => /\[DojoNinja\] rustle/.test(l)).length;
      const rustleSfx = sfxOf(n).filter((x) => x.phase === 'dojo-rustle').length;
      ok(rustleSfx >= 1 && rustleSfx <= rustles, `empty ${empty} plant: rustle sounds play (${rustleSfx} for ${rustles} clicks; not restarted mid-rustle)`);
      ok(rustles === need - 1 && !b.logs.slice(n).some((l) => /\[DojoNinja\] play from|\[HexInput\] click/.test(l)),
        `empty ${empty} plant: ${need - 1} clicks rustle it, no ninja yet, nothing reaches the board (${rustles} rustles)`);
      await b.screenshot(`${OUT}/ninja-rustle-${empty}.png`);
      const m2 = b.logs.length;
      await b.clickAt(plant[empty].x, plant[empty].y);
      const surprise = await waitLog(m2, /\[DojoNinja\] surprise/, 1500);
      const play = await waitLog(m2, /\[DojoNinja\] play from/, 1500);
      ok(!!surprise && !!play && play.includes(empty), `click ${need}: the ninja bursts out of the ${empty} plant (${play ?? 'nothing'})`);
      const other = empty === 'left' ? 'right' : 'left';
      for (let k = 0; k < 4; k++) { await b.sleep(400); await b.clickAt(plant[other].x, plant[other].y); await b.clickAt(plant[empty].x, plant[empty].y); }
      const during = b.logs.slice(m2).filter((l) => /\[DojoNinja\] (play from|rustle|surprise)/.test(l)).length;
      ok(during === 2, `back-and-forth clicks during the sequence do nothing (${during - 2} extra)`);
      ok(!!(await waitLog(m2, /\[DojoNinja\] impact/, 7000)), `the surprise sequence lands`);
      seqOk(m2, `surprise from the ${empty}`);
      await b.sleep(1600);
      seen.empty = true;
      seen[empty] = true;
    }
    for (const side of ['left', 'right'] as const) {
      if (seen[side] || !(side === 'left' ? L : R)) continue;
      const n = b.logs.length;
      const t0 = Date.now();
      await b.clickAt(plant[side].x, plant[side].y);
      const play = await waitLog(n, /\[DojoNinja\] play from/, 1500);
      ok(!!play && play.includes(side), `${side} plant with a ninja: the sequence starts (${play ?? 'nothing'})`);
      // Frames through the sequence (shake 1.2 s, jump 0.4 s, throw 1.4 s / star from ~0.6 s, impact shake 1.2 s).
      let clicked2 = false;
      for (const at of [400, 1450, 1750, 2300, 2700, 3200, 3700, 4400]) {
        while (Date.now() - t0 < at) await b.sleep(20);
        await b.screenshot(`${OUT}/ninja-${side}-${at}.png`);
        if (!clicked2 && at >= 1450) { clicked2 = true; await b.clickAt(plant[side].x, plant[side].y); }
      }
      const impact = await waitLog(n, /\[DojoNinja\] impact/, 6000);
      ok(!!impact, `${side}: the star lands, both plants shake (${Date.now() - t0} ms)`);
      seqOk(n, side);
      const plays = b.logs.slice(n).filter((l) => /\[DojoNinja\] play from/.test(l)).length;
      ok(plays === 1, `${side}: a click during the sequence is ignored (${plays} play)`);
      ok(!b.logs.slice(n).some((l) => /\[HexInput\] click/.test(l)), `${side}: plant clicks never reach the board`);
      await b.sleep(1600);
      seen[side] = true;
    }
    const errors = b.allLogs.filter((l) => /Exception|NullReference/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
    ok(errors.length === 0, `battle ${battle}: no errors (${errors.slice(0, 2).join(' | ')})`);
    await resign();
  }
  ok(seen.left && seen.right, `both directions seen (left ${seen.left}, right ${seen.right}, empty ${seen.empty})`);
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
