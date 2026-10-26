import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim() === ${JSON.stringify(text)} || (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}

/**
 * The guest Dojo: no burner, no wallet. /dojo opens as a guest, Battle mints a guest session on the click and
 * starts a practice battle, and the battle page plays it ("Your turn"). Needs NO NEXT_PUBLIC_DEV_BURNER — the
 * burner button may be present (it is in the chrome), it is simply never clicked. forfeitIfLive cleans up.
 */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  // A NON-default team on purpose: the summary line only changes once React has hydrated and the deep-link
  // effect has run, so waiting for it is what proves the page is interactive before Battle is pressed.
  await b.goto(`${BASE}/dojo?team=mantis,sentinel,leviathan&tier=elite&purity=5&bot=charger`);
  expect(!!(await b.waitFor(`(document.querySelector('[data-testid=dojo-identity]')?.textContent || '').includes('guest')`, 90000, 250)), 'the Dojo opens as a guest, with no wallet gate');
  expect(!!(await b.waitFor(`document.body.innerText.includes('Mantis · Sentinel · Leviathan, Elite, purity 5')`, 30000, 250)), 'deep link fills the builder for a guest too (and the page is hydrated)');
  expect(!(await b.eval(`!!localStorage.getItem('clawbada.session.guest')`)), 'no guest session exists before the first action');
  await b.screenshot(`${S}/guest-dojo.png`);
  const identityState = () => b.eval(`(() => { const el = document.querySelector('[data-testid=dojo-identity]'); return el ? { kind: el.getAttribute('data-kind'), resolving: el.getAttribute('data-resolving'), wallet: el.getAttribute('data-wallet-status') } : null; })()`);
  // Timeline of the hook's state after hydration: when does wagmi settle, and is the page ever stuck?
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) { console.log(`[guest] t+${Date.now() - t0}ms identity: ${JSON.stringify(await identityState())}`); await b.sleep(500); }
  await rectClick(b, '[data-testid=dojo-battle]');
  const opened = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  expect(!!opened, 'Battle mints a guest session and opens a practice battle');
  if (!opened) {
    console.log(`[guest] still on ${await b.eval('location.pathname')}; identity: ${JSON.stringify(await identityState())}`);
    console.log(`[guest] page tail: ${JSON.stringify(await b.eval(`document.body.innerText.slice(-400)`))}`);
    console.log(`[guest] battle button: ${JSON.stringify(await b.eval(`(() => { const x = document.querySelector('[data-testid=dojo-battle]'); return x ? { label: x.getAttribute('aria-label'), disabled: x.disabled, status: document.querySelector('[data-testid=dojo-status]')?.innerText } : null; })()`))}`);
    for (const line of b.allLogs.filter((l) => /exception|error|\[auth\]|guest|practice|Wallet/i.test(l) && !/unity-build|favicon|async-storage/.test(l)).slice(-8)) console.log(`[guest] console: ${line.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  console.log(`[guest] battle: ${await b.eval('location.href')}`);
  expect(!!(await b.eval(`(() => { try { return JSON.parse(localStorage.getItem('clawbada.session.guest') || 'null')?.guest === true; } catch { return false; } })()`)), 'the guest session is stored for the battle page and reloads');
  // Participant proof on either stage: the React HUD (plain board) tags the guest's team "· you" / "(you)" and the action
  // panel says "Your turn"; Unity's status line says "Your turn" / "Bot thinking…". A spectator sees none of these.
  const participant = await b.waitFor(`['· you', '(you)', 'Your turn', 'Bot thinking'].some(s => document.body.innerText.includes(s))`, 90000, 500);
  expect(!!participant, 'the guest is a participant: the battle page gives it its team and its turn');
  if (!participant) console.log(`[guest] page text: ${JSON.stringify(await b.eval(`document.body.innerText.slice(0, 600)`))}`);
  await b.sleep(3000);
  await b.screenshot(`${S}/guest-battle.png`);
  console.log(fails.length ? `[guest] ${fails.length} FAIL` : '[guest] all ok');
}
