import type { Browser } from './cdp';

/**
 * Narrow windows (owner 2026-11-04: a wallet side panel narrowed a laptop window to ~1022 px with the sidebar open, and
 * the menu labels spilled off the frozen sidebar). Checks, on PAGE (default the Dojo):
 *   · at 1022×762 the sidebar engine runs — the toggle is enabled, it opens, every menu label sits inside the cloth, and
 *     it closes again;
 *   · open at 1440 wide, then narrowed to 1022 (the wallet panel sliding in): the sidebar rolls back to compact by itself;
 *   · widening again leaves it closed.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts sidebar-narrow.ts
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
const PAGE = process.env.PAGE ?? '/dojo';

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  const size = (width: number, height: number) => b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  const compact = () => b.eval(`document.body.classList.contains('sidebar-compact')`) as Promise<boolean>;
  const settle = async () => {
    let last = -1;
    for (let i = 0; i < 40; i++) {
      const w = await b.eval(`Math.round(document.querySelector('.pixel-chrome #panel')?.getBoundingClientRect().width ?? 0)`) as number;
      if (w === last) return w;
      last = w;
      await b.sleep(400);
    }
    return last;
  };
  const toggle = async () => {
    const t = await b.eval(`(() => { const e = document.querySelector('#toggle'); if (!e || e.disabled) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
    if (t) { await b.clickAt(t.x, t.y); await b.sleep(600); await settle(); }
    return !!t;
  };
  const spill = () => b.eval(`(() => { const p = document.querySelector('.pixel-chrome #panel')?.getBoundingClientRect(); if (!p) return 'no panel';
    const out = [...document.querySelectorAll('.pixel-chrome .menu-item')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.right > p.right + 1 || q.left < p.left - 1); });
    const zero = [...document.querySelectorAll('.pixel-chrome .menu-item')].filter((e) => e.getBoundingClientRect().width === 0).length;
    return { spilled: out.map((e) => e.textContent.trim()), zero, panel: Math.round(p.width) }; })()`) as Promise<{ spilled: string[]; zero: number; panel: number } | string>;

  // 1. At the wallet-panel width from a fresh load.
  await size(1022, 762);
  await b.goto(`${BASE}${PAGE}`);
  await b.waitFor(`!!document.querySelector('#toggle') && !document.querySelector('#toggle').disabled`, 30000, 250);
  await b.sleep(2500);
  ok('1022×762: sidebar starts compact', await compact());
  ok('1022×762: toggle enabled and opens the sidebar', await toggle() && !(await compact()));
  const s = await spill();
  ok('1022×762 open: every menu label inside the sidebar', typeof s !== 'string' && s.spilled.length === 0 && s.zero === 0, JSON.stringify(s));
  await b.screenshot(`${import.meta.dir}/out/narrow-1022-open.png`);
  ok('1022×762: toggle closes it again', await toggle() && await compact());

  // 2. Open wide, then the wallet panel narrows the window.
  await size(1440, 762);
  await b.sleep(1500);
  await settle();
  ok('1440: opens', await toggle() && !(await compact()));
  await size(1022, 762);
  await b.sleep(800);
  const w = await settle();
  ok('narrowed 1440 → 1022 while open: rolls back to compact', await compact(), `cloth ${w} px`);
  const s2 = await spill();
  ok('after narrowing: no label spills', typeof s2 !== 'string' && s2.spilled.length === 0, JSON.stringify(s2));
  await b.screenshot(`${import.meta.dir}/out/narrow-after-shrink.png`);

  // 3. Widening back leaves it closed.
  await size(1440, 762);
  await b.sleep(1500);
  ok('widened back to 1440: stays compact', await compact());

  for (const c of checks) console.log(c);
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails === 0 ? '[narrow] all ok' : `[narrow] ${fails} FAIL`);
}
