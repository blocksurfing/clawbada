import { describe, test, expect } from 'bun:test';
import { parseClientMessage, isPracticeId, CHAIN_ID_RE, turnResultToWire } from '../../lib/battle-session/protocol';

describe('parseClientMessage', () => {
  test('accepts ping and submit_turn', () => {
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseClientMessage(JSON.stringify({ type: 'submit_turn', battleId: '42', turn: 3, command: { lobsterId: 'A0', action: 'defend' } })))
      .toEqual({ type: 'submit_turn', battleId: '42', turn: 3, command: { lobsterId: 'A0', action: 'defend' } });
    expect(parseClientMessage(Buffer.from('{"type":"ping"}'))).toEqual({ type: 'ping' });
  });

  test('rejects garbage, oversized frames, and malformed submits without throwing', () => {
    for (const bad of ['', 'not json', '[]', '{}', '{"type":"nope"}', JSON.stringify({ type: 'submit_turn', battleId: 42, turn: 1, command: {} }),
      JSON.stringify({ type: 'submit_turn', battleId: '42', turn: -1, command: {} }), JSON.stringify({ type: 'submit_turn', battleId: '42', turn: 1.5, command: {} }),
      JSON.stringify({ type: 'submit_turn', battleId: '42', turn: 1 }), 'x'.repeat(5000)]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });
});

describe('ids', () => {
  test('practice vs chain ids', () => {
    expect(isPracticeId('p_123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isPracticeId('p_short')).toBe(false);
    expect(isPracticeId('42')).toBe(false);
    expect(CHAIN_ID_RE.test('42')).toBe(true);
    expect(CHAIN_ID_RE.test('0')).toBe(false);
    expect(CHAIN_ID_RE.test('0x10')).toBe(false);
  });
});

describe('turnResultToWire', () => {
  test('stringifies every bigint and keeps shape', () => {
    const wire = turnResultToWire({
      turn: 3, tick: 123n, lobsterId: 'A0', skipped: null, path: [{ col: 1, row: 1 }], action: 'attack', targetId: 'B1', isEnhanced: false,
      damage: [{ targetId: 'B1', amount: 140n, kind: 'attack', isCrit: true, killed: false }], heals: [{ targetId: 'A1', amount: 20n }], statuses: [],
      chargeAfter: 1, bar: [{ lobsterId: 'B0', tick: 200n }], finished: false, winner: null,
    });
    expect(wire.tick).toBe('123');
    expect(wire.damage[0]).toEqual({ targetId: 'B1', amount: '140', kind: 'attack', isCrit: true, killed: false });
    expect(wire.heals[0].amount).toBe('20');
    expect(wire.bar[0].tick).toBe('200');
    const hasBigint = (x: unknown): boolean => typeof x === 'bigint' || (!!x && typeof x === 'object' && Object.values(x as object).some(hasBigint));
    expect(hasBigint(wire)).toBe(false);
    expect(() => JSON.stringify(wire)).not.toThrow();
  });
});
