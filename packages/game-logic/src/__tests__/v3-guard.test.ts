import { describe, expect, test } from 'bun:test';
import { EvolutionTier, LobsterClass } from '../types';
import { v3 } from '../index';

const { createBattle, runBattle, nextActor, parseTurnCommand, legalCommands, legalSummary, validateTurn, hasStatus, BOTS, STYLE_BOTS, rankTurns, BOT_WEIGHTS } = v3;

function team(prefix: string, classes: LobsterClass[]): v3.LobsterInput[] {
  return classes.map((c, i) => ({ id: `${prefix}${i}`, class: c, tier: EvolutionTier.Elite, purity: 2 }));
}
function mk(seed: bigint) {
  return createBattle({
    battleId: 'g', vrfSeed: seed, tier: 'elite',
    teamA: team('A', [LobsterClass.Tempest, LobsterClass.Sentinel, LobsterClass.Mantis]),
    teamB: team('B', [LobsterClass.Bulwark, LobsterClass.Specter, LobsterClass.Ember]),
  });
}

describe('parseTurnCommand', () => {
  test('accepts well-formed commands and normalizes optional fields', () => {
    expect(parseTurnCommand({ lobsterId: 'A0', action: 'defend' })).toEqual({ lobsterId: 'A0', action: 'defend' });
    expect(parseTurnCommand({ lobsterId: 'A0', action: 'attack', targetId: 'B1', moveTo: { col: 2, row: 3 } }))
      .toEqual({ lobsterId: 'A0', action: 'attack', targetId: 'B1', moveTo: { col: 2, row: 3 } });
    expect(parseTurnCommand({ lobsterId: 'A0', action: 'none', moveTo: null, targetId: null })).toEqual({ lobsterId: 'A0', action: 'none' });
  });

  test('rejects garbage without throwing', () => {
    const bad: unknown[] = [
      null, undefined, 42, 'defend', [], {},
      { lobsterId: 7, action: 'defend' },
      { lobsterId: '', action: 'defend' },
      { lobsterId: 'A0' },
      { lobsterId: 'A0', action: 'fireball' },
      { lobsterId: 'A0', action: 'attack', targetId: 12 },
      { lobsterId: 'A0', action: 'attack', moveTo: { col: 1.5, row: 0 } },
      { lobsterId: 'A0', action: 'attack', moveTo: { col: -1, row: 0 } },
      { lobsterId: 'A0', action: 'attack', moveTo: 'there' },
      { lobsterId: 'x'.repeat(65), action: 'defend' },
    ];
    for (const b of bad) expect(parseTurnCommand(b)).toBeNull();
  });
});

describe('legalCommands / legalSummary', () => {
  test('every enumerated command validates; every bot choice is enumerated', () => {
    let checked = 0;
    for (let seed = 1n; seed <= 6n; seed++) {
      const state = mk(seed);
      for (let i = 0; i < 40 && !state.finished; i++) {
        const actor = nextActor(state)!;
        if (hasStatus(actor, 'stun')) { v3.applyTurn(state, null); continue; }
        const legal = legalCommands(state, actor);
        expect(legal.length).toBeGreaterThan(0);
        const keys = new Set(legal.map(c => JSON.stringify(c)));
        for (const cmd of legal) expect(() => validateTurn(state, cmd)).not.toThrow();
        // Every scored candidate (rankTurns) and every style choice is in the legal set.
        for (const c of rankTurns(state, actor, BOT_WEIGHTS.balanced)) expect(keys.has(JSON.stringify(c.cmd))).toBe(true);
        for (const p of [BOTS.aggressive, BOTS.cautious, STYLE_BOTS.charger, STYLE_BOTS.roles]) expect(keys.has(JSON.stringify(p(state, actor)))).toBe(true);
        checked += legal.length;
        v3.applyTurn(state, BOTS.balanced(state, actor));
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  test('legalCommands never contains an illegal one and contains defend/none for every reachable cell', () => {
    const state = mk(3n);
    runBattle(state, { A: BOTS.balanced, B: BOTS.balanced }, 7);
    const actor = nextActor(state)!;
    const legal = legalCommands(state, actor);
    const cells = 1 + v3.legalMoves(state, actor).length;
    expect(legal.filter(c => c.action === 'defend').length).toBe(cells);
    expect(legal.filter(c => c.action === 'none').length).toBe(cells);
    // An out-of-range attack is not in the set.
    const far = state.lobsters.find(l => l.team !== actor.team && v3.hexDistance(actor.pos, l.pos) > 3);
    if (far) expect(legal.some(c => c.action === 'attack' && c.targetId === far.id && !c.moveTo)).toBe(false);
  });

  test('legalSummary mirrors the enumerator for the actor\'s own cell and a tentative destination', () => {
    const state = mk(5n);
    runBattle(state, { A: BOTS.aggressive, B: BOTS.aggressive }, 10);
    const actor = nextActor(state)!;
    const here = legalSummary(state, actor);
    const legal = legalCommands(state, actor);
    expect(here.lobsterId).toBe(actor.id);
    expect(new Set(here.attackTargets)).toEqual(new Set(legal.filter(c => c.action === 'attack' && !c.moveTo).map(c => c.targetId!)));
    expect(here.canSpecial).toBe(actor.charge >= state.rules.specialCost);
    expect(here.moves).toEqual(v3.legalMoves(state, actor));
    if (here.moves.length > 0) {
      const dest = here.moves[0];
      const there = legalSummary(state, actor, dest);
      const fromDest = legal.filter(c => c.action === 'attack' && c.moveTo && v3.sameHex(c.moveTo, dest)).map(c => c.targetId!);
      expect(new Set(there.attackTargets)).toEqual(new Set(fromDest));
    }
  });
});
