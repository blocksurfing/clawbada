/**
 * Every class's Special, cast for real (rebuilt 2026-11-05; the 2026-09 probe drove a preset picker and a burner-wallet
 * button that no longer exist). For each class: a Dojo battle with three of it (Build-a-team deep link, purity 6), the
 * battle page's `?auto=special` autoplay casting the Special whenever one is legal (the balanced policy closes in
 * meanwhile). Checks per class:
 *   · the battle opens and the intro finishes;
 *   · at least CASTS of the player's Specials are sent and Unity plays them (its `[BattleManager] special <Class>` lines);
 *   · no Unity or page errors;
 * and reports how long each of the player's Special turns took to play on screen (Unity's ?perf=1 turn segments)
 * against the shot clock's estimate (game-logic v3.PLAYBACK_SPECIAL_MS, walk included) — the numbers for re-timing
 * Specials with Nzib.
 *
 *   bash chrome-gpu.sh && BASE=http://127.0.0.1:3010 API=http://127.0.0.1:3011 bun cdp.ts specials.ts
 * Knobs: CLASSES=tempest,abyss (default all ten), TIER=elite, ARENA=dojo, CASTS=2 (per class), SECONDS=150 (cap per
 * class). Muted; resigns each battle through the API (one live practice battle per player). Writes out/specials.json.
 */
import type { Browser } from './cdp';
import { v3, LobsterClass } from '../../packages/game-logic/src';

const ALL = ['bulwark', 'mantis', 'leviathan', 'tempest', 'specter', 'sentinel', 'reaver', 'abyss', 'kraken', 'ember'];
const CLASSES = (process.env.CLASSES ?? ALL.join(',')).split(',').map((c) => c.trim().toLowerCase());
const TIER = process.env.TIER ?? 'elite';
const ARENA = process.env.ARENA ?? 'dojo';
const CASTS = Number(process.env.CASTS ?? 2);
const SECONDS = Number(process.env.SECONDS ?? 150);
const title = (c: string) => c[0].toUpperCase() + c.slice(1);

type Segment = { label: string; stats: { ms?: number; max?: number; p95?: number } };

