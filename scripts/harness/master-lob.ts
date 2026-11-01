/**
 * Master Lob, the Dojo coach (2026-11-01).
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts master-lob.ts
 *
 * 1. A coached practice battle the probe does not play: he appears on the player's first turn, on a free hex that is
 *    not the active lobster's and not next to an enemy, says his tip in the bubble, and leaves when his reading time is
 *    up. Screenshot mid-tip: out/master-lob.png.
 * 2. A coached battle on autoplay (SECONDS, default 120): he appears several times, only on the player's turns, leaves
 *    when the turn is played, and nothing throws. Coach off (no ?coach=1) → he never appears.
 * Muted; resigns through the API at the end of each battle (one live practice battle per player).
 */
import type { Browser } from './cdp';

const SECONDS = Number(process.env.SECONDS ?? 120);

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const resign = async () => b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 0; const r = await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }); return r.status; })()`);
  const open = async (query: string) => {
    await b.goto(`${BASE}/dojo?team=sentinel,mantis,kraken&tier=elite&purity=6&bot=balanced&stay=1&${query}`);
    if (!(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250))) return false;
    await b.sleep(2500);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs();
    await b.clickAt(r.x, r.y);
    if (!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000))) return false;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000 && !b.logs.some((l) => /\[BattleStage\] intro complete/.test(l))) await b.sleep(250);
    return true;
  };
  const appears = () => b.logs.filter((l) => /\[MasterLobCoach\] appears at/.test(l));

  // 1. Not played: he appears on the first player turn and finishes his tip.
  ok(await open('coach=1'), 'coached battle opened');
  const t1 = Date.now();
  while (Date.now() - t1 < 40000 && appears().length === 0) await b.sleep(200);
  const first = appears()[0] ?? '';
  ok(!!first, `he appears on the player's first turn — ${first.replace(/^\[log\] /, '')}`);
  const said = b.logs.find((l) => /\[MasterLob\] said /.test(l)) ?? '';
  ok(!!said, `the web marked the tip as said — ${said.replace(/^\[log\] /, '')}`);
  await b.sleep(2600);   // the bubble opens 0.6 s after his Speak loop starts
  const shot = await b.send('Page.captureScreenshot', { format: 'png' });
  await Bun.write(`${import.meta.dir}/out/master-lob.png`, Buffer.from(shot.data, 'base64'));
  const t2 = Date.now();
  while (Date.now() - t2 < 30000 && !b.logs.some((l) => /\[MasterLobCoach\] leaves \(read\)/.test(l))) await b.sleep(250);
  ok(b.logs.some((l) => /\[MasterLobCoach\] leaves \(read\)/.test(l)), 'he leaves when his reading time is up');
  await resign();

  // 2. Autoplay: several appearances, only on the player's turns, gone when the turn plays.
  ok(await open('coach=1&auto=1'), 'coached autoplay battle opened');
  const t3 = Date.now();
  while (Date.now() - t3 < SECONDS * 1000) {
    if (await b.eval(`/Victory|Defeat|Battle over/i.test(document.querySelector('[data-testid=battle-status-line]')?.textContent || '')`)) break;
    await b.sleep(1000);
  }
  const n = appears().length;
  const leaves = b.logs.filter((l) => /\[MasterLobCoach\] leaves \(turn played\)/.test(l)).length;
  const skipped = b.logs.filter((l) => /\[MasterLobCoach\] skipped/.test(l)).map((l) => l.replace(/^\[log\] \[MasterLobCoach\] skipped /, ''));
  ok(n >= 3, `he appears several times in a battle (${n} appearances, ${leaves} left as the turn played; skipped: ${skipped.join(' | ') || 'none'})`);
  const errors = b.allLogs.filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
  ok(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`);
  await resign();

  // 3. Coach off: he never appears.
  ok(await open('auto=1'), 'uncoached battle opened');
  await b.sleep(25000);
  ok(appears().length === 0, 'no Master Lob without the guidance toggle');
  await resign();
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
