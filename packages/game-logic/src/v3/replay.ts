/**
 * Replay and commitments. A battle is fully determined by
 * {config (roster, seed, layout, rules), ordered turn log}; this module
 * re-executes a log against a fresh battle, verifies every per-turn hash, and
 * folds the whole thing into the single `turnLogHash` that `BattleArena.settle`
 * carries on-chain.
 */
import { keccak256Packed } from '../hash';
import { nextActor } from './atb';
import { hasStatus } from './effects';
import { forfeit } from './session';
import { createBattle, type BattleConfig } from './sim';
import type { AtbBattleState, LobsterInput, TurnCommand, TurnLogEntry } from './state';
import { applyTurn } from './turn';

/**
 * Command to re-issue for a log entry. `null` = the actor was stunned (applyTurn
 * resolves the skip itself). A non-stunned 'skip' is a lobster that died to bleed
 * at the start of its turn: its command was validated but never resolved, so any
 * legal command reproduces the state — Defend is always legal.
 */
export function commandFromLog(entry: TurnLogEntry, actorStunned: boolean): TurnCommand | null {
  if (entry.action === 'forfeit') throw new Error('forfeit entries are not turn commands');
  if (actorStunned) return null;
  if (entry.action === 'skip') return { lobsterId: entry.lobsterId, action: 'defend' };
  return { lobsterId: entry.lobsterId, moveTo: entry.moveTo, action: entry.action, targetId: entry.targetId };
}

/** Re-execute `log` against a fresh battle built from `cfg`. Throws on an inconsistent log. */
export function replayBattle(cfg: BattleConfig, log: TurnLogEntry[]): AtbBattleState {
  const state = createBattle(cfg);
  for (const entry of log) {
    if (entry.action === 'forfeit') {
      if (!entry.loser) throw new Error(`forfeit entry at turn ${entry.turn} has no loser`);
      forfeit(state, entry.loser, 'replay');
      continue;
    }
    const actor = nextActor(state);
    if (!actor) throw new Error(`no actor at turn ${entry.turn}`);
    if (actor.id !== entry.lobsterId) throw new Error(`turn ${entry.turn}: log says ${entry.lobsterId}, battle says ${actor.id}`);
    applyTurn(state, commandFromLog(entry, hasStatus(actor, 'stun')));
  }
  return state;
}

export type VerifyResult = { ok: true; state: AtbBattleState } | { ok: false; failedAt: number; expected: string; got: string };

/** Replay and check every recorded postStateHash against the re-derived one. */
export function verifyLog(cfg: BattleConfig, log: TurnLogEntry[]): VerifyResult {
  const state = createBattle(cfg);
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    try {
      if (entry.action === 'forfeit') {
        if (!entry.loser) return { ok: false, failedAt: i, expected: entry.postStateHash, got: 'forfeit-without-loser' };
        forfeit(state, entry.loser, 'replay');
      } else {
        const actor = nextActor(state);
        if (!actor || actor.id !== entry.lobsterId) return { ok: false, failedAt: i, expected: entry.postStateHash, got: `actor:${actor?.id ?? 'none'}` };
        applyTurn(state, commandFromLog(entry, hasStatus(actor, 'stun')));
      }
    } catch (err) {
      return { ok: false, failedAt: i, expected: entry.postStateHash, got: `error:${(err as Error).message}` };
    }
    const got = state.log[state.log.length - 1]?.postStateHash ?? '';
    if (got !== entry.postStateHash) return { ok: false, failedAt: i, expected: entry.postStateHash, got };
  }
  return { ok: true, state };
}

function canonicalRoster(roster: LobsterInput[]) {
  return [...roster]
    .map(l => ({ id: l.id, class: l.class, tier: l.tier, purity: l.purity, legend: !!l.legend }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Commitment to the whole battle, as settled on-chain: binds the battle id, the
 * VRF seed, the arena, the roster and the ordered turn log (each entry already
 * carries its post-state hash). `hashState` alone deliberately omits the setup
 * (battleId / seed / layout / stats), so this is what a dispute or an S2 replay
 * checks against.
 */
export function turnLogHash(state: AtbBattleState, roster: LobsterInput[]): string {
  const payload = JSON.stringify({
    battleId: state.battleId,
    vrfSeed: state.vrfSeed.toString(),
    layout: state.layout,
    roster: canonicalRoster(roster),
    log: state.log,
  });
  return '0x' + keccak256Packed(payload).toString(16).padStart(64, '0');
}
