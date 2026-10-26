import type { Browser } from './cdp';

/**
 * Coming out of a battle, the site theme waits THEME_RETURN_DELAY_MS (3 s) and then eases in over THEME_RETURN_FADE_MS
 * (3 s), when the site music is on (owner 2026-10-26: dropping straight into it was jarring). Every media element is
 * muted at the source, so nothing reaches the speakers even though the music preference is on.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts theme-return.ts
 */
export const keepAudio = true;   // the prefs are set below; the elements themselves are muted
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e => ${text === undefined ? 'true' : `(e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  if (!r) throw new Error(`no ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  // Site music on, battle music and SFX off; every <audio> muted before it can play, and each theme element tracked.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('clawbada_music', 'on'); localStorage.setItem('clawbada_battle_music', 'off'); localStorage.setItem('clawbada_sfx', 'off'); } catch (e) {}
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.muted = true; if (/theme/.test(this.src)) window.__theme = this; return play.call(this); };
  ` });
  await b.goto(`${BASE}/dojo`);
  await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]:not(:disabled)')`, 90000, 250);
  await b.sleep(2500);
  // Browsers only autoplay after a user gesture: click the page, then start the theme as a visitor's click would.
  const quiet = await b.eval(`(() => { const h = document.querySelector('h1, h2'); const q = h.getBoundingClientRect(); return { x: q.left + 4, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  await b.clickAt(quiet.x, quiet.y);   // the page heading: a gesture that presses nothing
  await b.eval(`window.__theme ? window.__theme.play().catch(() => {}) : null`);
  await b.sleep(800);
  const before = await b.eval(`window.__theme ? !window.__theme.paused : null`);
  ok('theme playing on the Dojo before the battle (site music on)', before === true, `theme ${before === null ? 'missing' : before ? 'playing' : 'paused'}`);
  await rectClick(b, '[data-testid=dojo-battle]');
  const inBattle = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 90000);
  ok('entered the battle', inBattle);
  if (!inBattle) { for (const c of checks) console.log(c); return; }
  // Past the loading screens and the intro: the battle is on screen (the EXIT button is reachable).
  const live = await b.waitFor(`!document.querySelector('[data-testid=battle-entry]') && /Your turn|Bot thinking|Opponent/.test(document.querySelector('[data-testid=battle-status-line]')?.textContent || '')`, 120000, 500);
  ok('battle on screen', live);
  await b.sleep(2000);
  const duringBattle = await b.eval(`window.__theme ? !window.__theme.paused : null`);
  ok('theme silent during the battle', duringBattle !== true, `theme ${duringBattle === null ? 'never started' : duringBattle ? 'playing' : 'paused'}`);
  // Out of the battle: EXIT leaves fullscreen, then the sidebar's Dojo link navigates away (client-side, like a player).
  await rectClick(b, 'button, a', 'exit');
  await b.sleep(1500);
  const dojo = await b.eval(`(() => { const a = document.querySelector('a[data-menu="dojo"]'); if (!a) return null; const q = a.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
  ok('sidebar Dojo link reachable after leaving fullscreen', !!dojo);
  if (dojo) await b.clickAt(dojo.x, dojo.y);
  const left = Date.now();
  const out = await b.waitFor(`!/^\\/battle\\//.test(location.pathname)`, 20000, 100);
  ok('left the battle page', out, await b.eval('location.pathname') as string);
  const sample = () => b.eval(`window.__theme ? { playing: !window.__theme.paused, volume: Math.round(window.__theme.volume * 1000) / 1000 } : null`) as Promise<{ playing: boolean; volume: number } | null>;
  await b.sleep(Math.max(0, 2000 - (Date.now() - left)));
  const at2 = await sample();
  ok('still silent 2 s after leaving', !at2 || !at2.playing, JSON.stringify(at2));
  await b.sleep(Math.max(0, 4500 - (Date.now() - left)));
  const at45 = await sample();
  ok('easing in at 4.5 s (between silent and full)', !!at45 && at45.playing && at45.volume > 0.02 && at45.volume < 0.38, JSON.stringify(at45));
  await b.sleep(Math.max(0, 7500 - (Date.now() - left)));
  const at75 = await sample();
  ok('back at full level by 7.5 s', !!at75 && at75.playing && at75.volume >= 0.39, JSON.stringify(at75));
  const logs = b.allLogs.filter((l) => /ArenaMusic|EntryAmbience|BattleEntry|LiveBattle\] (closing|result)|MusicToggle/.test(l));
  for (const l of logs) console.log('  music:', l.slice(0, 160));
  for (const c of checks) console.log(c);
  console.log(checks.some((c) => c.startsWith('FAIL')) ? '[theme] FAILED' : '[theme] all ok');
}
