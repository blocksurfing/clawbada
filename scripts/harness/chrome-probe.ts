import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const TAG = process.env.TAG ?? 'chrome';
/** Web origin under test (a worktree's dev server can run on another port). */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const API = process.env.API ?? 'http://127.0.0.1:3011';
const NAME = process.env.NAME ?? `Probe ${Math.floor(Math.random() * 900 + 100)}`;

async function rect(b: Browser, selector: string, text?: string) {
  return b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, w: q.width, h: q.height }; })()`);
}
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await rect(b, selector, text);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
async function hover(b: Browser, selector: string) {
  const r = await rect(b, selector);
  if (!r) throw new Error(`no element ${selector}`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, '').split('\n')[0]);
const shot = async (b: Browser, name: string) => { await b.screenshot(`${S}/${TAG}-${name}.png`); };
/** Any painted pixel on the ribbon canvas of a menu item. */
const ribbonPainted = (label: string) => `(() => { const c = document.querySelector('canvas.active-ribbon[data-ribbon=${JSON.stringify(label)}]'); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; return false; })()`;
const labelText = `(document.querySelector('.connect-wallet')?.textContent || '').trim()`;

/** Nzib's chrome (PR 2026-10-08): the rolling pixel sidebar, the wallet/profile panel and the music toggle on
 *  /game at desktop width. Checks, in order: the startup roll opens the banner (canvas step == total, body no
 *  longer compact) and the plank opens with the wheel at 0°; twelve menu items + the separator; Mining → the
 *  route changes and its ribbon is painted while Dashboard's clears; the pole closes (step 0, compact) and the
 *  logo reopens; the avatar closes the plank (amount 0, wheel 360°) with clicks locked mid-motion, and reopens;
 *  the dev burner connects → the label is the short address; the label opens the two profile actions, hover
 *  expands Profile; Profile → the dialog saves a name through PATCH /api/agent/profile (shown in the label and
 *  returned by GET /api/agent/profile); the music toggle flips the stored preference; Disconnect → Connect Wallet.
 *  Frames `out/chrome-*.png`. Fails on any step and on runtime errors (the mainnet RPC CORS noise excluded). */
export default async function (b: Browser) {
  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[chrome-fail] ${msg}`); };
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.send('Network.clearBrowserCache', {});
  await b.goto(`${BASE}/game`);

  // 1. Startup: compact → open; the plank opens with the wheel back at 0°.
  const opened = await b.waitFor(`(() => { const c = document.querySelector('#panel'); return !!c && c.dataset.step && c.dataset.step === c.dataset.total && !document.body.classList.contains('sidebar-compact'); })()`, 20000, 100);
  if (!opened) fail('the sidebar did not open on load (canvas step != total, or the body stayed compact)');
  const plank = await b.waitFor(`(() => { const a = document.querySelector('#user-section-art'); const w = document.querySelector('#user-avatar-frame'); return !!a && a.dataset.amount === '1' && !!w && Number(w.dataset.degrees) === 0; })()`, 10000, 100);
  if (!plank) fail('the wallet plank did not open on load (amount != 1 or wheel != 0°)');
  const idleLabel = await b.waitFor(`${labelText} === 'Connect Wallet'`, 4000, 100);
  if (!idleLabel) fail(`label at load is "${await b.eval(labelText)}" (loader?), expected Connect Wallet`);
  const items = await b.eval(`document.querySelectorAll('#menu-list .menu-item').length`);
  if (items !== 12) fail(`${items} menu items, expected 12`);
  const sepW = await b.eval(`(document.querySelector('.menu-separator canvas')?.width) || 0`);
  if (sepW < 48) fail(`separator canvas width ${sepW} — not painted`);
  const current = await b.eval(`document.querySelector('.menu-item[aria-current="page"]')?.dataset.menu`);
  if (current !== 'dashboard') fail(`initial selection is ${current}, expected dashboard`);
  await b.sleep(300);
  await shot(b, 'open');
  console.log('[chrome-log]', `open: step=${await b.eval(`document.querySelector('#panel').dataset.step`)}/${await b.eval(`document.querySelector('#panel').dataset.total`)} rows=${await b.eval(`document.querySelector('#panel').height / 16`)} plank=${await b.eval(`document.querySelector('#user-section-art').dataset.amount`)} label=${await b.eval(labelText)}`);

  // 2. Menu selection follows the route; the ribbon moves (retract, then extend).
  await rectClick(b, '.menu-item[data-menu="mining"]');
  const routed = await b.waitFor(`location.pathname === '/game/mining'`, 10000, 100);
  if (!routed) fail('clicking Mining did not navigate to /game/mining');
  // Retract (250 ms) then extend (250 ms), on rAF — a page still hydrating in dev can stretch that, so wait for it.
  await b.waitFor(`${ribbonPainted('Mining')} === true && ${ribbonPainted('Dashboard')} === false`, 4000, 100);
  const miningRibbon = await b.eval(ribbonPainted('Mining'));
  const dashRibbon = await b.eval(ribbonPainted('Dashboard'));
  const cur2 = await b.eval(`document.querySelector('.menu-item[aria-current="page"]')?.dataset.menu`);
  if (miningRibbon !== true) fail(`Mining ribbon not painted after navigation (${miningRibbon})`);
  if (dashRibbon !== false) fail(`Dashboard ribbon still painted after navigation (${dashRibbon})`);
  if (cur2 !== 'mining') fail(`aria-current is ${cur2} after navigation, expected mining`);
  await shot(b, 'mining');

  // 3. Pole closes (roll up, then slide compact); the logo reopens.
  await rectClick(b, '#toggle');
  const closed = await b.waitFor(`document.body.classList.contains('sidebar-compact') && document.querySelector('#panel').dataset.step === '0'`, 5000, 50);
  if (!closed) fail('the pole did not roll the sidebar up into the compact state');
  await b.sleep(400);
  await shot(b, 'compact');
  await rectClick(b, '.brand-trigger');
  const reopened = await b.waitFor(`(() => { const c = document.querySelector('#panel'); return c.dataset.step === c.dataset.total && !document.body.classList.contains('sidebar-compact') && !document.querySelector('#toggle').disabled; })()`, 6000, 50);
  if (!reopened) fail('the logo did not reopen the sidebar');

  // 4. Avatar: retract + spin, locked while moving; click again to expand.
  await rectClick(b, '.user-avatar-slot');
  await b.sleep(60);
  const locked = await b.eval(`document.querySelector('.user-avatar-slot').disabled`);
  if (locked !== true) fail('the avatar was not locked during its animation');
  const plankClosed = await b.waitFor(`(() => { const a = document.querySelector('#user-section-art'); const w = document.querySelector('#user-avatar-frame'); return a.dataset.amount === '0' && Number(w.dataset.degrees) === 360 && !document.querySelector('.user-avatar-slot').disabled; })()`, 3000, 30);
  if (!plankClosed) fail('the plank did not retract to 0 with the wheel at 360°');
  const hiddenLabel = await b.eval(`getComputedStyle(document.querySelector('.connect-wallet')).visibility`);
  if (hiddenLabel !== 'hidden') fail(`the label is ${hiddenLabel} with the plank retracted, expected hidden`);
  await shot(b, 'wallet-closed');
  await rectClick(b, '.user-avatar-slot');
  const plankOpen = await b.waitFor(`document.querySelector('#user-section-art').dataset.amount === '1' && Number(document.querySelector('#user-avatar-frame').dataset.degrees) === 0`, 3000, 30);
  if (!plankOpen) fail('the plank did not expand again');

  // 5. Connect (dev burner, no extension) → the short address.
  await b.sleep(300);
  await rectClick(b, 'button', 'burner wallet').catch(() => fail('no "burner wallet" chip (NEXT_PUBLIC_DEV_BURNER off?)'));
  const connected = await b.waitFor(`/^0x[0-9a-fA-F]{2,6}[.…]+[0-9a-fA-F]{4}$/.test(${labelText})`, 15000, 100);
  const label1 = await b.eval(labelText);
  if (!connected) fail(`label after connecting is "${label1}", expected a short address`);
  console.log('[chrome-log]', `connected: label=${label1}`);
  await shot(b, 'connected');

  // 6. The label opens the profile actions; hover expands Profile (width from the content, 3 px grid).
  await rectClick(b, '.connect-wallet');
  const menuShown = await b.waitFor(`(() => { const m = document.querySelector('#profile-menu'); return !!m && !m.hidden && getComputedStyle(m).display !== 'none'; })()`, 3000, 50);
  if (!menuShown) fail('the profile menu did not open');
  await b.sleep(250);
  const compactW = await b.eval(`document.querySelector('[data-profile-action="edit"]').getBoundingClientRect().width`);
  const chainOk = await b.eval(`getComputedStyle(document.querySelector('[data-profile-action="edit"]'), '::before').backgroundImage.includes('Button.png')`);
  if (!chainOk) fail('the profile buttons carry no chain');
  await shot(b, 'profile-menu');
  await hover(b, '[data-profile-action="edit"]');
  await b.sleep(350);
  const openW = await b.eval(`document.querySelector('[data-profile-action="edit"]').getBoundingClientRect().width`);
  if (!(openW > compactW + 20)) fail(`Profile did not expand on hover (${compactW} → ${openW})`);
  if (Math.round(openW) % 3 !== 0) fail(`Profile's open width ${openW} is not on the 3 px grid`);
  await shot(b, 'profile-hover');
  console.log('[chrome-log]', `profile actions: compact ${compactW}px → open ${openW}px`);

  // 7. Profile → save a display name through the API (the burner signs the login silently).
  await rectClick(b, '[data-profile-action="edit"]');
  const dialogOpen = await b.waitFor(`document.querySelector('#profile-editor')?.open === true`, 3000, 50);
  if (!dialogOpen) fail('the profile editor did not open');
  await b.eval(`(() => { const i = document.querySelector('#profile-name'); i.focus(); i.value = ''; })()`);
  await b.send('Input.insertText', { text: NAME });
  await rectClick(b, '#profile-editor button[type="submit"]');
  const named = await b.waitFor(`${labelText} === ${JSON.stringify(NAME)}`, 20000, 200);
  const label2 = await b.eval(labelText);
  if (!named) fail(`label after saving is "${label2}", expected "${NAME}" (${await b.eval(`document.querySelector('.profile-editor-error')?.textContent || 'no error shown'`)})`);
  const dialogClosed = await b.eval(`document.querySelector('#profile-editor')?.open === false`);
  if (!dialogClosed) fail('the profile editor stayed open after saving');
  const burnerAddress = await b.eval(`(() => { try { const s = JSON.parse(localStorage.getItem('wagmi.store') || '{}'); const c = s?.state?.connections?.value?.[0]?.[1]?.accounts?.[0]; return c || null; } catch { return null; } })()`);
  if (burnerAddress) {
    const fromApi = await b.eval(`(async () => { const r = await fetch('${API}/api/agent/profile/${burnerAddress}'); const j = await r.json(); return j.displayName; })()`);
    if (fromApi !== NAME) fail(`GET /api/agent/profile returned displayName "${fromApi}", expected "${NAME}"`);
    else console.log('[chrome-log]', `GET /api/agent/profile/${burnerAddress.slice(0, 8)}… → displayName "${fromApi}"`);
  } else fail('could not read the burner address from wagmi storage to verify the API');
  await b.sleep(300);
  await shot(b, 'named');

  // 8. Music toggle flips the stored preference and its pressed state (no pole, no sidebar change).
  const musicBefore = await b.eval(`localStorage.getItem('clawbada_music')`);
  const pressedBefore = await b.eval(`document.querySelector('.music-toggle').getAttribute('aria-pressed')`);
  const stepBefore = await b.eval(`document.querySelector('#panel').dataset.step`);
  await rectClick(b, '.music-toggle');
  await b.sleep(300);
  const musicAfter = await b.eval(`localStorage.getItem('clawbada_music')`);
  const pressedAfter = await b.eval(`document.querySelector('.music-toggle').getAttribute('aria-pressed')`);
  const stepAfter = await b.eval(`document.querySelector('#panel').dataset.step`);
  if (pressedAfter === pressedBefore) fail(`music toggle did not flip (aria-pressed ${pressedBefore} → ${pressedAfter})`);
  if (musicAfter === musicBefore) fail(`music preference did not change (${musicBefore} → ${musicAfter})`);
  if (stepAfter !== stepBefore) fail('the music toggle moved the sidebar');
  console.log('[chrome-log]', `music: pref ${musicBefore ?? 'unset'} → ${musicAfter}, pressed ${pressedBefore} → ${pressedAfter}`);
  await rectClick(b, '.music-toggle');   // leave it as found

  // 9. Disconnect → Connect Wallet.
  await rectClick(b, '.connect-wallet');
  await b.waitFor(`!document.querySelector('#profile-menu').hidden`, 3000, 50);
  await b.sleep(250);
  await rectClick(b, '[data-profile-action="disconnect"]');
  const disconnected = await b.waitFor(`${labelText} === 'Connect Wallet'`, 8000, 100);
  if (!disconnected) fail(`label after disconnecting is "${await b.eval(labelText)}", expected Connect Wallet`);
  const menuGone = await b.waitFor(`document.querySelector('#profile-menu').hidden === true`, 2000, 50);
  if (!menuGone) fail('the profile menu stayed after disconnecting');
  await shot(b, 'disconnected');

  const errs = grab(b, /^\[(error|exception)\]|^\[log:error\]|Uncaught|Exception/).filter((l) => !/eth\.merkle\.io|CORS|Failed to load resource|hydrat|Aave|Family/i.test(l));
  if (errs.length) fail(`${errs.length} runtime errors`);
  for (const e of errs.slice(0, 6)) console.log('[chrome-err]', e.slice(0, 220));
  console.log(`[chrome] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/${TAG}-{open,mining,compact,wallet-closed,connected,profile-menu,profile-hover,named,disconnected}.png`);
}
