import type { Browser } from './cdp';

/**
 * Nzib's Victory / Defeat screens (drop 93e213e) with the player's team under the banner. A guest presses Battle on the
 * Dojo with autoplay on (?auto=1&speed=N), the battle plays itself out, and the probe photographs the result screen a
 * few times over ~4 s (Victory: Attack → Jump/hop looping; Defeat: Die held, skulls once Nzib's sprite is bound), then
 * checks the web's 6 s auto-return still brings the page back to the Dojo. The opponent mirrors the team, so the outcome is
 * a coin flip: run it until both screens have been seen.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts result-probe.ts
 *   TEAM=mantis,ember,abyss TIER=apex SPEED=4 bun cdp.ts result-probe.ts
 */
const OUT = process.env.OUT ?? `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const TEAM = process.env.TEAM ?? 'mantis,leviathan,sentinel';
const TIER = process.env.TIER ?? 'elite';
const SPEED = process.env.SPEED ?? '4';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e => ${text === undefined ? 'true' : `(e.textContent || '').trim() === ${JSON.stringify(text)}`}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.allLogs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => { checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
  const done = () => { for (const c of checks) console.log(c); console.log(checks.some((c) => c.startsWith('FAIL')) ? '[result] FAILED' : '[result] all ok'); };

  await b.send('Network.clearBrowserCache', {});
  await b.goto(`${BASE}/dojo?team=${TEAM}&tier=${TIER}&bot=charger&auto=1&speed=${SPEED}`);
  await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]:not(:disabled)')`, 90000, 250);
  await b.sleep(2500);
  await rectClick(b, '[data-testid=dojo-battle]');
  const navigated = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 90000);
  ok('battle page opened', navigated);
  if (!navigated) return done();
  let bound = false;
  for (const t = Date.now(); Date.now() - t < 180000 && !bound; ) {
    bound = grab(b, /\[BattleHud\] bind/).length > 0;
    if (!bound) await b.sleep(500);
  }
  ok('Unity bound the battle', bound);
  if (!bound) return done();

  // Autoplay to the end.
  let raised: string | undefined;
  const t0 = Date.now();
  let deathShot = false;
  while (Date.now() - t0 < 480000 && !raised) {
    raised = grab(b, /\[ResultScreen\] (Victory|Defeat)Screen/)[0];
    // The first death on the board: the darkened body with Nzib's ghost risen over it (spawn ~0.5 s, then idle).
    if (!deathShot && grab(b, /\[LobsterController\] death /).length > 0) { deathShot = true; await b.sleep(2000); await b.screenshot(`${OUT}/result-first-death.png`); }
    if (!raised) await b.sleep(250);
  }
  ok('result screen raised', !!raised, raised ?? 'none within 8 min');
  if (!raised) return done();
  const won = /VictoryScreen/.test(raised);
  const tag = won ? 'victory' : 'defeat';
  ok(`${won ? 'Victory' : 'Defeat'} screen carries the player's 3 lobsters`, /with 3 lobster\(s\)/.test(raised), raised);
  const banner = grab(b, /\[BattleHud\] banner (VICTORY|DEFEAT)/)[0];
  ok('the banner log line still marks the end (probes key on it)', !!banner && /VICTORY/.test(banner) === won, banner ?? 'missing');
  const countdown = (await b.eval(`(document.body.innerText.match(/(back to the arena[^\\n]*|leaving the arena[^\\n]*)/i) || [''])[0]`)) as string;
  ok('web return row shown over the result', countdown !== '', countdown.trim() || 'not found');
  // The screen raises 0.6 s after the end log; then five frames ~0.9 s apart (the victory loop is ~2 s long).
  for (let i = 0; i < 5; i++) {
    await b.sleep(i === 0 ? 300 : 900);
    await b.screenshot(`${OUT}/result-${tag}-${i}.png`);
    // A burst after the first frame catches the hop / Jump between the 0.9 s frames.
    if (i === 1 && won) for (let k = 0; k < 10; k++) await b.screenshot(`${OUT}/result-${tag}-burst-${k}.png`);
  }
  const errs = grab(b, /Exception|GLctx|Uncaught|has no receiver/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  ok('no Unity/page exceptions', errs.length === 0, errs.slice(0, 2).join(' | '));
  const back = await b.waitFor(`location.pathname === '/dojo'`, 20000, 250);
  ok('auto-return lands back on the Dojo', back, await b.eval('location.pathname') as string);
  if (won) {
    const how = grab(b, /\[ResultScreen\] Result_\S+ celebrates/);
    for (const l of how) console.log('[result]', l);
    ok('every lobster starts its celebration', how.length === 3, `${how.length}/3`);
    const hops = how.filter((l) => /code hop/.test(l)).length, landed = grab(b, /\[ResultScreen\] Result_\S+ hop landed/).length;
    ok('every code hop completes', landed === hops, `${landed}/${hops} landed`);
  }
  done();
}
