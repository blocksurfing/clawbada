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

/** The Elite jellyfish (Nzib's drop + JellySchool, 2026-10-07): starts an Elite practice battle, waits for
 *  the school's seed line, the first group and its first rise, checks the designer's rules on every logged
 *  rise (a group of 1–3, one heading, surfacing at the floor line inside the player's window — left of the
 *  opponent's HUD panels, right of the wall — slow), takes a frame
 *  burst while the group is rising (`out/jelly-<tag>-rise-N.png`) and another after the first exit
 *  (`…-after-N.png`), and fails on any runtime exception. */
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
  let spawnY = 2, exitY = 3.1, vLo = 0, vHi = 1;
  if (seedLine) {
    console.log('[jelly-log]', seedLine.slice(0, 220));
    const m = /max=(\d+) spawnY=([\d.]+) exitY=([\d.]+) rise=\[([\d.]+),([\d.]+)\] order=Background\/(\d+) z=(-?[\d.]+)/.exec(seedLine);
    if (!m) fail(`seed line did not parse: ${seedLine}`);
    else {
      spawnY = Number(m[2]); exitY = Number(m[3]); vLo = Number(m[4]); vHi = Number(m[5]);
      if (Number(m[1]) > 3) fail(`max ${m[1]} jellyfish; Nzib said 3 max`);
      if (spawnY < 1.97) fail(`spawnY ${spawnY} is over the floor plate`);
      if (Number(m[6]) < 1 || Number(m[6]) > 2) fail(`sorting order ${m[6]} is not between the water (1) and the walls (3)`);
      if (Number(m[7]) >= 0) fail(`z ${m[7]} is not in front of BG - 2.1`);
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
    else { count = Number(m[1]); if (count < 1 || count > 3) fail(`group of ${count}`); const bx = Number(m[3]); if (bx < -1.71 || bx > -0.49) fail(`base x ${bx} outside the player's window −1.7..−0.5 (the HUD covers x > 0.2)`); }
  }
  const enterRe = /\[JellySchool\] jelly g(\d+)\.(\d+) enter x=(-?[\d.]+) y=([\d.]+) up=([\d.]+) dx=([+-][\d.]+) scale=([\d.]+)/;
  const enters = await waitLogs(b, /\[JellySchool\] jelly g0\.\d+ enter /, Math.max(1, count), 8000);
  if (enters.length < Math.max(1, count)) fail(`${enters.length} of ${count} jellyfish surfaced within 8 s of the group`);
  let heading: number | null = null;
  for (const l of enters) {
    const m = enterRe.exec(l);
    if (!m) { fail(`enter line did not parse: ${l}`); continue; }
    const x = Number(m[3]), y = Number(m[4]), up = Number(m[5]), dx = Number(m[6]);
    if (x < -2.01 || x > -0.09) fail(`surfaced at x=${x}, outside the visible window −2.0..−0.1`);
    if (Math.abs(y - spawnY) > 0.01) fail(`surfaced at y=${y}, not the floor line ${spawnY}`);
    if (up < vLo * 0.84 || up > vHi * 1.16) fail(`rise speed ${up} outside the config`);
    const s = Math.sign(dx);
    if (heading === null) heading = s; else if (s !== heading) fail('members of one group head different ways');
    console.log('[jelly-log]', l.slice(0, 160));
  }

  // Fade-in is 1 s; then the group is rising through the open water.
  await b.sleep(2500);
  await burst(b, 'rise');
  // The rise is ~1.1 u at 0.07–0.17 u/s: the first exit lands within ~20 s.
  const exits = await waitLogs(b, /\[JellySchool\] jelly g0\.\d+ exit /, 1, 30000);
  if (exits.length === 0) fail('no jellyfish left within 30 s of surfacing');
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
  console.log(`[jelly] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/jelly-${TAG}-{rise,after}-N.png`);
}
