/**
 * Market probe — Nzib's Marketplace on the real listings (design/website ee1219f, landed 2026-10-16).
 *
 * Run: cd scripts/harness && bash chrome-restart.sh && BASE=http://127.0.0.1:3010 bun cdp.ts market-probe.ts
 * (the dev stack from the scratchpad probe-stack script; seed a listing with SEED=1 … see the PR notes).
 *
 * Checks: the page has no header and starts with his shopkeeper band; the wooden catalogue and the filter
 * panel paint (nine-slice canvases ready); the grid resolves to 1–4 columns at 1600 and 1 at 760 wide; the
 * filters drive the listings request (class → class=, tier → tier=, legend → legend=true, sort → sort=,
 * limit=9, offset=0); Reset clears them; the Eggs view is the dormant empty copy; fonts are Big Shot on the
 * controls and Upheaval on the headings and buttons; no horizontal overflow; with the burner connected the
 * "List a lobster" entry opens the dialog. With a seeded listing (SEED=1): a 444 px card with the id ribbon,
 * tier symbol, class badge, purity, breed count, a sprite, the price button and Details → the detail view
 * with the Lineage tab.
 */
import type { Browser } from './cdp';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3010';
const TAG = process.env.TAG ?? 'market';
const SEEDED = process.env.SEED === '1';
const S = `${import.meta.dir}/out`;

