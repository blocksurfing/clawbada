import type { Browser } from './cdp';

/**
 * A rollout in the middle of a battle (PR 2, 2026-10-28): the API restarts while a guest plays a Dojo battle
 * (autoplay). The page must reconnect with a FRESH socket ticket (tickets are single-use), the restarted API must
 * adopt the battle from its lease and push a snapshot, and the battle must carry on — more turns after the restart.
 *   RESTART_CMD='…' BASE=http://127.0.0.1:3010 bun cdp.ts rollout-probe.ts
 * RESTART_CMD is run by the probe (it should SIGTERM the API and start it again on the same port).
 */
export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const fails: string[] = [];
  const ok = (pass: boolean, what: string, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); if (!pass) fails.push(what); };
  const count = (re: RegExp) => b.allLogs.filter((l) => re.test(l)).length;
  const turns = () => count(/\[BattleBridge\] PlayTurn|\[BattleManager\] PlayTurn/);

  await b.goto(`${BASE}/dojo?team=bulwark,leviathan,sentinel&tier=evolved&purity=2&bot=charger&auto=1`);
  await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250);
  await b.sleep(4000);   // hydration
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  await b.clickAt(r.x, r.y);
  ok(!!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000)), 'battle page opened');
  // Wait for the battle to be under way (past the entry and the intro).
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && turns() < 3) await b.sleep(500);
  const before = turns();
  ok(before >= 3, 'turns played before the restart', `${before}`);
  const ticketsBefore = count(/\/api\/auth\/ws-ticket/);

  const proc = Bun.spawn(['bash', '-c', process.env.RESTART_CMD!], { stdout: 'inherit', stderr: 'inherit' });
  await proc.exited;
  console.log('[rollout] API restarted');

  const t1 = Date.now();
  while (Date.now() - t1 < 60000 && !b.allLogs.some((l) => /\[BattleSession\] socket open \(reconnect/.test(l))) await b.sleep(250);
  ok(b.allLogs.some((l) => /\[BattleSession\] socket open \(reconnect/.test(l)), 'the page reconnected', `${((Date.now() - t1) / 1000).toFixed(1)} s`);
  ok(count(/\/api\/auth\/ws-ticket/) > ticketsBefore, 'with a fresh ticket');
  const t2 = Date.now();
  while (Date.now() - t2 < 90000 && turns() < before + 3) await b.sleep(500);
  ok(turns() >= before + 3, 'the battle carried on after the restart', `${before} → ${turns()} turns`);
  const errs = b.allLogs.filter((l) => /could not get a socket ticket|session_not_found|Invalid or expired ticket/.test(l));
  console.log(`[rollout] ticket/session errors during the gap: ${errs.length}`);
  for (const l of errs.slice(0, 5)) console.log('  ', l.slice(0, 200));
  console.log(fails.length ? `[rollout] ${fails.length} FAIL` : '[rollout] all ok');
}
