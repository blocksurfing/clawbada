import type { Browser } from './cdp';

/**
 * Battle Friends end to end (owner 2026-10-28: "a sharable game without a wallet connection required"): two INDEPENDENT
 * browsers — the host on the usual :9222, the friend on a fresh Chrome this probe starts on :9223 with its own empty
 * profile, so the friend really has never seen the site.
 *   host: Dojo › Fight with friend › Create invite link  →  friend: opens the link  →  the same lobby, no prompt
 *   → hidden teams → both press Battle → both in /battle/f_… taking turns → forfeit → both back in the Dojo.
 * Then a broken link gets the friendly message. Both browsers muted at the source; the second Chrome is killed after.
 *   BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts friend-battle.ts
 */
export const keepAudio = true;   // muted at the source below, on both browsers

const MUTE = `{ const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { this.muted = true; return p.call(this); }; }
try { localStorage.setItem('clawbada_music', 'off'); localStorage.setItem('clawbada_battle_music', 'off'); localStorage.setItem('clawbada_sfx', 'off'); } catch (e) {}`;
/** Any wallet / connect / signature dialog on screen (ConnectKit's modal or anything like it). The chrome's own
 *  "Connect Wallet" plank is not a dialog and does not count. */
const WALLET_DIALOG = `(() => [...document.querySelectorAll('[role=dialog], [aria-modal=true]')].some((d) => d.offsetParent !== null && /wallet|connect|sign/i.test(d.textContent || '')))()`;

