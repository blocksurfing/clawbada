import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'random_evolved';
const TAG = process.env.TAG ?? PRESET;
const FRAMES = Number(process.env.FRAMES ?? 3);
const GAP_MS = Number(process.env.GAP_MS ?? 600);
/** Web origin under test (a worktree's dev server can run on another port). */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
async function waitLogs(b: Browser, re: RegExp, count: number, timeoutMs: number): Promise<string[]> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hits = grab(b, re);
    if (hits.length >= count) return hits;
    await b.sleep(500);
  }
  return grab(b, re);
}
async function burst(b: Browser, name: string) {
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  for (let i = 1; i <= FRAMES; i++) {
    await b.screenshot(`${S}/bird-${TAG}-${name}-${i}.png`);
    if (i < FRAMES) await b.sleep(GAP_MS);
  }
}

/** The Evolved seagulls (Nzib's bird drop + BirdFlock, 2026-10-04): starts an Evolved practice battle,
 *  waits for the first flock's plan line, checks the designer's rules on it (balanced entry sides, one
 *  bird per rock), takes a frame burst once every bird has landed (`out/bird-<tag>-landed-N.png`) and
 *  another once they have all left (`…-gone-N.png`), and fails on any runtime exception. */
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`${BASE}/game/battle?preset=${PRESET}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[bird] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log(`[bird] ${TAG}: FAILED — HUD never bound`); return; }

  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[bird-fail] ${msg}`); };

  // The intro is ~16 s, the first flock 6–12 s after it, the crossing a few seconds more.
  const seedLine = (await waitLogs(b, /\[BirdFlock\] seed=/, 1, 60000))[0];
  if (!seedLine) fail('no "[BirdFlock] seed=" line — is the Birds child in ArenaArt_Evolved.prefab?');
  else console.log('[bird-log]', seedLine.slice(0, 200));
  const planLine = (await waitLogs(b, /\[BirdFlock\] flock 0:/, 1, 60000))[0];
  if (!planLine) { fail('no flock plan line within 60 s of the HUD binding'); }
  let n = 0;
  if (planLine) {
    console.log('[bird-log]', planLine.slice(0, 200));
    const m = /n=(\d+)((?: [RL]:[^@ ]+@[\d.]+)+) exit=([RL])/.exec(planLine);
    if (!m) fail(`plan line did not parse: ${planLine}`);
    else {
      n = Number(m[1]);
      const birds = m[2].trim().split(' ').map((s) => { const [side, rest] = s.split(':'); return { side, perch: rest.split('@')[0] }; });
      const right = birds.filter((x) => x.side === 'R').length, left = birds.length - right;
      if (birds.length !== n) fail(`plan lists ${birds.length} birds but n=${n}`);
      if (Math.abs(right - left) > 1) fail(`entry sides ${right}:${left} are not balanced`);
      if (n < 3) fail(`flock of ${n}; Nzib asked for 3–5`);
      if (new Set(birds.map((x) => x.perch)).size !== birds.length) fail('two birds share a rock');
      console.log(`[bird] flock of ${n}: ${right} from the right, ${left} from the left, exit ${m[3]}`);
    }
  }
  if (n > 0) {
    const landed = await waitLogs(b, /\[BirdFlock\] flock 0 bird \d+ landed /, n, 45000);
    if (landed.length < n) fail(`only ${landed.length}/${n} birds landed within 45 s`);
    for (const l of landed) console.log('[bird-log]', l.slice(0, 160));
    await burst(b, 'landed');
    // Dwell is 18–35 s, then the birds leave one by one (0.8–1.6 s apart) and fly out (~3 s).
    const gone = await waitLogs(b, /\[BirdFlock\] flock 0 bird \d+ departed /, n, 70000);
    if (gone.length < n) fail(`only ${gone.length}/${n} birds departed within 70 s of landing`);
    for (const l of gone) console.log('[bird-log]', l.slice(0, 160));
    await burst(b, 'gone');
  }
  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  if (errs.length) fail(`${errs.length} runtime exceptions`);
  for (const e of errs.slice(0, 5)) console.log('[bird-err]', e.slice(0, 200));
  console.log(`[bird] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/bird-${TAG}-{landed,gone}-N.png`);
}
