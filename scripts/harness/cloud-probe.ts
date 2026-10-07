import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'random_evolved';
const TAG = process.env.TAG ?? PRESET;
const FRAMES = Number(process.env.FRAMES ?? 3);
const GAP_MS = Number(process.env.GAP_MS ?? 4000);
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
    await b.screenshot(`${S}/cloud-${TAG}-${name}-${i}.png`);
    if (i < FRAMES) await b.sleep(GAP_MS);
  }
}

/** The Evolved drift clouds (Nzib's drop + CloudDrift, 2026-10-07): starts an Evolved practice battle, waits
 *  for the sky's seed line, checks the designer's rules on it and on every logged pass (2–3 clouds, one wind,
 *  variants 1–6, lanes inside the band, slow), takes a frame burst 4 s apart so the drift is visible between
 *  frames (`out/cloud-<tag>-sky-N.png`), and fails on any runtime exception. */
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  // The Unity bundle keeps its URL across builds: drop Chrome's HTTP cache too (2026-10-05 lesson).
  await b.send('Network.clearBrowserCache', {});
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
    if (load > 0) { console.log(`[cloud] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log(`[cloud] ${TAG}: FAILED — HUD never bound`); return; }

  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[cloud-fail] ${msg}`); };

  // The intro is ~16 s; the sky logs its seed right after it.
  const seedLine = (await waitLogs(b, /\[CloudDrift\] seed=/, 1, 60000))[0];
  if (!seedLine) fail('no "[CloudDrift] seed=" line — is the Clouds child in ArenaArt_Evolved.prefab?');
  let count = 0, bandLo = 0, bandHi = 0, vLo = 0, vHi = 1;
  if (seedLine) {
    console.log('[cloud-log]', seedLine.slice(0, 260));
    const m = /wind=(\S+) count=(\d+) band=\[([\d.]+),([\d.]+)\] speed=\[([\d.]+),([\d.]+)\] order=Background\/(\d+) z=(-?[\d.]+)/.exec(seedLine);
    if (!m) fail(`seed line did not parse: ${seedLine}`);
    else {
      count = Number(m[2]); bandLo = Number(m[3]); bandHi = Number(m[4]); vLo = Number(m[5]); vHi = Number(m[6]);
      if (count < 2 || count > 3) fail(`sky of ${count} clouds; the config says 2–3`);
      if (Number(m[7]) !== 1) fail(`sorting order ${m[7]}, expected Background/1 (Static_Clouds' order)`);
      if (Number(m[8]) >= 0) fail(`z ${m[8]} is not in front of Static_Clouds`);
      if (vHi > 0.12) fail(`speed range up to ${vHi} u/s is not slow`);
      console.log(`[cloud] ${count} clouds, wind ${m[1]}, lanes ${bandLo}..${bandHi}, speed ${vLo}..${vHi}`);
    }
  }

  // Every first pass starts in view, so all `count` enter lines are logged at once.
  const enterRe = /\[CloudDrift\] cloud (\d+) pass (\d+) enter variant=(\d) (inview x=(-?[\d.]+)|from [LR]) y=([\d.]+) speed=([\d.]+)/;
  const enters = await waitLogs(b, /\[CloudDrift\] cloud \d+ pass \d+ enter /, Math.max(1, count), 20000);
  if (enters.length < Math.max(1, count)) fail(`${enters.length} of ${count} clouds entered within 20 s`);
  let inView = 0;
  for (const l of enters) {
    const m = enterRe.exec(l);
    if (!m) { fail(`enter line did not parse: ${l}`); continue; }
    const variant = Number(m[3]), y = Number(m[6]), speed = Number(m[7]);
    if (variant < 1 || variant > 6) fail(`variant ${variant}`);
    if (y < bandLo - 0.01 || y > bandHi + 0.01) fail(`lane y=${y} outside the band [${bandLo},${bandHi}]`);
    if (speed < vLo - 0.001 || speed > vHi + 0.001) fail(`speed ${speed} outside ${vLo}..${vHi}`);
    if (m[4].startsWith('inview')) inView++;
    console.log('[cloud-log]', l.slice(0, 160));
  }
  if (inView < 2) fail(`only ${inView} clouds started in view — the sky should not be empty at battle start`);

  // A burst with 4 s between frames: at 0.04–0.09 u/s a cloud moves 10–23 px per gap (64 px/u).
  await b.sleep(1500);
  await burst(b, 'sky');

  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  if (errs.length) fail(`${errs.length} runtime exceptions`);
  for (const e of errs.slice(0, 5)) console.log('[cloud-err]', e.slice(0, 200));
  console.log(`[cloud] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/cloud-${TAG}-sky-N.png`);
}
