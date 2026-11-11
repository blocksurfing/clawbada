import type { Browser } from './cdp';

/** cdp.ts opts every probe in to the review tools; this probe is about the browser that has NOT. */
export const noReviewMode = true;

async function rectClick(b: Browser, selector: string) {
  const r = await b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector}`);
  await b.clickAt(r.x, r.y);
}

/**
 * The review tools (?auto ?autodelay ?speed ?stay ?perf) need a local opt-in (apps/web/src/lib/review-mode.ts): a
 * link alone must not make someone's battle play itself. As a guest, twice:
 *   1. not opted in  — the battle URL carries none of them and the player's turn is left to the player;
 *   2. opted in      — they are carried and the battle plays itself.
 * A development build is always in review mode, so there step 1 only reports that.
 */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? (BASE.includes('clawbada.com') ? 'https://api.clawbada.com' : 'http://127.0.0.1:3001');
  const DOJO = `${BASE}/dojo?team=mantis,sentinel,leviathan&tier=elite&purity=5&bot=charger&auto=1&speed=0.5&stay=1`;
  const autoplayed = () => b.allLogs.some((l) => /\[LiveBattle\] autoplay turn/.test(l));

  /** Open the Dojo with the review params on the link, press Battle as a guest, and return the battle URL. */
  const enter = async (): Promise<string | null> => {
    await b.goto(DOJO);
    if (!(await b.waitFor(`document.body.innerText.includes('Mantis · Sentinel · Leviathan, Elite, purity 5')`, 120000, 250))) return null;
    await b.sleep(1500);
    await rectClick(b, '[data-testid=dojo-battle]');
    if (!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 45000))) return null;
    return (await b.eval('location.href')) as string;
  };
  /** Resign the battle this page is on, as its guest, and forget the guest (the next battle is a fresh visitor's). */
  const leave = async () => {
    await b.eval(`(async () => { try { const s = JSON.parse(localStorage.getItem('clawbada.session.guest') || 'null'); const id = location.pathname.split('/').pop(); if (s && id) await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {} })()`);
    await b.sleep(500);
  };

  // ── 1. a browser that has not opted in ──
  await b.goto(`${BASE}/dojo`);
  await b.eval(`(() => { try { localStorage.removeItem('clawbada.review'); localStorage.removeItem('clawbada.session.guest'); } catch (e) {} })()`);
  const dev = !!(await b.eval(`!!document.querySelector('nextjs-portal')`));
  const first = await enter();
  expect(!!first, 'not opted in: a guest opens a practice battle from a link that carries ?auto=1&speed=0.5&stay=1');
  if (first) {
    if (dev) {
      console.log('note a development build is always in review mode — the opt-in is checked on a production build only');
    } else {
      expect(!/[?&](auto|speed|stay)=/.test(first), `not opted in: none of them reaches the battle — ${first.replace(BASE, '')}`);
      const mine = await b.waitFor(`['Your turn', '· you', '(you)'].some(s => document.body.innerText.includes(s))`, 120000, 500);
      expect(!!mine, 'not opted in: the battle is live and it is the player\'s turn');
      await b.sleep(8000);   // autoplay acts 350 ms after a turn becomes playable
      expect(!autoplayed(), 'not opted in: the player\'s turn is left to the player (no autoplay)');
    }
    await leave();
  }

  // ── 2. the same browser, opted in ──
  await b.goto(`${BASE}/dojo`);
  await b.eval(`(() => { try { localStorage.setItem('clawbada.review', '1'); localStorage.removeItem('clawbada.session.guest'); } catch (e) {} })()`);
  b.drainLogs();
  const second = await enter();
  expect(!!second && /[?&]auto=1/.test(second) && /[?&]speed=0\.5/.test(second) && /[?&]stay=1/.test(second), `opted in: the review params are carried to the battle — ${(second ?? '').replace(BASE, '')}`);
  if (second) {
    let played = false;
    for (let i = 0; i < 300 && !played; i++) { played = autoplayed(); if (!played) await b.sleep(500); }
    expect(played, 'opted in: the battle plays itself');
    await leave();
  }
  await b.eval(`(() => { try { localStorage.removeItem('clawbada.review'); } catch (e) {} })()`);
  console.log(fails.length ? `[review-optin] ${fails.length} FAIL` : '[review-optin] all ok');
}
