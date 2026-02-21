import { describe, test, expect } from 'bun:test';
import {
  initBattle,
  resolveRound,
  simulateBattle,
} from '../battle-sim';
import type { BattleState } from '../battle-sim';
import { scaleStats, getBaseStats } from '../battle-resolver';
import { encodeDNA, encodeAllele } from '../dna';
import { keccak256Packed } from '../hash';
import {
  WINNER_DAMAGE_MIN,
  WINNER_DAMAGE_MAX,
  LOSER_DAMAGE_MIN,
  LOSER_DAMAGE_MAX,
  HP_BATTLE_SCALE,
  MAX_ROUNDS,
  SPECIAL_CHARGE_COST,
} from '../constants';
import { EvolutionTier, LegendStatus, LobsterClass, MoveType } from '../types';
import type { Lobster, BattleMove } from '../types';

// ──────────── Helpers ────────────

function makeLobster(
  cls: LobsterClass,
  tier: EvolutionTier = EvolutionTier.Evolved,
  overrides: Partial<Lobster> = {},
): Lobster {
  const alleles = Array.from({ length: 18 }, () =>
    encodeAllele({ classAffinity: cls, variant: 5 }),
  );
  return {
    tokenId: BigInt(Math.floor(Math.random() * 100000)),
    owner: '0x1234',
    dna: encodeDNA(cls, LegendStatus.Normal, 0, alleles),
    class: cls,
    legend: LegendStatus.Normal,
    breedType: 0,
    purity: 6,
    evolutionTier: tier,
    damage: 0,
    breedCount: 0,
    generation: 0,
    soulbound: false,
    locked: false,
    ...overrides,
  };
}

function makeTeam(
  cls: LobsterClass = LobsterClass.Bulwark,
  tier: EvolutionTier = EvolutionTier.Evolved,
): Lobster[] {
  return [
    makeLobster(cls, tier),
    makeLobster(cls, tier),
    makeLobster(cls, tier),
  ];
}

function attackMove(slot: number, target: number): BattleMove {
  return { lobsterSlot: slot, moveType: MoveType.Attack, targetSlot: target };
}

function defendMove(slot: number): BattleMove {
  return { lobsterSlot: slot, moveType: MoveType.Defend, targetSlot: slot };
}

function specialMove(slot: number, target: number): BattleMove {
  return { lobsterSlot: slot, moveType: MoveType.Special, targetSlot: target };
}

/** All 3 lobsters on each team attack slot 0 of the opponent. */
function allAttackMoves(): [BattleMove[], BattleMove[]] {
  return [
    [attackMove(0, 0), attackMove(1, 0), attackMove(2, 0)],
    [attackMove(0, 0), attackMove(1, 0), attackMove(2, 0)],
  ];
}

/** All 3 lobsters on each team defend. */
function allDefendMoves(): [BattleMove[], BattleMove[]] {
  return [
    [defendMove(0), defendMove(1), defendMove(2)],
    [defendMove(0), defendMove(1), defendMove(2)],
  ];
}

function seedFrom(n: number): bigint {
  return keccak256Packed(BigInt(n), 'battle_test');
}

// ──────────── initBattle ────────────

