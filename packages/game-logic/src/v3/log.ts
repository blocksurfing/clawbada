import { keccak256Packed } from '../hash';
import type { AtbBattleState } from './state';

/** Canonical, order-stable serialization of everything that affects play. */
export function canonicalState(state: AtbBattleState): string {
  const lobsters = [...state.lobsters]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(l => ({
      id: l.id,
      hp: l.hp.toString(),
      alive: l.alive,
      pos: l.pos,
      charge: l.charge,
      defending: l.defending,
      lastTick: l.lastTick.toString(),
      turnsTaken: l.turnsTaken,
      stunImmunity: l.stunImmunity,
      statuses: l.statuses.map(s => ({ t: s.type, n: s.turns, v: s.value.toString(), u: !!s.uncleansable, s: s.since })),
    }));
  return JSON.stringify({ turn: state.turn, tick: state.tick.toString(), finished: state.finished, winner: state.winner, dmg: { A: state.damageDealt.A.toString(), B: state.damageDealt.B.toString() }, rules: { r0: state.rules.fortifyReflectBase.toString(), r1: state.rules.fortifyReflectEnhanced.toString(), sc: state.rules.specialCost, sp: Object.fromEntries(Object.entries(state.rules.specialPower).map(([k, v]) => [k, String(v)])), rb: state.rules.rendBleedPerTurn.toString(), hr: state.rules.hauntReduction.toString(), mv: state.rules.moveRange, am: Object.fromEntries(Object.entries(state.rules.attackMult).map(([k, v]) => [k, String(v)])) }, lobsters });
}

/** keccak256 of the canonical state, hex-encoded (matches on-chain hashing of the same bytes). */
export function hashState(state: AtbBattleState): string {
  return '0x' + keccak256Packed(canonicalState(state)).toString(16).padStart(64, '0');
}
