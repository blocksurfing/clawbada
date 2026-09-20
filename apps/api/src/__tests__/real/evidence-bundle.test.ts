/**
 * D-12 / D-27, against the REAL engine (this group runs unmocked, in its own process): from the
 * evidence bundle alone — as plain JSON, the way it crosses the wire — a stranger replays the
 * battle and rebuilds the commitment that goes on-chain.
 */
import { describe, expect, test } from 'bun:test';
import { v3, EvolutionTier, LobsterClass } from '@clawbada/game-logic';
import { evidenceBundle } from '../../lib/battle-session/evidence';

const classes = { A: [LobsterClass.Reaver, LobsterClass.Kraken, LobsterClass.Ember], B: [LobsterClass.Bulwark, LobsterClass.Abyss, LobsterClass.Tempest] };
const inputs = (side: 'A' | 'B') => classes[side].map((c, i) => ({ id: `${side}${i}`, class: c, tier: EvolutionTier.Evolved, purity: i }));

function finishedRow(end: 'wipeout' | 'timeout-forfeit') {
  const cfg = { battleId: '42', vrfSeed: 987654321n, tier: 'evolved' as const, teamA: inputs('A'), teamB: inputs('B') };
  const state = v3.createBattle(cfg);
  if (end === 'wipeout') {
    v3.runBattle(state, { A: v3.BOTS.balanced, B: v3.BOTS.balanced });
  } else {
    let clock: v3.SessionClock = { timeouts: { A: 0, B: 0 } };
    while (!state.finished) {
      const actor = v3.nextActor(state)!;
      const stunned = actor.statuses.some((st) => st.type === 'stun');
      const ev: v3.SessionEvent = stunned ? { type: 'stun_skip' } : actor.team === 'B' ? { type: 'timeout' } : { type: 'command', cmd: v3.BOTS.balanced(state, actor) };
      clock = v3.reduceSession(state, clock, ev).clock;
    }
  }
  const roster = (['A', 'B'] as const).flatMap((side) => inputs(side).map((l, slot) => ({ id: l.id, side, slot, classId: l.class, tier: l.tier, purity: l.purity, legend: false, owner: side })));
  return {
    id: '42', kind: 'real', status: 'settled', tier: 'evolved', vrfRound: 5_555, rulesVersion: state.rulesVersion, roster,
    stateJson: v3.serializeState(state), winner: state.winner, finalStateHash: v3.hashState(state), turnLogHash: v3.turnLogHash(state, [...cfg.teamA, ...cfg.teamB]),
  };
}

/** What a third party does with the bundle. Nothing here touches the server or its database. */
function strangerVerifies(wire: any) {
  const team = (side: string) => wire.roster.filter((r: any) => r.side === side).sort((a: any, b: any) => a.slot - b.slot).map((r: any) => ({ id: r.id, class: r.class, tier: r.tier, purity: r.purity, legend: r.legend }));
  const cfg = { battleId: wire.battleId, vrfSeed: BigInt(wire.vrfSeed), tier: wire.tier, layout: wire.layout, teamA: team('A'), teamB: team('B'), rulesVersion: wire.rulesVersion };
  const verdict = v3.verifyLog(cfg, wire.log);
  return { cfg, verdict, turnLogHash: verdict.ok ? v3.turnLogHash(verdict.state, [...cfg.teamA, ...cfg.teamB]) : null, finalStateHash: verdict.ok ? v3.hashState(verdict.state) : null };
}

const overTheWire = (bundle: unknown) => JSON.parse(JSON.stringify(bundle, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

describe('evidence bundle (D-12 / D-27)', () => {
  test('a battle fought to the end: the stranger rebuilds both on-chain commitments', () => {
    const row = finishedRow('wipeout');
    const wire = overTheWire(evidenceBundle(row));
    expect(wire).toMatchObject({ battleId: '42', vrfRound: 5_555, vrfSeed: '987654321', rulesVersion: v3.RULES_VERSION, serverRulesVersion: v3.RULES_VERSION });
    const r = strangerVerifies(wire);
    expect(r.verdict.ok).toBe(true);
    expect(r.turnLogHash).toBe(row.turnLogHash);
    expect(r.finalStateHash).toBe(row.finalStateHash);
  });

  test('a battle that ended by timeout forfeit: the bundle explains it, and it verifies', () => {
    const row = finishedRow('timeout-forfeit');
    const wire = overTheWire(evidenceBundle(row));
    expect(wire.log.at(-1)).toMatchObject({ action: 'forfeit', loser: 'B', reason: 'timeout' });
    expect(wire.log.filter((e: any) => e.timeout)).toHaveLength(v3.TIMEOUTS_TO_FORFEIT);
    const r = strangerVerifies(wire);
    expect(r.verdict.ok).toBe(true);
    expect(r.turnLogHash).toBe(row.turnLogHash);
  });

  test('a doctored log does not rebuild the commitment', () => {
    const row = finishedRow('wipeout');
    const wire = overTheWire(evidenceBundle(row));
    // Hide that side B ever timed out / change who acted: any edit breaks a per-turn hash or the commitment.
    const edited = { ...wire, log: wire.log.map((e: any, i: number) => (i === 0 ? { ...e, action: 'defend', targetId: undefined, moveTo: undefined } : e)) };
    const r = strangerVerifies(edited);
    expect(r.verdict.ok && r.turnLogHash === row.turnLogHash).toBe(false);
  });

  test('a bundle claiming other rules is refused rather than mis-verified', () => {
    const wire = overTheWire(evidenceBundle(finishedRow('wipeout')));
    const r = strangerVerifies({ ...wire, rulesVersion: '0x' + 'ab'.repeat(32) });
    expect(r.verdict.ok).toBe(false);
  });
});
