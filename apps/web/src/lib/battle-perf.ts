/**
 * Smoothness campaign (2026-10-29): frame timing on the battle page, for probes only. Off unless the URL carries
 * `?perf=1` (players never pay for it). When on:
 *   · the page records every requestAnimationFrame gap (main-thread smoothness as the browser sees it) and every long
 *     task (> 50 ms of main-thread work), into preallocated buffers;
 *   · BattleStage turns Unity's own recorder on (BattleBridge.SetPerf) and lets a probe ask for its report;
 *   · everything is reachable at `window.__clawbadaPerf` — `pageReport()`, `requestUnity()` (resolves with Unity's
 *     JSON), `reset()`.
 */
export interface PerfStats { n: number; mean: number; p50: number; p95: number; p99: number; max: number; over25: number; over50: number; over100: number }

const CAP = 60 * 60 * 15;
const gaps = new Float32Array(CAP);
let count = 0;
let last = 0;
let raf = 0;
const longTasks: { start: number; duration: number }[] = [];
let observer: PerformanceObserver | null = null;
let pendingUnity: ((json: string) => void) | null = null;
let unitySend: ((method: string, json: string) => void) | null = null;

export function perfEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return new URLSearchParams(window.location.search).get('perf') === '1'; } catch { return false; }
}

function stats(values: Float32Array | number[], n: number): PerfStats {
  if (n === 0) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, over25: 0, over50: 0, over100: 0 };
  const sorted = Array.from(values.slice(0, n)).sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  let sum = 0, o25 = 0, o50 = 0, o100 = 0;
  for (const v of sorted) { sum += v; if (v > 25) o25++; if (v > 50) o50++; if (v > 100) o100++; }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n, mean: r(sum / n), p50: r(p(0.5)), p95: r(p(0.95)), p99: r(p(0.99)), max: r(sorted[n - 1]), over25: o25, over50: o50, over100: o100 };
}

/** Start the page recorders and publish window.__clawbadaPerf. Idempotent. */
export function startPagePerf(): void {
  if (typeof window === 'undefined' || raf) return;
  const tick = (now: number) => {
    if (last && count < CAP) gaps[count++] = now - last;
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  try {
    observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) }); });
    observer.observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
  (window as unknown as { __clawbadaPerf?: unknown }).__clawbadaPerf = {
    pageReport: () => ({ frames: stats(gaps, count), longTasks: longTasks.slice(), longTaskMs: longTasks.reduce((s, t) => s + t.duration, 0) }),
    reset: () => { count = 0; last = 0; longTasks.length = 0; unitySend?.('SetPerf', '{"enabled":true}'); },
    requestUnity: () => new Promise<string>((resolve, reject) => {
      if (!unitySend) { reject(new Error('Unity not ready')); return; }
      const timer = setTimeout(() => { pendingUnity = null; reject(new Error('no report from Unity')); }, 5000);
      pendingUnity = (json) => { clearTimeout(timer); pendingUnity = null; resolve(json); };
      unitySend('RequestPerf', '{}');
    }),
    onUnityReport: (json: string) => { pendingUnity?.(json); },
  };
}

/** BattleStage hands over its Unity sender once the player is ready; recording starts at once. */
export function attachUnityPerf(send: ((method: string, json: string) => void) | null): void {
  unitySend = send;
  if (send) send('SetPerf', '{"enabled":true}');
}
