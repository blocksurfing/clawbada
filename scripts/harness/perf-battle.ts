import type { Browser } from './cdp';

/**
 * Smoothness campaign (2026-10-29): measure a real battle's frame timing — Unity's own frame recorder (PerfMonitor,
 * per turn and per Special) and the page's rAF gaps and long tasks (lib/battle-perf.ts) — on the owner's MacBook Air
 * viewport (1440×755 @2, fullscreen like a real Battle press). Run it on the REAL GPU:
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 bun cdp.ts perf-battle.ts
 * Knobs: CLASSES=tempest,abyss (default all ten; each runs a three-of-a-kind team so its Special comes up),
 *        ARENA=dojo|evolved|elite|apex|match (default dojo), SECONDS=70 (battle time measured per run),
 *        TIER=elite, LABEL=baseline (output name). Writes out/perf-<LABEL>.json and prints a table.
 * Uses Build-a-team deep links (they work on production builds too). Muted, forfeits at the end (house rules).
 */
const CLASSES = (process.env.CLASSES ?? 'bulwark,mantis,leviathan,tempest,specter,sentinel,reaver,abyss,kraken,ember').split(',');
const ARENA = process.env.ARENA ?? 'dojo';
const SECONDS = Number(process.env.SECONDS ?? 70);
const TIER = process.env.TIER ?? 'elite';
const LABEL = process.env.LABEL ?? 'baseline';

type Stats = { n: number; ms?: number; mean?: number; p50?: number; p95?: number; p99?: number; max?: number; over25?: number; over50?: number; over100?: number; gc?: number };
type UnityReport = { frames: number; heapBytes: number; screen: string; all: Stats; segments: { label: string; stats: Stats }[] };

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  const OUT = `${import.meta.dir}/out`;
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  const runs: Record<string, unknown>[] = [];
  for (const cls of CLASSES) {
    await b.goto(`${BASE}/dojo?team=${cls},${cls},${cls}&tier=${TIER}&purity=6&bot=balanced&arena=${ARENA}&auto=1&perf=1&stay=1`);
    if (!(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250))) { console.log(`${cls}: no Dojo`); continue; }
    await b.sleep(3000);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs();
    await b.clickAt(r.x, r.y);
    if (!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000))) { console.log(`${cls}: battle did not open`); continue; }
    const t0 = Date.now();
    while (Date.now() - t0 < 120000 && !b.logs.some((l) => /\[BattleStage\] intro complete/.test(l))) await b.sleep(250);
    // Measure the battle itself: reset both recorders once the intro is over.
    await b.waitFor(`!!window.__clawbadaPerf`, 20000, 200);
    await b.eval(`window.__clawbadaPerf.reset()`);
    const tStart = Date.now();
    while (Date.now() - tStart < SECONDS * 1000) {
      if (await b.eval(`/Victory|Defeat|Battle over/i.test(document.querySelector('[data-testid=battle-status-line]')?.textContent || '')`)) break;
      await b.sleep(1000);
    }
    const unity = JSON.parse(await b.eval(`window.__clawbadaPerf.requestUnity()`) as string) as UnityReport;
    const page = await b.eval(`window.__clawbadaPerf.pageReport()`) as { frames: Stats; longTasks: { start: number; duration: number }[]; longTaskMs: number };
    const specials = unity.segments.filter((s) => /:special:/.test(s.label));
    const turns = unity.segments.filter((s) => /^turn:/.test(s.label));
    const idles = unity.segments.filter((s) => s.label === 'idle').map((s) => s.stats.ms ?? 0);
    const worst = [...unity.segments].sort((a, b2) => (b2.stats.max ?? 0) - (a.stats.max ?? 0)).slice(0, 5).map((s) => `${s.label} ${s.stats.max}ms`);
    const run = { cls, arena: ARENA, seconds: Math.round((Date.now() - tStart) / 1000), screen: unity.screen, heapMB: Math.round(unity.heapBytes / 1048576), unityAll: unity.all, pageFrames: page.frames, longTasks: page.longTasks.length, longTaskMs: page.longTaskMs,
      turns: turns.length, specials: specials.map((s) => ({ label: s.label, ...s.stats })), idleMs: { n: idles.length, median: idles.sort((a, c) => a - c)[Math.floor(idles.length / 2)] ?? 0, max: Math.max(0, ...idles) }, worst, segments: unity.segments };
    runs.push(run);
    // One live practice battle per player: resign this one before the next class (the house rule, and the API's).
    const resigned = await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 'no session'; const r = await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } }); return r.status; })()`);
    if (resigned !== 200) console.log(`${cls}: forfeit -> ${resigned}`);
    const u = unity.all;
    console.log(`${cls.padEnd(9)} unity p50 ${u.p50} p95 ${u.p95} p99 ${u.p99} max ${u.max} | >25 ${u.over25} >50 ${u.over50} >100 ${u.over100} gc ${u.gc} | page p95 ${page.frames.p95} max ${page.frames.max} longtasks ${page.longTasks.length} (${page.longTaskMs} ms) | turns ${turns.length} specials ${specials.length} worst-special-max ${Math.max(0, ...specials.map((s) => s.stats.max ?? 0))} | idle median ${run.idleMs.median} ms`);
  }
  await Bun.write(`${OUT}/perf-${LABEL}.json`, JSON.stringify({ label: LABEL, at: new Date().toISOString(), base: BASE, arena: ARENA, runs }, null, 1));
  console.log(`[perf] wrote out/perf-${LABEL}.json (${runs.length} runs)`);
}
