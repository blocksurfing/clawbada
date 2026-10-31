/**
 * Dojo lobby lineup check (2026-10-30): shadows on the feet, the lineup idling, Nzib's ninja squirrel.
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts dojo-shots.ts
 *
 * Per tier, at the owner's MacBook Air size (1440 × 755 @2): a lineup screenshot (out/dojo-<tier>.png), every
 * fighter's shadow centre against its lobster's lowest pixel (should sit 2 art px above it), and whether the canvases
 * change over a fifth of a second (the idle). Then ?squirrel=now and a screenshot mid-run (out/dojo-squirrel.png).
 */
import type { Browser } from './cdp';

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  for (const tier of ['evolved', 'elite', 'apex']) {
    await b.goto(`${BASE}/dojo?team=mantis,leviathan,sentinel&tier=${tier}&stay=1`);
    await b.waitFor(`!!document.querySelector('[data-fighter="team"] canvas:not([hidden])')`, 60000, 250);
    await b.sleep(2500);
    const r = await b.eval(`(() => { const els=[...document.querySelectorAll('.dojo-fighter')]; const rs=els.map(e=>e.getBoundingClientRect()); const x=Math.min(...rs.map(r=>r.left))-40, y=Math.min(...rs.map(r=>r.top))-120, x2=Math.max(...rs.map(r=>r.right))+40, y2=Math.max(...rs.map(r=>r.bottom))+20; return {x,y,width:x2-x,height:y2-y}; })()`);
    const shot = await b.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    await Bun.write(`${import.meta.dir}/out/dojo-${tier}.png`, Buffer.from(shot.data, 'base64'));
    // The canvas is cropped to the opaque pixels, so its bottom edge is the lowest pixel of the lobster.
    const shadows = await b.eval(`(() => [...document.querySelectorAll('.dojo-fighter')].filter(f => f.querySelector('canvas:not([hidden])')).map(f => {
      const c = f.querySelector('canvas').getBoundingClientRect(), s = f.querySelector('.dojo-shadow').getBoundingClientRect();
      const px = parseFloat(getComputedStyle(f).getPropertyValue('--dojo-selected-pixel')) || 4;
      return { side: f.dataset.fighter, slot: f.dataset.slot, off: Math.round(((c.bottom - 2 * px) - (s.top + s.height / 2)) / px * 10) / 10 };
    }))()`) as { side: string; slot: string; off: number }[];
    ok(shadows.length === 6 && shadows.every((s) => Math.abs(s.off) <= 1), `${tier}: shadows centred 2 px above the feet (off in art px: ${shadows.map((s) => s.off).join(', ')})`);
    // Some classes hold a pose for two frames, so sample six times over half a second.
    const frames = await b.eval(`(async () => { const cs=[...document.querySelectorAll('.dojo-fighter canvas:not([hidden])')]; const seen=cs.map(()=>new Set()); for (let i=0;i<6;i++){ cs.forEach((c,j)=>seen[j].add(c.toDataURL())); await new Promise(r=>setTimeout(r,90)); } return seen.filter(s=>s.size>1).length; })()`) as number;
    ok(frames === 6, `${tier}: lineup idles (${frames} of 6 canvases moved in 0.5 s)`);
  }
  await b.goto(`${BASE}/dojo?team=mantis,leviathan,sentinel&tier=elite&stay=1&squirrel=now`);
  const ran = await b.waitFor(`document.querySelector('[data-testid=dojo-squirrel]')?.dataset.running === 'true'`, 15000, 50);
  ok(ran, 'squirrel starts with ?squirrel=now');
  await b.sleep(1700);
  const shot = await b.send('Page.captureScreenshot', { format: 'png' });
  await Bun.write(`${import.meta.dir}/out/dojo-squirrel.png`, Buffer.from(shot.data, 'base64'));
  await b.sleep(2500);
  ok(await b.eval(`document.querySelector('[data-testid=dojo-squirrel]').hidden`) as boolean, 'squirrel hidden again after its 3.5 s run');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
