import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim() === ${JSON.stringify(text)} || (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}

/** /dojo: deep link pre-fills the builder, Train starts a team_* practice battle with the chosen purity. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.goto('http://127.0.0.1:3000/dojo?team=mantis,sentinel,leviathan&tier=elite&purity=5&bot=charger&opponent=random');
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  expect(!!(await b.waitFor(`document.body.innerText.includes('Mantis · Sentinel · Leviathan, Elite, purity 5')`, 30000, 250)), 'deep link fills team, tier and purity');
  expect(!!(await b.waitFor(`document.body.innerText.includes('150% as hard') && document.body.innerText.includes('30% of the time')`, 2000, 250)), 'purity explainer shows 1+0.1p and 5+5p');
  expect(!!(await b.waitFor(`(document.querySelector('[data-testid=dojo-bot-info]')?.textContent || '').includes('Defends to bank charge')`, 3000, 250)), 'deep-linked bot shows how it plays and its lesson');
  expect(!!(await b.waitFor(`(document.querySelector('[data-testid=dojo-bot]')?.textContent || '').includes('Charger · Easy')`, 3000, 250)), 'bot picker shows name and difficulty');
  await b.screenshot(`${S}/dojo-builder.png`);
  // Change purity by clicking the 6 chip, then train.
  await rectClick(b, '[data-testid=dojo-purity] button', '6');
  expect(!!(await b.waitFor(`document.body.innerText.includes('Elite, purity 6')`, 3000, 250)), 'purity chip updates the summary');
  await rectClick(b, 'button', 'Train');
  expect(!!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000)), 'Train opens a practice battle');
  console.log(`[dojo] battle: ${await b.eval('location.href')}`);
  await b.sleep(4000);
  await b.screenshot(`${S}/dojo-battle.png`);
  console.log(fails.length ? `[dojo] ${fails.length} FAIL` : '[dojo] all ok');
}
