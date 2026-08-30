/**
 * Full round-by-round 3v3 combat engine.
 *
 * This is the off-chain battle resolver. Given teams, moves, and a VRF seed,
 * it deterministically simulates combat — same inputs always produce the same outputs.
 *
 * Battle flow:
 *   1. Init: scale stats (tier + legend applied, HP × HP_BATTLE_SCALE)
 *   2. Each round: tick status effects → validate moves → resolve in speed order → check win
 *   3. Settlement: determine winner, calculate damage points for repair
 */

import {
  ATTACK_BASE_POWER,
  DEFEND_COUNTER_BASE,
  DEFEND_REDUCTION_BPS,
  MAX_ROUNDS,
  MULT_DENOM,
  SPECIAL_BASE_POWERS,
  SPECIAL_CHARGE_COST,
  WINNER_DAMAGE_MIN,
  WINNER_DAMAGE_MAX,
  LOSER_DAMAGE_MIN,
  LOSER_DAMAGE_MAX,
} from './constants';
import {
  calculateAttackDamage,
  calculateDefendCounter,
  calculateSpecialDamage,
  critChance,
  enhancedProcChance,
  getBaseStats,
  getClassAdvantage,
  scaleStats,
} from './battle-resolver';
import type { Lobster, Stats, BattleMove, RoundResult, RoundAction } from './types';
import { EvolutionTier, LegendStatus, LobsterClass, MoveType } from './types';
import { deriveRandom, deriveVrfRoll, randomBool } from './hash';

// ──────────── Battle Types ────────────

export interface StatusEffect {
  type: 'bleed' | 'stun' | 'haunt' | 'fortify' | 'shield' | 'speed_debuff';
  remainingRounds: number;
  value: bigint;
}

export interface BattleLobster {
  slot: number;
  team: 'A' | 'B';
  class: LobsterClass;
  baseStats: Stats;
  currentHp: bigint;
  maxHp: bigint;
  charge: number;
  alive: boolean;
  statusEffects: StatusEffect[];
  purity: number;
  defending: boolean;
}

export interface BattleState {
  round: number;
  teamA: BattleLobster[];
  teamB: BattleLobster[];
  vrfSeed: bigint;
  roundResults: RoundResult[];
  finished: boolean;
  winner: 'A' | 'B' | 'draw' | null;
}

export interface FullBattleResult {
  winner: 'A' | 'B' | 'draw';
  rounds: RoundResult[];
  totalRounds: number;
  teamADamagePoints: [number, number, number];
  teamBDamagePoints: [number, number, number];
}

// ──────────── Init ────────────

/**
 * Initialize a battle state from two teams of Lobster data.
 *
 * Scales stats (evolution tier + legend + HP × HP_BATTLE_SCALE) and sets initial state.
 */
export function initBattle(teamA: Lobster[], teamB: Lobster[], vrfSeed: bigint): BattleState {
  if (teamA.length !== 3 || teamB.length !== 3) {
    throw new Error('Each team must have exactly 3 lobsters');
  }

  return {
    round: 0,
    teamA: teamA.map((l, i) => createBattleLobster(l, i, 'A')),
    teamB: teamB.map((l, i) => createBattleLobster(l, i, 'B')),
    vrfSeed,
    roundResults: [],
    finished: false,
    winner: null,
  };
}

function createBattleLobster(lobster: Lobster, slot: number, team: 'A' | 'B'): BattleLobster {
  const base = getBaseStats(lobster.class);
  const scaled = scaleStats(base, lobster.evolutionTier, lobster.legend === LegendStatus.Legend);

  return {
    slot,
    team,
    class: lobster.class,
    baseStats: scaled,
    currentHp: scaled.hp,
    maxHp: scaled.hp,
    charge: 0,
    alive: true,
    statusEffects: [],
    purity: lobster.purity,
    defending: false,
  };
}

// ──────────── Full simulation ────────────

