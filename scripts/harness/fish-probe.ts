import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'random_elite';
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
    await b.screenshot(`${S}/fish-${TAG}-${name}-${i}.png`);
    if (i < FRAMES) await b.sleep(GAP_MS);
  }
}

/** The Elite angler fish (Nzib's drop + AnglerSchool, 2026-10-05): starts an Elite practice battle, waits
 *  for the school's seed line and the first crossing, checks the designer's rules on every logged crossing
 *  (1–3 fish, random sides, lane inside the open-water band, a turn only between the walls), takes a frame
 *  burst while the first fish is in the visible middle (`out/fish-<tag>-swim-N.png`) and another after it
 *  turned or left (`…-after-N.png`), and fails on any runtime exception. */
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
    if (load > 0) { console.log(`[fish] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log(`[fish] ${TAG}: FAILED — HUD never bound`); return; }

  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[fish-fail] ${msg}`); };

  // The intro is ~16 s; the school logs its seed right after it.
  const seedLine = (await waitLogs(b, /\[AnglerSchool\] seed=/, 1, 60000))[0];
  if (!seedLine) { fail('no "[AnglerSchool] seed=" line — is the Fish child in ArenaArt_Elite.prefab?'); }
  let count = 0, bandLo = 0, bandHi = 0, viewHalf = 5.6;
  if (seedLine) {
    console.log('[fish-log]', seedLine.slice(0, 220));
    const m = /count=(\d+) band=\[([\d.]+),([\d.]+)\] order=Background\/(\d+) view=±([\d.]+)/.exec(seedLine);
    if (!m) fail(`seed line did not parse: ${seedLine}`);
    else {
      count = Number(m[1]); bandLo = Number(m[2]); bandHi = Number(m[3]); viewHalf = Number(m[5]);
      if (count < 1 || count > 3) fail(`school of ${count}; Nzib's randomized quantity is 1–3`);
      if (Number(m[4]) < 1 || Number(m[4]) > 3) fail(`sorting order ${m[4]} is not between the water (1) and the floor`);
      console.log(`[fish] school of ${count}, lanes ${bandLo}..${bandHi}, order Background/${m[4]}`);
    }
  }

  // First crossing: the stagger is ≤ 20 s, then the swim in from off-screen (≤ 16 s at the slowest speed).
  const enterRe = /\[AnglerSchool\] fish (\d+) crossing (\d+) enter ([LR])→([LR]) y=([\d.]+) speed=([\d.]+) scale=([\d.]+) (turn@x=(-?[\d.]+)|straight)/;
  const first = (await waitLogs(b, /\[AnglerSchool\] fish \d+ crossing \d+ enter /, 1, 60000))[0];
  if (!first) fail('no crossing within 60 s of the seed line');
  else {
    const m = enterRe.exec(first);
    if (!m) fail(`enter line did not parse: ${first}`);
    else {
      const [, fish, , from, , y, speed, , , turnX] = m;
      console.log('[fish-log]', first.slice(0, 200));
      // Time for it to reach the visible middle (|x| < 1.8) from off-screen, plus a little.
      const toMiddle = (viewHalf - 1.8) / Math.max(0.05, Number(speed));
      await b.sleep(Math.min(40000, toMiddle * 1000 + 800));
      await burst(b, 'swim');
      // Then it either turns (logged) or leaves by the far edge: a full crossing is ≤ 32 s at the slowest speed.
      const after = await waitLogs(b, new RegExp(`\\[AnglerSchool\\] fish ${fish} (turned at|exit )`), 1, 70000);
      if (after.length === 0) fail(`fish ${fish} neither turned nor left within 70 s`);
      else { console.log('[fish-log]', after[0].slice(0, 160)); if (turnX !== undefined && !/turned at/.test(after[0])) fail(`fish ${fish} planned a turn at x=${turnX} but left without turning`); }
      await b.sleep(1200);
      await burst(b, 'after');
      void from;
    }
  }

  // Every crossing logged so far obeys the designer's rules.
  const enters = grab(b, /\[AnglerSchool\] fish \d+ crossing \d+ enter /);
  const sides = new Set<string>();
  for (const l of enters) {
    const m = enterRe.exec(l);
    if (!m) { fail(`enter line did not parse: ${l}`); continue; }
    const y = Number(m[5]), speed = Number(m[6]), scale = Number(m[7]);
    sides.add(m[3]);
    if (y < bandLo - 0.01 || y > bandHi + 0.01) fail(`lane y=${y} outside the band [${bandLo},${bandHi}]`);
    if (speed < 0.34 || speed > 0.71) fail(`speed ${speed} outside 0.35..0.7`);
    if (scale < 0.69 || scale > 1.01) fail(`scale ${scale} outside 0.7..1.0`);
    if (m[9] !== undefined && Math.abs(Number(m[9])) > 1.81) fail(`turn at x=${m[9]} is outside the visible middle`);
  }
  console.log(`[fish] ${enters.length} crossings logged, entry sides ${[...sides].join('/') || 'none'}`);

  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  if (errs.length) fail(`${errs.length} runtime exceptions`);
  for (const e of errs.slice(0, 5)) console.log('[fish-err]', e.slice(0, 200));
  console.log(`[fish] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/fish-${TAG}-{swim,after}-N.png`);
}
