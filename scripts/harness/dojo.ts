import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim() === ${JSON.stringify(text)} || (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}

/** /dojo: deep link pre-fills the builder (and opens it), Battle starts a team_* practice battle with the chosen purity. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  if (process.env.ONLY) { const [w, h] = process.env.ONLY.split('x').map(Number); await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: Number(process.env.DPR ?? 1), mobile: false }); }
  await b.goto(`${BASE}/dojo?team=mantis,sentinel,leviathan&tier=elite&purity=5&bot=charger&opponent=random`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  expect(!!(await b.waitFor(`document.body.innerText.includes('Mantis · Sentinel · Leviathan, Elite, purity 5')`, 30000, 250)), 'deep link fills team, tier and purity');
  expect(!!(await b.waitFor(`document.body.innerText.includes('150% as hard') && document.body.innerText.includes('30% of the time')`, 2000, 250)), 'purity explainer shows 1+0.1p and 5+5p');
  expect(!!(await b.waitFor(`(document.querySelector('[data-testid=dojo-bot-info]')?.textContent || '').includes('Defends to bank charge')`, 3000, 250)), 'deep-linked bot shows how it plays and its lesson');
  expect(!!(await b.waitFor(`(document.querySelector('[data-testid=dojo-bot]')?.selectedOptions?.[0]?.textContent || '').includes('Charger · Easy')`, 3000, 250)), 'bot picker shows name and difficulty');
  await b.screenshot(`${S}/dojo-builder.png`);
  // Change purity by clicking the 6 chip, then train.
  await rectClick(b, '[data-testid=dojo-purity] button', '6');
  expect(!!(await b.waitFor(`document.body.innerText.includes('Elite, purity 6')`, 3000, 250)), 'purity chip updates the summary');
  await rectClick(b, '[data-testid=dojo-battle]');
  // A burner whose session needs a signature gets the sign-in gate first (nothing goes fullscreen before it signs).
  if (await b.waitFor(`!!document.querySelector('[data-testid=dojo-gate]')`, 3000, 200)) {
    expect(await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-gate] button').getBoundingClientRect(); return q.bottom <= innerHeight && q.top >= 0; })()`), 'the gate button is on screen');
    await rectClick(b, '[data-testid=dojo-gate] button', 'Sign in');
    expect(!!(await b.waitFor(`(document.querySelector('[data-testid=dojo-gate]')?.textContent || '').includes('Enter Training')`, 20000, 250)), 'the gate signs in, then offers Enter Training');
    await rectClick(b, '[data-testid=dojo-gate] button', 'Enter Training');
  }
  const opened = !!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000));
  expect(opened, 'Battle opens a practice battle');
  console.log(`[dojo] battle: ${await b.eval('location.href')}`);
  await b.sleep(4000);
  await b.screenshot(`${S}/dojo-battle.png`);
  console.log(fails.length ? `[dojo] ${fails.length} FAIL` : '[dojo] all ok');
}
