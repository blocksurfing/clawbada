/**
 * The evidence bundle for a finished battle (audit 2026-09, D-12). Pure: it depends only on
 * the game logic, so it is tested against the REAL engine (src/__tests__/real/), not the
 * partial mocks the route tests share a process with.
 */
import { v3 } from '@clawbada/game-logic';

export function evidenceBundle(row: {
  id: string; kind: string; status: string; tier: string; vrfRound: number | null; rulesVersion?: string | null;
  roster: unknown; stateJson: string; winner: string | null; finalStateHash: string | null; turnLogHash: string | null;
}) {
  const state = v3.deserializeState(row.stateJson);
  const roster = (row.roster as Array<{ id: string; classId: number; tier: number; purity: number; legend?: boolean; side: string; slot: number }>)
    .map((r) => ({ id: r.id, class: r.classId, tier: r.tier, purity: r.purity, legend: !!r.legend, side: r.side, slot: r.slot }));
  return {
    battleId: row.id,
    kind: row.kind,
    status: row.status,
    tier: row.tier,
    /** The rules this battle was played under, and the rules this server runs NOW. If they
     *  differ, replay with the engine tagged `engine-rules-<first 12 hex of rulesVersion>`. */
    rulesVersion: state.rulesVersion,
    serverRulesVersion: v3.rulesVersion(),
    vrfRound: row.vrfRound,
    vrfSeed: state.vrfSeed.toString(),
    layout: state.layout,
    roster,
    log: state.log,
    winner: row.winner,
    finalStateHash: row.finalStateHash,
    turnLogHash: row.turnLogHash,
  };
}