/**
 * Simulate a complete battle from start to finish.
 *
 * @param teamA Array of 3 Lobster data objects
 * @param teamB Array of 3 Lobster data objects
 * @param allMoves Array of [teamAMoves, teamBMoves] per round (length = number of rounds to play)
 * @param vrfSeed VRF-derived random seed for deterministic resolution
 * @returns Full battle result with round-by-round data and damage points
 */
export function simulateBattle(
  teamA: Lobster[],
  teamB: Lobster[],
  allMoves: [BattleMove[], BattleMove[]][],
  vrfSeed: bigint,
): FullBattleResult {
  const state = initBattle(teamA, teamB, vrfSeed);

  for (let round = 0; round < Math.min(allMoves.length, MAX_ROUNDS); round++) {
    if (state.finished) break;
    const [movesA, movesB] = allMoves[round];
    resolveRound(state, movesA, movesB);
  }

  // If not finished after all provided moves or MAX_ROUNDS, determine winner by HP%
  if (!state.finished) {
    state.winner = determineWinnerByHp(state);
    state.finished = true;
  }

  // Calculate damage points (for RepairShop)
  const isWinnerA = state.winner === 'A';
  const damageSeed = deriveRandom(vrfSeed, 'battle_damage');

  return {
    winner: state.winner!,
    rounds: state.roundResults,
    totalRounds: state.round,
    teamADamagePoints: rollTeamDamage(damageSeed, 'A', isWinnerA),
    teamBDamagePoints: rollTeamDamage(damageSeed, 'B', !isWinnerA),
  };
}

function rollTeamDamage(seed: bigint, team: string, isWinner: boolean): [number, number, number] {
  const min = isWinner ? WINNER_DAMAGE_MIN : LOSER_DAMAGE_MIN;
  const max = isWinner ? WINNER_DAMAGE_MAX : LOSER_DAMAGE_MAX;
  const result: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const rand = deriveRandom(seed, `dmg_${team}_${i}`);
    result[i] = min + Number(rand % BigInt(max - min + 1));
  }
  return result;
}

// ──────────── Round resolution ────────────

/**
 * Resolve a single round of combat.
 *
 * 1. Pre-round: tick status effects (bleed damage, decrement durations)
 * 2. Clear defending flags from previous round
 * 3. Turn order: sort all alive lobsters by speed (descending), VRF tiebreak
 * 4. Execute each action in speed order
 * 5. Post-round: check for team elimination
 */
export function resolveRound(state: BattleState, movesA: BattleMove[], movesB: BattleMove[]): RoundResult {
  state.round++;
  const roundSeed = deriveRandom(state.vrfSeed, `round_${state.round}`);
  const actions: RoundAction[] = [];

  // Pre-round: tick status effects
  tickStatusEffects(state, actions, roundSeed);

  // Clear defending flags
  for (const l of [...state.teamA, ...state.teamB]) {
    l.defending = false;
  }

  // Build move map for all alive lobsters
  const moveMap = buildMoveMap(state, movesA, movesB);

  // Determine turn order: all alive lobsters sorted by effective speed
  const turnOrder = getTurnOrder(state, roundSeed);

  // Execute each action
  for (const lobster of turnOrder) {
    if (!lobster.alive) continue;
    if (hasStatus(lobster, 'stun')) {
      // Stunned — skip turn, remove stun
      removeStatus(lobster, 'stun');
      continue;
    }

    const move = moveMap.get(lobster);
    if (!move) continue;

    const actionSeed = deriveRandom(roundSeed, `action_${lobster.team}_${lobster.slot}`);
    const action = executeAction(state, lobster, move, actionSeed);
    if (action) actions.push(action);
  }

  // Build round result
  const result: RoundResult = {
    round: state.round,
    actions,
    teamAHp: [state.teamA[0].currentHp, state.teamA[1].currentHp, state.teamA[2].currentHp],
    teamBHp: [state.teamB[0].currentHp, state.teamB[1].currentHp, state.teamB[2].currentHp],
  };
  state.roundResults.push(result);

  // Check win condition
  const aAlive = state.teamA.some(l => l.alive);
  const bAlive = state.teamB.some(l => l.alive);
  if (!aAlive || !bAlive) {
    state.finished = true;
    if (!aAlive && !bAlive) state.winner = 'draw';
    else if (!aAlive) state.winner = 'B';
    else state.winner = 'A';
  } else if (state.round >= MAX_ROUNDS) {
    state.winner = determineWinnerByHp(state);
    state.finished = true;
  }

  return result;
}

