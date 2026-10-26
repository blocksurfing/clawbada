import type { Browser } from './cdp';

/**
 * Laptop fit (owner 2026-10-25: a 13" MacBook at 100 % had the sidebar over the Shell's first stage, the Battle button
 * over the third label and the sidebar cut off at the bottom; 80 % zoom was the workaround). For each window size —
 * browser viewports of common laptops and desktops at 100 % zoom — and both sidebar states, on the Shell:
 *   · the chrome scale is 3× only on a wide, tall window, else 2× (pixel-assets.ts chromePixelScale);
 *   · no stage or slot label overlaps the sidebar's cloth, the Battle button or the Queue/Active/History tabs;
 *   · the expanded sidebar fits the window top to bottom (nothing scrolled out of reach).
 *   BASE=http://127.0.0.1:3010 bun cdp.ts layout-fit.ts
 */
const OUT = process.env.OUT ?? `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const SIZES: [string, number, number][] = [
  ['13" MacBook (1440×900)', 1440, 755],
  ['13" MacBook, more space', 1680, 900],
  ['14" MacBook Pro', 1512, 830],
  ['16" MacBook Pro', 1728, 1000],
  ['1080p monitor', 1920, 955],
  ['1440p monitor', 2560, 1300],
  ['small laptop', 1280, 680],
];

type R = { l: number; t: number; r: number; b: number };
const hit = (a: R, b: R) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  for (const [label, w, h] of SIZES) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await b.goto(`${BASE}/game`);
    await b.waitFor(`!!document.querySelector('.lobby-slot .character-stage') && document.body.classList.contains('sidebar-compact') !== undefined`, 60000, 250);
    await b.sleep(3500);   // the opening roll + the room's art maths
    for (const state of ['compact', 'expanded'] as const) {
      if (state === 'expanded') {
        const t = await b.eval(`(() => { const e = document.querySelector('#toggle'); if (!e || e.disabled) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
        if (!t) { ok(`${label} ${w}×${h}: sidebar can expand`, false, 'toggle missing or disabled'); continue; }
        await b.clickAt(t.x, t.y);
        await b.sleep(2500);
      }
      const m = await b.eval(`(() => {
        const r = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; };
        const sh = document.querySelector('.sidebar-shell');
        return {
          pixel: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pixel')),
          compact: document.body.classList.contains('sidebar-compact'),
          panel: r(document.querySelector('.pixel-chrome #panel')),
          battle: r(document.querySelector('.shell-battle')),
          tabs: r(document.querySelector('.shell-tabs')),
          stages: [...document.querySelectorAll('.lobby-slot .character-stage')].map(r),
          labels: [...document.querySelectorAll('.lobby-slot .slot-name, .lobby-slot .slot-hint, .lobby-slot .slot-art')].map(r).filter((x) => x && x.r > x.l),
          sidebarOverflow: sh ? sh.scrollHeight - sh.clientHeight : 0,
        };
      })()`) as { pixel: number; compact: boolean; panel: R | null; battle: R | null; tabs: R | null; stages: R[]; labels: R[]; sidebarOverflow: number };
      const tag = `${label} ${w}×${h} ${state}`;
      const want = w >= 1600 && h >= 996 ? 3 : 2;
      if (state === 'compact') ok(`${label} ${w}×${h}: chrome at ${want}×`, m.pixel === want, `--pixel ${m.pixel}px`);
      const blockers = [['sidebar', m.panel], ['Battle', m.battle], ['tabs', m.tabs]] as const;
      const clashes: string[] = [];
      m.stages.forEach((s, i) => blockers.forEach(([n, r]) => { if (r && hit(s, r)) clashes.push(`stage ${i + 1} × ${n}`); }));
      m.labels.forEach((s, i) => blockers.forEach(([n, r]) => { if (r && hit(s, r)) clashes.push(`label ${i + 1} × ${n}`); }));
      ok(`${tag}: stages and labels clear of the sidebar, Battle and tabs`, m.stages.length === 3 && clashes.length === 0, clashes.join(', ') || `3 stages, ${m.labels.length} labels`);
      const offscreen = m.stages.filter((s) => s.l < 0 || s.r > w).length;
      ok(`${tag}: stages on screen`, offscreen === 0, offscreen ? `${offscreen} off screen` : '');
      if (state === 'expanded') ok(`${tag}: the whole sidebar fits`, m.sidebarOverflow <= 2, `${m.sidebarOverflow}px scrolled out of reach`);
      await b.screenshot(`${OUT}/fit-${w}x${h}-${state}.png`);
    }
  }
  for (const c of checks) console.log(c);
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails === 0 ? '[fit] all ok' : `[fit] ${fails} FAIL`);
}
