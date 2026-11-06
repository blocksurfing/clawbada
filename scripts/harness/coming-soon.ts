/**
 * The Coming Soon gate (owner 2026-11-06: everything but the Dojo; Nzib's page, design/website e35532b).
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts coming-soon.ts
 * At the owner's MacBook (1440×756 @2) and a phone (400×800 @2):
 *   · gated pages (/, /game, /game/mining, /market, /agents, /faucet, /leaderboard) show Coming Soon, the address kept;
 *   · the gold ENTER DOJO button is drawn and shines (?shine=paused freezes the sweep), the lobsters' art animates;
 *   · X is a link; Discord never navigates and says "Currently invite only"; no Docs icon;
 *   · ENTER DOJO opens the Dojo; its sidebar keeps every page (owner 2026-11-06) and a gated one (Mining) opens
 *     Coming Soon at its own address;
 *   · open pages stay themselves: the friend-invite page and the docs book (/book/index.html).
 * Screenshots: out/coming-soon-desktop.png, -phone.png, -discord.png.
 */
import type { Browser } from './cdp';

const GATED = ['/', '/game', '/game/mining', '/market', '/agents', '/faucet', '/leaderboard'];

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
  const OUT = `${import.meta.dir}/out`;
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  const isComingSoon = `!!document.querySelector('main.coming-soon') && /COMING SOON/.test(document.querySelector('#coming-soon-title')?.textContent || '')`;

  for (const [label, w, h] of [['desktop', 1440, 756], ['phone', 400, 800]] as const) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: label === 'phone' });
    for (const path of GATED) {
      await b.goto(`${BASE}${path}`);
      const shown = await b.waitFor(isComingSoon, 20000, 200);
      const where = await b.eval('location.pathname') as string;
      ok(shown && where === path, `${label} ${path}: Coming Soon, address kept (${where})`);
    }
    // The page itself (on the last gated path).
    await b.goto(`${BASE}/market?shine=paused`);
    await b.waitFor(`document.querySelector('[data-testid=enter-dojo]')?.dataset.pixelReady === 'true'`, 15000, 200);
    await b.sleep(600);
    const page = await b.eval(`(() => {
      const btn = document.querySelector('[data-testid=enter-dojo]');
      const shine = btn?.querySelector('.pixel-button-shine');
      let lit = 0; try { const d = shine.getContext('2d').getImageData(0, 0, shine.width, shine.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++; } catch (e) { lit = -1; }
      const art = document.querySelector('.construction-art'); const cs = art && getComputedStyle(art);
      const r = btn.getBoundingClientRect();
      return { title: document.title, ready: btn?.dataset.pixelReady, lit, artBg: cs?.backgroundImage || '', artAnim: cs?.animationName || '', artW: Math.round(art?.getBoundingClientRect().width || 0),
        x: !!document.querySelector('.coming-soon a[href="https://x.com/clawbada"]'), discord: !!document.querySelector('[data-testid=discord]'),
        docs: !!document.querySelector('.coming-soon a[href*="docs"]'), overflow: document.documentElement.scrollWidth - window.innerWidth,
        btn: { w: Math.round(r.width), h: Math.round(r.height), inView: r.bottom <= window.innerHeight && r.top >= 0 } };
    })()`) as { title: string; ready: string; lit: number; artBg: string; artAnim: string; artW: number; x: boolean; discord: boolean; docs: boolean; overflow: number; btn: { w: number; h: number; inView: boolean } };
    ok(page.title === 'Clawbada · Coming Soon', `${label}: title "${page.title}"`);
    ok(page.ready === 'true' && page.lit > 50, `${label}: gold button drawn and shining (${page.lit} lit px; button ${page.btn.w}×${page.btn.h})`);
    ok(/Under_Construction\.png/.test(page.artBg) && page.artAnim === 'construction-work' && page.artW > 100, `${label}: lobsters' art animates (${page.artW} px wide)`);
    ok(page.x && page.discord && !page.docs, `${label}: X + Discord, no Docs icon`);
    ok(page.overflow <= 0 && page.btn.inView, `${label}: fits the window (overflow ${page.overflow}px, button in view)`);
    await b.screenshot(`${OUT}/coming-soon-${label}.png`);
    // Discord: a press says it is invite-only and goes nowhere.
    const d = await b.eval(`(() => { const q = document.querySelector('[data-testid=discord]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    await b.clickAt(d.x, d.y);
    await b.sleep(400);
    const note = await b.eval(`(() => { const n = document.querySelector('#discord-invite-note'); return { text: n?.textContent?.trim(), opacity: n ? getComputedStyle(n).opacity : '0', path: location.pathname }; })()`) as { text: string; opacity: string; path: string };
    ok(note.text === 'Currently invite only' && Number(note.opacity) > 0.9 && note.path === '/market', `${label}: Discord shows "${note.text}" (opacity ${note.opacity}), stays on the page`);
    if (label === 'desktop') await b.screenshot(`${OUT}/coming-soon-discord.png`);
  }

  // ENTER DOJO → the Dojo; its sidebar keeps every page, and a gated one opens Coming Soon.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 756, deviceScaleFactor: 2, mobile: false });
  await b.goto(`${BASE}/`);
  await b.waitFor(`document.querySelector('[data-testid=enter-dojo]')?.dataset.pixelReady === 'true'`, 15000, 200);
  const e = await b.eval(`(() => { const q = document.querySelector('[data-testid=enter-dojo]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
  await b.clickAt(e.x, e.y);
  ok(await b.waitFor(`location.pathname === '/dojo' && !!document.querySelector('[data-testid=dojo-battle]')`, 30000, 200), 'ENTER DOJO opens the Dojo');
  const menu = await b.eval(`[...document.querySelectorAll('.pixel-chrome .menu-item .menu-label')].map((e) => e.textContent.trim())`) as string[];
  ok(menu.length >= 10 && menu.includes('Mining') && menu.includes('Market') && menu.includes('Dojo'), `Dojo sidebar keeps every page (${menu.join(', ')})`);
  await b.sleep(2500);   // the sidebar's opening roll
  const mining = await b.eval(`(() => { const a = document.querySelector('.pixel-chrome a.menu-item[href="/game/mining"]'); if (!a) return null; const q = a.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number } | null;
  if (mining) await b.clickAt(mining.x, mining.y);
  const minedSoon = await b.waitFor(isComingSoon, 20000, 200);
  ok(!!mining && minedSoon && (await b.eval('location.pathname')) === '/game/mining', `clicking Mining in the sidebar opens Coming Soon at /game/mining (${await b.eval('location.pathname')})`);

  // Open pages stay themselves.
  await b.goto(`${BASE}/battle-friends/join`);
  await b.sleep(2500);
  ok(!(await b.eval(isComingSoon)), 'the friend-invite page is not gated');
  const book = await b.eval(`fetch('/book/index.html').then((r) => r.status + ' ' + (r.headers.get('content-type') || ''))`) as string;
  ok(/^200 text\/html/.test(book), `the docs book is served (${book})`);
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
