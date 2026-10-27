import type { Browser } from './cdp';

/**
 * The sidebar's and the wallet wheel's open / close sounds (lib/site-sfx.ts, owner 2026-10-26). Every media element is MUTED AT THE SOURCE
 * (nothing reaches the speakers); each play() is recorded with its file and volume.
 *   · nothing plays on page load (the opening roll is not a press);
 *   · a press on the pole plays Open when expanding, Close when collapsing, at 0.5 × the SFX volume;
 *   · a second press while the banner is still rolling plays nothing (no stacking);
 *   · the SFX switch off silences it; the SFX volume scales it;
 *   · the files are served with the year-long immutable cache header.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts sidebar-sfx-probe.ts
 */
/** The harness turns site sound off unless a probe opts in; every element here is muted at the source instead. */
export const keepAudio = true;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    try { localStorage.setItem('clawbada_sfx', 'on'); localStorage.removeItem('clawbada_sfx_vol'); } catch (e) {}
    window.__plays = [];
    const p = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { this.muted = true; window.__plays.push({ file: (this.currentSrc || this.src).split('/').pop(), volume: this.volume, t: performance.now() }); return p.call(this); };
  }` });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  await b.goto(`${BASE}/dojo`);
  await b.waitFor(`!!document.querySelector('#toggle') && !document.querySelector('#toggle').disabled`, 90000, 250);
  await b.sleep(1500);
  const sfxPlays = () => b.eval(`window.__plays.filter(p => p.file.startsWith('SFX_UI_Sidebar'))`) as Promise<{ file: string; volume: number }[]>;
  ok('no sidebar sound on page load', (await sfxPlays()).length === 0, JSON.stringify(await sfxPlays()));
  const toggle = await b.eval(`(() => { const q = document.querySelector('#toggle').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  const idle = () => b.waitFor(`!document.querySelector('#toggle').disabled`, 10000, 50);
  const press = async () => { await b.clickAt(toggle.x, toggle.y); };

  await press(); await b.sleep(100);
  let plays = await sfxPlays();
  ok('expanding plays the open sound at 0.5 × SFX volume', plays.length === 1 && plays[0].file.startsWith('SFX_UI_Sidebar_Open.') && Math.abs(plays[0].volume - 0.5) < 0.01, JSON.stringify(plays));
  await press(); await b.sleep(100);   // still rolling: ignored
  ok('a press while the banner is rolling plays nothing', (await sfxPlays()).length === 1, JSON.stringify(await sfxPlays()));
  await idle(); await b.sleep(200);
  await press(); await b.sleep(100);
  plays = await sfxPlays();
  ok('collapsing plays the close sound', plays.length === 2 && plays[1].file.startsWith('SFX_UI_Sidebar_Close.'), JSON.stringify(plays));
  await idle(); await b.sleep(200);

  await b.eval(`localStorage.setItem('clawbada_sfx', 'off')`);
  await press(); await b.sleep(100);
  ok('the SFX switch off silences it', (await sfxPlays()).length === 2, JSON.stringify(await sfxPlays()));
  await idle(); await b.sleep(200);
  await b.eval(`localStorage.setItem('clawbada_sfx', 'on'); localStorage.setItem('clawbada_sfx_vol', '30')`);
  await press(); await b.sleep(100);
  plays = await sfxPlays();
  ok('the SFX volume scales it (30 % → 0.15)', plays.length === 3 && Math.abs(plays[2].volume - 0.15) < 0.01, JSON.stringify(plays));
  await idle();
  await b.eval(`localStorage.removeItem('clawbada_sfx_vol')`);

  const headers = await b.eval(`Promise.all(Array.from(new Set(window.__plays.map(p => p.file))).filter(f => f.startsWith('SFX_UI_')).map(f => fetch('/audio/sfx/' + f).then(r => ({ f, status: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type') }))))`) as { f: string; status: number; cache: string | null; type: string | null }[];
  ok('the sidebar files are served, cached as immutable', headers.length === 2 && headers.every((h) => h.status === 200 && (h.cache ?? '').includes('immutable')), JSON.stringify(headers));

  // ── the wallet wheel (top right): it slides open by itself on load — silently — then each press closes / opens ──
  await b.goto(`${BASE}/game`);
  await b.waitFor(`document.querySelector('.user-avatar-slot')?.getAttribute('aria-expanded') === 'true' && !document.querySelector('.user-avatar-slot').disabled`, 90000, 250);
  await b.sleep(800);
  const wheelPlays = () => b.eval(`window.__plays.filter(p => p.file.startsWith('SFX_UI_Wheel'))`) as Promise<{ file: string; volume: number }[]>;
  ok('wheel: no sound for the opening slide on load', (await wheelPlays()).length === 0, JSON.stringify(await wheelPlays()));
  const wheel = await b.eval(`(() => { const q = document.querySelector('.user-avatar-slot').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  const wheelIdle = () => b.waitFor(`!document.querySelector('.user-avatar-slot').disabled`, 10000, 50);
  await b.clickAt(wheel.x, wheel.y); await b.sleep(80);
  await b.clickAt(wheel.x, wheel.y); await b.sleep(80);   // mid-slide: ignored
  let wp = await wheelPlays();
  ok('wheel: a press closes the plank with the close sound; a press mid-slide plays nothing', wp.length === 1 && wp[0].file.startsWith('SFX_UI_Wheel_Close.') && Math.abs(wp[0].volume - 0.5) < 0.01, JSON.stringify(wp));
  await wheelIdle(); await b.sleep(200);
  await b.clickAt(wheel.x, wheel.y); await b.sleep(80);
  wp = await wheelPlays();
  ok('wheel: the next press opens it with the open sound', wp.length === 2 && wp[1].file.startsWith('SFX_UI_Wheel_Open.'), JSON.stringify(wp));
  await wheelIdle(); await b.sleep(200);
  await b.eval(`localStorage.setItem('clawbada_sfx', 'off')`);
  await b.clickAt(wheel.x, wheel.y); await b.sleep(80);
  ok('wheel: the SFX switch off silences it', (await wheelPlays()).length === 2, JSON.stringify(await wheelPlays()));
  await wheelIdle();
  await b.eval(`localStorage.setItem('clawbada_sfx', 'on')`);

  await b.goto('about:blank');
  console.log(checks.join('\n'));
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails ? `[sidebar-sfx] ${fails} FAIL of ${checks.length}` : `[sidebar-sfx] all ${checks.length} ok`);
}