export default async function (b: Browser) {
  const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
  const API = process.env.API ?? 'http://127.0.0.1:3011';
  let failures = 0;
  const ok = (good: boolean, what: string) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failures++; };
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 755, deviceScaleFactor: 2, mobile: false });
  const rows: Record<string, unknown>[] = [];

  for (const cls of CLASSES) {
    const Cls = title(cls);
    const logStart = b.allLogs.length;
    await b.goto(`${BASE}/dojo?team=${cls},${cls},${cls}&tier=${TIER}&purity=6&bot=balanced&arena=${ARENA}&auto=special&perf=1&stay=1`);
    if (!(await b.waitFor(`!!document.querySelector('[data-testid=dojo-battle]')`, 90000, 250))) { ok(false, `${Cls}: Dojo opened`); continue; }
    await b.sleep(2500);
    const r = await b.eval(`(() => { const q = document.querySelector('[data-testid=dojo-battle]').getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`) as { x: number; y: number };
    b.drainLogs();
    await b.clickAt(r.x, r.y);
    if (!(await b.waitFor(`/^\\/battle\\/p_/.test(location.pathname)`, 60000))) { ok(false, `${Cls}: battle opened`); continue; }
    let intro = false;
    for (const t0 = Date.now(); Date.now() - t0 < 120000 && !intro; ) { intro = b.logs.some((l) => /\[BattleStage\] intro complete/.test(l)); if (!intro) await b.sleep(250); }
    ok(intro, `${Cls}: battle opened, intro done`);
    if (!intro) continue;
    await b.waitFor(`!!window.__clawbadaPerf`, 20000, 200);
    await b.eval(`window.__clawbadaPerf?.reset()`);

    // Play until CASTS of our Specials have been sent and the last has finished playing, the battle ends, or the cap.
    const sent = () => b.logs.filter((l) => /\[LiveBattle\] autoplay turn \d+: special/.test(l)).length;
    const played = () => b.logs.filter((l) => new RegExp(`\\[BattleManager\\] special ${Cls}\\b`).test(l)).length;
    const over = () => b.logs.some((l) => /\[BattleHud\] banner/.test(l));
    const tStart = Date.now();
    while (Date.now() - tStart < SECONDS * 1000 && !over()) {
      if (sent() >= CASTS && played() > 0) {
        // Let the last cast finish: its timing segment closes when Unity starts the next turn (a PlayTurn after the
        // last Special's own PlayTurn), or the battle ends.
        const lastAt = b.logs.map((l, k) => (/\[BattleBridge\] PlayTurn/.test(l) && /"action":"special"/.test(l) ? k : -1)).filter((k) => k >= 0).pop() ?? b.logs.length;
        for (const t1 = Date.now(); Date.now() - t1 < 20000 && !over() && !b.logs.slice(lastAt + 1).some((l) => /\[BattleBridge\] PlayTurn/.test(l)); ) await b.sleep(250);
        await b.sleep(300);
        break;
      }
      await b.sleep(500);
    }
    const nSent = sent(), nPlayed = played();
    const unity = JSON.parse((await b.eval(`window.__clawbadaPerf ? window.__clawbadaPerf.requestUnity() : '{"segments":[]}'`)) as string) as { segments: Segment[] };
    // Only casts with a turn after them: the battle's last turn (often the killing Special) is cut off by the result.
    const isOurs = (s: Segment) => new RegExp(`^turn:\\d+:special:${Cls}:A$`).test(s.label);
    const ours = unity.segments.filter((s, k) => isOurs(s) && unity.segments.slice(k + 1).some((n) => /^turn:/.test(n.label))).map((s) => Math.round(s.stats.ms ?? 0));
    const estimate = v3.PLAYBACK_SPECIAL_MS[LobsterClass[Cls as keyof typeof LobsterClass]];
    const details = [...new Set(b.logs.filter((l) => new RegExp(`\\[BattleManager\\] special ${Cls}\\b`).test(l)).map((l) => l.replace(/^\[log\] \[BattleManager\] special \w+ /, '').replace(/\d+\.\d+/g, '#').trim()))];
    const errors = b.allLogs.slice(logStart).filter((l) => /Exception|NullReference|\[error\]/i.test(l) && !/Aave Wallet|FamilyAccountsSdk|UnityErrorGuard/.test(l));

    ok(nSent >= Math.min(CASTS, 1) && nPlayed > 0, `${Cls}: Specials sent ${nSent}, played by Unity ${nPlayed > 0 ? 'yes' : 'NO'}${over() && nSent < CASTS ? ' (battle ended first)' : ''}`);
    ok(errors.length === 0, `${Cls}: no errors${errors.length ? ` — ${errors.slice(0, 2).map((e) => e.slice(0, 140)).join(' | ')}` : ''}`);
    console.log(`     ${Cls} on screen: ${ours.length ? ours.map((ms) => `${(ms / 1000).toFixed(2)} s`).join(', ') : '—'} (walk included; the shot-clock estimate without walk is ${(estimate / 1000).toFixed(2)} s); Unity: ${details.slice(0, 3).join(' · ').slice(0, 220)}`);
    rows.push({ cls: Cls, sent: nSent, played: nPlayed, onScreenMs: ours, estimateMs: estimate, details, errors: errors.slice(0, 5) });

    const resigned = await b.eval(`(async () => { const id = location.pathname.split('/').pop(); const raw = localStorage.getItem('clawbada.session.guest'); const tok = raw && JSON.parse(raw).token; if (!tok) return 'no session'; return (await fetch(${JSON.stringify(API)} + '/api/game/combat/' + id + '/forfeit', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } })).status; })()`);
    if (resigned !== 200 && resigned !== 404 && !over()) console.log(`     ${Cls}: forfeit -> ${resigned}`);
  }
  await Bun.write(`${import.meta.dir}/out/specials.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, tier: TIER, arena: ARENA, rows }, null, 1));
  await b.goto('about:blank');
  console.log(failures ? `${failures} FAILED` : 'all ok');
}
