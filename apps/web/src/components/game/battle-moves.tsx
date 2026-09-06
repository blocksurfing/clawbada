'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toHex } from 'viem';
import { teamCommitHash } from '@clawbada/chain';
import { api, type BattleData } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useCalldataTx } from '@/hooks/use-calldata-tx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

/**
 * Pre-battle on-chain actions for a participant: deposit, team commit, team
 * reveal. V3: once both teams are revealed the battle itself runs off-chain over
 * WebSocket (live page + session manager), so this component only shows a
 * "battle in progress" state from that point on.
 */
interface BattleMovesProps {
  battleId: string;
  address: string;
  battleData: BattleData;
}

function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** Determine which side the player is on. Returns null when chain is null
 *  (PR-B X1: pending_create window before the engine confirms createBattle). */
function getPlayerSide(battleData: BattleData, address: string): 'A' | 'B' | null {
  const chain = battleData.chain;
  if (!chain) return null;
  if (chain.playerA.toLowerCase() === address.toLowerCase()) return 'A';
  if (chain.playerB.toLowerCase() === address.toLowerCase()) return 'B';
  return null;
}

export function BattleMoves({ battleId, address, battleData }: BattleMovesProps) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status: txStatus } = useCalldataTx();
  const queryClient = useQueryClient();

  const side = getPlayerSide(battleData, address);

  // A2: pre-reveal team ID source. `chain.teamIdA/B` are 0 until revealTeam
  // lands on-chain, so the commit hash must bind the queued team ID instead.
  // The server-side endpoint returns only the authenticated caller's own
  // queued team — opponent's stays redacted to preserve commit-reveal secrecy.
  //
  // A2-FU MEDIUM: queryKey includes the lowercased wallet address. Without
  // it, two participant wallets sharing the same browser session could see
  // each other's cached queued team data via the shared TanStack
  // QueryClient — a commit-reveal secrecy leak.
  const lowerAddress = address.toLowerCase();
  const myTeamQuery = useQuery({
    queryKey: ['battle-my-team', battleId, lowerAddress],
    queryFn: async () => {
      const auth = await getAuthHeaders();
      return api.combat.getMyTeam(battleId, auth);
    },
    enabled: !!side,
  });
  const myQueuedTeamId = myTeamQuery.data?.myTeamId ?? null;

  if (!side) return null;

  const chain = battleData.chain;
  // PR-B X1: getPlayerSide already returned null if chain was null, so this
  // re-guard is a no-op at runtime but lets TS narrow chain to non-null.
  if (!chain) return null;
  const myDeposit = side === 'A' ? chain.depositA : chain.depositB;
  const oppDeposit = side === 'A' ? chain.depositB : chain.depositA;
  const myTeamCommit = side === 'A' ? chain.teamCommitA : chain.teamCommitB;
  const oppTeamCommit = side === 'A' ? chain.teamCommitB : chain.teamCommitA;
  const myTeamRevealed = side === 'A' ? chain.teamRevealedA : chain.teamRevealedB;
  const oppTeamRevealed = side === 'A' ? chain.teamRevealedB : chain.teamRevealedA;

  const hasMyTeamCommit = myTeamCommit !== '0x0000000000000000000000000000000000000000000000000000000000000000';
  const hasOppTeamCommit = oppTeamCommit !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Determine current action needed. Contract phases: 4 = Active (off-chain
  // battle running), 5 = AwaitingFinalize (settle proposed), 6 = Settled.
  let phase: 'deposit' | 'wait_deposit' | 'commit_team' | 'wait_team_commit' | 'reveal_team' | 'wait_team_reveal' | 'in_battle' | 'awaiting_finalize' | 'settled';

  if (chain.phase >= 6) {
    phase = 'settled';
  } else if (chain.phase === 5) {
    phase = 'awaiting_finalize';
  } else if (!myDeposit) {
    phase = 'deposit';
  } else if (!oppDeposit) {
    phase = 'wait_deposit';
  } else if (!hasMyTeamCommit) {
    phase = 'commit_team';
  } else if (!hasOppTeamCommit) {
    phase = 'wait_team_commit';
  } else if (!myTeamRevealed) {
    phase = 'reveal_team';
  } else if (!oppTeamRevealed) {
    phase = 'wait_team_reveal';
  } else {
    phase = 'in_battle';
  }

  // X13: surface handleTimeout button when the chain phase deadline has
  // elapsed. Contract routes to cancel/finalize/emergency-exit per the
  // current phase (BattleArena.sol:727). Anyone can call on chain — auth
  // server-side is for telemetry + rate-limit only.
  const showHandleTimeout = isTimeoutable(chain);

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} />

      {showHandleTimeout && (
        <HandleTimeoutAction battleId={battleId} />
      )}

      {phase === 'deposit' && (
        <DepositAction battleId={battleId} />
      )}

      {phase === 'commit_team' && (
        myQueuedTeamId ? (
          <TeamCommitAction battleId={battleId} address={address} teamId={myQueuedTeamId} />
        ) : (
          <PrivateTeamLoadingOrError query={myTeamQuery} />
        )
      )}

      {phase === 'reveal_team' && (
        /* A2-FU MEDIUM: no chain-teamId fallback. Pre-reveal `chain.teamIdA/B`
           is '0' and reveal with teamId=0 reverts (and also defeats the
           wallet+battle-scoped sessionStorage protection). Gate the action
           on the API-sourced `myQueuedTeamId`. Reveal still prefers the
           wallet-scoped sessionStorage teamId stored at commit; this prop
           is only the fallback if sessionStorage was lost. */
        myQueuedTeamId ? (
          <TeamRevealAction battleId={battleId} address={address} teamId={myQueuedTeamId} />
        ) : (
          <PrivateTeamLoadingOrError query={myTeamQuery} />
        )
      )}

      {phase === 'in_battle' && (
        <div className="border border-border rounded-md p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Both teams are revealed. The battle runs live over WebSocket — open the battle page to play.
          </p>
        </div>
      )}

      {phase.startsWith('wait_') && (
        <div className="border border-border rounded-md p-6 text-center">
          <Loader2 className="size-5 mx-auto animate-spin text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Waiting for opponent...</p>
        </div>
      )}
    </div>
  );
}

