import type { Browser } from './cdp';
import { chromePixelScale } from '../../apps/web/src/components/pixel/pixel-assets';

/**
 * The Dojo (Nzib's drop 5cb6655, ported 2026-10-26) — the acceptance checks of his dojo-browser.py / dojo-drag.py:
 *   · per window size at its chrome scale (3 / 2.5 / 2): a guest opens on Build a team; six fighters stand; the Battle
 *     button and the status line are on screen and clear of both cards; the cards don't overlap, and nothing inside a
 *     card spills out of it; Fight with friend is shown, disabled, "Coming soon"; the page doesn't scroll;
 *   · My lobsters (a burner wallet whose lobsters and teams are stubbed in the page — no chain on a dev stack): opens on
 *     My lobsters with the first saved team; click removes and refills; drag replaces, swaps (never a duplicate) and,
 *     dropped on the tiles, removes; Escape cancels a drag; Battle sends lobsterIds and a failure lands in the status.
 *   BASE=http://127.0.0.1:3010 bun cdp.ts dojo-layout.ts      (ONLY=1440x755 DPR=2 for one size)
 */
const OUT = process.env.OUT ?? `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const SIZES: [string, number, number, number][] = (process.env.ONLY ? [['only', ...process.env.ONLY.split('x').map(Number), Number(process.env.DPR ?? 2)] as [string, number, number, number]] : null) ?? [
  ['13" MacBook', 1440, 755, 2],
  ['16" MacBook Pro', 1728, 1000, 2],
  ['1080p monitor', 1920, 955, 1],
  ['1440p monitor', 2560, 1300, 1],
  ['Windows laptop 1366×768', 1366, 650, 1],
  ['small laptop', 1280, 648, 1],
];

type R = { l: number; t: number; r: number; b: number };
const hit = (a: R, b: R) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;

/** Wallet fixtures: ten lobsters (two pages at 10 a page = 1 page; 12 = 2 pages) and one saved team. */
const CLASSES = ['Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter', 'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember'];
const FIXTURE_LOBSTERS = Array.from({ length: 12 }, (_, i) => ({ tokenId: String(101 + i), class: i % 10, className: CLASSES[i % 10], tierName: 'Evolved', evolutionTier: 1 }));
const STUB = `
  const lobsters = ${JSON.stringify(FIXTURE_LOBSTERS)};
  const real = window.fetch.bind(window);
  window.__practiceBodies = [];
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (/\\/api\\/agent\\/lobsters\\//.test(url)) return json({ address: '0x', count: lobsters.length, lobsters });
    if (/\\/api\\/game\\/teams\\?/.test(url)) return json({ address: '0x', count: 1, teams: [{ teamId: '7', owner: '0x', lobsterIds: ['101', '102', '103'], active: false }] });
    if (/\\/api\\/game\\/combat\\/practice/.test(url)) { try { window.__practiceBodies.push(JSON.parse(init.body)); } catch (e) {} }
    return real(input, init);
  };
