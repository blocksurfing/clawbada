/**
 * Wire format for AtbBattleState. The in-memory state is riddled with bigints,
 * so JSON.stringify throws on it; this module gives the live engine a lossless
 * string form (persist snapshots, resume after a restart, ship to clients) and
 * a client-safe projection that strips the VRF seed — every future crit, VRF
 * roll and enhanced proc derives from it, so it must never leave the server.
 */
import type { ArenaLayout } from './board';
import { nextActor, projectBar } from './atb';
import type { AtbBattleState, AtbLobster, BattleRules, Status, Team, TurnLogEntry } from './state';

export const WIRE_VERSION = 1 as const;

export interface WireStatus { type: Status['type']; turns: number; value: string; uncleansable?: boolean; since: number }
export interface WireLobster {
  id: string; team: Team; slot: number; class: number; tier: number; purity: number; legend: boolean;
  stats: { hp: string; attack: string; armor: string; speed: string; critical: string };
  maxHp: string; hp: string; alive: boolean; pos: { col: number; row: number }; charge: number; defending: boolean;
  statuses: WireStatus[]; lastTick: string; turnsTaken: number; stunImmunity: number; recentHits: number; tiebreak: string;
}
export interface WireRules {
  fortifyReflectBase: string; fortifyReflectEnhanced: string;
  moveRange: Record<string, number>; attackMult: Record<string, string>;
  specialCost: number; specialPower: Record<string, string>;
  rendBleedPerTurn: string; hauntReduction: string;
  fortifyTaunt: boolean; focusFalloffBps: string; guardPenaltyBps: string; rallyHealPct: string;
  attackRange: Record<string, number>; firstHitReduction: Record<string, string>;
}
export interface WireState {
  v: typeof WIRE_VERSION;
  battleId: string;
  vrfSeed: string;
  layout: ArenaLayout;
  rules: WireRules;
  lobsters: WireLobster[];
  damageDealt: { A: string; B: string };
  turn: number;
  tick: string;
  finished: boolean;
  winner: Team | 'draw' | null;
  log: TurnLogEntry[];
}

/** What a client may see: everything except the VRF seed, plus the derived HUD bits. */
export interface ClientBattleState extends Omit<WireState, 'vrfSeed'> {
  nextActorId: string | null;
  bar: { lobsterId: string; tick: string }[];
}

const s = (b: bigint) => b.toString();
const strMap = (m: Partial<Record<number, bigint>>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)]));
const numMap = (m: Partial<Record<number, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v as number]));
const bigMapBack = (m: Record<string, string>): Partial<Record<number, bigint>> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), BigInt(v)]));
const numMapBack = (m: Record<string, number>): Partial<Record<number, number>> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), v]));

function lobsterToWire(l: AtbLobster): WireLobster {
  return {
    id: l.id, team: l.team, slot: l.slot, class: l.class, tier: l.tier, purity: l.purity, legend: l.legend,
    stats: { hp: s(l.stats.hp), attack: s(l.stats.attack), armor: s(l.stats.armor), speed: s(l.stats.speed), critical: s(l.stats.critical) },
    maxHp: s(l.maxHp), hp: s(l.hp), alive: l.alive, pos: { col: l.pos.col, row: l.pos.row }, charge: l.charge, defending: l.defending,
    statuses: l.statuses.map(st => ({ type: st.type, turns: st.turns, value: s(st.value), ...(st.uncleansable ? { uncleansable: true } : {}), since: st.since })),
    lastTick: s(l.lastTick), turnsTaken: l.turnsTaken, stunImmunity: l.stunImmunity, recentHits: l.recentHits, tiebreak: s(l.tiebreak),
  };
}

function lobsterFromWire(w: WireLobster): AtbLobster {
  return {
    id: w.id, team: w.team, slot: w.slot, class: w.class, tier: w.tier, purity: w.purity, legend: w.legend,
    stats: { hp: BigInt(w.stats.hp), attack: BigInt(w.stats.attack), armor: BigInt(w.stats.armor), speed: BigInt(w.stats.speed), critical: BigInt(w.stats.critical) },
    maxHp: BigInt(w.maxHp), hp: BigInt(w.hp), alive: w.alive, pos: { col: w.pos.col, row: w.pos.row }, charge: w.charge, defending: w.defending,
    statuses: w.statuses.map(st => ({ type: st.type, turns: st.turns, value: BigInt(st.value), ...(st.uncleansable ? { uncleansable: true } : {}), since: st.since })),
    lastTick: BigInt(w.lastTick), turnsTaken: w.turnsTaken, stunImmunity: w.stunImmunity, recentHits: w.recentHits, tiebreak: BigInt(w.tiebreak),
  };
}

