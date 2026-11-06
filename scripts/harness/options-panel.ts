/**
 * Nzib's battle options panel (drop 5009ba1, wired 2026-11-06; replaces the stale volume-probe.ts). One Dojo battle:
 *   · the gear slides his panel in from the left; its controls are logged once it has landed;
 *   · Music / SFX icon toggles flip React's prefs (localStorage) and back — the harness keeps both muted;
 *   · the volume sliders set a level by a click on the track; React persists it and echoes it back to Unity;
 *   · the hints toggle flips ActionBar.HintsEnabled and its ON / OFF text;
 *   · FLEE asks first: STAY returns to the controls (nothing sent), the close arrow closes, the gear reopens;
 *   · FLEE → FLEE forfeits (the battle ends).
 * Screenshots: out/options-closed.png, -sliding.png, -open.png, -confirm.png (the owner's MacBook viewport).
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts options-panel.ts
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  const OUT = `${import.meta.dir}/out`;
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  const since = (n: number, re: RegExp) => b.logs.slice(n).some((l) => re.test(l));
  const waitLog = async (n: number, re: RegExp, ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { if (since(n, re)) return true; await b.sleep(120); } return false; };
  const store = (k: string) => b.eval(`localStorage.getItem(${JSON.stringify(k)})`) as Promise<string | null>;

  await b.goto(`${BASE}/dojo?team=sentinel,mantis,kraken&tier=elite&bot=balanced&stay=1`);
  ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), 'Dojo opened');
  await b.sleep(2500);
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  b.drainLogs();
  await b.clickAt(r.x, r.y);
  ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), 'battle opened');
  ok(await waitLog(0, /\[BattleStage\] intro complete/, 120000), 'intro done');
  ok(await waitLog(0, /\[BattleHud\] options gear=/, 30000), 'gear shown');
  await b.sleep(1500);

  const g = await b.eval(`(() => { const c = [...document.querySelectorAll('canvas')].sort((x, y) => y.width * y.height - x.width * x.height)[0]; const q = c.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, bw: c.width, bh: c.height }; })()`) as { x: number; y: number; w: number; h: number; bw: number; bh: number };
  const line = () => b.logs.filter((l) => /\[BattleHud\] options gear=/.test(l)).slice(-1)[0] ?? '';
  const rect = (key: string) => { const m = line().match(new RegExp(`${key}=\\((-?\\d+),(-?\\d+),(\\d+),(\\d+)\\)`)); return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null; };
  /** Click a logged control at a fraction across its rect (Unity screen px, y from the bottom). */
  const press = async (key: string, fx = 0.5) => {
    const q = rect(key);
    if (!q) return false;
    const ux = q.x + q.w * fx, uy = q.y + q.h / 2;
    await b.clickAt(g.x + ux * g.w / g.bw, g.y + (g.bh - uy) * g.h / g.bh);
    return true;
  };
  const shot = (name: string) => b.screenshot(`${OUT}/options-${name}.png`);

  await shot('closed');
  // Open: the panel slides in; the controls are logged once it has landed.
  let n = b.logs.length;
  ok(await press('gear'), 'gear pressed');
  await b.sleep(220);
  await shot('sliding');
  ok(await waitLog(n, /\[BattleHud\] options opened/, 2000), 'options opened');
  ok(await waitLog(n, /\[BattleHud\] options gear=.* music:(on|off)=.* musicSlider:\d+=.* sfxSlider:\d+=.* hints:(on|off)=.* forfeit=.* close=/, 3000), `controls logged after the slide (${line().slice(0, 160)})`);
  await b.sleep(300);
  await shot('open');

  // Music / SFX toggles (muted harness: both start off).
  const musicWas = /music:on=/.test(line()), sfxWas = /sfx:on=/.test(line());
  n = b.logs.length;
  await press(`music:${musicWas ? 'on' : 'off'}`);
  ok(await waitLog(n, new RegExp(`\\[BattleHud\\] music ${musicWas ? 'off' : 'on'}`), 2000), `music toggle → ${musicWas ? 'off' : 'on'}`);
  await b.sleep(400);
  ok(await store('clawbada_battle_music') === (musicWas ? 'off' : 'on'), `React saved battle music ${await store('clawbada_battle_music')}`);
  n = b.logs.length;
  await press(`music:${musicWas ? 'off' : 'on'}`);
  ok(await waitLog(n, new RegExp(`\\[BattleHud\\] music ${musicWas ? 'on' : 'off'}`), 2000), 'music toggle back');
  n = b.logs.length;
  await press(`sfx:${sfxWas ? 'on' : 'off'}`);
  ok(await waitLog(n, new RegExp(`\\[BattleHud\\] sfx ${sfxWas ? 'off' : 'on'}`), 2000), `SFX toggle → ${sfxWas ? 'off' : 'on'}`);
  n = b.logs.length;
  await press(`sfx:${sfxWas ? 'off' : 'on'}`);
  ok(await waitLog(n, new RegExp(`\\[BattleHud\\] sfx ${sfxWas ? 'on' : 'off'}`), 2000), 'SFX toggle back');

  // Sliders: a click on the track sets the level; React persists it and echoes it to Unity.
  n = b.logs.length;
  await press(`musicSlider:\\d+`, 0.3);
  ok(await waitLog(n, /\[BattleHud\] music volume \d+/, 2000), 'music slider moved');
  await b.sleep(500);
  const mv = Number((b.logs.slice(n).filter((l) => /music volume/.test(l)).pop() ?? '').match(/volume (\d+)/)?.[1]);
  ok(mv > 5 && mv < 60 && await store('clawbada_battle_music_vol') === String(mv), `music volume ${mv} saved (${await store('clawbada_battle_music_vol')})`);
  n = b.logs.length;
  await press(`sfxSlider:\\d+`, 0.8);
  ok(await waitLog(n, /\[BattleHud\] sfx volume \d+/, 2000), 'SFX slider moved');
  await b.sleep(500);
  const sv = Number((b.logs.slice(n).filter((l) => /sfx volume/.test(l)).pop() ?? '').match(/volume (\d+)/)?.[1]);
  ok(sv > 50 && await store('clawbada_sfx_vol') === String(sv), `SFX volume ${sv} saved (${await store('clawbada_sfx_vol')})`);
  ok(await waitLog(n, new RegExp(`SetAudioPrefs .*sfxVol=${sv}`), 2000), 'React echoed the volume back to Unity');

  // Hints.
  const hintsWas = /hints:on=/.test(line());
  n = b.logs.length;
  await press(`hints:${hintsWas ? 'on' : 'off'}`);
  ok(await waitLog(n, new RegExp(`\\[BattleHud\\] hints ${hintsWas ? 'off' : 'on'}`), 2000), `hints → ${hintsWas ? 'off' : 'on'}`);
  n = b.logs.length;
  await press(`hints:${hintsWas ? 'off' : 'on'}`);
  ok(await waitLog(n, new RegExp(`\\[BattleHud\\] hints ${hintsWas ? 'on' : 'off'}`), 2000), 'hints back');

  // FLEE asks; STAY returns; nothing is sent.
  n = b.logs.length;
  await press('forfeit');
  ok(await waitLog(n, /\[BattleHud\] options gear=.* yes=.* no=/, 2000), 'FLEE shows the confirmation (FLEE / STAY)');
  await b.sleep(300);
  await shot('confirm');
  n = b.logs.length;
  await press('no');
  ok(await waitLog(n, /\[BattleHud\] forfeit cancelled/, 2000) && !since(n, /\[BattleHud\] forfeit$/), 'STAY returns to the controls, nothing forfeited');
  ok(await waitLog(n, /\[BattleHud\] options gear=.* forfeit=.* close=/, 2000), 'controls back');
  // The close arrow closes; the gear reopens.
  n = b.logs.length;
  await press('close');
  ok(await waitLog(n, /\[BattleHud\] options closed/, 2000), 'close arrow closes it');
  await b.sleep(900);
  n = b.logs.length;
  await press('gear');
  ok(await waitLog(n, /\[BattleHud\] options gear=.* forfeit=/, 3000), 'gear reopens it');
  // FLEE → FLEE forfeits.
  n = b.logs.length;
  await press('forfeit');
  await waitLog(n, /yes=/, 2000);
  n = b.logs.length;
  await press('yes');
  ok(await waitLog(n, /\[BattleHud\] forfeit/, 2000), 'FLEE → FLEE forfeits');
  ok(await waitLog(n, /\[BattleHud\] banner/, 20000), 'the battle ends (result banner)');

  const errors = b.allLogs.filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk|UnityErrorGuard/.test(l));
  ok(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ').slice(0, 200)})`);
  await b.eval(`localStorage.removeItem('clawbada_battle_music_vol'); localStorage.removeItem('clawbada_sfx_vol')`);
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
