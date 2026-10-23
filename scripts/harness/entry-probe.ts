import type { Browser } from './cdp';

/**
 * The battle entry sequence (PR feat/battle-entry-web): a guest presses Train on the Dojo and must see Nzib's
 * loading loop at once, the page in fullscreen, the loop held for at least 4.5 s, then the arena intro.
 *   bun cdp.ts entry-probe.ts                      # local stack (web :3000)
 *   BASE=https://clawbada-web.vercel.app bun cdp.ts entry-probe.ts
 */
const OUT = process.env.OUT ?? `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rectClick(b: Browser, selector: string, text: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e => (e.textContent || '').trim() === ${JSON.stringify(text)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no ${selector} ${text}`);
  await b.clickAt(r.x, r.y);
}
const overlay = (b: Browser) => b.eval(`(() => { const o = document.querySelector('[data-testid=battle-entry]'); return o ? { phase: o.dataset.phase, kind: o.dataset.kind, frame: o.querySelector('canvas')?.dataset.frame ?? null, opacity: getComputedStyle(o).opacity } : null; })()`) as Promise<{ phase: string; kind: string; frame: string | null; opacity: string } | null>;

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => { checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

  // A non-default team, so the summary line proves the page hydrated before the click.
  await b.goto(`${BASE}/dojo?team=bulwark,leviathan,sentinel&tier=evolved&purity=2&bot=charger`);
  await b.waitFor(`document.body.innerText.includes('Bulwark · Leviathan · Sentinel, Evolved, purity 2')`, 60000, 250);
  await b.sleep(1500);
  ok('no overlay before the press', (await overlay(b)) === null);

  const t0 = Date.now();
  await rectClick(b, 'button', 'Train');
  const appeared = await b.waitFor(`!!document.querySelector('[data-testid=battle-entry][data-phase=web]')`, 3000, 50);
  const tAppear = Date.now() - t0;
  ok('overlay appears on the press', appeared, `${tAppear} ms`);
  ok('page is fullscreen', await b.eval(`document.fullscreenElement === document.documentElement`) as boolean);
  await b.sleep(1200);
  const mid = await overlay(b);
  ok('loop is animating (frame advances)', !!mid && mid.frame !== null && mid.frame !== '0', `frame ${mid?.frame}`);
  await b.screenshot(`${OUT}/entry-loading.png`);

  const navigated = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  ok('navigated to the battle page under the overlay', navigated);
  if (!navigated) {
    // The start failed: the Dojo shows the error in its summary line and the sequence drops the overlay.
    console.log('dojo says:', await b.eval(`document.querySelector('[data-testid=dojo-gate]')?.textContent ?? Array.from(document.querySelectorAll('span')).map(s => s.textContent).find(t => /Could not|expired|failed|error/i.test(t || '')) ?? '(no error text)'`));
    for (const l of b.allLogs.slice(-8)) console.log('console:', l.slice(0, 200));
  }
  // The overlay must still be up at 4.0 s after the press (the hold is 4.5 s) …
  const until4 = 4000 - (Date.now() - t0);
  if (until4 > 0) await b.sleep(until4);
  const at4 = await overlay(b);
  ok('still covering at 4.0 s', !!at4 && at4.phase === 'web', `phase ${at4?.phase}`);
  // … and gone once the hold has passed AND the arena was built (InitBattle), 400 ms fade included.
  const gone = await b.waitFor(`!document.querySelector('[data-testid=battle-entry]')`, 60000, 100);
  const tGone = Date.now() - t0;
  ok('overlay released after the hold + arena ready', gone, `${tGone} ms after the press`);
  ok('released no earlier than the 4.5 s hold', tGone >= 4500, `${tGone} ms`);

  // The Unity half (a player build with LoadingScreenController): the training scene reported itself, the web
  // loop handed over the tip, Unity held it ≥ 4.5 s from that moment, then released into the intro.
  const unityShown = b.allLogs.some((l) => /\[LoadingScreen\] training scene shown/.test(l));
  ok('unity training scene shown (player build with the loading scene)', unityShown);
  if (unityShown) {
    const tipAt = Date.now();
    const tipSet = await (async () => { while (Date.now() - tipAt < 15000) { if (b.allLogs.some((l) => /\[LoadingScreen\] tip set/.test(l))) return true; await b.sleep(200); } return false; })();
    ok('tip handed to Unity after the web loop lifted', tipSet);
    await b.sleep(1200);
    await b.screenshot(`${OUT}/entry-training.png`);
    const releasedAt = Date.now();
    const released = await (async () => { while (Date.now() - releasedAt < 30000) { const l = b.allLogs.find((x) => /\[LoadingScreen\] released after/.test(x)); if (l) return l; await b.sleep(200); } return null; })();
    const held = released ? Number((released.match(/after ([0-9.]+) s/) || [])[1]) : NaN;
    ok('unity released the training scene', !!released, released ? `${held} s on screen` : 'no release log');
    ok('unity held the training scene ≥ 4.5 s', Number.isFinite(held) && held >= 4.5, `${held} s`);
  }

  const live = await b.waitFor(`(() => { const s = document.querySelector('[data-testid=battle-status-line]'); return !!s && /Your turn|Bot thinking|Opponent/.test(s.textContent || ''); })()`, 180000, 500);
  ok('unity status line live', live);
  const t1 = Date.now();
  let introDone = false;
  while (Date.now() - t1 < 60000) { if (b.allLogs.some((l) => /intro\w* ?(complete|done|finished)|IntroComplete/i.test(l))) { introDone = true; break; } await b.sleep(500); }
  ok('intro completed', introDone);
  await b.sleep(introDone ? 2000 : 0);
  await b.screenshot(`${OUT}/entry-arena.png`);

  for (const c of checks) console.log(c);
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails === 0 ? '[entry] all ok' : `[entry] ${fails} FAIL`);
}
