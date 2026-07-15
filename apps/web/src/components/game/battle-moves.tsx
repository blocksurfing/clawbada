'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keccak256, encodePacked, toHex } from 'viem';
import { useAccount } from 'wagmi';
import { teamCommitHash } from '@clawbada/chain';
import { api, type BattleData, type RoundData } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useCalldataTx } from '@/hooks/use-calldata-tx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, Swords, Zap } from 'lucide-react';

const MOVE_TYPES = [
  { id: 0, label: 'Attack', icon: Swords, color: 'text-coral', needsTarget: true },
  { id: 1, label: 'Defend', icon: Shield, color: 'text-ocean', needsTarget: false },
  { id: 2, label: 'Special', icon: Zap, color: 'text-claw-gold', needsTarget: true },
] as const;

interface LobsterSlot {
  moveType: number;
  targetSlot: number;
}

interface BattleMovesProps {
  battleId: string;
  address: string;
  battleData: BattleData;
  rounds: RoundData[];
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

export function BattleMoves({ battleId, address, battleData, rounds }: BattleMovesProps) {
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
  const myRoundCommit = side === 'A' ? chain.roundCommitA : chain.roundCommitB;
  const oppRoundCommit = side === 'A' ? chain.roundCommitB : chain.roundCommitA;
  const myRoundRevealed = side === 'A' ? chain.roundRevealedA : chain.roundRevealedB;
  const oppRoundRevealed = side === 'A' ? chain.roundRevealedB : chain.roundRevealedA;

  const hasMyTeamCommit = myTeamCommit !== '0x0000000000000000000000000000000000000000000000000000000000000000';
  const hasOppTeamCommit = oppTeamCommit !== '0x0000000000000000000000000000000000000000000000000000000000000000';
  const hasMyRoundCommit = myRoundCommit !== '0x0000000000000000000000000000000000000000000000000000000000000000';
  const hasOppRoundCommit = oppRoundCommit !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Determine current action needed
  let phase: 'deposit' | 'wait_deposit' | 'commit_team' | 'wait_team_commit' | 'reveal_team' | 'wait_team_reveal' | 'commit_moves' | 'wait_move_commit' | 'reveal_moves' | 'wait_move_reveal' | 'settled';

  if (chain.winner && chain.winner !== '0x0000000000000000000000000000000000000000') {
    phase = 'settled';
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
  } else if (!hasMyRoundCommit) {
    phase = 'commit_moves';
  } else if (!hasOppRoundCommit) {
    phase = 'wait_move_commit';
  } else if (!myRoundRevealed) {
    phase = 'reveal_moves';
  } else if (!oppRoundRevealed) {
    phase = 'wait_move_reveal';
  } else {
    // Both revealed — server will resolve round and reset commits
    phase = 'commit_moves';
  }

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} round={chain.currentRound} />

      {phase === 'deposit' && (
        <DepositAction battleId={battleId} />
      )}

      {phase === 'commit_team' && (
        <TeamCommitAction battleId={battleId} teamId={side === 'A' ? chain.teamIdA : chain.teamIdB} />
      )}

      {phase === 'reveal_team' && (
        <TeamRevealAction battleId={battleId} teamId={side === 'A' ? chain.teamIdA : chain.teamIdB} />
      )}

      {phase === 'commit_moves' && (
        <MoveCommitAction
          battleId={battleId}
          round={chain.currentRound}
          teamHp={side === 'A' ? getLatestHp(rounds, 'A') : getLatestHp(rounds, 'B')}
        />
      )}

      {phase === 'reveal_moves' && (
        <MoveRevealAction battleId={battleId} />
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

function PhaseIndicator({ phase, round }: { phase: string; round: number }) {
  const labels: Record<string, string> = {
    deposit: 'Deposit Stake',
    wait_deposit: 'Waiting for Opponent Deposit',
    commit_team: 'Commit Team',
    wait_team_commit: 'Waiting for Opponent Team Commit',
    reveal_team: 'Reveal Team',
    wait_team_reveal: 'Waiting for Opponent Team Reveal',
    commit_moves: `Round ${round} — Select Moves`,
    wait_move_commit: `Round ${round} — Waiting for Opponent`,
    reveal_moves: `Round ${round} — Reveal Moves`,
    wait_move_reveal: `Round ${round} — Waiting for Opponent Reveal`,
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

function MoveCommitAction({
  battleId,
  round,
  teamHp,
}: {
  battleId: string;
  round: number;
  teamHp: string[];
}) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const [slots, setSlots] = useState<LobsterSlot[]>([
    { moveType: 0, targetSlot: 0 },
    { moveType: 0, targetSlot: 1 },
    { moveType: 0, targetSlot: 2 },
  ]);

  const updateSlot = useCallback((index: number, update: Partial<LobsterSlot>) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)));
  }, []);