async function rect(b: Browser, selector: string, text?: string) {
  return b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, w: q.width, h: q.height }; })()`);
}
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await rect(b, selector, text);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
const shot = async (b: Browser, name: string) => { await b.screenshot(`${S}/${TAG}-${name}.png`); };
const listingRequests = (b: Browser) => b.allLogs.filter((l) => /\[net\].*\/api\/game\/market\/listings\?/.test(l)).map((l) => l.replace(/^.*\/api\/game\/market\/listings\?/, '').split(/\s/)[0]);

export default async function (b: Browser) {
  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[market-fail] ${msg}`); };
  await b.send('Network.clearBrowserCache', {});
  await b.goto(`${BASE}/market`);

  // 1. Structure: no page header, the shopkeeper band first, the wooden catalogue painted.
  const painted = await b.waitFor(`(() => { const c = document.querySelector('.market-catalog'); const f = document.querySelector('.market-filters'); return !!c && c.dataset.pixelReady === 'true' && !!f && f.dataset.pixelReady === 'true'; })()`, 20000, 100);
  if (!painted) fail('the catalogue / filter wooden panels never painted');
  const structure = await b.eval(`(() => { const page = document.querySelector('.market-page'); const first = page?.querySelector('.market > *'); return { page: !!page, firstIsHero: first?.classList.contains('market-hero') ?? false, h1: !!document.querySelector('.market-page h1'), bg: page ? getComputedStyle(page).backgroundColor : null, filtersH2: document.querySelector('.market-filters h2')?.textContent, classChoices: document.querySelectorAll('.market-class-choice').length, legend: !!document.querySelector('.market-legend-choice input'), rarity: !!document.querySelector('select[name=rarity]'), bid: !!document.querySelector('[data-pixel-panel="marketBidButton"]:not(.market-details-button)'), overflow: document.documentElement.scrollWidth <= innerWidth + 1 }; })()`);
  if (!structure.page || !structure.firstIsHero) fail(`page structure ${JSON.stringify(structure)}`);
  if (structure.h1) fail('the market has a page header (his design has none)');
  if (structure.bg !== 'rgb(25, 44, 83)') fail(`page colour ${structure.bg}, expected his #192c53`);
  if (structure.filtersH2 !== 'Filters' || structure.classChoices !== 11) fail(`filter panel ${JSON.stringify(structure)}`);
  if (!structure.legend || structure.rarity || structure.bid) fail(`decisions not applied (legend toggle / no rarity / no bid): ${JSON.stringify(structure)}`);
  if (!structure.overflow) fail('horizontal overflow at 1600');
  const cols = await b.eval(`getComputedStyle(document.querySelector('.market-grid')).gridTemplateColumns.split(' ').length`);
  if (cols < 1 || cols > 4) fail(`grid columns ${cols}`);
  console.log('[market-log]', `structure ok · ${cols} columns at 1600 · ${structure.classChoices} class choices`);

  // 2. Typography: Big Shot on the controls and copy, Upheaval on headings and buttons.
  const fonts = await b.eval(`JSON.stringify({ select: getComputedStyle(document.querySelector('.market-filters select')).fontFamily, h2: getComputedStyle(document.querySelector('.market-filters h2')).fontFamily, h2size: getComputedStyle(document.querySelector('.market-filters h2')).fontSize, button: getComputedStyle(document.querySelector('.market-filters .pixel-button')).fontFamily, body: getComputedStyle(document.querySelector('.market-page')).fontFamily })`);
  const f = JSON.parse(fonts);
  if (!/Big Shot/.test(f.select) || !/Big Shot/.test(f.body)) fail(`body font ${fonts}`);
  if (!/Upheaval/.test(f.h2) || !/Upheaval/.test(f.button) || f.h2size !== '40px') fail(`display font ${fonts}`);

  // 3. Filters drive the listings query; Reset clears it.
  await rectClick(b, '.market-class-choice', 'Tempest');
  await b.sleep(400);
  await b.eval(`(() => { const s = document.querySelector('select[name=tier]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, '2'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await b.sleep(300);
  await rectClick(b, '.market-legend-choice');
  await b.sleep(300);
  await b.eval(`(() => { const s = document.querySelector('select[name=sort]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, 'price_asc'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const queried = await b.waitFor(`true`, 800, 100);
  void queried;
  const reqs = listingRequests(b);
  const last = reqs[reqs.length - 1] ?? '';
  for (const part of ['class=3', 'tier=2', 'legend=true', 'sort=price_asc', 'limit=9', 'offset=0']) {
    if (!last.includes(part)) fail(`listings query missing ${part}: ${last}`);
  }
  console.log('[market-log]', `query ${last}`);
  await rectClick(b, '.market-filters .pixel-button', 'Reset filters');
  await b.sleep(500);
  const afterReset = await b.eval(`JSON.stringify({ klass: document.querySelector('input[name=klass][value=""]').checked, tier: document.querySelector('select[name=tier]').value, legend: document.querySelector('.market-legend-choice input').checked, sort: document.querySelector('select[name=sort]').value })`);
  if (afterReset !== '{"klass":true,"tier":"","legend":false,"sort":"recent"}') fail(`reset left ${afterReset}`);
  const resetReq = listingRequests(b).pop() ?? '';
  if (/class=|tier=|legend=/.test(resetReq)) fail(`reset query still filtered: ${resetReq}`);

  // 4. Eggs: the dormant empty view, no request.
  const before = listingRequests(b).length;
  await b.eval(`(() => { const s = document.querySelector('select[name=type]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, 'egg'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await b.sleep(500);
  const eggCopy = await b.eval(`document.querySelector('[data-market-empty]')?.textContent ?? ''`);
  if (!/No eggs listed yet/.test(eggCopy)) fail(`eggs view: "${eggCopy}"`);
  if (listingRequests(b).length !== before) fail('the Eggs view made a listings request');
  await shot(b, 'eggs');
  await b.eval(`(() => { const s = document.querySelector('select[name=type]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, 'all'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await b.sleep(600);
  await b.eval(`window.scrollTo(0, 0)`);
  await b.sleep(200);
  await shot(b, 'catalogue');

  // 5. A seeded listing: his card, then Details → the detail view with the Lineage tab.
  if (SEEDED) {
    const card = await b.waitFor(`(() => { const c = document.querySelector('.market-card'); return !!c && c.dataset.pixelReady === 'true'; })()`, 15000, 100);
    if (!card) fail('no painted market card for the seeded listing');
    const geometry = await b.eval(`(() => { const c = document.querySelector('.market-card'); const r = c.getBoundingClientRect(); const buy = c.querySelector('.market-buy'); const det = c.querySelector('.market-details-button'); const b1 = buy.getBoundingClientRect(), b2 = det.getBoundingClientRect(); return { h: Math.round(r.height), id: c.querySelector('.market-id')?.textContent, tier: c.querySelector('.market-tier-symbol')?.getAttribute('aria-label'), klass: c.querySelector('.market-class-badge')?.getAttribute('aria-label'), purity: c.querySelector('.market-purity-stars')?.getAttribute('aria-label'), breed: c.querySelector('.market-breed dd')?.textContent, art: !!c.querySelector('.market-lobster-art img, .market-lobster-art .sprite-animate, .market-lobster-art [data-pixel-sprite]'), price: buy.querySelector('.market-buy-price')?.textContent, sideBySide: Math.abs(b1.top - b2.top) < 2 && b1.right <= b2.left + 2, buyPainted: buy.dataset.pixelReady === 'true' }; })()`);
    if (Math.abs(geometry.h - 444) > 2) fail(`card height ${geometry.h}`);
    if (!geometry.art || !geometry.sideBySide || !geometry.buyPainted) fail(`card parts ${JSON.stringify(geometry)}`);
    console.log('[market-log]', `card ${JSON.stringify(geometry)}`);
    await b.eval(`document.querySelector('.market-card')?.scrollIntoView({ block: 'center' })`);
    await b.sleep(300);
    await shot(b, 'card');
    await rectClick(b, '.market-details-button');
    const detail = await b.waitFor(`!!document.querySelector('button') && /Lineage/.test(document.body.innerText) && /Full Details/.test(document.body.innerText)`, 5000, 100);
    if (!detail) fail('Details did not open the detail view with a Lineage tab');
    await rectClick(b, 'button', 'Lineage');
    // innerText carries the CSS text-transform, so the heading reads PARENTS: match without case.
    const lineage = await b.waitFor(`/Faucet-born|Parents|Lineage unavailable/i.test(document.body.innerText)`, 8000, 100);
    if (!lineage) fail('the Lineage tab rendered nothing');
    await shot(b, 'lineage');
    await b.eval(`document.querySelector('.fixed.inset-0')?.click()`);
  }

  // 6. The burner connects → the selling entry point (his pixel button) opens the List dialog.
  const burner = await rect(b, 'button', 'burner wallet');
  if (burner) {
    await b.clickAt(burner.x, burner.y);
    const listBtn = await b.waitFor(`!!Array.from(document.querySelectorAll('.market-toolbar .pixel-button')).find(e => /List a lobster/.test(e.textContent))`, 15000, 200);
    if (!listBtn) fail('"List a lobster" did not appear after connecting');
    else {
      await rectClick(b, '.market-toolbar .pixel-button', 'List a lobster');
      const dialog = await b.waitFor(`/List a Lobster for Sale/i.test(document.body.innerText)`, 4000, 100);
      if (!dialog) fail('the List dialog did not open');
      await shot(b, 'list-dialog');
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
  } else console.log('[market-log]', 'no burner on this stack — skipping the List dialog check');

  // 7. Narrow: the filters stack above the grid and nothing overflows.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.sleep(800);
  const narrow = await b.eval(`JSON.stringify({ cols: getComputedStyle(document.querySelector('.market-grid')).gridTemplateColumns.split(' ').length, layoutCols: getComputedStyle(document.querySelector('.market-layout')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth <= innerWidth + 1 })`);
  const n = JSON.parse(narrow);
  if (n.cols !== 1 || !n.overflow) fail(`narrow ${narrow}`);
  await shot(b, 'narrow');
  await b.send('Emulation.clearDeviceMetricsOverride', {});

  const errors = b.allLogs.filter((l) => /^\[(error|exception)\]/.test(l) && !/Family|Aave|WalletConnect|favicon|Failed to load resource/.test(l));
  if (errors.length) fail(`${errors.length} page errors: ${errors[0].slice(0, 160)}`);
  console.log(`[market] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/${TAG}-{catalogue,eggs,card,lineage,list-dialog,narrow}.png`);
  if (!ok) process.exitCode = 1;
}
