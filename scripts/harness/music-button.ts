import type { Browser } from './cdp';

/**
 * The site music buttons (2026-11-11): one press does what the button shows. A press used to reverse the STORED
 * preference, which reads as "on" in a browser that never stored one and stays "on" when the browser refuses to
 * autoplay — so the first press switched the music "off" in silence and only the second one started it.
 *   1. a stored "on" the browser would not autoplay: the sidebar button shows off, one press starts the theme;
 *   2. a new browser on the landing page: the floating button shows off, one press starts it, the next stops it;
 *   3. a new browser in the Dojo: the sidebar button shows off, one press starts it;
 *   4. switched off inside a battle, the theme does not come back after it;
 *   5. switched on inside a battle, nothing plays there and the theme comes in after it.
 * Every media element is muted at the source, so nothing reaches the speakers. `NO_BATTLE=1` runs 1–3 only (no API).
 *   BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts music-button.ts
 */
export const keepAudio = true;   // the site music preference is the subject; battle music and SFX are switched off below
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const API = process.env.API ?? 'http://127.0.0.1:3011';
const TEAM = 'kraken,ember,abyss';

type Shown = { fab: string | null; sidebar: string | null };

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);

  // Before every page's own scripts, for the whole run: battle music and SFX off, and every <audio> muted before it
  // can play. A muted <audio> is still refused without a gesture, like an audible one, so the browser's autoplay rule
  // is the real one.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.setItem('clawbada_battle_music', 'off'); localStorage.setItem('clawbada_sfx', 'off'); } catch (e) {}
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.muted = true; if (/\\/audio\\/theme/.test(this.src)) window.__theme = this; return play.call(this); };
  ` });
  // And, per step, the stored site-music choice a page load starts from (null = a browser that never stored one).
  let installed: string | null = null;
  const keepStored = async () => { if (installed) await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: installed }); installed = null; };
  const stored = async (music: 'on' | null) => {
    await keepStored();
    installed = (await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { ${music === null ? `localStorage.removeItem('clawbada_music')` : `localStorage.setItem('clawbada_music', '${music}')`}; } catch (e) {}` })).identifier;
  };

  /** Every page this probe loads must carry the mute: stop before anything can sound if one does not. */
  const open = async (path: string) => {
    await b.goto(`${BASE}${path}`);
    if (!(await b.eval(`/this\\.muted = true/.test(String(HTMLMediaElement.prototype.play))`))) throw new Error(`${path} loaded without the mute — stopping`);
  };

  const playing = `!!window.__theme && !window.__theme.paused`;
  const pref = () => b.eval(`localStorage.getItem('clawbada_music')`) as Promise<string | null>;
  const shown = () => b.eval(`(() => {
    const vis = (el) => !!el && el.getBoundingClientRect().width > 0;
    const fab = document.querySelector('.site-music-fab'), side = document.querySelector('button.music-toggle');
    return { fab: vis(fab) ? (fab.title === 'Pause music' ? 'on' : 'off') : null, sidebar: vis(side) ? (side.getAttribute('aria-pressed') === 'true' ? 'on' : 'off') : null };
  })()`) as Promise<Shown>;
  const press = async (selector: string) => {
    const r = await b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const q = el.getBoundingClientRect(); return q.width ? { x: q.left + q.width / 2, y: q.top + q.height / 2 } : null; })()`) as { x: number; y: number } | null;
    if (!r) throw new Error(`no visible ${selector}`);
    await b.clickAt(r.x, r.y);
    await b.sleep(700);
  };
  const SIDEBAR = 'button.music-toggle', FAB = '.site-music-fab';
  const state = async () => `theme ${await b.eval(playing) ? 'playing' : 'silent'}, buttons ${JSON.stringify(await shown())}, stored ${JSON.stringify(await pref())}`;

  // ── 1. a stored "on" the browser would not autoplay (first, in a tab that has never been clicked) ──────────────
  await stored('on');
  await open(`/dojo?team=${TEAM}`);
  ok('Dojo loaded (sidebar music button present)', await b.waitFor(`(() => { const el = document.querySelector('${SIDEBAR}'); return !!el && !el.disabled && el.getBoundingClientRect().width > 0; })()`, 120000, 250));
  await b.sleep(1500);
  ok('1. stored "on": the browser refused to autoplay, and the button shows off', !(await b.eval(playing)) && (await shown()).sidebar === 'off', await state());
  await press(SIDEBAR);
  ok('1. one press starts the theme and the button shows on', await b.eval(playing) === true && (await shown()).sidebar === 'on' && (await pref()) === 'on', await state());

  // ── 2. a new browser on the landing page ────────────────────────────────────────────────────────────────────────
  await stored(null);
  await open('/');
  ok('landing page loaded (floating music button present)', await b.waitFor(`(() => { const el = document.querySelector('${FAB}'); return !!el && el.getBoundingClientRect().width > 0; })()`, 120000, 250));
  await b.sleep(1500);
  ok('2. new browser: nothing stored, nothing playing, the button shows off', (await pref()) === null && !(await b.eval(playing)) && (await shown()).fab === 'off', await state());
  await press(FAB);
  ok('2. one press starts the theme and the button shows on', await b.eval(playing) === true && (await shown()).fab === 'on' && (await pref()) === 'on', await state());
  await press(FAB);
  ok('2. the next press stops it and the button shows off', !(await b.eval(playing)) && (await shown()).fab === 'off' && (await pref()) === 'off', await state());
  await press(FAB);
  ok('2. and one more starts it again', await b.eval(playing) === true && (await shown()).fab === 'on', await state());

  // ── 3. a new browser in the Dojo ────────────────────────────────────────────────────────────────────────────────
  await open(`/dojo?team=${TEAM}`);
  await b.waitFor(`(() => { const el = document.querySelector('${SIDEBAR}'); return !!el && !el.disabled && el.getBoundingClientRect().width > 0; })()`, 120000, 250);
  await b.sleep(1500);
  ok('3. new browser in the Dojo: nothing playing, the sidebar button shows off', (await pref()) === null && !(await b.eval(playing)) && (await shown()).sidebar === 'off', await state());
  await press(SIDEBAR);
  ok('3. one press starts the theme and the button shows on', await b.eval(playing) === true && (await shown()).sidebar === 'on' && (await pref()) === 'on', await state());

  if (process.env.NO_BATTLE) { for (const c of checks) console.log(c); console.log(checks.some((c) => c.startsWith('FAIL')) ? '[music-button] FAILED' : '[music-button] all ok (battle steps skipped)'); return; }

  // ── 4 and 5: inside a battle ────────────────────────────────────────────────────────────────────────────────────
  await keepStored();   // from here on a page load keeps what the page itself stored
  const battles: string[] = [];
  /** Train → the battle on screen → EXIT (out of fullscreen, still in the battle view, the sidebar reachable). */
  const enterBattle = async (n: number) => {
    const ready = await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]:not(:disabled)')`, 90000, 250);
    if (ready) await press('[data-testid=dojo-battle]');
    const inBattle = ready && await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 90000);
    const live = inBattle && await b.waitFor(`!document.querySelector('[data-testid=battle-entry]') && /Your turn|Bot thinking|Opponent/.test(document.querySelector('[data-testid=battle-status-line]')?.textContent || '')`, 120000, 500);
    ok(`${n}. battle on screen`, !!live, await b.eval('location.pathname') as string);
    if (!live) return false;
    battles.push(String(await b.eval(`location.pathname.split('/').pop()`)));
    await b.sleep(2000);
    const exit = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button, a')).find((e) => (e.textContent || '').trim().toLowerCase().includes('exit')); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
    if (exit) { await b.clickAt(exit.x, exit.y); await b.sleep(1500); }
    return true;
  };
  /** The sidebar's Dojo link, as a player leaves (client-side: the theme element and its state survive). */
  const leaveBattle = async () => {
    const dojo = await b.eval(`(() => { const a = document.querySelector('a[data-menu="dojo"]'); if (!a) return null; const q = a.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
    if (dojo) await b.clickAt(dojo.x, dojo.y);
    return !!dojo && await b.waitFor(`!/^\\/battle\\//.test(location.pathname)`, 20000, 100);
  };

  /** The practice battle was left running: resign it with the session the page holds (a second one would not start). */
  const resign = async () => {
    const id = battles.pop();
    if (!id) return;
    const status = await b.eval(`(async () => {
      let last = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('clawbada.session.')) continue;
        let token; try { token = JSON.parse(localStorage.getItem(key)).token; } catch (e) { continue; }
        if (!token) continue;
        const r = await fetch(${JSON.stringify(`${API}/api/game/combat/${encodeURIComponent(id)}/forfeit`)}, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
        last = r.status; if (r.ok) return 200;
      }
      return last;
    })()`);
    console.log(`[music-button] battle ${id} ${status === 200 ? 'forfeited' : status === 409 ? 'was already over' : `could not be forfeited (${status})`}`);
  };

  // 4. The theme is playing (step 3). The battle silences it, the button still shows on; switched off there, it stays off.
  if (await enterBattle(4)) {
    ok('4. the battle silences the theme, and the button still shows on (it is due back)', !(await b.eval(playing)) && (await shown()).sidebar === 'on', await state());
    await press(SIDEBAR);
    ok('4. switched off inside the battle: the button shows off', !(await b.eval(playing)) && (await shown()).sidebar === 'off' && (await pref()) === 'off', await state());
    ok('4. left the battle', await leaveBattle(), await b.eval('location.pathname') as string);
    await b.sleep(8000);   // past the 3 s wait and the 3 s ease-in a returning theme takes
    ok('4. the theme does not come back, and the button shows off', !(await b.eval(playing)) && (await shown()).sidebar === 'off', await state());
  }
  await resign();

  // 5. The theme is off. Switched on inside the battle, nothing plays there; it comes in once the battle is left.
  await open(`/dojo?team=${TEAM}`);
  if (await enterBattle(5)) {
    ok('5. the theme is off going in, and the button shows off', !(await b.eval(playing)) && (await shown()).sidebar === 'off', await state());
    await press(SIDEBAR);
    ok('5. switched on inside the battle: the button shows on, and nothing plays there', !(await b.eval(playing)) && (await shown()).sidebar === 'on' && (await pref()) === 'on', await state());
    ok('5. left the battle', await leaveBattle(), await b.eval('location.pathname') as string);
    ok('5. the theme comes in after the battle', await b.waitFor(playing, 12000, 200), await state());
    await b.sleep(3500);
    const level = await b.eval(`window.__theme ? Math.round(window.__theme.volume * 100) / 100 : null`);
    ok('5. at its usual level, and the button shows on', level === 0.4 && (await shown()).sidebar === 'on', `volume ${level}, ${await state()}`);
  }

  await resign();
  for (const l of b.allLogs.filter((l) => /\[ArenaMusic\]/.test(l))) console.log('  music:', l.slice(0, 160));
  for (const c of checks) console.log(c);
  console.log(checks.some((c) => c.startsWith('FAIL')) ? '[music-button] FAILED' : '[music-button] all ok');
}