export default async function (host: Browser, h: { connect(host: string): Promise<Browser> }) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3001';
  const OUT = `${import.meta.dir}/out`;
  const fails: string[] = [];
  const ok = (pass: boolean, what: string, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!pass) fails.push(what); };
  const click = async (b: Browser, sel: string) => {
    const r = await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
    if (!r) throw new Error(`no ${sel}`);
    await b.clickAt(r.x, r.y);
  };

  // The friend's browser: a fresh Chrome, empty profile.
  const profile = `${OUT}/chrome-profile-friend`;
  Bun.spawnSync(['pkill', '-f', 'remote-debugging-port=9223']);
  Bun.spawnSync(['rm', '-rf', profile]);
  Bun.spawn(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--remote-debugging-port=9223', '--window-size=1600,1000',
    `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });
  for (let i = 0; i < 40; i++) { if ((await fetch('http://127.0.0.1:9223/json/version').catch(() => null))?.ok) break; await Bun.sleep(500); }
  const friend = await h.connect('127.0.0.1:9223');
  try {
    for (const b of [host, friend]) {
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: MUTE });
      await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 1, mobile: false });
    }

    // ── host opens a lobby ──
    await host.goto(`${BASE}/dojo?team=kraken,ember,abyss&tier=elite&purity=3&auto=1`);
    ok(!!(await host.waitFor(`document.body.innerText.includes('Kraken · Ember · Abyss, Elite, purity 3')`, 90000, 250)), 'host: Dojo hydrated with the team');
    await click(host, '[data-testid=dojo-friend-tab]');
    await click(host, '[data-testid=friend-create]');
    ok(!!(await host.waitFor(`(document.querySelector('[data-testid=friend-link]')?.value || '').includes('/battle-friends/join#r_')`, 20000)), 'host: an invite link appears');
    const link = await host.eval(`document.querySelector('[data-testid=friend-link]').value`) as string;
    ok(!!(await host.eval(`!!localStorage.getItem('clawbada.session.guest')`)), 'host: played as a guest — no wallet needed to make a link');
    ok(!(await host.eval(WALLET_DIALOG)), 'host: no wallet prompt');
    await host.screenshot(`${OUT}/friend-host-link.png`);

    // ── the friend opens it in a browser that has never been here ──
    ok(!(await friend.eval(`(() => { try { return !!localStorage.getItem('clawbada.session.guest'); } catch { return false; } })()`)), 'friend: a brand-new browser (no session)');
    const u = new URL(link);
    await friend.goto(`${BASE}${u.pathname}?auto=1${u.hash}`);
    const landed = await friend.waitFor(`location.pathname === '/dojo' && document.querySelector('[data-testid=friend-lobby]')?.getAttribute('data-state') === 'seated'`, 60000, 250);
    ok(!!landed, 'friend: lands straight in the Dojo lobby');
    ok(!(await friend.eval(`location.href.includes('#')`)), 'friend: the invite secret is gone from the address bar');
    ok(!!(await friend.eval(`!!localStorage.getItem('clawbada.session.guest')`)), 'friend: a guest session was minted silently');
    ok(!(await friend.eval(WALLET_DIALOG)), 'friend: no wallet prompt, no signature, no sign-up');
    ok(!!(await host.waitFor(`document.querySelector('[data-testid=friend-status]')?.getAttribute('data-opponent') === 'picking'`, 15000)), 'host: sees the friend arrive');

    // ── teams: the friend picks with the tiles; the host's is the deep-linked one ──
    for (const c of ['bulwark', 'mantis', 'sentinel']) await click(friend, `#dojo-builder [data-owned-id="${c}"]`);
    ok(!!(await friend.waitFor(`document.body.innerText.includes('Bulwark · Mantis · Sentinel')`, 5000)), 'friend: picked a team');
    await click(host, '[data-testid=dojo-battle]');
    ok(!!(await host.waitFor(`document.querySelector('[data-testid=friend-status]')?.getAttribute('data-you') === 'ready'`, 15000)), 'host: locked in, waiting for the friend');
    ok(!!(await friend.waitFor(`['locked', 'ready'].includes(document.querySelector('[data-testid=friend-lobby] [data-testid=friend-status]')?.getAttribute('data-opponent'))`, 10000)), 'friend: sees the host locked in');
    const shown = await friend.eval(`[...document.querySelectorAll('[data-testid=dojo-friend-lineup] canvas')].map((c) => c.getAttribute('data-class'))`) as (string | null)[];
    ok(!shown.includes('ember') && !shown.includes('abyss'), 'friend: the host\'s team stays hidden (silhouettes only)', JSON.stringify(shown));
    await friend.screenshot(`${OUT}/friend-lobby.png`);

    // ── the friend presses Battle: both go in ──
    await click(friend, '[data-testid=dojo-battle]');
    const inF = await friend.waitFor(`/^\\/battle\\/f_/.test(location.pathname)`, 60000, 250);
    const inH = await host.waitFor(`/^\\/battle\\/f_/.test(location.pathname)`, 60000, 250);
    ok(!!inF && !!inH, 'both players enter the friend battle');
    const idF = await friend.eval(`location.pathname.split('/').pop()`), idH = await host.eval(`location.pathname.split('/').pop()`);
    ok(idF === idH, 'the same battle on both sides', String(idF));
    const turns = (b: Browser) => b.allLogs.filter((l) => /\[LiveBattle\] autoplay turn/.test(l)).length;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000 && (turns(host) < 2 || turns(friend) < 2)) await Bun.sleep(1000);
    ok(turns(host) >= 2 && turns(friend) >= 2, 'both players take turns', `host ${turns(host)}, friend ${turns(friend)}`);
    ok(!(await friend.eval(WALLET_DIALOG)) && !(await host.eval(WALLET_DIALOG)), 'no wallet prompt in the battle');
    await friend.screenshot(`${OUT}/friend-battle.png`);

    // ── resign (the host), then both are back in the Dojo after the 8 s result ──
    const token = await host.eval(`JSON.parse(localStorage.getItem('clawbada.session.guest')).token`) as string;
    const ff = await fetch(`${API}/api/game/combat/${idH}/forfeit`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    ok(ff.status === 200, 'host resigns', String(ff.status));
    const backF = await friend.waitFor(`location.pathname === '/dojo'`, 40000, 250);
    const backH = await host.waitFor(`location.pathname === '/dojo'`, 40000, 250);
    ok(!!backF && !!backH, 'both return to the Dojo after the result');
    ok(!!(await host.waitFor(`document.querySelector('[data-testid=friend-lobby]')?.getAttribute('data-state') === 'none' || document.querySelector('[data-testid=dojo-bot-tab]')?.getAttribute('aria-selected') === 'true'`, 10000)), 'the host can start again (no stale lobby)');

    // ── a broken link ──
    await friend.goto(`${BASE}/battle-friends/join#r_00000000-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAA`);
    ok(!!(await friend.waitFor(`/expired|already used/i.test(document.querySelector('[data-testid=friend-join-error]')?.textContent || '')`, 30000)), 'a dead link gets the friendly message');
  } finally {
    await friend.goto('about:blank').catch(() => {});
    Bun.spawnSync(['pkill', '-f', 'remote-debugging-port=9223']);
  }
  console.log(fails.length ? `[friend] ${fails.length} FAIL` : '[friend] all ok');
}
