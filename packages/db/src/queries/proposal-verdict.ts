/**
 * D-06 (audit 2026-09): does an on-chain settlement proposal agree with the battle this
 * server ran? Shared by the indexer (alarm when the proposal lands), the engine's finalize
 * watcher (refuse to complete a payout we did not compute) and the API (tell the players).
 * Pure: no database access.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type ProposalVerdict =
  /** The proposal is the result this server computed. */
  | 'matches'
  /** No session row at all. The honest settle job is only ever enqueued by a session that
   *  FINISHED, so a proposal with no session behind it did not come from that job. This is
   *  what a thief who settles within a second or two of the reveal produces: the API claims a
   *  battle only while its mirrored phase is Active, so it never starts one that is already
   *  AwaitingFinalize — no session, no battle played, and a result on-chain anyway. */
  | 'no_session'
  /** The server is STILL PLAYING this battle, so the honest settle job cannot have proposed anything. */
  | 'session_still_active'
  /** The server finished the battle with a different winner or different hashes. */
  | 'result_mismatch';

export interface SessionResult {
  status: string;
  /** 'A' | 'B' | 'draw' once finished. */
  winner: string | null;
  playerA: string;
  playerB: string;
  finalStateHash: string | null;
  turnLogHash: string | null;
}

export interface OnChainProposal {
  /** Wallet, or the zero address for a draw. */
  proposedWinner: string;
  proposedFinalStateHash: string;
  proposedTurnLogHash: string;
}

export function judgeProposal(session: SessionResult | null | undefined, proposal: OnChainProposal): ProposalVerdict {
  if (!session) return 'no_session';
  if (session.status === 'active') return 'session_still_active';
  const ours =
    session.winner === 'draw' ? ZERO_ADDRESS
    : session.winner === 'A' ? session.playerA.toLowerCase()
    : session.winner === 'B' ? session.playerB.toLowerCase()
    : null;
  const same = (a: string | null, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();
  if (ours !== proposal.proposedWinner.toLowerCase()) return 'result_mismatch';
  if (!same(session.finalStateHash, proposal.proposedFinalStateHash)) return 'result_mismatch';
  if (!same(session.turnLogHash, proposal.proposedTurnLogHash)) return 'result_mismatch';
  return 'matches';
}

/** True for every verdict except a proven match. "Not provably ours" is treated as rogue on
 *  purpose: the costs are lopsided. A false alarm costs a human one look and, at worst, a
 *  manual finalizeBattle (it is permissionless). A missed rogue proposal pays a thief the
 *  whole pot, irreversibly. */
export function isRogueVerdict(v: ProposalVerdict): boolean {
  return v !== 'matches';
}
