import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const PRESET = process.env.PRESET ?? 'trio_kraken';
const SPEED = process.env.SPEED ?? '1';
async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));

/** Kraken Bind as the designer specified: tentacles Spawn on the hit, Idle-loop for as long as the
 *  victim is stunned (through its skipped turn), Out when the stun ends; the victim's rig is frozen
 *  in place meanwhile and resumes after. Also: damage/heal floats use the pixel font. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=${PRESET}&auto=1&speed=${SPEED}&stay=1`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  expect(await b.waitFor(`!!Array.from(document.querySelectorAll('button[role=combobox]')).find(x => /·/.test(x.textContent || ''))`, 20000, 250), 'preset from URL');
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  expect(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000), 'battle page opened');
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[stun] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  expect(inited, 'HUD bound');
  if (!inited) return;
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);

  // Wait for the first FRESH stun to land (a Kraken needs 3 charge, so a few turns in). Fresh =
  // the tentacles Spawn; a Bind on an already-stunned lobster only refreshes the status and keeps
  // the tentacles it has, so its "stun on" line has no Spawn and would confuse the sequence check.
  const started = Date.now();
  let onIdx = -1;
  while (Date.now() - started < 240_000) {
    const spawnIdx = b.logs.findIndex((l) => /status fx FX_Kraken_Bind_Spawn on (\S+)/.test(l));
    if (spawnIdx >= 0) {
      const who = (b.logs[spawnIdx].match(/Spawn on (\S+)/) || [])[1];
      for (let i = spawnIdx; i >= 0; i--) if (b.logs[i].includes(`status stun on ${who}`)) { onIdx = i; break; }
      if (onIdx >= 0) break;
    }
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    await b.sleep(100);
  }
  expect(onIdx >= 0, 'a fresh stun was applied (tentacles spawned)');
  if (onIdx < 0) return;
  const tOn = Date.now();
  await b.sleep(700);  await b.screenshot(`${S}/stun-1-spawn.png`);
  await b.sleep(1300); await b.screenshot(`${S}/stun-2-hold.png`);

  // Wait for that stun to end.
  let offIdx = -1;
  while (Date.now() - tOn < 90_000) {
    const who = (b.logs[onIdx].match(/status stun on (\S+)/) || [])[1];
    offIdx = b.logs.findIndex((l, i) => i > onIdx && l.includes(`status stun off ${who}`));
    if (offIdx >= 0) break;
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    await b.sleep(100);
  }
  const tOff = Date.now();
  expect(offIdx >= 0, `the stun ended (${((tOff - tOn) / 1000).toFixed(1)} s later)`);
  await b.sleep(350); await b.screenshot(`${S}/stun-3-out.png`);
  await b.sleep(1500);

  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(S, { recursive: true });
  writeFileSync(`${S}/stunprobe-console.log`, b.logs.join('\n'));
  // Follow ONE victim: the id named in the first "status stun on" line.
  const victim = (b.logs[onIdx].match(/status stun on (\S+)/) || [])[1] ?? '';
  console.log(`[stun] victim: ${victim}; full console → out/stunprobe-console.log (${b.logs.length} lines)`);
  const seq = b.logs.slice(onIdx, (offIdx >= 0 ? offIdx : b.logs.length) + 12)
    .map((l) => l.replace(/^\[\w+\] /, ''))
    .filter((l) => /status (stun|fx)|frozen|unfrozen|PlayTurn:|banner|BattleHud\] sync|stunned — skips|stun skip/.test(l))
    .map((l) => l.slice(0, 120));
  console.log('[stun] sequence:'); for (const l of seq) console.log('   ', l);
  const mine = (l: string) => l.includes(victim);
  const idx = (re: RegExp, from = 0) => seq.findIndex((l, i) => i >= from && re.test(l) && (!/LobsterController/.test(l) || mine(l)));
  const iOn = idx(/status stun on/);
  const iSpawn = idx(/status fx FX_Kraken_Bind_Spawn/, iOn);
  const iFrozen = idx(/frozen \(stun\)/, iOn);
  const iIdle = idx(/status fx FX_Kraken_Bind_Idle/, iOn);
  const iOff = idx(/status stun off/, iOn + 1);
  const iOut = idx(/status fx FX_Kraken_Bind_Out/, iOff);
  const iUnfrozen = idx(/unfrozen/, iOff);
  const turnsHeld = iIdle >= 0 ? seq.slice(iIdle, iOff >= 0 ? iOff : seq.length).filter((l) => /PlayTurn:/.test(l)).length : 0;
  const firstOut = idx(/status fx FX_Kraken_Bind_Out/, iOn);
  const outEarly = firstOut >= 0 && (iOff < 0 || firstOut < iOff);
  expect(iSpawn > iOn, 'tentacles Spawn on the stun');
  expect(iFrozen > iOn, 'victim frozen after the hit read');
  expect(iIdle > iSpawn, 'Idle loop attached after Spawn');
  expect(turnsHeld >= 1, `Idle held across ≥1 later turn (${turnsHeld})`);
  expect(!outEarly, 'no Out before the stun ended');
  expect(iOff >= 0 && iOut > iOff, 'Out plays when the stun ends');
  expect(iUnfrozen > iOff, 'victim unfrozen when the stun ends');
  // The skipped turn is a held beat now: "STUNNED" over the frozen rig, then the stun's end read.
  const iSkip = idx(/stunned — skips \(hold/, iOn);
  const iFloat = idx(/float \S+ stun skip/, iOn);
  expect(iSkip > iOn && iSkip < iOff, 'the victim\'s skipped turn is held before the stun ends');
  expect(iFloat > iOn && iFloat < iOff, '"STUNNED" float shown on the skipped turn');
  const held = (tOff - tOn) / 1000;
  expect(held >= 1.5, `tentacles on screen ≥ 1.5 s even when the victim is next on the bar (${held.toFixed(1)} s)`);
  const errs = grab(b, /Exception|GLctx|Uncaught|\[exception\]/).filter((l) => !/Family|Aave|hydrat/i.test(l));
  expect(errs.length === 0, `no exceptions (${errs.length})`);
  for (const l of errs.slice(0, 4)) console.log('  err:', l.slice(0, 160));
  console.log(fails.length ? `[stun] FAILED: ${fails.join('; ')}` : '[stun] ALL CHECKS PASSED');
}
