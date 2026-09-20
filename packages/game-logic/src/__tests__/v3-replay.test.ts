import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const { createBattle, runBattle, hashState, replayBattle, verifyLog, turnLogHash, commandFromLog, forfeit, BOTS, STYLE_BOTS } = v3;

function team(prefix: string, classes: LobsterClass[], tier = EvolutionTier.Evolved): v3.LobsterInput[] {
  return classes.map((c, i) => ({ id: `${prefix}${i}`, class: c, tier, purity: i * 2 }));
}
const A = [LobsterClass.Reaver, LobsterClass.Kraken, LobsterClass.Ember];
const B = [LobsterClass.Bulwark, LobsterClass.Abyss, LobsterClass.Tempest];
function cfg(seed: bigint, battleId = 'rp'): v3.BattleConfig {
  return { battleId, vrfSeed: seed, tier: 'evolved', teamA: team('A', A), teamB: team('B', B) };
}

describe('replayBattle / verifyLog', () => {
  test('replaying a full bot-vs-bot log reproduces the final state hash and every postStateHash', () => {
    for (const seed of [1n, 2n, 3n, 4n, 5n]) {
      const live = createBattle(cfg(seed));
      runBattle(live, { A: BOTS.balanced, B: STYLE_BOTS.focus });
      expect(live.finished).toBe(true);
      const replayed = replayBattle(cfg(seed), live.log);
      expect(hashState(replayed)).toBe(hashState(live));
      expect(replayed.winner).toBe(live.winner);
      const v = verifyLog(cfg(seed), live.log);
      expect(v.ok).toBe(true);
    }
  });

  test('logs contain stun skips and they replay (Kraken Bind)', () => {
    // Kraken on team A guarantees Bind casts; run several seeds until a 'skip' appears.
    let found = false;
    for (let seed = 10n; seed < 40n && !found; seed++) {
      const live = createBattle(cfg(seed));
      runBattle(live, { A: BOTS.aggressive, B: BOTS.cautious });
      if (live.log.some(e => e.action === 'skip')) {
        found = true;
        expect(verifyLog(cfg(seed), live.log).ok).toBe(true);
      }
    }
    expect(found).toBe(true);
  });

  test('a tampered entry is pinpointed', () => {
    const live = createBattle(cfg(8n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced });
    const log = live.log.map(e => ({ ...e }));
    const i = Math.floor(log.length / 2);
    // Corrupt the recorded hash of one turn.
    log[i] = { ...log[i], postStateHash: '0x' + 'ab'.repeat(32) };
    const v = verifyLog(cfg(8n), log);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedAt).toBe(i);
  });

  test('a swapped command is caught at that turn', () => {
    const live = createBattle(cfg(9n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced });
    const log = live.log.map(e => ({ ...e }));
    const i = log.findIndex(e => e.action === 'attack');
    expect(i).toBeGreaterThan(-1);
    log[i] = { ...log[i], action: 'defend', targetId: undefined };
    const v = verifyLog(cfg(9n), log);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.failedAt).toBe(i);
  });

  // ── D-12: a forfeit must be explained by the log that contains it ──

  /** Drive a live session: side `lazy` lets the shot clock run out on every turn; the other
   *  side plays. Exactly what the API does — no direct log surgery. */
  function sessionWhereOneSideTimesOut(seed: bigint, lazy: v3.Team) {
    const live = createBattle(cfg(seed));
    let clock: v3.SessionClock = { timeouts: { A: 0, B: 0 } };
    let forfeited: v3.Team | null = null;
    while (!live.finished) {
      const actor = v3.nextActor(live)!;
      const stunned = actor.statuses.some((st) => st.type === 'stun');
      const ev: v3.SessionEvent = stunned ? { type: 'stun_skip' } : actor.team === lazy ? { type: 'timeout' } : { type: 'command', cmd: BOTS.balanced(live, actor) };
      const step = v3.reduceSession(live, clock, ev);
      clock = step.clock;
      forfeited = step.forfeited ?? forfeited;
    }
    return { live, forfeited };
  }

  test('D-12: a genuine timeout forfeit says so in the hashed log, and replays', () => {
    const { live, forfeited } = sessionWhereOneSideTimesOut(12n, 'B');
    expect(forfeited).toBe('B');
    expect(live.winner).toBe('A');
    expect(live.log.at(-1)).toMatchObject({ action: 'forfeit', loser: 'B', reason: 'timeout', lobsterId: '' });
    // The three Defends the clock chose are marked; a chosen Defend never is.
    const timedOut = live.log.filter((e) => e.timeout);
    expect(timedOut).toHaveLength(v3.TIMEOUTS_TO_FORFEIT);
    expect(timedOut.every((e) => e.action === 'defend' && e.lobsterId.startsWith('B'))).toBe(true);

    const replayed = replayBattle(cfg(12n), live.log);
    expect(hashState(replayed)).toBe(hashState(live));
    expect(replayed.log).toEqual(live.log); // field for field: reason and timeout marks included
    expect(turnLogHash(replayed, [...cfg(12n).teamA, ...cfg(12n).teamB])).toBe(turnLogHash(live, [...cfg(12n).teamA, ...cfg(12n).teamB]));
    expect(verifyLog(cfg(12n), live.log).ok).toBe(true);
  });

  test('D-12: a resignation replays, with its reason', () => {
    const live = createBattle(cfg(12n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced }, 9);
    forfeit(live, 'B', 'resign');
    expect(live.log.at(-1)).toMatchObject({ action: 'forfeit', loser: 'B', reason: 'resign' });
    expect(hashState(replayBattle(cfg(12n), live.log))).toBe(hashState(live));
    expect(verifyLog(cfg(12n), live.log).ok).toBe(true);
  });

  test('D-12: THE FABRICATED LOG — a timeout forfeit with no timeouts behind it no longer verifies', () => {
    // Before: [{ action: 'forfeit', loser: 'A' }] replayed ok:true. Any battle could be awarded
    // to either side with a log that verified cleanly.
    const state = createBattle(cfg(12n));
    const oneEntry: v3.TurnLogEntry[] = [{ turn: 0, tick: '0', lobsterId: '', action: 'forfeit', loser: 'A', reason: 'timeout', postStateHash: hashState({ ...state, finished: true, winner: 'B' }) }];
    expect(() => replayBattle(cfg(12n), oneEntry)).toThrow('0 consecutive timeouts, 3 are required');
    const v = verifyLog(cfg(12n), oneEntry);
    expect(v.ok).toBe(false);
  });

  test('D-12: a forfeit must state its reason', () => {
    const live = createBattle(cfg(12n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced }, 9);
    forfeit(live, 'B', 'resign');
    const stripped = live.log.map((e) => (e.action === 'forfeit' ? { ...e, reason: undefined } : e));
    expect(() => replayBattle(cfg(12n), stripped)).toThrow('has no reason');
  });

  test('D-12: relabelling a chosen Defend as a timeout (or the reverse) breaks the forfeit and the commitment', () => {
    const { live } = sessionWhereOneSideTimesOut(12n, 'B');
    const roster = [...cfg(12n).teamA, ...cfg(12n).teamB];
    const firstTimeout = live.log.findIndex((e) => e.timeout);

    // Un-mark one of the three timeouts: the streak is now 2, the forfeit is unexplained.
    const unmarked = live.log.map((e, i) => (i === firstTimeout ? { ...e, timeout: undefined } : e));
    expect(() => replayBattle(cfg(12n), unmarked)).toThrow('consecutive timeouts, 3 are required');

    // And the label is inside the on-chain commitment, so it cannot be changed after the fact.
    const relabelled = { ...live, log: unmarked };
    expect(turnLogHash(relabelled, roster)).not.toBe(turnLogHash(live, roster));
  });

  test('D-12: a command from the lazy side resets its streak, exactly as the live session counts', () => {
    const live = createBattle(cfg(12n));
    let clock: v3.SessionClock = { timeouts: { A: 0, B: 0 } };
    let bTurns = 0;
    while (!live.finished && live.turn < 40) {
      const actor = v3.nextActor(live)!;
      const stunned = actor.statuses.some((st) => st.type === 'stun');
      // B times out twice, then acts, forever: never three in a row.
      const lazy = actor.team === 'B' && !stunned && bTurns++ % 3 !== 2;
      const ev: v3.SessionEvent = stunned ? { type: 'stun_skip' } : lazy ? { type: 'timeout' } : { type: 'command', cmd: BOTS.balanced(live, actor) };
      const step = v3.reduceSession(live, clock, ev);
      clock = step.clock;
      expect(step.forfeited).toBeNull();
    }
    expect(live.log.some((e) => e.timeout)).toBe(true);
    expect(verifyLog(cfg(12n), live.log).ok).toBe(true);
    // Claiming a timeout forfeit on top of that log is rejected.
    const forged = [...live.log, { turn: live.turn, tick: live.tick.toString(), lobsterId: '', action: 'forfeit' as const, loser: 'B' as const, reason: 'timeout' as const, postStateHash: '0x' }];
    if (!live.finished) expect(() => replayBattle(cfg(12n), forged)).toThrow('consecutive timeouts, 3 are required');
  });

  test('commandFromLog: stunned → null, bleed-death skip → defend, normal → the command', () => {
    expect(commandFromLog({ turn: 1, tick: '1', lobsterId: 'A0', action: 'skip', postStateHash: '0x' }, true)).toBeNull();
    expect(commandFromLog({ turn: 1, tick: '1', lobsterId: 'A0', action: 'skip', postStateHash: '0x' }, false)).toEqual({ lobsterId: 'A0', action: 'defend' });
    expect(commandFromLog({ turn: 1, tick: '1', lobsterId: 'A0', action: 'attack', targetId: 'B1', moveTo: { col: 1, row: 1 }, postStateHash: '0x' }, false))
      .toEqual({ lobsterId: 'A0', action: 'attack', targetId: 'B1', moveTo: { col: 1, row: 1 } });
    expect(() => commandFromLog({ turn: 1, tick: '1', lobsterId: '', action: 'forfeit', loser: 'A', postStateHash: '0x' }, false)).toThrow();
  });
});

