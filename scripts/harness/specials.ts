import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const CLASS = process.env.TRIO ?? 'Ember';
const PRESET_LABEL = process.env.PRESET_LABEL ?? `Trio · ${CLASS}`;

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));
const myTurn = `/Your turn/i.test(document.body.innerText) && !/animating…/.test(document.body.innerText)`;
const turnNo = `(document.body.innerText.match(/Turn (\\d+)/i) || [])[1]`;
async function canvasGeom(b: Browser) {
  return b.eval(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bw: c.width, bh: c.height }; })()`);
}
function toCss(g: { x: number; y: number; w: number; h: number; bw: number; bh: number }, ux: number, uy: number) {
  const sx = g.w / g.bw, sy = g.h / g.bh;
  return { x: g.x + ux * sx, y: g.y + (g.bh - uy) * sy };
}
function parseButtons(line: string) {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const m of line.matchAll(/(\w+)=\((-?\d+),(-?\d+),(\d+),(\d+)\)/g)) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  return out;
}
function cube(p: { col: number; row: number }) { const x = p.col - (p.row - (p.row & 1)) / 2; const z = p.row; return [x, -x - z, z]; }
function hexDist(a: { col: number; row: number }, b: { col: number; row: number }) { const [ax, ay, az] = cube(a), [bx, by, bz] = cube(b); return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2; }
function parseCells(line: string) {
  const out = new Map<string, { x: number; y: number }>();
  for (const m of line.matchAll(/\((\d+),(\d+)\)=\((-?\d+),(-?\d+)\)/g)) out.set(`${m[1]},${m[2]}`, { x: +m[3], y: +m[4] });
  return out;
}

/** Trio·<CLASS> practice battle: cast the class Special whenever it is available (Defend
 *  otherwise to bank charge). Verifies the submit is accepted, the turn advances, the log
 *  records the special, and Unity raises no exceptions. */
export default async function (b: Browser) {
  const fails: string[] = [];
  const expect = (ok: boolean, what: string) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };

  if (process.env.DPR) await b.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: Number(process.env.DPR), mobile: false });
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=${process.env.PRESET_ID ?? `trio_${CLASS.toLowerCase()}`}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let attempt = 0; attempt < 4; attempt++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  // Preset comes from the URL (?preset=...); confirm the picker shows it before starting.
  const shown = await b.waitFor(`!!Array.from(document.querySelectorAll('button[role=combobox]')).find(x => x.textContent.includes(${JSON.stringify(PRESET_LABEL)}))`, 20000, 250);
  expect(!!shown, `preset picker shows '${PRESET_LABEL}' from the URL`);
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  console.log(`[${CLASS}] battle:`, await b.eval('location.pathname'));
  // Unity sometimes aborts on init under headless SwiftShader ("GLctx" — WebGL context lost);
  // a reload of the same battle page recovers it. Try up to 3 loads before giving up.
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { console.log(`[${CLASS}] Unity did not bind — reloading (${load})`); b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break; // crashed: reload now instead of waiting out the clock
      await b.sleep(500);
    }
  }
  expect(inited, 'HUD bound');
  if (!inited) { console.log(`[${CLASS}] FAILED: HUD never bound (Unity init crashed 3x)`); return; }
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);

  const casters = new Set<string>(); let casts = 0; let ownTurns = 0; let errors: string[] = []; let moves = 0;
  let cellsCache = new Map<string, { x: number; y: number }>();
  const started = Date.now();
  while (Date.now() - started < 7 * 60_000 && ownTurns < 16) {
    if (grab(b, /\[BattleHud\] banner/).length > 0) break;
    const mine = await b.waitFor(myTurn, 30000, 300);
    if (!mine) { if (grab(b, /\[BattleHud\] banner/).length > 0) break; continue; }
    await b.sleep(700);
    const g = await canvasGeom(b);
    const fresh = parseCells(grab(b, /\[BattleHud\] cells/).slice(-1)[0] ?? '');
    if (fresh.size >= 20) cellsCache = fresh;
    const cells = cellsCache;
    const btns = parseButtons(grab(b, /\[BattleHud\] buttons/).slice(-1)[0] ?? '');
    let sel = await b.eval(`window.__clawbada_selection ? JSON.parse(JSON.stringify(window.__clawbada_selection)) : null`) as any;
    if (!sel || !btns.defend) { await b.sleep(800); continue; }
    const before = await b.eval(turnNo);
    ownTurns++;
    // Melee Specials need adjacency: when charged but nothing is in range, step toward the
    // nearest enemy first (tentative move), then re-read the targets from the new cell.
    if (sel.specialKind === 'enemy' && (sel.specialTargets ?? []).length === 0 && (sel.moves ?? []).length > 0) {
      const me = (sel.lobsters || []).find((l: any) => l.id === sel.actor);
      const enemies = (sel.lobsters || []).filter((l: any) => l.alive && me && l.team !== me.team);
      const near = (p: any) => Math.min(...enemies.map((e: any) => hexDist(p, e)));
      const best = [...sel.moves].sort((a: any, c: any) => near(a) - near(c))[0];
      const cell = cells.get(`${best.col},${best.row}`);
      if (cell && me && near(best) < near(me)) {
        const q = toCss(g, cell.x, cell.y); await b.clickAt(q.x, q.y); moves++;
        await b.sleep(900);
        sel = await b.eval(`window.__clawbada_selection ? JSON.parse(JSON.stringify(window.__clawbada_selection)) : null`) as any ?? sel;
      }
    }
    if (sel.canSpecial && btns.special) {
      const kind = sel.specialKind as string;
      const targets: string[] = sel.specialTargets ?? [];
      if (kind !== 'none' && targets.length === 0) {
        // Special armed but nothing in range: Defend and try next turn.
        const p = toCss(g, btns.defend.x + btns.defend.w / 2, btns.defend.y + btns.defend.h / 2); await b.clickAt(p.x, p.y);
      } else {
        b.drainLogs();
        const p = toCss(g, btns.special.x + btns.special.w / 2, btns.special.y + btns.special.h / 2); await b.clickAt(p.x, p.y);
        await b.sleep(500);
        if (kind !== 'none') {
          const pick = targets.find((t: string) => t !== sel.actor) ?? targets[0]; // prefer a teammate over self for ally Specials
          const lob = (sel.lobsters || []).find((l: any) => l.id === pick);
          const cell = lob ? cells.get(`${lob.col},${lob.row}`) : null;
          if (cell) { const q = toCss(g, cell.x, cell.y); await b.clickAt(q.x, q.y); }
          else errors.push(`no cell for target ${pick}`);
        }
        if (CLASS === 'Tempest' && casts === 0) {
          // Frame burst across the storm's flash + electric hits (impactAt 3.9 s, hit clip 0.33 s).
          await b.sleep(2400);
          for (let f = 0; f < 14; f++) { await b.screenshot(`${S}/specials-Tempest-g${f}.png`); }
        }
        if (CLASS === 'Bulwark' && casts === 0) {
          // Frame burst through the whole Fortify dome: spawn 3.3 s -> idle hold -> out (clip 6.8 s).
          for (let f = 0; f < 14; f++) { await b.screenshot(`${S}/specials-Bulwark-f${f}.png`); await b.sleep(480); }
          // Past the dome's 6.85 s lifetime: it must be GONE from around the caster by here.
          for (const t of [8, 10, 12, 15]) { await b.sleep(t === 8 ? 1300 : 2000); await b.screenshot(`${S}/specials-Bulwark-late${t}s.png`); }
          for (const l of grab(b, /OneShotVfx|Destroy|Fortify/i)) console.log('[Bulwark-vfx]', l.slice(0, 200));
          for (const l of grab(b, /BattleManager\] special|StatusChanged|SetStatus|fortify/i)) console.log('[Bulwark-log]', l.slice(0, 220));
        }
        if ((CLASS === 'Mantis' || CLASS === 'Kraken' || CLASS === 'Abyss') && casts === 0) {
          // New drop (2026-09-15): burst through the cast so the frames can be eyeballed —
          // Ambush is a 0.5 s slash at the claws, Bind a per-target tentacle impact, Devour a
          // vortex under the target with its impact at 0.5 s.
          await b.sleep(250);
          for (let f = 0; f < 10; f++) { await b.screenshot(`${S}/specials-${CLASS}-f${f}.png`); await b.sleep(300); }
          for (const l of grab(b, /BattleManager\] special|Devour|Bind|Ambush|SortingGroup|Exception/i)) console.log(`[${CLASS}-log]`, l.slice(0, 220));
        }
        if (CLASS === 'Specials') {
          // Mixed roster: capture each finished Special as it fires.
          await b.sleep(500);
          for (let f = 0; f < 4; f++) { await b.screenshot(`${S}/live-specials-c${casts}-f${f}.png`); await b.sleep(320); }
        }
        if (CLASS === 'Specter' && casts === 0) {
          // Frame burst through the Haunt turn: spirit detaches → drifts to the target → possession → sigil spawns under it.
          await b.sleep(600);
          for (let f = 0; f < 10; f++) { await b.screenshot(`${S}/specials-Specter-f${f}.png`); await b.sleep(150); }
          for (const l of grab(b, /BattleManager\] special|StatusChanged|SetStatus|haunt/i)) console.log('[Specter-log]', l.slice(0, 220));
        }
        if (CLASS === 'Ember' && casts === 0) {
          // Frame burst through the projectile turn: formation → launch → flight → burst.
          await b.sleep(700);
          for (let f = 0; f < 8; f++) { await b.screenshot(`${S}/specials-Ember-f${f}.png`); await b.sleep(380); }
          for (const l of grab(b, /BattleManager\] (special|Play|Unknown)|LiveBattle\] submit|turn_resolved|targetId|LobsterController\] attack/)) console.log('[Ember-log]', l.slice(0, 260));
        }
        await b.sleep(900);
        const sub = grab(b, /\[LiveBattle\] submit special/);
        if (sub.length > 0) { casts++; casters.add(sel.actor); }
        else errors.push(`turn ${before}: special pressed (kind=${kind}, targets=${targets.length}) but no submit`);
      }
    } else {
      const p = toCss(g, btns.defend.x + btns.defend.w / 2, btns.defend.y + btns.defend.h / 2); await b.clickAt(p.x, p.y);
    }
    const advanced = await b.waitFor(`${turnNo} !== ${JSON.stringify(before)}`, 25000, 200);
    if (!advanced) errors.push(`turn ${before}: did not advance`);
    const errText = await b.eval(`(document.body.innerText.match(/(not legal|rejected|error:[^\\n]*)/i) || [])[0] || ''`);
    if (errText) errors.push(`turn ${before}: page error '${errText}'`);
    if (casters.size >= 3 && casts >= 3) break;
  }
  await b.sleep(1500);
  await b.screenshot(`${S}/specials-${CLASS}.png`);
  const logSpecials = await b.eval(`Array.from(document.querySelectorAll('span.text-claw-gold')).map(s => s.textContent).filter(Boolean).slice(0, 6)`);
  console.log(`[${CLASS}] own turns ${ownTurns}, moves ${moves}, casts ${casts} by ${[...casters].join(',')}; log specials: ${JSON.stringify(logSpecials)}`);
  expect(casts >= 1, `${CLASS}: at least one Special cast was accepted`);
  expect(errors.length === 0, `${CLASS}: no turn errors: ${errors.slice(0, 3).join(' | ')}`);
  const exc = b.logs.filter((l) => /\[exception\]|NullReference|GLctx/.test(l) && !/Family Accounts/.test(l));
  expect(exc.length === 0, `${CLASS}: no Unity/page exceptions: ${exc.slice(0, 2).join(' | ')}`);
  const held = grab(b, /\[BattleManager\] special .* effect held to/);
  for (const l of held.slice(0, 4)) console.log('  hold:', l.slice(0, 120));
  if (held.length) {
    // The turn must hold until the effect is (nearly) done — 15 % tail on a short clip, 0.8 s on a long one.
    const short = held.map((l) => l.match(/held to ([\d.]+)s of ([\d.]+)s/)).filter(Boolean).map((m) => [Number(m![1]), Number(m![2])] as const);
    expect(short.every(([t, clip]) => t >= clip - Math.min(0.8, clip * 0.15) - 0.05), `${CLASS}: every cinematic held to its clip's end (${short.map(([t, c]) => `${t}/${c}`).join(', ')})`);
  }
  const cine = grab(b, /\[BattleManager\] special .* effect clip=/);
  if (cine.length) console.log(`[${CLASS}] cinematic special timing: ${cine[0]}`);
  const floats = grab(b, /\[BattleHud\] float .* special/);
  console.log(`[${CLASS}] special damage floats seen: ${floats.length}`);
  console.log(fails.length ? `[${CLASS}] FAILED: ${fails.join('; ')}` : `[${CLASS}] ALL CHECKS PASSED`);
}
