/**
 * Session layer over the pure turn engine: the shot clock's consequences and
 * the forfeit terminator, as a reducer with no timers. The live engine arms a
 * setTimeout per turn and calls `reduceSession` with what happened; tests drive
 * the same reducer with a hand-rolled sequence.
 *
 * Rules (docs/gitbook/battle.md): on expiry the lobster auto-Defends and the bar
 * advances; 3 consecutive timeouts by the same PLAYER forfeit the battle. Any
 * accepted command by that player resets their counter. A stun skip is not a
 * timeout (nobody was asked to act).
 */
import { nextActor } from './atb';
import { hasStatus } from './effects';
import { hashState } from './log';
import type { AtbBattleState, Team, TurnCommand, TurnResult } from './state';
import { applyTurn, TurnError } from './turn';

export const TIMEOUTS_TO_FORFEIT = 3;

export interface SessionClock {
  /** Consecutive shot-clock expiries per player, reset on any accepted command. */
  timeouts: Record<Team, number>;
}

export function newSessionClock(): SessionClock {
  return { timeouts: { A: 0, B: 0 } };
}

export type SessionEvent =
  | { type: 'command'; cmd: TurnCommand }
  | { type: 'timeout' }
  | { type: 'stun_skip' }
  | { type: 'resign'; team: Team };

export interface SessionStep {
  /** Turn results in order (a timeout that trips the forfeit yields two: the auto-Defend, then the forfeit). */
  results: TurnResult[];
  clock: SessionClock;
  /** Set when this step ended the battle by forfeit. */
  forfeited: Team | null;
}

const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');

/**
 * End the battle: `loser` forfeits, the other team wins. Appends a 'forfeit' log
 * entry (so the log explains the outcome and replays to the same final hash).
 * No turn is scheduled — `state.turn` does not advance.
 */
export function forfeit(state: AtbBattleState, loser: Team, reason: 'timeout' | 'resign' | 'replay'): TurnResult {
  if (state.finished) throw new TurnError('finished', 'Battle is over');
  state.finished = true;
  state.winner = other(loser);
  state.log.push({ turn: state.turn, tick: state.tick.toString(), lobsterId: '', action: 'forfeit', loser, postStateHash: hashState(state) });
  void reason;
  return {
    turn: state.turn, tick: state.tick, lobsterId: '', skipped: null, path: [], action: null, targetId: null, isEnhanced: false,
    damage: [], heals: [], statuses: [], chargeAfter: 0, bar: [], finished: true, winner: state.winner,
  };
}

/** Apply one session event. Throws TurnError exactly like applyTurn on an illegal command. */
export function reduceSession(state: AtbBattleState, clock: SessionClock, ev: SessionEvent): SessionStep {
  const next: SessionClock = { timeouts: { ...clock.timeouts } };
  if (ev.type === 'resign') {
    return { results: [forfeit(state, ev.team, 'resign')], clock: next, forfeited: ev.team };
  }
  const actor = nextActor(state);
  if (!actor) throw new TurnError('no_actor', 'No living lobster');
  const stunned = hasStatus(actor, 'stun');

  if (ev.type === 'stun_skip') {
    if (!stunned) throw new TurnError('not_stunned', `${actor.id} is not stunned`);
    return { results: [applyTurn(state, null)], clock: next, forfeited: null };
  }
  if (stunned) throw new TurnError('stunned', `${actor.id} is stunned — resolve the skip first`);

  if (ev.type === 'command') {
    const result = applyTurn(state, ev.cmd); // throws before mutating on an illegal command
    next.timeouts[actor.team] = 0;
    return { results: [result], clock: next, forfeited: null };
  }

  // timeout: auto-Defend, count it, forfeit at the threshold
  const defend = applyTurn(state, { lobsterId: actor.id, action: 'defend' });
  next.timeouts[actor.team] += 1;
  if (!state.finished && next.timeouts[actor.team] >= TIMEOUTS_TO_FORFEIT) {
    const f = forfeit(state, actor.team, 'timeout');
    return { results: [defend, f], clock: next, forfeited: actor.team };
  }
  return { results: [defend], clock: next, forfeited: null };
}