describe('turnLogHash', () => {
  test('is a 32-byte hex, invariant to roster order, sensitive to any input', () => {
    const live = createBattle(cfg(20n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced }, 15);
    const roster = [...team('A', A), ...team('B', B)];
    const h = turnLogHash(live, roster);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(turnLogHash(live, [...roster].reverse())).toBe(h);

    // Different battle id → different hash, even with identical play.
    const other = createBattle(cfg(20n, 'rp-2'));
    runBattle(other, { A: BOTS.balanced, B: BOTS.balanced }, 15);
    expect(hashState(other)).toBe(hashState(live)); // hashState ignores battleId…
    expect(turnLogHash(other, roster)).not.toBe(h); // …turnLogHash does not.

    // One more turn → different hash.
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced }, 1);
    expect(turnLogHash(live, roster)).not.toBe(h);

    // Roster mismatch (purity changed) → different hash.
    const tweaked = roster.map(l => (l.id === 'A0' ? { ...l, purity: l.purity + 1 } : l));
    expect(turnLogHash(live, tweaked)).not.toBe(turnLogHash(live, roster));
  });
});


// ── D-27: the commitment names the rules it was played under ──
const PINNED_RULES_VERSION = '0xd4ae668fcb9eb3e64c4f57c506aaaf83a2b6f21b80cdcd38388ab043252e58ba';

