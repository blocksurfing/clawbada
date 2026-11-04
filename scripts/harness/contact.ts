/**
 * Contact timing (smoothness campaign 2026-11-04): every swing's hit lands on its strike frame from
 * Assets/Resources/ContactTimes.asset (or a clip "Contact" event), not halfway through the swing.
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts contact.ts
 *
 * Autoplays one Elite and one Apex Dojo battle (SECONDS each) and checks every `[LobsterController] contact` line: the
 * source is the table (or an event), never the fallback, and the time matches the table for that class at normal speed.
 * Muted; resigns through the API after each battle.
 */
import type { Browser } from './cdp';
import { readFileSync } from 'node:fs';

const SECONDS = Number(process.env.SECONDS ?? 70);
const TIERS: Record<string, number> = { evolved: 1, elite: 2, apex: 3 };

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const asset = readFileSync(`${import.meta.dir}/../../packages/battle-engine/ClawbadaBattle/Assets/Resources/ContactTimes.asset`, 'utf8');
  const table = new Map<string, number>();
  for (const m of asset.matchAll(/tier: (\d+)\n\s+className: (\w+)\n\s+state: (\w+)\n\s+seconds: ([\d.]+)/g)) table.set(`${m[1]}/${m[2]}/${m[3]}`, +m[4]);
  ok(table.size >= 50, `table read (${table.size} entries)`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });

  for (const [tierName, team] of [['elite', 'mantis,kraken,reaver'], ['apex', 'leviathan,ember,specter']] as const) {
    await b.goto(`${BASE}/dojo?team=${team}&tier=${tierName}&bot=balanced&stay=1&auto=1`);
    ok(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250), `${tierName}: Dojo opened`);
    await b.sleep(2000);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs();
    await b.clickAt(r.x, r.y);
    ok(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000), `${tierName}: battle opened`);
    await b.sleep(SECONDS * 1000);
    const lines = b.logs.filter((l) => /\[LobsterController\] contact /.test(l));
    let bad = 0, fallback = 0;
    const seen = new Set<string>();
    for (const l of lines) {
      const m = /contact (\w+) (\w+) at ([\d.]+)s of ([\d.]+)s \((\w+)\)/.exec(l);
      if (!m) continue;
      const [, cls, state, at, , src] = m;
      seen.add(`${cls} ${state}`);
      if (src === 'fallback') { fallback++; console.log(`  fallback: ${l}`); continue; }
      const want = table.get(`${TIERS[tierName]}/${cls}/${state}`);
      // Normal-speed swings match the table; a slowed cast (Bind 0.5×) lands later by its speed.
      if (want === undefined || (Math.abs(+at - want) > 0.011 && Math.abs(+at - want / 0.5) > 0.011)) { bad++; console.log(`  mismatch (want ${want}): ${l}`); }
    }
    ok(lines.length >= 4 && fallback === 0 && bad === 0, `${tierName}: ${lines.length} swings land on their strike frames (${[...seen].join(', ')})`);
    await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 0; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`).catch(() => 0);
  }
  const errors = b.allLogs.filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
  ok(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`);
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