function PhaseIndicator({ phase }: { phase: string }) {
  const labels: Record<string, string> = {
    deposit: 'Deposit Stake',
    wait_deposit: 'Waiting for Opponent Deposit',
    commit_team: 'Commit Team',
    wait_team_commit: 'Waiting for Opponent Team Commit',
    reveal_team: 'Reveal Team',
    wait_team_reveal: 'Waiting for Opponent Team Reveal',
    in_battle: 'Battle in Progress',
    awaiting_finalize: 'Result Proposed — Dispute Window Open',
    settled: 'Battle Settled',
  };

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="text-xs">
        {phase.startsWith('wait_') ? (
          <Loader2 className="size-3 animate-spin mr-1" />
        ) : null}
        {labels[phase] ?? phase}
      </Badge>
    </div>
  );
}

function DepositAction({ battleId }: { battleId: string }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const handleDeposit = useCallback(async () => {
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.deposit(battleId, auth);
    await executeTx(steps);
  }, [battleId, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';

  return (
    <div className="border border-border rounded-md p-6 text-center space-y-3">
      <p className="text-sm text-muted-foreground">Deposit your stake + 5% anti-grief deposit to begin.</p>
      <Button onClick={handleDeposit} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Processing...</> : 'Deposit Stake'}
      </Button>
    </div>
  );
}

/** A2-FU MEDIUM: distinguish "still loading" from "API errored" from
 *  "API returned null myTeamId" so the user gets the right signal.
 *  - loading → spinner
 *  - errored (network / auth-signature timeout / 5xx) → retry button
 *  - resolved with myTeamId === null → repair-needed (legacy battle row
 *    predating the A2 schema migration, or indexer-fallback insert)
 *
 *  Codex A2-FU-03 follow-up: conflating errored with null-data was
 *  misleading — a transient signature timeout shouldn't tell the user
 *  the battle needs ops repair. */
function PrivateTeamLoadingOrError({
  query,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
    data?: { myTeamId: string | null } | undefined;
  };
}) {
  if (query.isLoading) {
    return (
      <div className="border border-border rounded-md p-6 text-center">
        <Loader2 className="size-5 mx-auto animate-spin text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Loading team selection...</p>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="border border-coral/40 rounded-md p-6 text-center bg-coral/5">
        <p className="text-sm font-medium">Couldn&apos;t load team selection</p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          The server didn&apos;t respond. Check your connection and retry.
        </p>
        <Button onClick={() => query.refetch()} size="sm" variant="secondary">
          Retry
        </Button>
      </div>
    );
  }
  // Codex A2-FU2: only render the repair-needed branch when we've actually
  // observed `myTeamId === null` in a resolved response. TanStack v5's
  // `isLoading` is "pending && actively fetching" — a paused or
  // not-yet-fetched query has `data === undefined` AND `isLoading === false`,
  // which would otherwise fall through to repair-needed and mislead the user.
  if (query.data?.myTeamId === null) {
    return (
      <div className="border border-coral/40 rounded-md p-6 text-center bg-coral/5">
        <p className="text-sm font-medium">Team selection not available</p>
        <p className="text-xs text-muted-foreground mt-1">
          This battle is in a repair-needed state. Please contact support if it persists.
        </p>
      </div>
    );
  }
  // data === undefined && !isLoading && !isError → render a neutral
  // not-ready state. The caller's gating logic should have already routed
  // to the success branch when data was present.
  return (
    <div className="border border-border rounded-md p-6 text-center">
      <Loader2 className="size-5 mx-auto animate-spin text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">Preparing battle...</p>
    </div>
  );
}

