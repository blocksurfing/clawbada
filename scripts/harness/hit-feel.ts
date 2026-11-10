/**
 * Hit feel (owner 2026-11-09; trimmed 2026-11-10 on Nzib's note — hit stop and knockback live in his frames): white
 * flash, crit/kill shake, bigger spark, number pop.
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts hit-feel.ts
 * 1. An autoplay Dojo battle (SECONDS, default 100): every damaging hit logs `[HitFeel] hit …` and flashes; crits and
 *    kills grow the spark and shake; no errors; no hit stop or recoil left. Frames right after a crit and a kill:
 *    out/hitfeel-crit-*.png, out/hitfeel-kill-*.png.
 * 2. The same with the OS "reduce motion" setting: no flash, no shake.
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
  const n = (re: RegExp) => a.hits.filter((l) => re.test(l)).length;
  const normal = n(/crit=False kill=False/), crit = n(/crit=True kill=False/), kill = n(/kill=True/);
  console.log(`  ${a.hits.length} hits: ${normal} normal, ${crit} crit, ${kill} kill`);
  ok(a.hits.length > 0 && a.hits.every((l) => /flash=0\.(06|09)|flash=0\.00/.test(l)) && a.hits.some((l) => /flash=0\.(06|09)/.test(l)), 'damaging hits flash');
  ok(a.hits.filter((l) => /crit=True|kill=True/.test(l)).every((l) => /spark=1\.5/.test(l)) && a.hits.filter((l) => /crit=False kill=False/.test(l)).every((l) => /spark=1\.0/.test(l)), 'crits and kills get the bigger spark');
  ok(crit + kill === 0 || a.shakes.some((l) => /\[HitFeel\] shake/.test(l)), `crits/kills shake (${a.shakes.filter((l) => /HitFeel/.test(l)).length} shakes)`);
  ok(!a.hits.some((l) => /hold=|recoil=/.test(l)), 'no hit stop or recoil (drawn in Nzib\'s frames)');
  ok(a.errors.length === 0, `no errors (${a.errors.slice(0, 2).join(' | ')})`);
  ok(b.allLogs.some((l) => /\[HitFeel\] flash material ready/.test(l)) && !b.allLogs.some((l) => /SpriteFlash shader missing/.test(l)), 'the white-flash shader loads in the WebGL player');

  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const rm = await battle('reduce motion', false);
  ok(rm.hits.length > 0 && rm.hits.every((l) => /flash=0\.00/.test(l)), `reduce motion: no flash (${rm.hits.length} hits)`);
  ok(!rm.shakes.some((l) => /\[CameraShake\] amp/.test(l)), `reduce motion: no screen shake (${rm.shakes.filter((l) => /skipped/.test(l)).length} skipped)`);
  ok(rm.errors.length === 0, 'reduce motion: no errors');
  await b.send('Emulation.setEmulatedMedia', { features: [] });
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