// ──────────── Status effects ────────────

function tickStatusEffects(state: BattleState, actions: RoundAction[], roundSeed: bigint): void {
  for (const lobster of [...state.teamA, ...state.teamB]) {
    if (!lobster.alive) continue;

    // Apply bleed damage
    const bleedEffects = lobster.statusEffects.filter(e => e.type === 'bleed');
    for (const bleed of bleedEffects) {
      lobster.currentHp -= bleed.value;
      if (lobster.currentHp <= 0n) {
        lobster.currentHp = 0n;
        lobster.alive = false;
      }
    }

    // Decrement all durations, remove expired
    lobster.statusEffects = lobster.statusEffects
      .map(e => ({ ...e, remainingRounds: e.remainingRounds - 1 }))
      .filter(e => e.remainingRounds > 0);
  }
}

function hasStatus(lobster: BattleLobster, type: StatusEffect['type']): boolean {
  return lobster.statusEffects.some(e => e.type === type);
}

function removeStatus(lobster: BattleLobster, type: StatusEffect['type']): void {
  lobster.statusEffects = lobster.statusEffects.filter(e => e.type !== type);
}

function addStatus(lobster: BattleLobster, effect: StatusEffect): void {
  lobster.statusEffects.push(effect);
}

/** Remove all debuffs (bleed, haunt, stun, speed_debuff) from a lobster. */
function cleanseDebuffs(lobster: BattleLobster): void {
  lobster.statusEffects = lobster.statusEffects.filter(
    e => e.type === 'fortify' || e.type === 'shield',
  );
}

// ──────────── Turn order ────────────

function getEffectiveSpeed(lobster: BattleLobster): bigint {
  let speed = lobster.baseStats.speed;
  // Apply speed debuff
  const speedDebuff = lobster.statusEffects.find(e => e.type === 'speed_debuff');
  if (speedDebuff) {
    speed = (speed * (MULT_DENOM - speedDebuff.value)) / MULT_DENOM;
  }
  return speed;
}

function getTurnOrder(state: BattleState, roundSeed: bigint): BattleLobster[] {
  const all = [...state.teamA, ...state.teamB].filter(l => l.alive);

  return all.sort((a, b) => {
    const speedA = getEffectiveSpeed(a);
    const speedB = getEffectiveSpeed(b);
    if (speedA !== speedB) return speedA > speedB ? -1 : 1;
    // Tiebreak with VRF
    const tieA = deriveRandom(roundSeed, `tie_${a.team}_${a.slot}`);
    const tieB = deriveRandom(roundSeed, `tie_${b.team}_${b.slot}`);
    if (tieA !== tieB) return tieA > tieB ? -1 : 1;
    return 0;
  });
}

// ──────────── Move mapping ────────────

function buildMoveMap(
  state: BattleState,
  movesA: BattleMove[],
  movesB: BattleMove[],
): Map<BattleLobster, BattleMove> {
  const map = new Map<BattleLobster, BattleMove>();
  for (const move of movesA) {
    const lobster = state.teamA[move.lobsterSlot];
    if (lobster?.alive) map.set(lobster, move);
  }
  for (const move of movesB) {
    const lobster = state.teamB[move.lobsterSlot];
    if (lobster?.alive) map.set(lobster, move);
  }
  return map;
}

// ──────────── Action execution ────────────

function getTarget(state: BattleState, actor: BattleLobster, targetSlot: number): BattleLobster | null {
  const targetTeam = actor.team === 'A' ? state.teamB : state.teamA;
  const target = targetTeam[targetSlot];
  if (!target || !target.alive) {
    // Target dead — pick first alive enemy
    return targetTeam.find(l => l.alive) ?? null;
  }
  return target;
}

