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
import { forfeit, TIMEOUTS_TO_FORFEIT } from './session';
import { RULES_VERSION } from './rules-version';
import { createBattle, type BattleConfig } from './sim';
import type { AtbBattleState, LobsterInput, Team, TurnCommand, TurnLogEntry } from './state';
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
  assertReplayableRules(cfg);
  const state = createBattle(cfg);
  const audit = new ForfeitAudit();
  for (const entry of log) {
    if (entry.action === 'forfeit') {
      audit.checkForfeit(entry);
      forfeit(state, entry.loser!, entry.reason!); // checkForfeit guarantees a reason
      continue;
    }
    const actor = nextActor(state);
    if (!actor) throw new Error(`no actor at turn ${entry.turn}`);
    if (actor.id !== entry.lobsterId) throw new Error(`turn ${entry.turn}: log says ${entry.lobsterId}, battle says ${actor.id}`);
    const stunned = hasStatus(actor, 'stun');
    audit.checkTurn(entry, actor.team, stunned);
    applyTurn(state, commandFromLog(entry, stunned));
    if (entry.timeout) state.log[state.log.length - 1]!.timeout = true;
  }
  return state;
}

/**
 * D-27: this code can only re-execute a battle played under THESE rules. A log from another
 * rules version is not "wrong" — it needs the engine it was played on (see rules-version.ts).
 */
function assertReplayableRules(cfg: BattleConfig): void {
  if (cfg.rulesVersion !== undefined && cfg.rulesVersion !== RULES_VERSION) {
    throw new Error(`rules version mismatch: the battle was played under ${cfg.rulesVersion}, this engine is ${RULES_VERSION} — replay it with the matching engine-rules tag`);
  }
}

/**
 * D-12: a forfeit must be explained by the log that contains it.
 *
 * It used to be accepted at any point with no precondition — the one-entry log
 * [{ action: 'forfeit', loser: 'A' }] replayed `ok`. Combined with timeouts being logged as
 * ordinary Defends, a server could award any battle to either side with a log that verified
 * cleanly, and the admin judging the dispute had nothing to check it against.
 *
 * Now: a timed-out turn is marked in the hashed log, and a forfeit with reason 'timeout' is
 * only valid directly after TIMEOUTS_TO_FORFEIT consecutive timed-out turns by the loser (a
 * command from that team resets the count, exactly as the live session counts them). A
 * forfeit must state its reason. 'resign' is the player's own act and is still taken on the
 * server's word — closing that needs signed turn commands, which is a design decision.
 */
class ForfeitAudit {
  private readonly streak: Record<Team, number> = { A: 0, B: 0 };

  checkTurn(entry: TurnLogEntry, team: Team, stunned: boolean): void {
    if (entry.timeout) {
      if (stunned) throw new Error(`turn ${entry.turn}: a stunned lobster cannot time out`);
      if (entry.action !== 'defend' || entry.moveTo) throw new Error(`turn ${entry.turn}: a timed-out turn must be a plain Defend`);
      this.streak[team] += 1;
    } else if (!stunned && entry.action !== 'skip') {
      this.streak[team] = 0; // the player acted
    }
  }

  checkForfeit(entry: TurnLogEntry): void {
    if (!entry.loser) throw new Error(`forfeit entry at turn ${entry.turn} has no loser`);
    if (entry.reason === 'resign') return;
    if (entry.reason !== 'timeout') throw new Error(`forfeit entry at turn ${entry.turn} has no reason`);
    if (this.streak[entry.loser] < TIMEOUTS_TO_FORFEIT) {
      throw new Error(`forfeit entry at turn ${entry.turn}: side ${entry.loser} has ${this.streak[entry.loser]} consecutive timeouts, ${TIMEOUTS_TO_FORFEIT} are required`);
    }
  }
}

export type VerifyResult = { ok: true; state: AtbBattleState } | { ok: false; failedAt: number; expected: string; got: string };

/** Replay and check every recorded postStateHash against the re-derived one. */
export function verifyLog(cfg: BattleConfig, log: TurnLogEntry[]): VerifyResult {
  try {
    assertReplayableRules(cfg);
  } catch (err) {
    return { ok: false, failedAt: -1, expected: cfg.rulesVersion ?? '', got: `error:${(err as Error).message}` };
  }
  const state = createBattle(cfg);
  const audit = new ForfeitAudit();
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    try {
      if (entry.action === 'forfeit') {
        if (!entry.loser) return { ok: false, failedAt: i, expected: entry.postStateHash, got: 'forfeit-without-loser' };
        audit.checkForfeit(entry);
        forfeit(state, entry.loser, entry.reason!);
      } else {
        const actor = nextActor(state);
        if (!actor || actor.id !== entry.lobsterId) return { ok: false, failedAt: i, expected: entry.postStateHash, got: `actor:${actor?.id ?? 'none'}` };
        const stunned = hasStatus(actor, 'stun');
        audit.checkTurn(entry, actor.team, stunned);
        applyTurn(state, commandFromLog(entry, stunned));
        if (entry.timeout) state.log[state.log.length - 1]!.timeout = true;
      }
    } catch (err) {
      return { ok: false, failedAt: i, expected: entry.postStateHash, got: `error:${(err as Error).message}` };
    }
    const got = state.log[state.log.length - 1]?.postStateHash ?? '';
    if (got !== entry.postStateHash) return { ok: false, failedAt: i, expected: entry.postStateHash, got };
  }
  return { ok: true, state };
}

/**
 * Canonical JSON: object keys sorted, `undefined` dropped, no whitespace. The commitment used
 * to be `JSON.stringify` of objects as they happened to be built, so it depended on property
 * INSERTION ORDER — an entry rebuilt in a different order (a replay, a row read back from a
 * jsonb column, an agent written in another language) hashed differently while being equal.
 * Sorted keys are a rule anyone can implement; "the order this TypeScript wrote them" is not.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  }
  return `{${parts.join(',')}}`;
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
  const payload = canonicalJson({
    // D-27: the commitment names the rules it was played under.
    rulesVersion: state.rulesVersion,
    battleId: state.battleId,
    vrfSeed: state.vrfSeed.toString(),
    layout: state.layout,
    roster: canonicalRoster(roster),
    log: state.log,
  });
  return '0x' + keccak256Packed(payload).toString(16).padStart(64, '0');
}