`;

export default async function (b: Browser) {
  const checks: string[] = [];
  const ok = (name: string, pass: boolean, detail = '') => checks.push(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  const rect = (sel: string) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; })()`) as Promise<R | null>;

  for (const [label, w, h, dpr] of SIZES) {
    const tag = `${label} ${w}×${h}`;
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    await b.goto(`${BASE}/dojo`);
    await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]') && !!document.querySelector('.dojo-sign[data-ready=true]')`, 60000, 250);
    await b.sleep(1500);
    const want = chromePixelScale(w, h, dpr);
    const pixel = await b.eval(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pixel'))`);
    ok(`${tag}: chrome scale`, pixel === want, `${pixel} (want ${want})`);
    ok(`${tag}: a guest opens on Build a team`, await b.eval(`document.querySelector('[data-team-mode=builder]')?.getAttribute('aria-selected') === 'true'`));
    const fighters = await b.eval(`Array.from(document.querySelectorAll('.dojo-fighter canvas')).filter(c => !c.hidden && c.getBoundingClientRect().width > 0).length`);
    ok(`${tag}: six fighters stand`, fighters === 6, String(fighters));
    const cards = await b.eval(`Array.from(document.querySelectorAll('.dojo-card')).map(e => { const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; })`) as R[];
    const battle = (await rect('[data-testid=dojo-battle]'))!;
    const status = (await rect('[data-testid=dojo-summary]'))!;
    const inView = (r: R) => r.l >= 0 && r.t >= 0 && r.r <= w && r.b <= h;
    ok(`${tag}: Battle button on screen`, inView(battle), JSON.stringify(battle));
    ok(`${tag}: status line on screen`, !!status && inView(status), JSON.stringify(status));
    ok(`${tag}: cards on screen`, cards.every(inView), JSON.stringify(cards.map((c) => Math.round(c.b))));
    ok(`${tag}: cards don't overlap`, cards.length === 2 && !hit(cards[0], cards[1]));
    ok(`${tag}: Battle and status clear of the cards`, !cards.some((c) => hit(c, battle) || hit(c, status)));
    for (const mode of ['builder', 'owned'] as const) {
      await b.eval(`document.querySelector('[data-team-mode=${mode}]').click()`);
      await b.sleep(300);
      const spill = await b.eval(`(() => { const out = []; document.querySelectorAll('.dojo-card').forEach((card, i) => { const c = card.getBoundingClientRect(); card.querySelectorAll('button, select, label, legend, p, .dojo-inventory-pager').forEach(e => { if (e.closest('[hidden]') || e.closest('.dojo-bot-notes') || e.classList.contains('dojo-soon')) return; const q = e.getBoundingClientRect(); if (!q.width) return; if (q.left < c.left - 1 || q.right > c.right + 1 || q.top < c.top - 1 || q.bottom > c.bottom + 1) out.push(i + ':' + (e.textContent || e.tagName).trim().slice(0, 24)); }); }); return out; })()`) as string[];
      ok(`${tag}: nothing spills out of a card (${mode})`, spill.length === 0, spill.join(', '));
    }
    await b.eval(`document.querySelector('[data-team-mode=builder]').click()`);
    ok(`${tag}: Fight with friend is disabled, "Coming soon"`, await b.eval(`(() => { const t = document.querySelector('[data-testid=dojo-friend-tab]'); return !!t && t.getAttribute('aria-disabled') === 'true' && t.textContent.includes('Coming soon'); })()`));
    const scroll = await b.eval(`(() => { const p = document.querySelector('#page-content'); return { page: document.scrollingElement.scrollHeight - innerHeight, inner: p.scrollHeight - p.clientHeight }; })()`) as { page: number; inner: number };
    ok(`${tag}: the window doesn't scroll`, scroll.page <= 0, JSON.stringify(scroll));
    await b.screenshot(`${OUT}/dojo-layout-${w}x${h}.png`);
  }

  // ── My lobsters: a burner wallet with stubbed lobsters ──
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await b.goto(`${BASE}/dojo`);
  // The dev burner exists only in a build with NEXT_PUBLIC_DEV_BURNER=true; without it the wallet half can't run.
  if (!(await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 30000, 250))) {
    checks.push('skip My lobsters: no dev burner wallet in this build');
    console.log(checks.join('\n'));
    const fails = checks.filter((c) => c.startsWith('FAIL')).length;
    console.log(fails ? `[dojo-layout] ${fails} FAIL of ${checks.length}` : `[dojo-layout] all ${checks.length} ok (wallet half skipped)`);
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await b.eval(`(() => { const e = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet')); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
    if (r) await b.clickAt(r.x, r.y);
    if (await b.waitFor(`document.querySelector('[data-testid=dojo-identity]')?.getAttribute('data-kind') === 'wallet'`, 8000, 250)) break;
  }
  ok('wallet: opens on My lobsters', !!(await b.waitFor(`document.querySelector('[data-team-mode=owned]')?.getAttribute('aria-selected') === 'true'`, 20000, 250)));
  const slots = () => b.eval(`(() => Array.from(document.querySelectorAll('[data-owned-id]')).filter(t => t.getAttribute('aria-pressed') === 'true').map(t => [t.dataset.ownedId, t.querySelector('[data-slot-badge]').textContent]).sort((a, c) => a[1] - c[1]).map(x => x[0]).join(','))()`) as Promise<string>;
  ok('wallet: the saved team fills the lineup', (await b.waitFor(`document.querySelector('[data-saved-team]')?.value === '7'`, 10000, 250)) && (await slots()) === '101,102,103', await slots());
  ok('wallet: twelve lobsters on two pages', await b.eval(`document.querySelectorAll('[data-owned-id]').length === 12 && document.querySelector('.dojo-inventory-pager span').textContent.trim() === '1 / 2'`));
  const center = (sel: string) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as Promise<{ x: number; y: number }>;
  const mouse = (type: string, p: { x: number; y: number }) => b.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const drag = async (from: string, to: string, opts: { escape?: boolean } = {}) => {
    const a = await center(from), z = await center(to);
    await mouse('mousePressed', a);
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', { x: a.x + ((z.x - a.x) * i) / 8, y: a.y + ((z.y - a.y) * i) / 8 }); await b.sleep(30); }
    if (opts.escape) {
      const ghost = await b.eval(`!!document.querySelector('[data-drag-preview]') && !!document.querySelector('[data-drag-follower]')`);
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      ok('drag: shows the ghost and the follower', ghost);
    }
    await mouse('mouseReleased', z);
    await b.sleep(300);
  };
  await b.eval(`document.querySelector('[data-owned-id="101"]').click()`); await b.sleep(200);
  ok('click: a picked lobster leaves and the rest close ranks', (await slots()) === '102,103', await slots());
  ok('click: the saved team clears once edited', await b.eval(`document.querySelector('[data-saved-team]').value === ''`));
  await b.eval(`document.querySelector('[data-owned-id="105"]').click()`); await b.sleep(200);
  ok('click: a new lobster takes the free slot', (await slots()) === '102,103,105', await slots());
  await b.eval(`document.querySelector('[data-owned-id="106"]').click()`); await b.sleep(200);
  ok('click: a full team says so', await b.eval(`document.querySelector('.dojo-selection-feedback').textContent.includes('Team full')`));
  await drag('[data-owned-id="104"]', '[data-fighter="team"][data-slot="1"]');
  ok('drag: a tile onto a slot replaces it', (await slots()) === '102,104,105', await slots());
  await drag('[data-fighter="team"][data-slot="0"]', '[data-fighter="team"][data-slot="2"]');
  ok('drag: lineup to lineup swaps, no duplicate', (await slots()) === '105,104,102', await slots());
  await drag('[data-owned-id="107"]', '[data-fighter="team"][data-slot="0"]', { escape: true });
  ok('drag: Escape cancels', (await slots()) === '105,104,102' && !(await b.eval(`!!document.querySelector('[data-drag-follower], [data-drag-preview]')`)), await slots());
  await drag('[data-fighter="team"][data-slot="1"]', '[data-owned-inventory]');
  ok('drag: lineup onto the tiles removes', (await slots()) === '105,102', await slots());
  ok('Battle is off with two lobsters', await b.eval(`document.querySelector('[data-testid=dojo-battle]').disabled`));
  await b.eval(`document.querySelector('[data-owned-id="108"]').click()`); await b.sleep(200);
  await b.screenshot(`${OUT}/dojo-layout-owned.png`);
  ok('Battle is on with three', await b.eval(`!document.querySelector('[data-testid=dojo-battle]').disabled`));
  const bp = await center('[data-testid=dojo-battle]');
  await b.clickAt(bp.x, bp.y);
  // A burner session may need a signature first: the gate, then Enter Training.
  if (await b.waitFor(`!!document.querySelector('[data-testid=dojo-gate]')`, 3000, 200)) {
    await b.eval(`Array.from(document.querySelectorAll('[data-testid=dojo-gate] button')).find(x => x.textContent.includes('Sign in'))?.click()`);
    await b.waitFor(`(document.querySelector('[data-testid=dojo-gate]')?.textContent || '').includes('Enter Training')`, 20000, 250);
    await b.eval(`Array.from(document.querySelectorAll('[data-testid=dojo-gate] button')).find(x => x.textContent.includes('Enter Training'))?.click()`);
  }
  await b.waitFor(`window.__practiceBodies.length > 0`, 20000, 250);
  const body = await b.eval(`window.__practiceBodies[0]`) as { lobsterIds?: string[]; teamId?: string; preset?: string; purity?: number } | undefined;
  ok('Battle sends the three lobster ids, no preset or purity', JSON.stringify(body?.lobsterIds) === '["105","102","108"]' && !body?.preset && body?.purity === undefined, JSON.stringify(body));
  // A dev stack has no lobsters on chain: the start fails, and the failure shows under the button.
  const failed = await b.waitFor(`location.pathname === '/dojo' && !!document.querySelector('.dojo-status [data-tone=error]')`, 30000, 250);
  ok('a failed start shows in the status line and stays on the Dojo', !!failed, String(await b.eval(`document.querySelector('.dojo-status')?.innerText`)));
  await b.eval(`document.exitFullscreen?.().catch(() => {})`);

  console.log(checks.join('\n'));
  const fails = checks.filter((c) => c.startsWith('FAIL')).length;
  console.log(fails ? `[dojo-layout] ${fails} FAIL of ${checks.length}` : `[dojo-layout] all ${checks.length} ok`);
}
