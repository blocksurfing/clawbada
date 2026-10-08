import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'random_elite';
const TAG = process.env.TAG ?? PRESET;
const FRAMES = Number(process.env.FRAMES ?? 3);
const GAP_MS = Number(process.env.GAP_MS ?? 1500);
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
    await b.screenshot(`${S}/jelly-${TAG}-${name}-${i}.png`);
    if (i < FRAMES) await b.sleep(GAP_MS);
  }
}

/** The Elite jellyfish (Nzib's drop + JellySchool, 2026-10-07; floor mask + spacing 2026-10-08): starts an Elite
 *  practice battle, waits for the school's seed line (the floor mask must be on), the first group and its first
 *  rise, checks the rules on every logged rise (a group of 1–3, one heading, starting BELOW the floor plate's
 *  edge inside the player's window — left of the opponent's HUD panels, right of the wall — members spaced apart,
 *  slow), takes frames as the first member emerges from behind the plate (`out/jelly-<tag>-emerge-N.png`: 0.5 s
 *  after it starts there must be nothing to see, then it rises into view), a burst while the group is rising
 *  (`…-rise-N.png`) and another after the first exit (`…-after-N.png`), and fails on any runtime exception. */
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
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
    if (load > 0) { console.log(`[jelly] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log(`[jelly] ${TAG}: FAILED — HUD never bound`); return; }

  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[jelly-fail] ${msg}`); };

  // The intro is ~16 s; the school logs its seed right after it.
  const seedLine = (await waitLogs(b, /\[JellySchool\] seed=/, 1, 60000))[0];
  if (!seedLine) fail('no "[JellySchool] seed=" line — is the Jellies child in ArenaArt_Elite.prefab?');
  let spawnY = 1.3, exitY = 3.1, vLo = 0, vHi = 1, spacing = 0.65;
  if (seedLine) {
    console.log('[jelly-log]', seedLine.slice(0, 260));
    const m = /max=(\d+) spawnY=([\d.]+) exitY=([\d.]+) rise=\[([\d.]+),([\d.]+)\] order=Background\/(\d+) z=(-?[\d.]+) mask=(\w+) spacing=([\d.]+)/.exec(seedLine);
    if (!m) fail(`seed line did not parse (older build without the floor mask?): ${seedLine}`);
    else {
      spawnY = Number(m[2]); exitY = Number(m[3]); vLo = Number(m[4]); vHi = Number(m[5]); spacing = Number(m[9]);
      if (Number(m[1]) > 3) fail(`max ${m[1]} jellyfish; Nzib said 3 max`);
      // The plate's painted edge is y 1.59 at the window's left end; the sprite paints 0.24 u above its centre at scale 1.2.
      if (spawnY > 1.35) fail(`spawnY ${spawnY}: a jellyfish would start showing over the floor plate's edge (1.59) instead of rising from behind it`);
      if (Number(m[6]) < 1 || Number(m[6]) > 2) fail(`sorting order ${m[6]} is not between the water (1) and the walls (3)`);
      if (Number(m[7]) >= 0) fail(`z ${m[7]} is not in front of BG - 2.1`);
      if (m[8] !== 'outside') fail(`floor mask is '${m[8]}', not 'outside' — the jellyfish would pop in over the plate`);
      if (spacing < 0.5) fail(`member spacing ${spacing} u — bunched`);
    }
  }

  // First group: 5–20 s after the intro; its first member surfaces at once.
  const groupLine = (await waitLogs(b, /\[JellySchool\] group 0 count=/, 1, 40000))[0];
  if (!groupLine) fail('no group within 40 s of the seed line');
  let count = 0;
  if (groupLine) {
    console.log('[jelly-log]', groupLine.slice(0, 200));
    const m = /group 0 count=(\d) heading=(→|←) baseX=(-?[\d.]+)/.exec(groupLine);
    if (!m) fail(`group line did not parse: ${groupLine}`);
    else { count = Number(m[1]); if (count < 1 || count > 3) fail(`group of ${count}`); const bx = Number(m[3]); if (bx < -1.99 || bx > -0.11) fail(`line centre x ${bx} outside the player's window −2.0..−0.1 (the HUD covers x > 0.2)`); }
  }
  const enterRe = /\[JellySchool\] jelly g(\d+)\.(\d+) enter x=(-?[\d.]+) y=([\d.]+) up=([\d.]+) dx=([+-][\d.]+) scale=([\d.]+)/;
  // The first member starts at once; the others follow within memberDelayMax (4 s). Frames of the first member
  // emerging: 0.5 s after its start it is still fully behind the plate (nothing new to see at its x), then its
  // bell shows over the plate's edge and it rises clear.
  const first = (await waitLogs(b, /\[JellySchool\] jelly g0\.0 enter /, 1, 8000))[0];
  if (first) {
    await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
    await b.sleep(500);
    await b.screenshot(`${S}/jelly-${TAG}-emerge-1.png`);
    for (let i = 2; i <= 4; i++) { await b.sleep(2000); await b.screenshot(`${S}/jelly-${TAG}-emerge-${i}.png`); }
  }
  const enters = await waitLogs(b, /\[JellySchool\] jelly g0\.\d+ enter /, Math.max(1, count), 8000);
  if (enters.length < Math.max(1, count)) fail(`${enters.length} of ${count} jellyfish started within ~14 s of the group`);
  let heading: number | null = null;
  const xs: number[] = [];
  for (const l of enters) {
    const m = enterRe.exec(l);
    if (!m) { fail(`enter line did not parse: ${l}`); continue; }
    const x = Number(m[3]), y = Number(m[4]), up = Number(m[5]), dx = Number(m[6]);
    if (x < -2.01 || x > -0.09) fail(`started at x=${x}, outside the visible window −2.0..−0.1`);
    if (Math.abs(y - spawnY) > 0.01) fail(`started at y=${y}, not below the plate at ${spawnY}`);
    if (up < vLo * 0.84 || up > vHi * 1.16) fail(`rise speed ${up} outside the config`);
    const s = Math.sign(dx);
    if (heading === null) heading = s; else if (s !== heading) fail('members of one group head different ways');
    xs.push(x);
    console.log('[jelly-log]', l.slice(0, 160));
  }
  xs.sort((p, q) => p - q);
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < spacing - 0.13) fail(`members start ${(xs[i] - xs[i - 1]).toFixed(2)} u apart (spacing ${spacing}) — bunched`);

  // ~7 s after the first start the whole group is in the open water (the last member starts ≤ 4 s later and clears
  // the plate ~2 s after that; the first leaves the frame after ~10 s at the fastest rise).
  await b.sleep(1000);
  await burst(b, 'rise');
  // The rise is ~1.8 u at 0.085–0.21 u/s: the first exit lands within ~22 s of its start.
  const exits = await waitLogs(b, /\[JellySchool\] jelly g0\.\d+ exit /, 1, 35000);
  if (exits.length === 0) fail('no jellyfish left within 35 s of starting');
  else {
    const m = /exit x=(-?[\d.]+) after ([\d.]+)s/.exec(exits[0]);
    if (m && (Number(m[1]) < -2.01 || Number(m[1]) > -0.09)) fail(`left at x=${m[1]}, outside the visible window`);
    console.log('[jelly-log]', exits[0].slice(0, 160));
  }
  await b.sleep(800);
  await burst(b, 'after');

  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  if (errs.length) fail(`${errs.length} runtime exceptions`);
  for (const e of errs.slice(0, 5)) console.log('[jelly-err]', e.slice(0, 200));
  console.log(`[jelly] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/jelly-${TAG}-{emerge,rise,after}-N.png`);
}
