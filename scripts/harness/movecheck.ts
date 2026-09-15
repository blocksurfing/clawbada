import type { Browser } from './cdp';
const S = `${import.meta.dir}/out`;
const CLASS = process.env.TRIO ?? 'Leviathan';   // melee: has to walk in

async function rectClick(b: Browser, selector: string, text?: string) {
  const r = await b.eval(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = ${text ? `els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}))` : 'els[0]'}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!r) throw new Error(`no element ${selector} ${text ?? ''}`); await b.clickAt(r.x, r.y);
}
const grab = (b: Browser, re: RegExp) => b.logs.filter((l) => re.test(l)).map((l) => l.replace(/^\[log\] /, ''));

/** Let the bot play both sides and time a real hex hop, so the walk speed is measured, not assumed. */
export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=trio_${CLASS.toLowerCase()}&auto=1`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let i = 0; i < 4; i++) {
    await b.sleep(800);
    await rectClick(b, 'button', 'burner wallet').catch(() => {});
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  await b.sleep(300);
  await rectClick(b, 'button', 'Start practice');
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  let inited = false;
  for (let load = 0; load < 3 && !inited; load++) {
    if (load > 0) { b.drainLogs(); await b.goto(await b.eval('location.href')); }
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (b.logs.some((l) => /\[BattleHud\] bind/.test(l))) { inited = true; break; }
      if (b.logs.some((l) => /GLctx/.test(l))) break;
      await b.sleep(500);
    }
  }
  if (!inited) { console.log('[move] FAILED — HUD never bound'); return; }
  await b.eval(`document.querySelector('canvas')?.scrollIntoView({ block: 'start' })`);

  // Let the bot play; Unity logs every walk with its per-hex timing.
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    if (grab(b, /\[BattleHud\] banner/).length) break;
    if (grab(b, /\[LobsterController\] move /).length >= 4) break;
    await b.sleep(500);
  }
  const moves = grab(b, /\[LobsterController\] move /);
  const warns = b.logs.filter((l) => /has no '.*' state/.test(l));
  const secs = [...new Set(moves.map((m) => (m.match(/@ ([\d.]+)s/) || [])[1]).filter(Boolean))];
  console.log(`[move] walks observed: ${moves.length}`);
  for (const m of moves.slice(0, 5)) console.log(`[move]   ${m.slice(0, 90)}`);
  console.log(`[move] per-hex seconds seen: ${secs.join(', ') || 'none'}`);
  console.log(`[move] missing-animator-state warnings: ${warns.length ? warns.join(' | ') : 'none'}`);
  await b.screenshot(`${S}/move-${CLASS}.png`);
}