  const handleCommit = useCallback(async () => {
    const salt = generateSalt();
    sessionStorage.setItem(`battle-move-salt-${battleId}-${round}`, salt);

    // Encode moves: pack as (moveType, targetSlot) per lobster
    const moveData = encodePacked(
      ['uint8', 'uint8', 'uint8', 'uint8', 'uint8', 'uint8'],
      [
        slots[0].moveType, slots[0].targetSlot,
        slots[1].moveType, slots[1].targetSlot,
        slots[2].moveType, slots[2].targetSlot,
      ],
    );
    sessionStorage.setItem(`battle-move-data-${battleId}-${round}`, moveData);

    const commitHash = keccak256(
      encodePacked(['uint256', 'uint256', 'bytes', 'bytes32'], [BigInt(battleId), BigInt(round), moveData as `0x${string}`, salt as `0x${string}`]),
    );

    const auth = await getAuthHeaders();
    const { steps } = await api.combat.commitMoves(battleId, commitHash, auth);
    await executeTx(steps);
  }, [battleId, round, slots, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';

  return (
    <div className="border border-border rounded-md p-5 space-y-4">
      <p className="text-sm font-medium">Select moves for your team</p>

      <div className="space-y-3">
        {slots.map((slot, i) => {
          const hp = teamHp[i];
          const isKO = hp === '0';

          return (
            <div key={i} className={`border border-border rounded-md p-3 space-y-2 ${isKO ? 'opacity-40' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Lobster {i + 1}</span>
                <span className="text-xs text-muted-foreground font-mono">HP: {hp ?? '?'}</span>
              </div>

              {!isKO && (
                <>
                  <div className="flex gap-1.5">
                    {MOVE_TYPES.map((move) => {
                      const Icon = move.icon;
                      const active = slot.moveType === move.id;
                      return (
                        <button
                          key={move.id}
                          onClick={() => updateSlot(i, { moveType: move.id })}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-colors border ${
                            active
                              ? `border-foreground/30 bg-secondary ${move.color}`
                              : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                          }`}
                        >
                          <Icon className="size-3" />
                          {move.label}
                        </button>
                      );
                    })}
                  </div>

                  {MOVE_TYPES[slot.moveType].needsTarget && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Target:</span>
                      <div className="flex gap-1">
                        {[0, 1, 2].map((t) => (
                          <button
                            key={t}
                            onClick={() => updateSlot(i, { targetSlot: t })}
                            className={`px-2 py-1 rounded text-xs border transition-colors ${
                              slot.targetSlot === t
                                ? 'border-destructive/50 bg-destructive/10 text-destructive'
                                : 'border-border text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Enemy {t + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <Button onClick={handleCommit} disabled={busy} size="sm" className="w-full">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Committing...</> : 'Commit Moves'}
      </Button>
    </div>
  );
}

function MoveRevealAction({ battleId }: { battleId: string }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const handleReveal = useCallback(async () => {
    // Find the stored move data for the current round
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith(`battle-move-data-${battleId}-`));
    const latestKey = keys.sort().pop();
    const roundKey = latestKey?.replace('data', 'salt');

    const moveData = latestKey ? sessionStorage.getItem(latestKey) ?? '' : '';
    const salt = roundKey ? sessionStorage.getItem(roundKey) ?? '' : '';

    const auth = await getAuthHeaders();
    const { steps } = await api.combat.revealMoves(battleId, moveData, salt, auth);
    await executeTx(steps);

    // Clean up
    if (latestKey) sessionStorage.removeItem(latestKey);
    if (roundKey) sessionStorage.removeItem(roundKey);
  }, [battleId, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';

  return (
    <div className="border border-border rounded-md p-6 text-center space-y-3">
      <p className="text-sm">Both sides committed. Reveal your moves.</p>
      <Button onClick={handleReveal} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Revealing...</> : 'Reveal Moves'}
      </Button>
    </div>
  );
}

/** Get the latest HP values for a side from round data. */
function getLatestHp(rounds: RoundData[], side: 'A' | 'B'): string[] {
  if (rounds.length === 0) return ['?', '?', '?'];
  const last = rounds[rounds.length - 1];
  return side === 'A' ? last.teamAHp : last.teamBHp;
}
