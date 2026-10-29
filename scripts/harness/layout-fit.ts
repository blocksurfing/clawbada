import type { Browser } from './cdp';
import { chromePixelScale } from '../../apps/web/src/components/pixel/pixel-assets';

/**
 * Laptop fit (owner 2026-10-25: a 13" MacBook at 100 % had the sidebar over the Shell's first stage, the Battle button
 * over the third label and the sidebar cut off at the bottom; 80 % zoom was the workaround). For each window size —
 * browser viewports of common laptops and desktops at 100 % zoom — and both sidebar states, on the Shell:
 *   · the chrome scale is the one pixel-assets.ts chromePixelScale picks for that window and screen, and the sidebar,
 *     the wallet and the Battle button all draw at it (Nzib's one-pixel-size rule, 2026-10-29);
 *   · no stage or slot label overlaps the sidebar's cloth, the Battle button or the Queue/Active/History tabs;
 *   · the expanded sidebar's whole menu (down to Docs) is in the window; the banner's point below it may run past the edge.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts layout-fit.ts
 */
const OUT = process.env.OUT ?? `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
/** [label, viewport width, height, device pixel ratio] — browser viewports at 100 % zoom. */
const SIZES: [string, number, number, number][] = (process.env.ONLY ? [['only', ...process.env.ONLY.split('x').map(Number), Number(process.env.DPR ?? 2)] as [string, number, number, number]] : null) ?? [
  ['13" MacBook (1440×900, retina)', 1440, 755, 2],
  ['13" MacBook, more space', 1680, 900, 2],
  ['14" MacBook Pro', 1512, 830, 2],
  ['16" MacBook Pro', 1728, 1000, 2],
  ['1080p monitor', 1920, 955, 1],
  ['1440p monitor', 2560, 1300, 1],
  ['Windows laptop 1366×768', 1366, 650, 1],
  // 2026-10-29: big and scaled screens get the same proportions (one pixel size, chosen in device pixels).
  ['4K monitor', 3840, 2000, 1],
  ['2560 screen, browser zoomed to 50 % (Nzib)', 5120, 2600, 0.5],
  ['Windows laptop at 125 %', 1536, 760, 1.25],
];

type R = { l: number; t: number; r: number; b: number };
const hit = (a: R, b: R) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  for (const [label, w, h, dpr] of SIZES) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    await b.goto(`${BASE}/game`);
    await b.waitFor(`!!document.querySelector('.lobby-slot .character-stage') && document.body.classList.contains('sidebar-compact') !== undefined`, 60000, 250);
    await b.sleep(3500);   // the opening roll + the room's art maths
    for (const state of ['compact', 'expanded'] as const) {
      if (state === 'expanded') {
        const t = await b.eval(`(() => { const e = document.querySelector('#toggle'); if (!e || e.disabled) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
        if (!t) { ok(`${label} ${w}×${h}: sidebar can expand`, false, 'toggle missing or disabled'); continue; }
        await b.clickAt(t.x, t.y);
        await b.sleep(1500);
      }
      // Measure only once the sidebar has stopped rolling (its cloth keeps the same width for half a second).
      let last = -1;
      for (let i = 0; i < 40; i++) {
        const wNow = await b.eval(`Math.round(document.querySelector('.pixel-chrome #panel')?.getBoundingClientRect().width ?? 0)`) as number;
        if (wNow === last) break;
        last = wNow;
        await b.sleep(500);
      }
      await b.sleep(300);
      const m = await b.eval(`(() => {
        const r = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; };
        const sh = document.querySelector('.sidebar-shell');
        return {
          pixel: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pixel')),
          compact: document.body.classList.contains('sidebar-compact'),
          panel: r(document.querySelector('.pixel-chrome #panel')),
          battle: r(document.querySelector('.shell-battle')),
          walletPixel: (() => { const e = document.querySelector('.user-section'); return e ? parseFloat(getComputedStyle(e).getPropertyValue('--pixel')) : null; })(),
          walletBox: r(document.querySelector('.user-section')),
          tabs: r(document.querySelector('.shell-tabs')),
          stages: [...document.querySelectorAll('.lobby-slot .character-stage')].map(r),
          labels: [...document.querySelectorAll('.lobby-slot .slot-name, .lobby-slot .slot-hint, .lobby-slot .slot-art')].map(r).filter((x) => x && x.r > x.l),
          sidebarOverflow: sh ? sh.scrollHeight - sh.clientHeight : 0,
          docsBottom: (() => { const d = document.querySelector('[data-menu="docs"]'); return d ? d.getBoundingClientRect().bottom : null; })(),
          wrapped: [...document.querySelectorAll('.lobby-slot > .slot-name')].filter((e) => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).fontSize) * 1.6).length,
          menuFont: (() => { const e = document.querySelector('.menu-item'); return e ? getComputedStyle(e).fontSize : null; })(),
          wallet: (() => { const e = document.querySelector('.connect-wallet'); return e ? { text: e.textContent, over: e.scrollWidth - e.clientWidth, font: getComputedStyle(e).fontFamily.split(',')[0] + ' ' + getComputedStyle(e).fontSize } : null; })(),
        };
      })()`) as { pixel: number; compact: boolean; panel: R | null; battle: R | null; tabs: R | null; stages: R[]; labels: R[]; sidebarOverflow: number; docsBottom: number | null; wrapped: number; menuFont: string | null; wallet: { text: string; over: number; font: string } | null; walletPixel: number | null; walletBox: R | null };
      const tag = `${label} ${w}×${h} ${state}`;
      const want = chromePixelScale(w, h, dpr);
      if (state === 'compact') ok(`${label} ${w}×${h} @${dpr}x: chrome at ${want}×`, m.pixel === want, `--pixel ${m.pixel}px, menu labels ${m.menuFont}`);
      if (state === 'compact' && m.battle && m.walletBox) {
        const bw = m.battle.r - m.battle.l, ww = m.walletBox.r - m.walletBox.l;
        ok(`${label} ${w}×${h}: one pixel size — wallet and Battle button at ${want}×`, m.walletPixel === want && Math.abs(bw - 80 * want) < 1 && Math.abs(ww - 160 * want) < 1,
          `wallet --pixel ${m.walletPixel}, Battle ${bw.toFixed(1)} px (want ${80 * want}), wallet ${ww.toFixed(1)} px (want ${160 * want})`);
      }
      if (state === 'compact') ok(`${label} ${w}×${h}: wallet label not cut off`, !!m.wallet && m.wallet.over <= 0, m.wallet ? `"${m.wallet.text}" in ${m.wallet.font}, ${m.wallet.over}px over` : 'no wallet label'); 
      const blockers = [['sidebar', m.panel], ['Battle', m.battle], ['tabs', m.tabs]] as const;
      const clashes: string[] = [];
      m.stages.forEach((s, i) => blockers.forEach(([n, r]) => { if (r && hit(s, r)) clashes.push(`stage ${i + 1} × ${n}`); }));
      m.labels.forEach((s, i) => blockers.forEach(([n, r]) => { if (r && hit(s, r)) clashes.push(`label ${i + 1} × ${n}`); }));
      ok(`${tag}: stages and labels clear of the sidebar, Battle and tabs`, m.stages.length === 3 && clashes.length === 0, clashes.join(', ') || `3 stages, ${m.labels.length} labels`);
      ok(`${tag}: stage labels on one line`, m.wrapped === 0, m.wrapped ? `${m.wrapped} wrapped` : '');
      const offscreen = m.stages.filter((s) => s.l < 0 || s.r > w).length;
      ok(`${tag}: stages on screen`, offscreen === 0, offscreen ? `${offscreen} off screen` : '');
      if (state === 'expanded') ok(`${tag}: the whole menu (down to Docs) is in the window`, m.docsBottom !== null && m.docsBottom <= h, `Docs ends at ${Math.round(m.docsBottom ?? -1)} of ${h} px; banner point ${m.sidebarOverflow > 2 ? `${m.sidebarOverflow}px below the edge` : 'fully in view'}`);
      await b.screenshot(`${OUT}/fit-${w}x${h}-${state}.png`);
    }
  }
  for (const c of checks) console.log(c);
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails === 0 ? '[fit] all ok' : `[fit] ${fails} FAIL`);
}
