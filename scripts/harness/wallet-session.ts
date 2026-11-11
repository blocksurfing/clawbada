import type { Browser } from './cdp';

async function clickButton(b: Browser, text: string) {
  const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent || '').includes(${JSON.stringify(text)})); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no button "${text}"`);
  await b.clickAt(r.x, r.y);
}
const walletSessions = `Object.keys(localStorage).filter(k => /^clawbada\\.session\\.0x/i.test(k)).length`;

/**
 * A connected wallet and its session (needs the dev burner: NEXT_PUBLIC_DEV_BURNER=true — a local stack only).
 * The burner does not reconnect after a page load, so every move between pages here is an in-app navigation
 * (`window.next.router`) — the state a real wallet is in after it reconnects by itself.
 *   1. A battle link opened by a wallet with no session shows "Sign in to rejoin" and asks for nothing by itself
 *      (the burner signs without a prompt, so a request made on page load would show up as a stored session).
 *   2. The button signs in.
 *   3. Disconnecting the wallet — here through wagmi's disconnect, the event every disconnect raises — removes the
 *      stored session.
 */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`${BASE}/dojo`);
  if (!(await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 120000))) {
    console.log('FAIL no dev burner button — start the web with NEXT_PUBLIC_DEV_BURNER=true');
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await clickButton(b, 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  expect(!!(await b.eval(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`)), 'the burner wallet is connected');
  expect((await b.eval(walletSessions)) === 0, 'connecting alone creates no session');

  // 1. a battle link, wallet connected, no session
  await b.eval(`window.next.router.push('/battle/p_00000000-0000-4000-8000-000000000000')`);
  expect(!!(await b.waitFor(`!!document.querySelector('[data-testid=battle-sign-in-button]')`, 120000, 250)), 'a battle link shows "Sign in to rejoin" to a wallet with no session');
  await b.sleep(6000);
  expect((await b.eval(walletSessions)) === 0, 'and asks the wallet for nothing by itself (no session appeared in 6 s)');
  expect(!(await b.eval(`!!document.querySelector('[data-testid=battle-windowed-bar]') || /Connecting/.test(document.body.innerText)`)), 'the battle view is not mounted behind the button');

  // 2. the button signs in
  const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=battle-sign-in-button]').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  await b.clickAt(r.x, r.y);
  expect(!!(await b.waitFor(walletSessions + ' === 1', 30000, 250)), 'pressing it signs in (a session is stored)');
  expect(!!(await b.waitFor(`!document.querySelector('[data-testid=battle-sign-in]')`, 15000, 250)), 'and the button gives way to the battle view');

  // 3. disconnecting removes the session
  await b.eval(`window.next.router.push('/dojo')`);
  await b.waitFor(`location.pathname === '/dojo' && !!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 60000);
  expect((await b.eval(walletSessions)) === 1, 'the session is kept while the wallet stays connected');
  await clickButton(b, 'burner ✓');
  expect(!!(await b.waitFor(walletSessions + ' === 0', 15000, 250)), 'disconnecting the wallet removes its stored session');
  console.log(fails.length ? `[wallet-session] ${fails.length} FAIL` : '[wallet-session] all ok');
}