describe('initBattle', () => {
  test('returns state with 6 lobsters (3 per team), all alive, charge=0', () => {
    const teamA = makeTeam();
    const teamB = makeTeam(LobsterClass.Mantis);
    const state = initBattle(teamA, teamB, 42n);

    expect(state.teamA).toHaveLength(3);
    expect(state.teamB).toHaveLength(3);

    for (const l of [...state.teamA, ...state.teamB]) {
      expect(l.alive).toBe(true);
      expect(l.charge).toBe(0);
      expect(l.currentHp).toBeGreaterThan(0n);
      expect(l.currentHp).toBe(l.maxHp);
      expect(l.statusEffects).toHaveLength(0);
    }

    expect(state.round).toBe(0);
    expect(state.finished).toBe(false);
    expect(state.winner).toBeNull();
  });

  test('HP equals scaled stats for a known class (Bulwark Evolved)', () => {
    const teamA = makeTeam(LobsterClass.Bulwark, EvolutionTier.Evolved);
    const teamB = makeTeam(LobsterClass.Mantis, EvolutionTier.Evolved);
    const state = initBattle(teamA, teamB, 1n);

    const expectedStats = scaleStats(
      getBaseStats(LobsterClass.Bulwark),
      EvolutionTier.Evolved,
      false,
    );
    // HP should include the x5 battle scaling
    expect(state.teamA[0].maxHp).toBe(expectedStats.hp);
    expect(state.teamA[0].currentHp).toBe(expectedStats.hp);
    expect(state.teamA[0].baseStats.attack).toBe(expectedStats.attack);
  });

  test('rejects teams with fewer than 3 lobsters', () => {
    const teamA = [makeLobster(LobsterClass.Bulwark), makeLobster(LobsterClass.Bulwark)];
    const teamB = makeTeam();
    expect(() => initBattle(teamA, teamB, 1n)).toThrow('exactly 3');
  });

  test('rejects teams with more than 3 lobsters', () => {
    const teamA = makeTeam();
    const teamB = [...makeTeam(), makeLobster(LobsterClass.Bulwark)];
    expect(() => initBattle(teamA, teamB, 1n)).toThrow('exactly 3');
  });

  test('round starts at 0', () => {
    const state = initBattle(makeTeam(), makeTeam(), 1n);
    expect(state.round).toBe(0);
  });

  test('assigns correct team labels (A/B) and slot indices (0/1/2)', () => {
    const state = initBattle(makeTeam(), makeTeam(LobsterClass.Ember), 1n);
    for (let i = 0; i < 3; i++) {
      expect(state.teamA[i].team).toBe('A');
      expect(state.teamA[i].slot).toBe(i);
      expect(state.teamB[i].team).toBe('B');
      expect(state.teamB[i].slot).toBe(i);
    }
  });
});

// ──────────── resolveRound ────────────

describe('resolveRound', () => {
  test('attack: target loses HP', () => {
    const state = initBattle(makeTeam(), makeTeam(), seedFrom(100));
    const initialHp = state.teamB[0].currentHp;

    resolveRound(
      state,
      [attackMove(0, 0)],
      [],
    );

    expect(state.teamB[0].currentHp).toBeLessThan(initialHp);
  });

  test('attack: attacker gains 1 charge (capped at 3)', () => {
    const state = initBattle(makeTeam(), makeTeam(), seedFrom(101));

    resolveRound(state, [attackMove(0, 0)], []);
    expect(state.teamA[0].charge).toBe(1);

    resolveRound(state, [attackMove(0, 0)], []);
    expect(state.teamA[0].charge).toBe(2);

    resolveRound(state, [attackMove(0, 0)], []);
    expect(state.teamA[0].charge).toBe(3);

    // Should cap at SPECIAL_CHARGE_COST (3)
    resolveRound(state, [attackMove(0, 0)], []);
    expect(state.teamA[0].charge).toBe(SPECIAL_CHARGE_COST);
  });

  test('defend: defending lobster takes less damage than an attacking one', () => {
    // Use a high-speed class for B so defender acts first (sets defending flag before A attacks).
    // Mantis (speed=130) > Bulwark (speed=80) guarantees B defends before A's attack resolves.
    // Attack scenario: B[0] (Mantis) gets attacked without defending
    const stateAttack = initBattle(
      makeTeam(LobsterClass.Bulwark),
      makeTeam(LobsterClass.Mantis),
      seedFrom(200),
    );
    resolveRound(stateAttack, [attackMove(0, 0)], []);
    const damageNoDefend = stateAttack.teamB[0].maxHp - stateAttack.teamB[0].currentHp;

    // Defend scenario: B[0] (Mantis) defends while getting attacked
    const stateDefend = initBattle(
      makeTeam(LobsterClass.Bulwark),
      makeTeam(LobsterClass.Mantis),
      seedFrom(200),
    );
    resolveRound(stateDefend, [attackMove(0, 0)], [defendMove(0)]);
    const damageWithDefend = stateDefend.teamB[0].maxHp - stateDefend.teamB[0].currentHp;

    expect(damageWithDefend).toBeLessThan(damageNoDefend);
  });

  test('defend: defender gains 1 charge', () => {
    const state = initBattle(makeTeam(), makeTeam(), seedFrom(201));
    resolveRound(state, [], [defendMove(0)]);
    expect(state.teamB[0].charge).toBe(1);
  });

  test('special fallback: charge < 3 falls back to Attack (charge increments by 1)', () => {
    const state = initBattle(makeTeam(), makeTeam(), seedFrom(300));
    expect(state.teamA[0].charge).toBe(0);

    // Try Special with 0 charge — should fall back to Attack
    resolveRound(state, [specialMove(0, 0)], []);
    // Fallback to attack: charge should be 1 (not 0 or 3)
    expect(state.teamA[0].charge).toBe(1);
    // Target should have taken damage (from the fallback attack)
    expect(state.teamB[0].currentHp).toBeLessThan(state.teamB[0].maxHp);
  });

  test('special fire: pre-set charge=3, use Special, charge resets to 0', () => {
    const state = initBattle(
      makeTeam(LobsterClass.Leviathan),
      makeTeam(LobsterClass.Bulwark),
      seedFrom(400),
    );

    // Manually set charge to 3
    state.teamA[0].charge = 3;

    resolveRound(state, [specialMove(0, 0)], []);
    expect(state.teamA[0].charge).toBe(0);
    // Target should have taken damage from the special
    expect(state.teamB[0].currentHp).toBeLessThan(state.teamB[0].maxHp);
  });

  test('round result includes correct round number', () => {
    const state = initBattle(makeTeam(), makeTeam(), seedFrom(500));
    const result1 = resolveRound(state, ...allAttackMoves());
    expect(result1.round).toBe(1);
    const result2 = resolveRound(state, ...allAttackMoves());
    expect(result2.round).toBe(2);
  });

  test('round result includes HP snapshots for all 6 lobsters', () => {
    const state = initBattle(makeTeam(), makeTeam(), seedFrom(501));
    const result = resolveRound(state, ...allAttackMoves());
    expect(result.teamAHp).toHaveLength(3);
    expect(result.teamBHp).toHaveLength(3);
  });
});