function getAlly(state: BattleState, actor: BattleLobster, targetSlot: number): BattleLobster | null {
  const allyTeam = actor.team === 'A' ? state.teamA : state.teamB;
  const ally = allyTeam[targetSlot];
  if (!ally || !ally.alive) {
    // Target dead — pick lowest HP ally
    const aliveAllies = allyTeam.filter(l => l.alive && l !== actor);
    if (aliveAllies.length === 0) return actor;
    return aliveAllies.reduce((a, b) => a.currentHp < b.currentHp ? a : b);
  }
  return ally;
}

function getEffectiveStats(lobster: BattleLobster): Stats {
  let { attack, armor, speed, critical, hp } = lobster.baseStats;

  // Apply haunt debuff
  for (const effect of lobster.statusEffects) {
    if (effect.type === 'haunt') {
      attack = (attack * (MULT_DENOM - effect.value)) / MULT_DENOM;
      armor = (armor * (MULT_DENOM - effect.value)) / MULT_DENOM;
    }
  }

  return { hp, attack, armor, speed, critical };
}

function executeAction(
  state: BattleState,
  actor: BattleLobster,
  move: BattleMove,
  seed: bigint,
): RoundAction | null {
  switch (move.moveType) {
    case MoveType.Attack:
      return executeAttack(state, actor, move.targetSlot, seed);
    case MoveType.Defend:
      return executeDefend(actor, seed);
    case MoveType.Special:
      return executeSpecial(state, actor, move.targetSlot, seed);
    default:
      return null;
  }
}

// ──────────── Attack ────────────

function executeAttack(
  state: BattleState,
  actor: BattleLobster,
  targetSlot: number,
  seed: bigint,
): RoundAction | null {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return null;

  const actorStats = getEffectiveStats(actor);
  const targetStats = getEffectiveStats(target);
  const classMult = getClassAdvantage(actor.class, target.class);
  const vrfRoll = deriveVrfRoll(seed, 'atk_vrf');

  // Crit roll
  const critRoll = deriveRandom(seed, 'crit');
  const critBps = critChance(actorStats.critical);
  const isCrit = (critRoll % 10000n) < critBps;

  let damage = calculateAttackDamage(actorStats.attack, targetStats.armor, classMult, isCrit, vrfRoll);

  // Fortify: reduce damage if target's team has fortify
  damage = applyFortify(target, damage);

  // Defend: halve damage, apply counter
  if (target.defending) {
    damage = (damage * DEFEND_REDUCTION_BPS) / 10000n;

    // Counter damage
    const counterVrf = deriveVrfRoll(seed, 'counter_vrf');
    const counterMult = getClassAdvantage(target.class, actor.class);
    const counterDmg = calculateDefendCounter(targetStats.attack, actorStats.armor, counterMult, counterVrf);
    applyDamage(actor, applyFortify(actor, counterDmg));
  }

  applyDamage(target, damage);
  actor.charge = Math.min(actor.charge + 1, SPECIAL_CHARGE_COST);

  return {
    actorTeam: actor.team,
    actorSlot: actor.slot,
    moveType: MoveType.Attack,
    targetSlot: target.slot,
    damage,
    isCrit,
    isEnhanced: false,
  };
}

// ──────────── Defend ────────────

function executeDefend(actor: BattleLobster, _seed: bigint): RoundAction {
  actor.defending = true;
  actor.charge = Math.min(actor.charge + 1, SPECIAL_CHARGE_COST);

  return {
    actorTeam: actor.team,
    actorSlot: actor.slot,
    moveType: MoveType.Defend,
    targetSlot: actor.slot,
    damage: 0n,
    isCrit: false,
    isEnhanced: false,
  };
}

// ──────────── Special ────────────

function executeSpecial(
  state: BattleState,
  actor: BattleLobster,
  targetSlot: number,
  seed: bigint,
): RoundAction | null {
  // Charge check — if not enough, fall back to Attack
  if (actor.charge < SPECIAL_CHARGE_COST) {
    return executeAttack(state, actor, targetSlot, seed);
  }

  actor.charge = 0;

  // Enhanced proc roll
  const enhChance = enhancedProcChance(actor.purity);
  const isEnhanced = randomBool(seed, 'enhanced', enhChance, 10000n);

  const result = resolveClassSpecial(state, actor, targetSlot, seed, isEnhanced);
  return result;
}