export function rulesToWire(r: BattleRules): WireRules {
  return {
    fortifyReflectBase: s(r.fortifyReflectBase), fortifyReflectEnhanced: s(r.fortifyReflectEnhanced),
    moveRange: numMap(r.moveRange), attackMult: strMap(r.attackMult),
    specialCost: r.specialCost, specialPower: strMap(r.specialPower),
    rendBleedPerTurn: s(r.rendBleedPerTurn), hauntReduction: s(r.hauntReduction),
    fortifyTaunt: r.fortifyTaunt, focusFalloffBps: s(r.focusFalloffBps), guardPenaltyBps: s(r.guardPenaltyBps), rallyHealPct: s(r.rallyHealPct),
    attackRange: numMap(r.attackRange), firstHitReduction: strMap(r.firstHitReduction),
  };
}

export function rulesFromWire(w: WireRules): BattleRules {
  return {
    fortifyReflectBase: BigInt(w.fortifyReflectBase), fortifyReflectEnhanced: BigInt(w.fortifyReflectEnhanced),
    moveRange: numMapBack(w.moveRange), attackMult: bigMapBack(w.attackMult),
    specialCost: w.specialCost, specialPower: bigMapBack(w.specialPower),
    rendBleedPerTurn: BigInt(w.rendBleedPerTurn), hauntReduction: BigInt(w.hauntReduction),
    fortifyTaunt: w.fortifyTaunt, focusFalloffBps: BigInt(w.focusFalloffBps), guardPenaltyBps: BigInt(w.guardPenaltyBps), rallyHealPct: BigInt(w.rallyHealPct),
    attackRange: numMapBack(w.attackRange), firstHitReduction: bigMapBack(w.firstHitReduction),
  };
}

export function toWire(state: AtbBattleState): WireState {
  return {
    v: WIRE_VERSION,
    battleId: state.battleId,
    vrfSeed: s(state.vrfSeed),
    layout: state.layout,
    rules: rulesToWire(state.rules),
    lobsters: state.lobsters.map(lobsterToWire),
    damageDealt: { A: s(state.damageDealt.A), B: s(state.damageDealt.B) },
    turn: state.turn,
    tick: s(state.tick),
    finished: state.finished,
    winner: state.winner,
    log: state.log.map(e => ({ ...e })),
  };
}

export function fromWire(w: WireState): AtbBattleState {
  if (w.v !== WIRE_VERSION) throw new Error(`Unsupported battle wire version ${String(w.v)} (expected ${WIRE_VERSION})`);
  return {
    battleId: w.battleId,
    vrfSeed: BigInt(w.vrfSeed),
    layout: w.layout,
    rules: rulesFromWire(w.rules),
    lobsters: w.lobsters.map(lobsterFromWire),
    damageDealt: { A: BigInt(w.damageDealt.A), B: BigInt(w.damageDealt.B) },
    turn: w.turn,
    tick: BigInt(w.tick),
    finished: w.finished,
    winner: w.winner,
    log: w.log.map(e => ({ ...e })),
  };
}

/** Lossless JSON string (bigints as decimal strings). */
export function serializeState(state: AtbBattleState): string {
  return JSON.stringify(toWire(state));
}

export function deserializeState(json: string): AtbBattleState {
  return fromWire(JSON.parse(json) as WireState);
}

/**
 * Client-safe projection: the wire state minus the VRF seed, plus who acts
 * next and the projected bar. Clients rebuild a seedless state with
 * `fromWire({ ...view, vrfSeed: '0' })` for legality/highlight queries — none
 * of legalMoves / attackTargets / specialTargets read the seed; only applyTurn does.
 */
export function clientView(state: AtbBattleState): ClientBattleState {
  const { vrfSeed: _seed, ...rest } = toWire(state);
  void _seed;
  const actor = state.finished ? null : nextActor(state);
  return {
    ...rest,
    nextActorId: actor?.id ?? null,
    bar: state.finished ? [] : projectBar(state).map(b => ({ lobsterId: b.lobsterId, tick: s(b.tick) })),
  };
}