describe('rules version (D-27)', () => {
  const roster = [...cfg(3n).teamA, ...cfg(3n).teamB];

  test('is a 32-byte hex, stable, and stamped on every new battle', () => {
    expect(v3.RULES_VERSION).toMatch(/^0x[0-9a-f]{64}$/);
    expect(createBattle(cfg(3n)).rulesVersion).toBe(v3.RULES_VERSION);
    expect(JSON.parse(v3.rulesManifest()).engine).toBe(v3.ENGINE_VERSION);
  });

  test('the manifest covers constants, stat tables, the class graph and the formulas', () => {
    const m = JSON.parse(v3.rulesManifest());
    expect(m.v3.MAX_TURNS).toBe(100);
    expect(m.v3.SPEED_CLAMP_MAX).toBe('1500n');
    expect(Object.keys(m.stats)).toHaveLength(10 * 4 * 2);
    expect(Object.keys(m.classAdvantage)).toHaveLength(100);
    expect(m.formulas.length).toBe(5 * 3 * 3);
  });

  test('it survives serialization, and unversioned legacy state is labelled as such', () => {
    const live = createBattle(cfg(3n));
    expect(v3.deserializeState(v3.serializeState(live)).rulesVersion).toBe(v3.RULES_VERSION);
    const legacy = JSON.parse(v3.serializeState(live));
    delete legacy.rulesVersion;
    expect(v3.deserializeState(JSON.stringify(legacy)).rulesVersion).toBe(v3.UNVERSIONED_RULES);
  });

  test('the commitment does not depend on the ORDER properties were written in', () => {
    const live = createBattle(cfg(3n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced });
    // The same log, every entry rebuilt with its keys reversed (what a jsonb column, a replay
    // or an agent in another language would produce).
    const reversed = { ...live, log: live.log.map((e) => Object.fromEntries(Object.entries(e).reverse()) as typeof e) };
    expect(Object.keys(reversed.log[0]!)[0]).not.toBe(Object.keys(live.log[0]!)[0]);
    expect(turnLogHash(reversed, roster)).toBe(turnLogHash(live, roster));
    expect(v3.canonicalJson({ b: 1, a: [{ d: undefined, c: 2n.toString() }] })).toBe('{"a":[{"c":"2"}],"b":1}');
  });

  test('it is part of turnLogHash: the same log under other rules is a different commitment', () => {
    const live = createBattle(cfg(3n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced });
    const other = { ...live, rulesVersion: '0x' + 'ab'.repeat(32) };
    expect(turnLogHash(other, roster)).not.toBe(turnLogHash(live, roster));
  });

  test('replaying a battle played under OTHER rules is refused with a message that says why', () => {
    const live = createBattle(cfg(3n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced });
    const old = { ...cfg(3n), rulesVersion: '0x' + 'ab'.repeat(32) };
    expect(() => replayBattle(old, live.log)).toThrow('rules version mismatch');
    const v = verifyLog(old, live.log);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.failedAt).toBe(-1); // before turn 1: the log is not "wrong", the engine is
      expect(v.got).toContain('matching engine-rules tag');
    }
    // The matching version replays.
    expect(verifyLog({ ...cfg(3n), rulesVersion: v3.RULES_VERSION }, live.log).ok).toBe(true);
  });

  test('PINNED — update this value ONLY together with a balance or engine change', () => {
    // If this fails you changed something that decides battle outcomes (a constant, a stat
    // table, a formula, ENGINE_VERSION). That is allowed — but every battle already played
    // commits to the OLD value, so: (1) tag the last commit of the old rules as
    // `engine-rules-<first 12 hex of the old value>` so disputed battles can still be replayed,
    // (2) paste the new value below, (3) say so in the release notes.
    expect(v3.RULES_VERSION).toBe(PINNED_RULES_VERSION);
  });
});
