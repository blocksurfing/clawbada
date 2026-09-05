'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toHex } from 'viem';
import { useAccount } from 'wagmi';
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

/** Determine which side the player is on. */
function getPlayerSide(battleData: BattleData, address: string): 'A' | 'B' | null {
  const chain = battleData.chain;
  if (chain.playerA.toLowerCase() === address.toLowerCase()) return 'A';
  if (chain.playerB.toLowerCase() === address.toLowerCase()) return 'B';
  return null;
}

export function BattleMoves({ battleId, address, battleData }: BattleMovesProps) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status: txStatus } = useCalldataTx();
  const queryClient = useQueryClient();

  const side = getPlayerSide(battleData, address);
  if (!side) return null;

  const chain = battleData.chain;
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

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} />

      {phase === 'deposit' && (
        <DepositAction battleId={battleId} />
      )}

      {phase === 'commit_team' && (
        <TeamCommitAction battleId={battleId} teamId={side === 'A' ? chain.teamIdA : chain.teamIdB} />
      )}

      {phase === 'reveal_team' && (
        <TeamRevealAction battleId={battleId} teamId={side === 'A' ? chain.teamIdA : chain.teamIdB} />
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

function TeamCommitAction({ battleId, teamId }: { battleId: string; teamId: string }) {
  const { getAuthHeaders } = useAuth();
  const { address } = useAccount();
  const { execute: executeTx, status } = useCalldataTx();

  const handleCommit = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');
    const salt = generateSalt();
    // Store salt for reveal phase
    sessionStorage.setItem(`battle-team-salt-${battleId}`, salt);
    sessionStorage.setItem(`battle-team-id-${battleId}`, teamId);
    // F5-01: the commit hash MUST include the player address to match BattleArena
    // (keccak256(abi.encodePacked(battleId, player, teamId, salt))). The shared
    // teamCommitHash helper is the single source of truth — an earlier inline version
    // omitted the address, so no reveal could ever validate on-chain.
    const commitHash = teamCommitHash(
      BigInt(battleId),
      address,
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

function TeamRevealAction({ battleId, teamId }: { battleId: string; teamId: string }) {
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
      const salt = sessionStorage.getItem(`battle-team-salt-${battleId}`) ?? '';
      const storedTeamId = sessionStorage.getItem(`battle-team-id-${battleId}`) ?? teamId;
      const auth = await getAuthHeaders();
      const res = await api.combat.revealTeam(battleId, storedTeamId, salt, auth);
      // Salt is now server-side; safe to clear locally.
      sessionStorage.removeItem(`battle-team-salt-${battleId}`);
      sessionStorage.removeItem(`battle-team-id-${battleId}`);
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
