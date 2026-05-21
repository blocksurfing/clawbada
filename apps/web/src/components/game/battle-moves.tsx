'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keccak256, encodePacked, toHex } from 'viem';
import { api, type BattleData, type RoundData } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useCalldataTx } from '@/hooks/use-calldata-tx';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Shield, Swords, Zap } from 'lucide-react';
import { MAX_ROUNDS } from '@clawbada/game-logic';

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

/** Determine which side the player is on. Returns null when chain is null
 *  (PR-B X1: pending_create window before the engine confirms createBattle). */
function getPlayerSide(battleData: BattleData, address: string): 'A' | 'B' | null {
  const chain = battleData.chain;
  if (!chain) return null;
  if (chain.playerA.toLowerCase() === address.toLowerCase()) return 'A';
  if (chain.playerB.toLowerCase() === address.toLowerCase()) return 'B';
  return null;
}

export function BattleMoves({ battleId, address, battleData, rounds }: BattleMovesProps) {
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

  // X13: surface handleTimeout button when the chain phase deadline has
  // elapsed. Contract routes to cancel/finalize/emergency-exit per the
  // current phase (BattleArena.sol:727). Anyone can call on chain — auth
  // server-side is for telemetry + rate-limit only.
  const showHandleTimeout = isTimeoutable(chain);

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} round={chain.currentRound} />

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

      {phase === 'commit_moves' && (
        <MoveCommitAction
          battleId={battleId}
          address={address}
          round={chain.currentRound}
          teamHp={side === 'A' ? getLatestHp(rounds, 'A') : getLatestHp(rounds, 'B')}
        />
      )}

      {phase === 'reveal_moves' && (
        <MoveRevealAction battleId={battleId} address={address} round={chain.currentRound} />
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
 *  X13 LOW-02: at MAX_ROUNDS with both reveals present, the resolver
 *  must settle — `_handleActiveTimeout` reverts `MaxRoundsReached`. Hide
 *  the CTA so users don't burn gas on a guaranteed revert. */
function isTimeoutable(chain: BattleData['chain']): boolean {
  if (!chain) return false;
  // Contract phase enum: 0=None, 1=Deposit, 2=TeamCommit, 3=TeamReveal,
  // 4=Active, 5=AwaitingFinalize, 6=Settled, 7=Cancelled.
  if (chain.phase < 1 || chain.phase > 5) return false;
  // LOW-01: dispute path is admin-only.
  if (chain.phase === 5 && chain.disputed) return false;
  // LOW-02: final round + both revealed → resolver settles, not timeout.
  if (
    chain.phase === 4 &&
    chain.currentRound >= MAX_ROUNDS &&
    chain.roundRevealedA &&
    chain.roundRevealedB
  ) {
    return false;
  }
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
    const salt = generateSalt();
    // A2-FU MEDIUM: sessionStorage keys scoped by lowercased wallet address.
    // Otherwise wallet B could read wallet A's stored salt/teamId in the
    // same browser session (commit-reveal secrecy leak + cross-wallet
    // corruption when wallet B tries to reveal A's commit).
    const lower = address.toLowerCase();
    sessionStorage.setItem(`battle-team-salt-${battleId}-${lower}`, salt);
    sessionStorage.setItem(`battle-team-id-${battleId}-${lower}`, teamId);
    // Must match `BattleArena.revealTeam`'s preimage:
    //   keccak256(abi.encodePacked(battleId, msg.sender, teamId, salt))
    // Earlier preimage omitted msg.sender — every reveal reverted InvalidCommitHash.
    const commitHash = keccak256(
      encodePacked(
        ['uint256', 'address', 'uint256', 'bytes32'],
        [BigInt(battleId), address as `0x${string}`, BigInt(teamId), salt as `0x${string}`],
      ),
    );
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.commitTeam(battleId, commitHash, auth);
    await executeTx(steps);
  }, [battleId, address, teamId, getAuthHeaders, executeTx]);

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
  const { execute: executeTx, status } = useCalldataTx();

  const handleReveal = useCallback(async () => {
    // A2-FU MEDIUM: sessionStorage keys scoped by lowercased wallet address
    // (matches the commit-time keys). Fallback `teamId` is the API-sourced
    // queued team — no longer the chain field, which is `0` pre-reveal.
    const lower = address.toLowerCase();
    const salt = sessionStorage.getItem(`battle-team-salt-${battleId}-${lower}`) ?? '';
    const storedTeamId = sessionStorage.getItem(`battle-team-id-${battleId}-${lower}`) ?? teamId;
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.revealTeam(battleId, storedTeamId, salt, auth);
    await executeTx(steps);
    // Clean up
    sessionStorage.removeItem(`battle-team-salt-${battleId}-${lower}`);
    sessionStorage.removeItem(`battle-team-id-${battleId}-${lower}`);
  }, [battleId, address, teamId, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';

  return (
    <div className="border border-border rounded-md p-6 text-center space-y-3">
      <p className="text-sm">Both teams committed. Reveal your team now.</p>
      <Button onClick={handleReveal} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Revealing...</> : 'Reveal Team'}
      </Button>
    </div>
  );
}

function MoveCommitAction({
  battleId,
  address,
  round,
  teamHp,
}: {
  battleId: string;
  address: string;
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
    // A2-FU MEDIUM: scope by lowercased wallet address (same reasoning as
    // team commit) — otherwise wallet switches in the same browser session
    // can corrupt or leak round secrets.
    const lower = address.toLowerCase();
    sessionStorage.setItem(`battle-move-salt-${battleId}-${round}-${lower}`, salt);

    // Encode moves: pack as (moveType, targetSlot) per lobster
    const moveData = encodePacked(
      ['uint8', 'uint8', 'uint8', 'uint8', 'uint8', 'uint8'],
      [
        slots[0].moveType, slots[0].targetSlot,
        slots[1].moveType, slots[1].targetSlot,
        slots[2].moveType, slots[2].targetSlot,
      ],
    );
    sessionStorage.setItem(`battle-move-data-${battleId}-${round}-${lower}`, moveData);

    // Must match `BattleArena.revealMoves`'s preimage:
    //   keccak256(abi.encodePacked(battleId, b.currentRound, msg.sender, moveData, salt))
    // currentRound is `uint8` on-chain (1 byte under abi.encodePacked), and the
    // earlier preimage omitted msg.sender entirely and encoded round as uint256.
    const commitHash = keccak256(
      encodePacked(
        ['uint256', 'uint8', 'address', 'bytes', 'bytes32'],
        [BigInt(battleId), round, address as `0x${string}`, moveData as `0x${string}`, salt as `0x${string}`],
      ),
    );

    const auth = await getAuthHeaders();
    const { steps } = await api.combat.commitMoves(battleId, commitHash, auth);
    await executeTx(steps);
  }, [battleId, address, round, slots, getAuthHeaders, executeTx]);

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

function MoveRevealAction({ battleId, address, round }: { battleId: string; address: string; round: number }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const handleReveal = useCallback(async () => {
    // A2-FU MEDIUM: look up the exact wallet+round keys instead of the
    // previous "sort all matching prefixes lexicographically" approach,
    // which could pick the wrong round if storage held stale entries
    // (e.g., round 10 sorts before round 2 as strings).
    const lower = address.toLowerCase();
    const dataKey = `battle-move-data-${battleId}-${round}-${lower}`;
    const saltKey = `battle-move-salt-${battleId}-${round}-${lower}`;

    const moveData = sessionStorage.getItem(dataKey) ?? '';
    const salt = sessionStorage.getItem(saltKey) ?? '';

    const auth = await getAuthHeaders();
    const { steps } = await api.combat.revealMoves(battleId, moveData, salt, auth);
    await executeTx(steps);

    sessionStorage.removeItem(dataKey);
    sessionStorage.removeItem(saltKey);
  }, [battleId, address, round, getAuthHeaders, executeTx]);

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
