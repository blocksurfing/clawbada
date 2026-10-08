import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'trio_tempest_evolved';
const PRESET_LABEL = process.env.PRESET_LABEL ?? 'Trio · Tempest (Evolved)';
const TAG = process.env.TAG ?? 'storm';
const SPEED = process.env.SPEED ?? '1';
const MAX_STORMS = Number(process.env.MAX_STORMS ?? 12);
const WATCH_MS = Number(process.env.WATCH_MS ?? 360000);
/** Web origin under test (a worktree's dev server can run on another port). */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`);
  await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, '').split('\n')[0]);
async function burst(b: Browser, name: string, frames = 3, gapMs = 700) {
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);
  for (let i = 1; i <= frames; i++) {
    await b.screenshot(`${S}/${TAG}-${name}-${i}.png`);
    if (i < frames) await b.sleep(gapMs);
  }
}

/** The Maelstrom reaction (StormReaction + BirdFlock.Panic, 2026-10-07; depth + quick return 2026-10-08): three
 *  Tempests on the Evolved arena in autoplay, so a Maelstrom comes every few turns. For every storm: the arena
 *  reacts within 1.5 s (`[StormReaction] storm start`), the sea calms again after the clip (`storm end`), and —
 *  when a flock was on the rocks — the gulls flee (`[BirdFlock] panic: N gulls flee on Foreground/270`, above
 *  the storm's runtime wrap at 260) in front of the storm clouds, and the next flock is back within ~25 s of the
 *  last storm clearing (`flock N+1:`); a tight frame burst of the first scatter, taken the moment the storm breaks
 *  (`out/storm-panic-N.png`, ~120 ms apart — the take-off and flight are over in ~1.2 s) and of the storm's sea
 *  (`out/storm-sea-N.png`). A flock is on screen roughly
 *  half the time, so the probe watches up to MAX_STORMS storms. Fails on a storm nobody reacted to, on gulls that
 *  did not flee, on a panic depth under the wrap, on no return, and on any runtime exception. */
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.send('Network.clearBrowserCache', {});
  await b.goto(`${BASE}/game/battle?preset=${PRESET}&auto=1&speed=${SPEED}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  let ok = true;
  const fail = (msg: string) => { ok = false; console.log(`[storm-fail] ${msg}`); };
  const picked = await b.waitFor(`!!Array.from(document.querySelectorAll('button[role=combobox]')).find(x => x.textContent.includes(${JSON.stringify(PRESET_LABEL)}))`, 20000, 250);
  if (!picked) fail(`preset "${PRESET_LABEL}" was not pre-selected from the URL (is ${PRESET} in the page's PRESETS?)`);
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  const reached = await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  if (!reached) { fail('Start practice did not open a battle (login/API?) — run diag-bind.ts'); console.log(`[storm] ${TAG}: FAILED`); return; }
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[storm] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log(`[storm] ${TAG}: FAILED — HUD never bound`); return; }

  const stormRe = /\[BattleManager\] special Tempest effect clip=([\d.]+)s/;
  const reactRe = /\[StormReaction\] storm (start|extended)/;
  const endRe = /\[StormReaction\] storm end/;
  /** Gulls on screen right now, from the flock's own log: landed minus departed minus fled. */
  const gullsOnScreen = () => grab(b, /\[BirdFlock\] flock \d+ bird \d+ landed/).length - grab(b, /\[BirdFlock\] flock \d+ bird \d+ (departed|fled)/).length;
  let seenStorms = 0, reacted = 0, panics = 0, quietStorms = 0, dueStorms = 0, seaBurst = false, panicBurst = false, lastClip = 6;
  let scatteredFlock = -1, scatteredAt = 0, returnChecked = false;
  const t0 = Date.now();
  while (Date.now() - t0 < WATCH_MS && seenStorms < MAX_STORMS) {
    const storms = grab(b, stormRe);
    if (storms.length > seenStorms) {
      const present = gullsOnScreen();          // sampled BEFORE the reaction had time to scatter them
      seenStorms = storms.length;
      lastClip = Number(stormRe.exec(storms[seenStorms - 1])![1]);
      // Frames of the scatter must be taken NOW: the take-off (0.4 s hop) and the flight out (0.8 s) are over
      // ~1.2 s after the storm breaks; the log check below can wait.
      const tStorm = Date.now();
      if (present > 0 && !panicBurst) { panicBurst = true; await burst(b, 'panic', 7, 120); }
      const left = 1500 - (Date.now() - tStorm);
      if (left > 0) await b.sleep(left);
      const reactions = grab(b, reactRe);
      if (reactions.length < seenStorms) fail(`storm ${seenStorms}: no [StormReaction] within 1.5 s — is the Storm child in ArenaArt_Evolved.prefab?`);
      else { reacted = reactions.length; console.log('[storm-log]', reactions[reactions.length - 1].slice(0, 160)); }
      const panicLines = grab(b, /\[BirdFlock\] panic: /);
      const last = panicLines[panicLines.length - 1] ?? '';
      const m = /panic: (\d+) gulls flee/.exec(last);
      if (panicLines.length < seenStorms) fail(`storm ${seenStorms}: BirdFlock.Panic was not called`);
      else if (m && Number(m[1]) > 0) {
        panics++;
        console.log('[storm-log]', last.slice(0, 160));
        const depth = /on (\w+)\/(\d+)/.exec(last);
        if (!depth) fail(`panic line carries no sorting depth: ${last.slice(0, 120)}`);
        else if (depth[1] !== 'Foreground' || Number(depth[2]) <= 261) fail(`gulls flee on ${depth[1]}/${depth[2]} — under the storm's runtime wrap (Foreground/260, onTop effects 261): they would vanish behind the clouds`);
        if (scatteredFlock < 0) {
          const flocks = grab(b, /\[BirdFlock\] flock (\d+): /);
          scatteredFlock = flocks.length ? Number(/flock (\d+):/.exec(flocks[flocks.length - 1])![1]) : 0;
          scatteredAt = Date.now();
        }
        const fled = await (async () => { const tf = Date.now(); while (Date.now() - tf < 4000 && grab(b, /\[BirdFlock\] flock \d+ bird \d+ fled /).length < Number(m[1])) await b.sleep(200); return grab(b, /\[BirdFlock\] flock \d+ bird \d+ fled /); })();
        if (fled.length === 0) fail('gulls panicked but none logged a flight out');
        for (const l of fled.slice(-3)) console.log('[storm-log]', l.slice(0, 140));
      } else {
        quietStorms++;
        if (present > 0) { dueStorms++; fail(`storm ${seenStorms}: ${present} gull(s) were on screen and did not flee (${last.slice(0, 80)})`); }
        else console.log('[storm-log]', `${last.slice(0, 100)} (none on screen: fine)`);
      }
      if (!seaBurst) { seaBurst = true; await burst(b, 'sea', 3, 400); }
    }
    // Quick return: after a scatter the next flock is planned afterStormGap (2 s) + 3–8 s after the storm clears
    // (clip 6 s) — ~11–16 s after the storm broke; later storms push it out by their own clip.
    if (scatteredFlock >= 0 && !returnChecked) {
      const back = grab(b, /\[BirdFlock\] flock (\d+): /).find((l) => Number(/flock (\d+):/.exec(l)![1]) > scatteredFlock);
      const lastStorm = grab(b, reactRe).length;
      if (back) {
        returnChecked = true;
        console.log('[storm-log]', `${back.slice(0, 100)} — ${((Date.now() - scatteredAt) / 1000).toFixed(0)} s after the scatter (${lastStorm} storm reactions so far)`);
      } else if (Date.now() - scatteredAt > (lastStorm + 1) * (lastClip + 10) * 1000 + 20000) {
        returnChecked = true;
        fail(`no flock came back within ${((Date.now() - scatteredAt) / 1000).toFixed(0)} s of the scatter`);
      }
    }
    if (grab(b, /\[BattleHud\] banner/).length > 0) { console.log('[storm] battle ended'); break; }
    await b.sleep(100);
  }
  if (scatteredFlock >= 0 && !returnChecked) console.log('[storm-log]', `the ${grab(b, /\[BattleHud\] banner/).length > 0 ? 'battle' : 'watch'} ended ${((Date.now() - scatteredAt) / 1000).toFixed(0)} s after the scatter, before the gulls came back: return unverified this run`);
  // The sea calms (clip + 2 s ease-out) after the LAST storm or extension — back-to-back Maelstroms keep it rough.
  if (seenStorms > 0) {
    const tEnd = Date.now();
    let lastReactions = grab(b, reactRe).length;
    let deadline = tEnd + (lastClip + 6) * 1000;
    while (Date.now() < deadline && grab(b, endRe).length === 0) {
      const now = grab(b, reactRe).length;
      if (now > lastReactions) { lastReactions = now; deadline = Date.now() + (lastClip + 6) * 1000; }
      await b.sleep(500);
    }
    const ends = grab(b, endRe);
    if (ends.length === 0) fail(`the sea never calmed (no 'storm end' within ${(lastClip + 6).toFixed(0)} s of the last storm)`);
    else console.log('[storm-log]', ends[ends.length - 1].slice(0, 120));
  }
  if (seenStorms === 0) fail(`no Maelstrom in ${WATCH_MS / 1000} s of autoplay`);
  console.log(`[storm] storms=${seenStorms} reactions=${reacted} gull panics=${panics} quiet=${quietStorms} (${dueStorms} with gulls present)` + (panics === 0 && dueStorms === 0 ? ' — no storm met a flock on screen: the panic is unverified this run' : ''));

  for (const l of grab(b, /\[StormReaction\] (disabled|enabled)/).slice(-4)) console.log('[storm-log]', l.slice(0, 140));
  const errs = grab(b, /Exception|GLctx|Uncaught/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  if (errs.length) fail(`${errs.length} runtime exceptions`);
  for (const e of errs.slice(0, 5)) console.log('[storm-err]', e.slice(0, 200));
  console.log(`[storm] ${TAG}: ${ok ? 'OK' : 'FAILED'} — frames in out/${TAG}-{sea,panic}-N.png`);
}