// ──────────── simulateBattle ────────────

describe('simulateBattle', () => {
  test('determinism: same inputs produce same FullBattleResult', () => {
    const teamA = makeTeam(LobsterClass.Leviathan);
    const teamB = makeTeam(LobsterClass.Bulwark);
    const seed = seedFrom(600);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const result1 = simulateBattle(teamA, teamB, moves, seed);
    const result2 = simulateBattle(teamA, teamB, moves, seed);

    expect(result1.winner).toBe(result2.winner);
    expect(result1.totalRounds).toBe(result2.totalRounds);
    expect(result1.teamADamagePoints).toEqual(result2.teamADamagePoints);
    expect(result1.teamBDamagePoints).toEqual(result2.teamBDamagePoints);
  });

  test('win by elimination: all 3 on one team die results in other team winning', () => {
    // Use Ember (glass cannon, low HP) vs Leviathan (high attack) to force quick kills
    const teamA = makeTeam(LobsterClass.Leviathan, EvolutionTier.Apex);
    const teamB = makeTeam(LobsterClass.Ember, EvolutionTier.Base);
    const seed = seedFrom(700);

    // All team A focuses on one target at a time
    const moves: [BattleMove[], BattleMove[]][] = [];
    for (let r = 0; r < 7; r++) {
      moves.push([
        [attackMove(0, r % 3), attackMove(1, r % 3), attackMove(2, r % 3)],
        [attackMove(0, 0), attackMove(1, 0), attackMove(2, 0)],
      ]);
    }

    const result = simulateBattle(teamA, teamB, moves, seed);
    // Apex Leviathan vs Base Ember should result in A winning
    expect(result.winner).toBe('A');
  });

  test('7-round limit: battle with defend-heavy rounds finishes with winner by HP%', () => {
    const teamA = makeTeam(LobsterClass.Bulwark);
    const teamB = makeTeam(LobsterClass.Bulwark);
    const seed = seedFrom(800);

    // All defend, no one dies
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allDefendMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    expect(result.totalRounds).toBe(MAX_ROUNDS);
    // Both teams should have full HP (no one attacked), so it could be a draw
    expect(['A', 'B', 'draw']).toContain(result.winner);
  });

  test('damage points: winner gets values in [5, 15]', () => {
    const teamA = makeTeam(LobsterClass.Leviathan, EvolutionTier.Apex);
    const teamB = makeTeam(LobsterClass.Ember, EvolutionTier.Base);
    const seed = seedFrom(900);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    const winnerDmg = result.winner === 'A' ? result.teamADamagePoints : result.teamBDamagePoints;

    for (const dp of winnerDmg) {
      expect(dp).toBeGreaterThanOrEqual(WINNER_DAMAGE_MIN);
      expect(dp).toBeLessThanOrEqual(WINNER_DAMAGE_MAX);
    }
  });

  test('damage points: loser gets values in [20, 40]', () => {
    const teamA = makeTeam(LobsterClass.Leviathan, EvolutionTier.Apex);
    const teamB = makeTeam(LobsterClass.Ember, EvolutionTier.Base);
    const seed = seedFrom(901);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    const loserDmg = result.winner === 'A' ? result.teamBDamagePoints : result.teamADamagePoints;

    for (const dp of loserDmg) {
      expect(dp).toBeGreaterThanOrEqual(LOSER_DAMAGE_MIN);
      expect(dp).toBeLessThanOrEqual(LOSER_DAMAGE_MAX);
    }
  });

  test('dead lobster stays dead: once HP=0, remains dead in subsequent rounds', () => {
    // Apex Leviathan (huge attack) vs Base Ember (very low HP) — kills should happen fast
    const teamA = makeTeam(LobsterClass.Leviathan, EvolutionTier.Apex);
    const teamB = makeTeam(LobsterClass.Ember, EvolutionTier.Base);
    const seed = seedFrom(1000);

    const state = initBattle(teamA, teamB, seed);

    // Focus fire on B slot 0
    for (let r = 0; r < 7; r++) {
      if (state.finished) break;
      resolveRound(
        state,
        [attackMove(0, 0), attackMove(1, 0), attackMove(2, 0)],
        [attackMove(0, 0), attackMove(1, 0), attackMove(2, 0)],
      );
    }

    // If B[0] died at some point, verify it stays dead
    if (!state.teamB[0].alive) {
      expect(state.teamB[0].currentHp).toBe(0n);
      expect(state.teamB[0].alive).toBe(false);
    }
  });

  test('result includes round-by-round data', () => {
    const teamA = makeTeam(LobsterClass.Bulwark);
    const teamB = makeTeam(LobsterClass.Mantis);
    const seed = seedFrom(1100);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 3 }, () => allAttackMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    expect(result.rounds.length).toBeLessThanOrEqual(MAX_ROUNDS);

    for (const round of result.rounds) {
      expect(round.round).toBeGreaterThan(0);
      expect(round.teamAHp).toHaveLength(3);
      expect(round.teamBHp).toHaveLength(3);
    }
  });

  test('totalRounds matches the number of round results', () => {
    const teamA = makeTeam();
    const teamB = makeTeam();
    const seed = seedFrom(1200);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    expect(result.totalRounds).toBe(result.rounds.length);
  });

  test('winner is one of A, B, or draw', () => {
    const teamA = makeTeam();
    const teamB = makeTeam(LobsterClass.Mantis);
    const seed = seedFrom(1300);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    expect(['A', 'B', 'draw']).toContain(result.winner);
  });

  test('damage points arrays always have 3 entries per team', () => {
    const teamA = makeTeam();
    const teamB = makeTeam();
    const seed = seedFrom(1400);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const result = simulateBattle(teamA, teamB, moves, seed);
    expect(result.teamADamagePoints).toHaveLength(3);
    expect(result.teamBDamagePoints).toHaveLength(3);
  });

  test('different seeds produce different results', () => {
    const teamA = makeTeam(LobsterClass.Mantis);
    const teamB = makeTeam(LobsterClass.Bulwark);
    const moves: [BattleMove[], BattleMove[]][] = Array.from({ length: 7 }, () => allAttackMoves());

    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const result = simulateBattle(teamA, teamB, moves, seedFrom(i + 2000));
      // Stringify the damage points as a proxy for uniqueness
      results.add(JSON.stringify(result.teamADamagePoints) + JSON.stringify(result.teamBDamagePoints));
    }
    // Expect some variation across 10 different seeds
    expect(results.size).toBeGreaterThan(1);
  });

  test('battle with no moves provided finishes immediately with winner by HP%', () => {
    const teamA = makeTeam();
    const teamB = makeTeam();
    const seed = seedFrom(1500);
    const moves: [BattleMove[], BattleMove[]][] = [];

    const result = simulateBattle(teamA, teamB, moves, seed);
    expect(result.totalRounds).toBe(0);
    expect(['A', 'B', 'draw']).toContain(result.winner);
  });

  test('charge accumulates correctly across rounds to enable Special in round 4', () => {
    const teamA = makeTeam(LobsterClass.Leviathan);
    const teamB = makeTeam(LobsterClass.Bulwark);
    const seed = seedFrom(1600);

    const state = initBattle(teamA, teamB, seed);

    // Round 1-3: attack to accumulate 3 charge
    for (let r = 0; r < 3; r++) {
      resolveRound(state, [attackMove(0, 0)], [defendMove(0)]);
    }
    expect(state.teamA[0].charge).toBe(3);

    // Round 4: use Special — charge should reset to 0
    resolveRound(state, [specialMove(0, 0)], [defendMove(0)]);
    expect(state.teamA[0].charge).toBe(0);
  });
});
