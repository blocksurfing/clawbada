import type { Browser } from './cdp';
const CLASS = process.env.TRIO ?? 'Kraken';

export default async function (b: Browser) {
  await b.send('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:3000', storageTypes: 'indexeddb,cache_storage,service_workers,local_storage' });
  await b.goto(`http://127.0.0.1:3000/game/battle?preset=${process.env.PRESET ?? 'trio_' + CLASS.toLowerCase()}&auto=1&speed=3${process.env.ARENA ? `&arena=${process.env.ARENA}` : ''}`);
  await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner wallet'))`, 90000);
  for (let i = 0; i < 4; i++) {
    await b.sleep(800);
    const r = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent||'').includes('burner wallet')); if (!el) return null; const q = el.getBoundingClientRect(); return {x:q.x+q.width/2,y:q.y+q.height/2}; })()`);
    if (r) await b.clickAt((r as any).x, (r as any).y);
    if (await b.waitFor(`!!Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('burner ✓'))`, 8000, 250)) break;
  }
  const st = await b.eval(`(() => { const el = Array.from(document.querySelectorAll('button')).find(e => (e.textContent||'').includes('Start practice')); if (!el) return null; const q = el.getBoundingClientRect(); return {x:q.x+q.width/2,y:q.y+q.height/2}; })()`);
  if (st) await b.clickAt((st as any).x, (st as any).y);
  await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 30000);
  console.log('battle:', await b.eval('location.pathname'));

  // Let the battle run; both sides are bot-driven so basic attacks will happen.
  // Run until the battle ends (so the music fade-out is observable), capped at 150 s.
  let ended = false;
  const quick = !!process.env.QUICK; // tier check: stop as soon as the music has started
  for (let i = 0; i < 30 && !ended; i++) {
    await b.sleep(5000);
    ended = b.logs.some((l) => /Battle over!/.test(l));
    if (quick && b.logs.some((l) => /\[ArenaMusic\] .* playing after/.test(l))) break;
  }
  console.log('battle ended:', ended);
  const count = (re: RegExp) => b.logs.filter((l) => re.test(l)).length;
  // Full console for grepping after the fact (the summaries below only show the first few lines of each kind).
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('out', { recursive: true });
  const dump = `out/sfx-probe-${process.env.PRESET ?? 'trio_' + CLASS.toLowerCase()}.log`;
  writeFileSync(dump, b.logs.join('\n'));
  console.log('console dump:', dump, `(${b.logs.length} lines)`);
  // Board the battle was set up on (ARENA=<tier> puts any team on that board; default = the team's tier).
  const init = b.logs.find((l) => /\[BattleManager\] Initialized battle/.test(l)) ?? '';
  console.log('arena:', (init.match(/tier: (\w+)/) || [])[1] ?? '?', process.env.ARENA ? `(asked for ${process.env.ARENA})` : '(team tier)');
  console.log('--- over the whole run ---');
  console.log('turns with action=attack :', count(/PlayTurn:.*"action":"attack"/));
  console.log('turns with action=special:', count(/PlayTurn:.*"action":"special"/));
  console.log('turns with action=defend :', count(/PlayTurn:.*"action":"defend"/));
  console.log('PlayAttack animations    :', count(/\[LobsterController\] attack/));
  console.log('BattleSfx plays          :', count(/\[BattleSfx\]/));
  const clips = b.logs.filter((l) => /\[BattleSfx\]/.test(l)).map((l) => (l.match(/SFX_[A-Za-z0-9_]+/) || [''])[0]);
  const tally: Record<string, number> = {};
  for (const c of clips) tally[c] = (tally[c] || 0) + 1;
  console.log('clips:', JSON.stringify(tally));
  const phase = (tag: string) => b.logs.filter((l) => new RegExp(`\\[BattleSfx\\] .* \\(${tag}\\) @`).test(l)).length;
  const deaths = b.logs.filter((l) => /\[LobsterController\] death /.test(l)).length;
  console.log(`phases: attack=${phase('attack')} cast=${phase('cast')} impact=${phase('impact')} defend=${phase('defend')} death=${phase('death')} (deaths on screen: ${deaths})`);
  // Movement: ONE looped sound per walk, started with the first hop and stopped when the lobster
  // stops — never a tail past the walk. Every bound clip should show up across the battle.
  const walks = b.logs.filter((l) => /\[LobsterController\] move \w+ \d+ hex/.test(l)).length;
  const moveStarts = b.logs.filter((l) => /\[BattleSfx\] SFX_Move_\w+ \(move\) start/.test(l)).length;
  const stopAfter = b.logs.map((l) => l.match(/\(move\) stop after ([\d.]+)s/)).filter(Boolean).map((m) => Number(m![1]));
  const moveClips = Object.entries(tally).filter(([k]) => /^SFX_Move_/.test(k));
  const speed = Number((await b.eval('location.href') as string).match(/speed=([\d.]+)/)?.[1] ?? '1');
  const longest = 3 * 0.7 / speed + 0.3;   // a 3-hex walk plus the fade, in wall time
  console.log(`move: walks=${walks} starts=${moveStarts} stops=${stopAfter.length} longest=${Math.max(0, ...stopAfter).toFixed(2)}s (≤ ${longest.toFixed(2)}s?) clips=${JSON.stringify(Object.fromEntries(moveClips))} → one per walk: ${walks === moveStarts && moveStarts === stopAfter.length} no spill: ${stopAfter.every((s) => s <= longest)} both heard: ${moveClips.length >= 2}`);
  for (const l of b.logs.filter((x) => /\[ArenaMusic\]/.test(x)).slice(0, 8)) console.log('  music:', l.replace(/^\[log\] /, '').slice(0, 170));
  const el = await b.eval(`(() => { const m = window.__clawbadaArenaMusic; if (!m) return null; const a = m.audio; return { tier: m.tier, src: a.src.split('/').pop(), paused: a.paused, currentTime: +a.currentTime.toFixed(1), volume: +a.volume.toFixed(2), duration: +a.duration.toFixed(1), loop: a.loop, readyState: a.readyState }; })()`);
  console.log('  <audio>:', JSON.stringify(el));
  console.log('placeholder warnings:', b.logs.filter((x) => /PLACEHOLDER track/.test(x)).length);
  const iSnap = b.logs.findIndex((x) => /\[BattleBridge\] Initialized battle|\[BattleManager\] Initialized battle/.test(x));
  const iBind = b.logs.findIndex((x) => /\[BattleHud\] bind/.test(x));
  const iMusic = b.logs.findIndex((x) => /\[ArenaMusic\] .* playing after/.test(x));
  console.log(`order: unity-init@${iSnap} hud-bind@${iBind} music-start@${iMusic} → music after bind: ${iMusic > iBind && iBind >= 0}`);
  for (const l of b.logs.filter((x) => /\[BattleSfx\] .*scheduled:/.test(x)).slice(0, 3)) {
    console.log('  sched:', l.replace(/^\[log\] /, '').slice(0, 160));
  }
  // Timing: when the Special sound starts vs how long the Haunt sequence actually runs.
  for (const l of b.logs.filter((x) => /projectile launchAt|special .* effect clip/.test(x)).slice(0, 3)) {
    console.log('  seq:', l.replace(/^\[log\] /, '').slice(0, 150));
  }
  const show = (re: RegExp, label: string) => {
    const hits = b.logs.filter((l) => re.test(l));
    console.log(`${label}: ${hits.length}`);
    for (const h of hits.slice(0, 6)) console.log('   ', h.replace(/^\[log\] /, '').slice(0, 160));
  };
  show(/\[BattleSfx\]/, 'BattleSfx');
  show(/\[LobsterController\] attack/, 'attack animations');
  show(/BattleSfxLibrary|silent/, 'library warnings');
}