/** X13: returns true when the chain phase deadline has elapsed AND the
 *  battle is in a phase the contract's `handleTimeout` will accept (i.e.
 *  not None/Settled/Cancelled). Mirrors BattleArena.sol:727 phase gate.
 *
 *  X13 LOW-01: disputed AwaitingFinalize battles route through
 *  `adminResolveDispute`, not `handleTimeout` — the contract reverts
 *  `DisputedBattleRequiresAdmin`. Hide the CTA in that state.
 *  V3: during Active the resolver settles; only after ACTIVE_WINDOW does
 *  handleTimeout succeed (mutual cancel + refund). */
function isTimeoutable(chain: BattleData['chain']): boolean {
  if (!chain) return false;
  // Contract phase enum: 0=None, 1=Deposit, 2=TeamCommit, 3=TeamReveal,
  // 4=Active, 5=AwaitingFinalize, 6=Settled, 7=Cancelled.
  if (chain.phase < 1 || chain.phase > 5) return false;
  // LOW-01: dispute path is admin-only.
  if (chain.phase === 5 && chain.disputed) return false;
  // V3: the Active phase has a single ACTIVE_WINDOW deadline; past it,
  // handleTimeout mutually cancels with full refunds (no per-round ladder).
  const now = BigInt(Math.floor(Date.now() / 1000));
  // AwaitingFinalize uses `payoutDeadline`; everything else uses `phaseDeadline`.
  const deadline = chain.phase === 5
    ? BigInt(chain.payoutDeadline ?? '0')
    : BigInt(chain.phaseDeadline ?? '0');
  if (deadline === 0n) return false;
  return now > deadline;
}

/** X13: permissionless handleTimeout button. Visible when the chain
 *  deadline for the current phase has elapsed. Calling it routes through
 *  the contract's phase-specific cleanup (cancel for stake-time deadlines,
 *  finalize for AwaitingFinalize, emergency exit for Active stalls).
 *  See BattleArena.sol:727+. */
