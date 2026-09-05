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

  test('a forfeit entry replays to the same final hash', () => {
    const live = createBattle(cfg(12n));
    runBattle(live, { A: BOTS.balanced, B: BOTS.balanced }, 9);
    forfeit(live, 'B', 'timeout');
    expect(live.finished).toBe(true);
    expect(live.winner).toBe('A');
    expect(live.log.at(-1)).toMatchObject({ action: 'forfeit', loser: 'B', lobsterId: '' });
    const replayed = replayBattle(cfg(12n), live.log);
    expect(hashState(replayed)).toBe(hashState(live));
    expect(verifyLog(cfg(12n), live.log).ok).toBe(true);
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
