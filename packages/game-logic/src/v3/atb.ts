/**
 * ATB initiative bar. Each lobster's next turn = lastTick + TICK_SCALE / effectiveSpeed.
 * Speed changes shift a lobster on the bar immediately (next tick is derived on
 * demand from lastTick), which is what the HUD shows.
 */
import { MULT_DENOM } from '../constants';
import { BAR_PREVIEW_LENGTH, SPEED_CLAMP_MAX, SPEED_CLAMP_MIN, TICK_SCALE } from './constants';
import type { AtbBattleState, AtbLobster, BarEntry } from './state';

/** Effective Speed with all status modifiers, clamped to [0.5×, 1.5×] of base. */
export function effectiveSpeed(l: AtbLobster): bigint {
  let mult = MULT_DENOM;
  for (const s of l.statuses) if (s.type === 'slow') mult -= s.value;
  if (mult < SPEED_CLAMP_MIN) mult = SPEED_CLAMP_MIN;
  if (mult > SPEED_CLAMP_MAX) mult = SPEED_CLAMP_MAX;
  const speed = (l.stats.speed * mult) / MULT_DENOM;
  return speed > 0n ? speed : 1n;
}

export function tickDelta(l: AtbLobster): bigint {
  return TICK_SCALE / effectiveSpeed(l);
}

export function nextTick(l: AtbLobster): bigint {
  return l.lastTick + tickDelta(l);
}

function earlier(a: { tick: bigint; tiebreak: bigint; id: string }, b: { tick: bigint; tiebreak: bigint; id: string }): boolean {
  if (a.tick !== b.tick) return a.tick < b.tick;
  if (a.tiebreak !== b.tiebreak) return a.tiebreak < b.tiebreak;
  return a.id < b.id;
}

/** The living lobster whose next tick comes first. */
export function nextActor(state: AtbBattleState): AtbLobster | null {
  let best: AtbLobster | null = null;
  for (const l of state.lobsters) {
    if (!l.alive) continue;
    if (!best || earlier({ tick: nextTick(l), tiebreak: l.tiebreak, id: l.id }, { tick: nextTick(best), tiebreak: best.tiebreak, id: best.id })) best = l;
  }
  return best;
}

/** Project the next `n` turns assuming no speed changes (HUD portrait strip). */
export function projectBar(state: AtbBattleState, n = BAR_PREVIEW_LENGTH): BarEntry[] {
  const sim = state.lobsters
    .filter(l => l.alive)
    .map(l => ({ id: l.id, tiebreak: l.tiebreak, delta: tickDelta(l), tick: nextTick(l) }));
  const out: BarEntry[] = [];
  while (out.length < n && sim.length > 0) {
    let best = sim[0];
    for (const s of sim) if (earlier(s, best)) best = s;
    out.push({ lobsterId: best.id, tick: best.tick });
    best.tick += best.delta;
  }
  return out;
}
