import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

// Playback estimate (smoothness 2026-11-04): the time the browser spends playing a resolved turn.
const team = (p: string, c: LobsterClass) => [0, 1, 2].map((j) => ({ id: `${p}${j}`, class: c, tier: EvolutionTier.Elite, purity: 0 }));
const battle = () => v3.createBattle({ battleId: 'pb', vrfSeed: 9n, tier: 'elite', teamA: team('A', LobsterClass.Tempest), teamB: team('B', LobsterClass.Bulwark) });
const result = (over: Partial<v3.TurnResult>, s: v3.AtbBattleState): v3.TurnResult => ({
  turn: 1, tick: 0n, lobsterId: s.lobsters[0].id, skipped: null, path: [], action: 'defend', targetId: null, isEnhanced: false,
  damage: [], heals: [], statuses: [], chargeAfter: 0, bar: [], finished: false, winner: null, ...over,
});
const m = (ms: number) => Math.min(v3.PLAYBACK_TURN_CAP_MS, Math.round(ms * v3.PLAYBACK_MARGIN));

describe('playbackEstimateMs', () => {
  test('defend in place, a walk, an attack and a Special follow the class tables', () => {
    const s = battle();
    expect(v3.playbackEstimateMs(result({ action: 'defend' }, s), s)).toBe(m(v3.PLAYBACK_GAP_MS + v3.PLAYBACK_DEFEND_MS));
    const path = [{ col: 1, row: 1 }, { col: 2, row: 1 }, { col: 3, row: 1 }];
    expect(v3.playbackEstimateMs(result({ action: 'attack', path }, s), s))
      .toBe(m(v3.PLAYBACK_GAP_MS + 3 * v3.PLAYBACK_WALK_MS_PER_HEX + v3.PLAYBACK_ATTACK_MS[LobsterClass.Tempest]));
    expect(v3.playbackEstimateMs(result({ action: 'special' }, s), s))
      .toBe(m(v3.PLAYBACK_GAP_MS + v3.PLAYBACK_SPECIAL_MS[LobsterClass.Tempest]));
  });

  test('a stun skip holds; a kill adds the death; the forfeit terminator plays nothing', () => {
    const s = battle();
    expect(v3.playbackEstimateMs(result({ skipped: 'stun', action: null }, s), s)).toBe(m(v3.PLAYBACK_GAP_MS + v3.PLAYBACK_STUN_SKIP_MS));
    const kill = { targetId: s.lobsters[3].id, amount: 99n, kind: 'attack' as const, killed: true };
    expect(v3.playbackEstimateMs(result({ action: 'attack', damage: [kill] }, s), s))
      .toBe(m(v3.PLAYBACK_GAP_MS + v3.PLAYBACK_ATTACK_MS[LobsterClass.Tempest] + v3.PLAYBACK_DEATH_MS));
    expect(v3.playbackEstimateMs(result({ lobsterId: '' }, s), s)).toBe(0);
  });

  test('one turn never adds more than the cap', () => {
    const s = battle();
    const path = Array.from({ length: 30 }, (_, i) => ({ col: i % 6, row: 0 }));
    expect(v3.playbackEstimateMs(result({ action: 'special', path }, s), s)).toBe(v3.PLAYBACK_TURN_CAP_MS);
  });
});
