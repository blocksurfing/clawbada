import type { Browser } from './cdp';

/**
 * The battle page out of fullscreen (owner 2026-10-28): a faded Dojo behind the arena and nothing else — no title, no
 * "Live · vs bot" line — the Dojo item highlighted in the sidebar, and the Full screen button clear of the wallet
 * wheel. Then the result: it holds ~8 s and returns to the Dojo on its own.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts battle-windowed.ts        (VW/VH/DPR to pick the window; default 1440×755@2)
 *   RESULT_AUDIO=on|off …                  the owner's settings (Music off, battle Music off) with SFX on or off: the
 *                                          Victory/Defeat track must play with SFX on and stay silent with it off.
 *                                          Every media element is muted at the source — nothing reaches the speakers.
 */
export const keepAudio = !!process.env.RESULT_AUDIO;

export default async function (b: Browser) {
  const resultAudio = process.env.RESULT_AUDIO as 'on' | 'off' | undefined;
  if (resultAudio) {
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `{ const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { this.muted = true; return p.call(this); }; }
      try { localStorage.setItem('clawbada_music', 'off'); localStorage.setItem('clawbada_battle_music', 'off'); localStorage.setItem('clawbada_sfx', '${resultAudio}'); } catch (e) {}` });
  }
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const OUT = `${import.meta.dir}/out`;
  const [vw, vh, dpr] = [Number(process.env.VW ?? 1440), Number(process.env.VH ?? 755), Number(process.env.DPR ?? 2)];
  const fails: string[] = [];
  const ok = (pass: boolean, what: string, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!pass) fails.push(what); };
  await b.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: dpr, mobile: false });

  await b.goto(`${BASE}/dojo?team=bulwark,leviathan,sentinel&tier=evolved&purity=2&bot=charger&auto=1`);
  await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250);
  await b.sleep(4000);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  await b.clickAt(r.x, r.y);
  ok(!!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000)), 'battle page opened');
  // Past the entry: the arena is up (Unity's HUD bound) — then leave fullscreen like a player pressing Esc.
  await b.waitFor(`!!document.querySelector('[data-testid=battle-fullscreen]') && !document.querySelector('[data-testid=battle-entry]')`, 120000, 500);
  await b.sleep(1500);
  await b.eval(`document.fullscreenElement ? document.exitFullscreen().then(() => true) : true`);
  await b.sleep(1500);

  const text = await b.eval(`document.querySelector('#page-content, main')?.innerText ?? document.body.innerText`) as string;
  ok(!/Practice battle|Beat the bot|Practice vs|\bLive\b/i.test(text), 'no title, subtitle or "Live · vs bot" line', JSON.stringify(text.slice(0, 120)));
  ok(!!(await b.eval(`(() => { const e = document.querySelector('[data-backdrop-art=dojo]'); return !!e && getComputedStyle(e).backgroundImage.includes('Dojo_Dark'); })()`)), 'the faded Dojo is behind the arena');
  const current = await b.eval(`document.querySelector('.menu-item[aria-current=page]')?.getAttribute('data-label') ?? null`);
  ok(current === 'Dojo', 'the sidebar highlights the Dojo', String(current));
  const rects = await b.eval(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; }; return { btn: r('[data-testid=battle-fullscreen]'), wheel: r('.user-section'), stage: r('.battle-live canvas') ?? r('.battle-live') }; })()`) as Record<string, { l: number; t: number; r: number; b: number } | null>;
  const hit = (a: any, c: any) => !!a && !!c && a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
  ok(!!rects.btn && !hit(rects.btn, rects.wheel), 'the Full screen button is clear of the wallet wheel', JSON.stringify({ btn: rects.btn, wheel: rects.wheel }));
  ok(!!rects.stage && !hit(rects.stage, rects.wheel), 'the arena is clear of the wallet wheel', JSON.stringify(rects.stage));
  ok(!!rects.stage && rects.stage.b <= vh + 1, 'the arena fits the window height', rects.stage ? `bottom ${Math.round(rects.stage.b)} / ${vh}` : 'none');
  await b.screenshot(`${OUT}/battle-windowed-${vw}.png`);

  // The result: forfeit, then time the hold until the page leaves for the Dojo.
  await b.eval(`document.querySelector('[data-testid=battle-fullscreen]') && 0`);
  const token = await b.eval(`(() => { try { return JSON.parse(localStorage.getItem('clawbada.session.guest') || 'null')?.token ?? null; } catch { return null; } })()`);
  const id = await b.eval(`location.pathname.split('/').pop()`);
  const api = process.env.API ?? 'http://127.0.0.1:3011';
  const res = await fetch(`${api}/api/game/combat/${id}/forfeit`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  ok(res.status === 200, 'forfeit accepted', String(res.status));
  const shownAt = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (b.allLogs.some((l) => /\[LiveBattle\] result shown/.test(l))) return Date.now(); await b.sleep(100); } return null; })();
  ok(!!shownAt, 'the result shows');
  let closingAt: number | null = null;
  // The exit iris (2026-10-29): when each phase was first seen, and where the page was when the circle shut.
  const seen: Record<string, number> = {};
  let pathWhenClosed = '';
  const exitPhase = () => b.eval(`document.querySelector('[data-testid=battle-exit]')?.getAttribute('data-phase') ?? 'none'`) as Promise<string>;
  const backAt = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (!closingAt && b.allLogs.some((l) => /\[LiveBattle\] closing the battle view/.test(l))) closingAt = Date.now(); const ph = await exitPhase(); if (ph !== 'none' && !seen[ph]) { seen[ph] = Date.now(); if (ph === 'closed') pathWhenClosed = await b.eval('location.pathname') as string; } if (await b.eval(`location.pathname === '/dojo'`)) return Date.now(); await b.sleep(50); } return null; })();
  // … then the opening on the Dojo, until the overlay is gone.
  const goneAt = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { const ph = await exitPhase(); if (ph !== 'none' && !seen[ph]) seen[ph] = Date.now(); if (ph === 'none' && seen.opening) return Date.now(); await b.sleep(50); } return null; })();
  const held = shownAt && backAt ? (backAt - shownAt) / 1000 : null;
  // The hold itself ends when the view starts closing; the navigation after it waits on the stage teardown (and, on a
  // cold dev server, a page compile) — logged separately so a slow server isn't read as a long hold.
  const closingLine = b.allLogs.find((l) => /\[LiveBattle\] closing the battle view/.test(l));
  console.log(`[windowed] closing logged: ${!!closingLine}; result → Dojo ${held?.toFixed(1)} s`);
  const zoomStart = shownAt && seen.closing ? (seen.closing - shownAt) / 1000 : null;
  ok(zoomStart !== null && zoomStart >= 7.8 && zoomStart <= 8.8, 'the zoom-out starts when the 8 s result hold ends', zoomStart !== null ? `${zoomStart.toFixed(1)} s after the result` : 'no exit iris seen');
  const closeDur = seen.closing && seen.closed ? (seen.closed - seen.closing) / 1000 : null;
  ok(closeDur !== null && closeDur >= 1.3 && closeDur <= 2.0, 'the circle closes over the result in ~1.5 s', closeDur !== null ? `${closeDur.toFixed(2)} s` : 'never closed');
  ok(pathWhenClosed.startsWith('/battle/'), 'the battle page is still there while it closes (the switch happens under the navy)', pathWhenClosed || 'unknown');
  ok(!!seen.opening && !!goneAt && !!backAt && seen.opening >= backAt, 'the Dojo opens from the middle afterwards', seen.opening && goneAt ? `opening ${((goneAt - seen.opening) / 1000).toFixed(2)} s` : 'no opening seen');
  const hold = shownAt && closingAt ? (closingAt - shownAt) / 1000 : null;
  ok(hold !== null && hold >= 9.3 && hold <= 10.6, 'the result holds 8 s, then the 1.5 s zoom-out, before the view closes', hold !== null ? `${hold.toFixed(1)} s` : 'never closed');
  ok(held !== null, 'then it returns to the Dojo by itself', held !== null ? `${held.toFixed(1)} s after the result (teardown + page load included)` : 'never returned');
  const rm = b.allLogs.filter((l) => /\[ResultMusic\]/.test(l));
  console.log(`[windowed] result music: ${rm.map((l) => l.slice(0, 120)).join(' | ') || '(none logged)'}`);
  if (resultAudio === 'on') ok(rm.some((l) => /BGM_Result_(Victory|Defeat)\.[0-9a-f]{8}\.m4a playing/.test(l)), 'with SFX on (Music off) the result track plays');
  if (resultAudio === 'off') ok(rm.some((l) => /sound effects are off/.test(l)) && !rm.some((l) => / playing/.test(l)), 'with SFX off the result track stays silent');
  if (resultAudio === 'on') ok(rm.some((l) => /fade out over|track finished/.test(l)), 'the result track finishes or fades out as the page leaves');
  console.log(fails.length ? `[windowed] ${fails.length} FAIL` : '[windowed] all ok');
}
