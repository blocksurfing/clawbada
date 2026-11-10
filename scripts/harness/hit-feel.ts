/**
 * Hit feel (owner 2026-11-09, Batch A): hit stop, white flash, recoil, crit/kill shake, bigger spark, number pop.
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts hit-feel.ts
 * 1. An autoplay Dojo battle (SECONDS, default 100): every damaging hit logs `[HitFeel] hit … hold=…`; normal hits
 *    hold 0.085 s, crits 0.170 s and shake, killing blows 0.250 s and shake harder; no errors. Frames right after a crit
 *    and a kill: out/hitfeel-crit-*.png, out/hitfeel-kill-*.png.
 * 2. The same with the OS "reduce motion" setting: no flash, no recoil, no shake (hit stop and numbers stay).
 * Muted; resigns each battle through the API.
 */
import type { Browser } from './cdp';

const SECONDS = Number(process.env.SECONDS ?? 100);

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  const OUT = `${import.meta.dir}/out`;
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const resign = () => b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (tok) await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }); })()`);
  const battle = async (label: string, film: boolean) => {
    await b.goto(`${BASE}/dojo?team=leviathan,ember,mantis&tier=apex&purity=6&bot=balanced&stay=1&auto=1`);
    await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250); await b.sleep(2500);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs(); await b.clickAt(r.x, r.y);
    await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000);
    let n = 0; const t0 = Date.now(); const filmed = { crit: false, kill: false };
    while (Date.now() - t0 < SECONDS * 1000) {
      const fresh = b.logs.slice(n); n = b.logs.length;
      for (const l of fresh) {
        if (!film || !/\[HitFeel\] hit /.test(l)) continue;
        const kind = /kill=True/.test(l) ? 'kill' : /crit=True/.test(l) ? 'crit' : null;
        if (kind && !filmed[kind]) { filmed[kind] = true; for (let i = 0; i < 4; i++) await b.screenshot(`${OUT}/hitfeel-${kind}-${i}.png`); }
      }
      if (b.logs.some((l) => /\[BattleHud\] banner/.test(l))) break;   // the result banner: the battle is over
      await b.sleep(60);
    }
    const hits = b.logs.filter((l) => /\[HitFeel\] hit /.test(l));
    const shakes = b.logs.filter((l) => /\[HitFeel\] shake|\[CameraShake\] (amp|skipped)/.test(l));
    const errors = b.allLogs.filter((l) => /Exception|NullReference/i.test(l) && !/Aave Wallet|FamilyAccountsSdk/.test(l));
    await resign();
    return { label, hits, shakes, errors };
  };

  const a = await battle('normal', true);
  const hold = (re: RegExp) => a.hits.filter((l) => re.test(l)).map((l) => Number(l.match(/hold=([\d.]+)/)?.[1]));
  const normal = hold(/crit=False kill=False/).filter((h) => h > 0), crit = hold(/crit=True kill=False/), kill = hold(/kill=True/);
  console.log(`  ${a.hits.length} hits: ${normal.length} normal, ${crit.length} crit, ${kill.length} kill`);
  ok(normal.length > 0 && normal.every((h) => Math.abs(h - 0.085) < 0.001), `normal hits hold 0.085 s (${normal.slice(0, 4).join(', ')})`);
  ok(crit.every((h) => Math.abs(h - 0.17) < 0.001), `crits hold 0.170 s (${crit.length ? crit.slice(0, 3).join(', ') : 'none this battle'})`);
  ok(kill.every((h) => Math.abs(h - 0.25) < 0.001), `kills hold 0.250 s (${kill.length ? kill.join(', ') : 'none this battle'})`);
  ok(a.hits.filter((l) => /hold=0\.[0-9]*[1-9]/.test(l)).every((l) => /flash=0\.(06|09)/.test(l)), 'every damaging hit flashes');
  ok(crit.length + kill.length === 0 || a.shakes.some((l) => /\[HitFeel\] shake/.test(l)), `crits/kills shake (${a.shakes.filter((l) => /HitFeel/.test(l)).length} shakes)`);
  ok(a.errors.length === 0, `no errors (${a.errors.slice(0, 2).join(' | ')})`);
  ok(b.allLogs.some((l) => /\[HitFeel\] flash material ready/.test(l)) && !b.allLogs.some((l) => /SpriteFlash shader missing/.test(l)), 'the white-flash shader loads in the WebGL player');

  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const rm = await battle('reduce motion', false);
  ok(rm.hits.length > 0 && rm.hits.every((l) => /flash=0\.00 recoil=0px/.test(l)), `reduce motion: no flash, no recoil (${rm.hits.length} hits)`);
  ok(!rm.shakes.some((l) => /\[CameraShake\] amp/.test(l)), `reduce motion: no screen shake (${rm.shakes.filter((l) => /skipped/.test(l)).length} skipped)`);
  ok(rm.hits.some((l) => /hold=0\.[0-9]*[1-9]/.test(l)), 'reduce motion: hit stop stays');
  ok(rm.errors.length === 0, 'reduce motion: no errors');
  await b.send('Emulation.setEmulatedMedia', { features: [] });
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