function HandleTimeoutAction({ battleId }: { battleId: string }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const handleClick = useCallback(async () => {
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.handleTimeout(battleId, auth);
    await executeTx(steps);
  }, [battleId, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';

  return (
    <div className="border border-claw-gold/40 rounded-md p-5 text-center space-y-2 bg-claw-gold/5">
      <p className="text-sm font-medium">Battle stuck past its deadline</p>
      <p className="text-xs text-text-secondary">
        Force the contract to resolve this phase (cancel + refund, or finalize the proposed
        outcome). Anyone can call — auth here is for telemetry.
      </p>
      <Button onClick={handleClick} disabled={busy} size="sm" variant="secondary">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Submitting...</> : 'Handle timeout'}
      </Button>
    </div>
  );
}

function TeamCommitAction({ battleId, address, teamId }: { battleId: string; address: string; teamId: string }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const handleCommit = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');
    const salt = generateSalt();
    // A2-FU MEDIUM: sessionStorage keys scoped by lowercased wallet address.
    // Otherwise wallet B could read wallet A's stored salt/teamId in the
    // same browser session (commit-reveal secrecy leak + cross-wallet
    // corruption when wallet B tries to reveal A's commit).
    const lower = address.toLowerCase();
    sessionStorage.setItem(`battle-team-salt-${battleId}-${lower}`, salt);
    sessionStorage.setItem(`battle-team-id-${battleId}-${lower}`, teamId);
    // F5-01: the commit hash MUST include the player address to match BattleArena
    // (keccak256(abi.encodePacked(battleId, player, teamId, salt))). The shared
    // teamCommitHash helper is the single source of truth — an earlier inline version
    // omitted the address, so no reveal could ever validate on-chain.
    const commitHash = teamCommitHash(
      BigInt(battleId),
      address as `0x${string}`,
      BigInt(teamId),
      salt as `0x${string}`,
    );
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.commitTeam(battleId, commitHash, auth);
    await executeTx(steps);
  }, [battleId, teamId, address, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';

  return (
    <div className="border border-border rounded-md p-6 text-center space-y-3">
      <p className="text-sm">Commit your team composition.</p>
      <p className="text-xs text-muted-foreground">Your opponent won't see your team until both sides reveal.</p>
      <Button onClick={handleCommit} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Committing...</> : 'Commit Team'}
      </Button>
    </div>
  );
}

function TeamRevealAction({ battleId, address, teamId }: { battleId: string; address: string; teamId: string }) {
  const { getAuthHeaders } = useAuth();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // F5-01: revealing no longer submits an on-chain tx. The player sends their salt to the
  // server; once BOTH players' salts are in, the resolver submits a single atomic revealTeams
  // for both teams. This closes the matchup-dodge (nothing leaks from a one-sided reveal) and
  // means a dropped connection here costs nothing — the reveal window times out to a full
  // mutual refund.
  const handleReveal = useCallback(async () => {
    setBusy(true);
    try {
      const lower = address.toLowerCase();
      const salt = sessionStorage.getItem(`battle-team-salt-${battleId}-${lower}`) ?? '';
      const storedTeamId = sessionStorage.getItem(`battle-team-id-${battleId}-${lower}`) ?? teamId;
      const auth = await getAuthHeaders();
      const res = await api.combat.revealTeam(battleId, storedTeamId, salt, auth);
      // Salt is now server-side; safe to clear locally.
      sessionStorage.removeItem(`battle-team-salt-${battleId}-${lower}`);
      sessionStorage.removeItem(`battle-team-id-${battleId}-${lower}`);
      setWaiting(res.status === 'waiting_for_opponent');
    } finally {
      setBusy(false);
    }
  }, [battleId, teamId, getAuthHeaders]);

  if (waiting) {
    return (
      <div className="border border-border rounded-md p-6 text-center space-y-3">
        <p className="text-sm">Team submitted. Waiting for your opponent to reveal…</p>
        <p className="text-xs text-muted-foreground">
          Both teams open at once — neither side sees the other first.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-md p-6 text-center space-y-3">
      <p className="text-sm">Both teams committed. Submit your team to reveal.</p>
      <Button onClick={handleReveal} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Submitting...</> : 'Reveal Team'}
      </Button>
    </div>
  );
}

/** Get the latest HP values for a side from round data. */
