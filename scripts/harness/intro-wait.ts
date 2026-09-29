import type { Browser } from './cdp';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Battle-start intro (2026-09-28): a fresh battle plays ~13 s of intro (obstacles, lobsters, CLAWS UP / BATTLE) before anything is clickable, and a
 * click during it SKIPS it. Call after the HUD binds and before the first click: waits for `[BattleIntro] done`, or
 * returns at once when no intro started (a reconnect, an old build).
 */
export async function waitForIntro(b: Browser, timeoutMs = 25_000): Promise<void> {
  const t0 = Date.now();
  const seen = (re: RegExp) => b.allLogs.some((l) => re.test(l));
  while (Date.now() - t0 < 3_000 && !seen(/\[BattleIntro\] start/)) await sleep(100);
  if (!seen(/\[BattleIntro\] start/)) return;
  while (Date.now() - t0 < timeoutMs && !seen(/\[BattleIntro\] done/)) await sleep(100);
  await sleep(400);   // the held turn calls replay right after it
}