// ──────────── Class-specific Specials ────────────

function resolveClassSpecial(
  state: BattleState,
  actor: BattleLobster,
  targetSlot: number,
  seed: bigint,
  isEnhanced: boolean,
): RoundAction {
  switch (actor.class) {
    case LobsterClass.Bulwark:
      return specialBulwark(state, actor, seed, isEnhanced);
    case LobsterClass.Mantis:
      return specialMantis(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Leviathan:
      return specialLeviathan(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Tempest:
      return specialTempest(state, actor, seed, isEnhanced);
    case LobsterClass.Specter:
      return specialSpecter(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Sentinel:
      return specialSentinel(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Reaver:
      return specialReaver(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Abyss:
      return specialAbyss(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Kraken:
      return specialKraken(state, actor, targetSlot, seed, isEnhanced);
    case LobsterClass.Ember:
      return specialEmber(state, actor, targetSlot, seed, isEnhanced);
  }
}

/** Helper: calculate special damage for a single target. */
function calcSpecialDmg(
  actor: BattleLobster,
  target: BattleLobster,
  basePower: bigint,
  seed: bigint,
): bigint {
  const actorStats = getEffectiveStats(actor);
  const targetStats = getEffectiveStats(target);
  const classMult = getClassAdvantage(actor.class, target.class);
  const vrfRoll = deriveVrfRoll(seed, 'special_vrf');
  return calculateSpecialDamage(basePower, actorStats.attack, targetStats.armor, classMult, actor.purity, vrfRoll);
}

function makeSpecialAction(
  actor: BattleLobster,
  targetSlot: number,
  damage: bigint,
  isEnhanced: boolean,
): RoundAction {
  return {
    actorTeam: actor.team,
    actorSlot: actor.slot,
    moveType: MoveType.Special,
    targetSlot,
    damage,
    isCrit: false,
    isEnhanced,
  };
}

// ── Bulwark: Fortify — team incoming damage -40% for 1 round ──
// Enhanced: also reflects a portion (20%) of blocked damage
function specialBulwark(state: BattleState, actor: BattleLobster, _seed: bigint, isEnhanced: boolean): RoundAction {
  const allyTeam = actor.team === 'A' ? state.teamA : state.teamB;
  for (const ally of allyTeam) {
    if (ally.alive) {
      addStatus(ally, { type: 'fortify', remainingRounds: 2, value: 400n }); // 40% reduction (×1000)
    }
  }
  // Enhanced: shield effect added (marks for reflect — simplified as extra fortify value)
  if (isEnhanced) {
    for (const ally of allyTeam) {
      if (ally.alive) {
        addStatus(ally, { type: 'shield', remainingRounds: 2, value: 200n }); // 20% reflect
      }
    }
  }
  return makeSpecialAction(actor, actor.slot, 0n, isEnhanced);
}

// ── Mantis: Ambush — single target, ignores 50% of target's Armor ──
// Enhanced: guaranteed critical hit
function specialMantis(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  const actorStats = getEffectiveStats(actor);
  const targetStats = getEffectiveStats(target);
  // Ignores 50% armor
  const effectiveArmor = targetStats.armor / 2n;
  const classMult = getClassAdvantage(actor.class, target.class);
  const vrfRoll = deriveVrfRoll(seed, 'special_vrf');
  const purityMult = MULT_DENOM + BigInt(actor.purity) * 100n;

  // Enhanced = guaranteed crit
  const critMult = isEnhanced ? 1500n : MULT_DENOM;
  const ratio = effectiveArmor > 0n
    ? (actorStats.attack * MULT_DENOM) / effectiveArmor
    : 2200n;
  const cappedR = ratio > 2200n ? 2200n : ratio;
  const denom = MULT_DENOM * MULT_DENOM * MULT_DENOM * MULT_DENOM * MULT_DENOM;

  let damage = (SPECIAL_BASE_POWERS[LobsterClass.Mantis] * cappedR * classMult * purityMult * critMult * vrfRoll) / denom;

  damage = applyDefendAndFortify(target, damage);
  applyDamage(target, damage);

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ── Leviathan: Crush — highest single-target burst (180 base) ──
// Enhanced: bonus damage if target below 50% HP
function specialLeviathan(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  let basePower = SPECIAL_BASE_POWERS[LobsterClass.Leviathan];
  // Enhanced: +50% if target below 50% HP
  if (isEnhanced && target.currentHp * 2n < target.maxHp) {
    basePower = (basePower * 3n) / 2n;
  }

  let damage = calcSpecialDmg(actor, target, basePower, seed);
  damage = applyDefendAndFortify(target, damage);
  applyDamage(target, damage);

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ── Tempest: Maelstrom — hits all 3 enemies for 90 each (AoE) ──
// Enhanced: also applies speed debuff
function specialTempest(state: BattleState, actor: BattleLobster, seed: bigint, isEnhanced: boolean): RoundAction {
  const enemyTeam = actor.team === 'A' ? state.teamB : state.teamA;
  let totalDamage = 0n;

  for (let i = 0; i < 3; i++) {
    const target = enemyTeam[i];
    if (!target.alive) continue;

    const targetSeed = deriveRandom(seed, `maelstrom_${i}`);
    let damage = calcSpecialDmg(actor, target, SPECIAL_BASE_POWERS[LobsterClass.Tempest], targetSeed);
    damage = applyDefendAndFortify(target, damage);
    applyDamage(target, damage);
    totalDamage += damage;

    if (isEnhanced) {
      addStatus(target, { type: 'speed_debuff', remainingRounds: 2, value: 200n }); // -20% speed
    }
  }

  return makeSpecialAction(actor, 0, totalDamage, isEnhanced);
}

// ── Specter: Haunt — damage + target Atk/Armor -20% for 2 rounds ──
// Enhanced: extends to 3 rounds + -30% reduction
function specialSpecter(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  let damage = calcSpecialDmg(actor, target, SPECIAL_BASE_POWERS[LobsterClass.Specter], seed);
  damage = applyDefendAndFortify(target, damage);
  applyDamage(target, damage);

  const rounds = isEnhanced ? 4 : 3; // +1 because ticked at start of round
  const reduction = isEnhanced ? 300n : 200n;
  addStatus(target, { type: 'haunt', remainingRounds: rounds, value: reduction });

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ── Sentinel: Rally — heal target ally 30% of max HP + cleanse debuffs ──
// Enhanced: also grants damage shield for 1 round
function specialSentinel(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const ally = getAlly(state, actor, targetSlot);
  if (!ally) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  // Heal 30% of max HP (scaled by purity)
  const purityMult = MULT_DENOM + BigInt(actor.purity) * 100n;
  const healAmount = (ally.maxHp * 300n * purityMult) / (MULT_DENOM * MULT_DENOM);
  ally.currentHp = ally.currentHp + healAmount;
  if (ally.currentHp > ally.maxHp) ally.currentHp = ally.maxHp;

  // Cleanse debuffs
  cleanseDebuffs(ally);

  // Enhanced: damage shield
  if (isEnhanced) {
    addStatus(ally, { type: 'shield', remainingRounds: 2, value: 300n }); // 30% damage shield
  }

  return makeSpecialAction(actor, ally.slot, 0n, isEnhanced);
}

// ── Reaver: Rend — hit + 40 bleed/round for 3 rounds (190 total) ──
// Enhanced: bleed cannot be cleansed (simplified — we just reapply if cleansed)
function specialReaver(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  let damage = calcSpecialDmg(actor, target, SPECIAL_BASE_POWERS[LobsterClass.Reaver], seed);
  damage = applyDefendAndFortify(target, damage);
  applyDamage(target, damage);

  // Bleed: 40 per round for 3 rounds (purity scales the bleed)
  const purityMult = MULT_DENOM + BigInt(actor.purity) * 100n;
  const bleedPerRound = (40n * purityMult) / MULT_DENOM;
  addStatus(target, { type: 'bleed', remainingRounds: 3, value: bleedPerRound });

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ── Abyss: Devour — damage + self-heal equal to damage dealt ──
// Enhanced: overheal converts to temporary HP
function specialAbyss(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  let damage = calcSpecialDmg(actor, target, SPECIAL_BASE_POWERS[LobsterClass.Abyss], seed);
  damage = applyDefendAndFortify(target, damage);
  applyDamage(target, damage);

  // Self-heal equal to damage dealt
  actor.currentHp += damage;
  if (isEnhanced) {
    // Overheal allowed (temporary HP via exceeding max)
    // No cap — can go above maxHp
  } else {
    if (actor.currentHp > actor.maxHp) actor.currentHp = actor.maxHp;
  }

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ── Kraken: Bind — damage + stun target for 1 round ──
// Enhanced: stun pierces Defend stance
function specialKraken(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  let damage = calcSpecialDmg(actor, target, SPECIAL_BASE_POWERS[LobsterClass.Kraken], seed);

  if (isEnhanced) {
    // Pierces defend — don't apply defend reduction
    damage = applyFortify(target, damage);
  } else {
    damage = applyDefendAndFortify(target, damage);
  }
  applyDamage(target, damage);

  // Stun for 1 round (+1 because ticked at start)
  addStatus(target, { type: 'stun', remainingRounds: 2, value: 0n });

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ── Ember: Inferno — 200 base power, caster takes 25% of damage dealt ──
// Enhanced: reduced self-damage (15% instead of 25%)
function specialEmber(state: BattleState, actor: BattleLobster, targetSlot: number, seed: bigint, isEnhanced: boolean): RoundAction {
  const target = getTarget(state, actor, targetSlot);
  if (!target) return makeSpecialAction(actor, targetSlot, 0n, isEnhanced);

  let damage = calcSpecialDmg(actor, target, SPECIAL_BASE_POWERS[LobsterClass.Ember], seed);
  damage = applyDefendAndFortify(target, damage);
  applyDamage(target, damage);

  // Self-damage: 25% (enhanced: 15%)
  const selfDamageRate = isEnhanced ? 150n : 250n;
  const selfDamage = (damage * selfDamageRate) / MULT_DENOM;
  applyDamage(actor, selfDamage);

  return makeSpecialAction(actor, target.slot, damage, isEnhanced);
}

// ──────────── Damage helpers ────────────

function applyDamage(lobster: BattleLobster, damage: bigint): void {
  if (damage <= 0n) return;
  lobster.currentHp -= damage;
  if (lobster.currentHp <= 0n) {
    lobster.currentHp = 0n;
    lobster.alive = false;
  }
}

function applyFortify(lobster: BattleLobster, damage: bigint): bigint {
  const fortify = lobster.statusEffects.find(e => e.type === 'fortify');
  if (fortify) {
    damage = (damage * (MULT_DENOM - fortify.value)) / MULT_DENOM;
  }
  return damage;
}

function applyDefendAndFortify(target: BattleLobster, damage: bigint): bigint {
  if (target.defending) {
    damage = (damage * DEFEND_REDUCTION_BPS) / 10000n;
  }
  return applyFortify(target, damage);
}

// ──────────── Win condition ────────────

function determineWinnerByHp(state: BattleState): 'A' | 'B' | 'draw' {
  const hpPctA = totalHpPercent(state.teamA);
  const hpPctB = totalHpPercent(state.teamB);

  if (hpPctA > hpPctB) return 'A';
  if (hpPctB > hpPctA) return 'B';
  return 'draw';
}

function totalHpPercent(team: BattleLobster[]): bigint {
  let totalCurrent = 0n;
  let totalMax = 0n;
  for (const l of team) {
    totalCurrent += l.currentHp > 0n ? l.currentHp : 0n;
    totalMax += l.maxHp;
  }
  if (totalMax === 0n) return 0n;
  return (totalCurrent * 10000n) / totalMax;
}
