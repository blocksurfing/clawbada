'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
 * Pre-battle on-chain actions for a participant: deposit (which carries the team
 * commit and your consent to the stake + opponent Power), then the team reveal.
 * V3: once both teams are revealed the battle itself runs off-chain over
 * WebSocket (live page + session manager), so this component only shows a
 * "battle in progress" state from that point on, then the result's review.
 *
 * There is no dispute: the game's watchdog replays every result during its review
 * window and freezes any it cannot reproduce; the team then settles it.
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

const saltKey = (battleId: string, lower: string) => `battle-team-salt-${battleId}-${lower}`;
const teamKey = (battleId: string, lower: string) => `battle-team-id-${battleId}-${lower}`;

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
  const myTeamRevealed = side === 'A' ? chain.teamRevealedA : chain.teamRevealedB;
  const iAmAccused = side === 'A' ? chain.accusedA : chain.accusedB;
  const iOpened = side === 'A' ? chain.openedA : chain.openedB;
  const opponentPower = side === 'A' ? chain.powerB : chain.powerA;

  // Contract phases: 1 Deposit, 3 TeamReveal, 4 Active (off-chain battle running),
  // 5 AwaitingFinalize (result in review), 6 Settled, 7 Cancelled, 8 Frozen.
  let phase: 'deposit' | 'wait_deposit' | 'reveal_team' | 'open_commit' | 'wait_team_reveal' | 'in_battle' | 'in_review' | 'frozen' | 'settled' | 'cancelled';

  if (chain.phase === 8) {
    phase = 'frozen';
  } else if (chain.phase === 7) {
    phase = 'cancelled';
  } else if (chain.phase === 6) {
    phase = 'settled';
  } else if (chain.phase === 5) {
    phase = 'in_review';
  } else if (chain.phase === 4) {
    phase = 'in_battle';
  } else if (!myDeposit) {
    phase = 'deposit';
  } else if (!oppDeposit) {
    phase = 'wait_deposit';
  } else if (iAmAccused && !iOpened) {
    phase = 'open_commit';
  } else if (!myTeamRevealed) {
    phase = 'reveal_team';
  } else {
    phase = 'wait_team_reveal';
  }

  // X13: surface handleTimeout button when the relevant deadline has
  // elapsed. Anyone can call on chain — auth server-side is for telemetry +
  // rate-limit only.
  const showHandleTimeout = isTimeoutable(chain);

  return (
    <div className="space-y-4">
      <PhaseIndicator phase={phase} />

      {showHandleTimeout && (
        <HandleTimeoutAction battleId={battleId} />
      )}

      {phase === 'deposit' && (
        myQueuedTeamId ? (
          <DepositAction battleId={battleId} address={address} teamId={myQueuedTeamId} stake={chain.stakeAmount} opponentPower={opponentPower} />
        ) : (
          <PrivateTeamLoadingOrError query={myTeamQuery} />
        )
      )}

      {phase === 'reveal_team' && (
        /* A2-FU MEDIUM: no chain-teamId fallback. Pre-reveal `chain.teamIdA/B`
           is '0' and reveal with teamId=0 reverts. Gate the action on the
           API-sourced `myQueuedTeamId`; the reveal prefers the wallet-scoped
           sessionStorage teamId stored at deposit. */
        myQueuedTeamId ? (
          <TeamRevealAction battleId={battleId} address={address} teamId={myQueuedTeamId} />
        ) : (
          <PrivateTeamLoadingOrError query={myTeamQuery} />
        )
      )}

      {phase === 'open_commit' && (
        myQueuedTeamId ? (
          <OpenCommitAction battleId={battleId} address={address} teamId={myQueuedTeamId} />
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

      {phase === 'in_review' && (
        <ReviewNotice payoutDeadline={chain.payoutDeadline} rogue={battleData.settlement?.rogue ?? false} />
      )}

      {phase === 'frozen' && (
        <FrozenNotice frozenAt={chain.frozenAt} />
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
    deposit: 'Deposit Stake + Commit Team',
    wait_deposit: 'Waiting for Opponent Deposit',
    reveal_team: 'Reveal Team',
    open_commit: 'Open Your Team Commit',
    wait_team_reveal: 'Waiting for Opponent Team Reveal',
    in_battle: 'Battle in Progress',
    in_review: 'Result under review',
    frozen: 'Frozen for review',
    settled: 'Battle Settled',
    cancelled: 'Battle Cancelled',
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

/** D-13 + D-08: one action — the deposit carries the team commit (built here from the queued
 *  team and a fresh random salt) and the player's consent: the server binds the stake and the
 *  opponent Team Power shown below, and the contract refuses any other battle. */
function DepositAction({ battleId, address, teamId, stake, opponentPower }: { battleId: string; address: string; teamId: string; stake: string; opponentPower: number }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();

  const handleDeposit = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');
    const lower = address.toLowerCase();
    // Re-use a salt from an earlier attempt at this deposit so a retry commits the same team.
    const salt = sessionStorage.getItem(saltKey(battleId, lower)) ?? generateSalt();
    // A2-FU MEDIUM: sessionStorage keys scoped by lowercased wallet address.
    sessionStorage.setItem(saltKey(battleId, lower), salt);
    sessionStorage.setItem(teamKey(battleId, lower), teamId);
    // F5-01: the commit hash MUST include the player address to match BattleArena
    // (keccak256(abi.encodePacked(battleId, player, teamId, salt))). The shared
    // teamCommitHash helper is the single source of truth.
    const commitHash = teamCommitHash(BigInt(battleId), address as `0x${string}`, BigInt(teamId), salt as `0x${string}`);
    const auth = await getAuthHeaders();
    // teamId + salt let the server reveal for you as soon as both deposits land (the reveal
    // window is 20 s); the salt also stays here for the reveal step as a fallback.
    const { steps } = await api.combat.deposit(battleId, { commitHash, teamId, salt }, auth);
    await executeTx(steps);
  }, [battleId, teamId, address, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';
  const stakeGold = (() => { try { return (BigInt(stake) / 10n ** 18n).toLocaleString(); } catch { return stake; } })();

  return (
    <div className="border border-border rounded-md p-6 text-center space-y-3">
      <p className="text-sm">Deposit your stake + 5% anti-grief deposit and commit your team.</p>
      <p className="text-xs text-muted-foreground">
        You agree to a stake of {stakeGold} $GOLD against a team of Power {opponentPower}. The contract refuses the
        deposit if the battle is anything else. Your opponent won&apos;t see your team until both teams are revealed together.
      </p>
      <Button onClick={handleDeposit} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Processing...</> : 'Deposit + Commit Team'}
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

/** X13: returns true when the deadline for the current phase has elapsed AND the battle is in
 *  a phase the contract's `handleTimeout` accepts (not None/Settled/Cancelled). Deadlines:
 *  `phaseDeadline` for Deposit/TeamReveal/Active, `payoutDeadline` (end of the review window)
 *  for AwaitingFinalize, `frozenAt` + 72 h for Frozen. */
export const FREEZE_LONG_STOP_SEC = 72 * 60 * 60;
function isTimeoutable(chain: BattleData['chain']): boolean {
  if (!chain) return false;
  // Contract phase enum: 0=None, 1=Deposit, 2=TeamCommit (unused), 3=TeamReveal,
  // 4=Active, 5=AwaitingFinalize, 6=Settled, 7=Cancelled, 8=Frozen.
  if (chain.phase < 1 || chain.phase === 6 || chain.phase === 7 || chain.phase > 8) return false;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = chain.phase === 5
    ? BigInt(chain.payoutDeadline ?? '0')
    : chain.phase === 8
      ? (chain.frozenAt ? BigInt(chain.frozenAt + FREEZE_LONG_STOP_SEC) : 0n)
      : BigInt(chain.phaseDeadline ?? '0');
  if (deadline === 0n) return false;
  return now > deadline;
}

/** Phase 5: the result is recorded, damage applied and both teams already free; the payout
 *  waits for the review window while the game's watchdog replays the battle. */
function ReviewNotice({ payoutDeadline, rogue }: { payoutDeadline: string; rogue: boolean }) {
  const ends = new Date(Number(payoutDeadline) * 1000).toLocaleTimeString();
  return (
    <div className={`border rounded-md p-5 space-y-2 ${rogue ? 'border-coral bg-coral/10' : 'border-border bg-surface/40'}`}>
      <p className="text-sm font-medium">Result under review</p>
      <p className="text-xs text-text-secondary">
        {rogue
          ? 'The result submitted on-chain does not match the battle this game server ran. The game\'s watchdog holds such a result for review before it can pay out — you do not need to do anything.'
          : `Your lobsters are already free. The payout is released after a short review (until ${ends}), while the game re-checks the battle.`}
      </p>
    </div>
  );
}

/** Phase 8: frozen. The team settles it; if nobody does within 72 h, anyone can close it and
 *  both players get their stakes back. */
function FrozenNotice({ frozenAt }: { frozenAt: number }) {
  const longStop = frozenAt ? new Date((frozenAt + FREEZE_LONG_STOP_SEC) * 1000).toLocaleString() : null;
  return (
    <div className="border border-claw-gold/40 rounded-md p-5 space-y-2 bg-claw-gold/5">
      <p className="text-sm font-medium">Frozen for review — the team is reviewing this result</p>
      <p className="text-xs text-text-secondary">
        The game could not reproduce the result that was submitted, so the payout is on hold. The team will pay out
        the correct result or refund both players.
        {longStop ? ` If nothing has happened by ${longStop}, anyone can close the battle and both players get their stake and anti-grief deposit back.` : ''}
        {' '}Your lobsters are not locked.
      </p>
    </div>
  );
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
        Force the contract to resolve this phase (cancel + refund, pay out a reviewed result, or
        close a frozen battle after 72 h). Anyone can call — auth here is for telemetry.
      </p>
      <Button onClick={handleClick} disabled={busy} size="sm" variant="secondary">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Submitting...</> : 'Handle timeout'}
      </Button>
    </div>
  );
}

function TeamRevealAction({ battleId, address, teamId }: { battleId: string; address: string; teamId: string }) {
  const { getAuthHeaders } = useAuth();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // F5-01: revealing submits no on-chain tx. The player sends their salt to the server; once
  // BOTH players' salts open their commits, the resolver submits a single atomic revealTeams for
  // both teams. The deposit already handed the server the salt, so this is the fallback — and
  // it runs by itself (the reveal window is only 20 s). The salt is KEPT locally until the
  // battle starts: if the server reports the commit unopenable, you open it yourself (D-14).
  const handleReveal = useCallback(async () => {
    setBusy(true);
    try {
      const lower = address.toLowerCase();
      const salt = sessionStorage.getItem(saltKey(battleId, lower)) ?? '';
      const storedTeamId = sessionStorage.getItem(teamKey(battleId, lower)) ?? teamId;
      const auth = await getAuthHeaders();
      const res = await api.combat.revealTeam(battleId, storedTeamId, salt, auth);
      setWaiting(res.status === 'waiting_for_opponent');
    } finally {
      setBusy(false);
    }
  }, [battleId, teamId, address, getAuthHeaders]);

  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    handleReveal().catch(() => { /* the button below retries */ });
  }, [handleReveal]);

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
      <p className="text-sm">Both deposits are in. Submit your team to reveal.</p>
      <Button onClick={handleReveal} disabled={busy} size="sm">
        {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Submitting...</> : 'Reveal Team'}
      </Button>
    </div>
  );
}

/** How long after a successful free re-send to wait for the resolver to reveal before offering
 *  the on-chain fallback (the reveal watcher polls every 2 s, then a transaction confirms). */
const RESEND_GRACE_MS = 8_000;

/** D-14: the server reported that your commit does not open with the salt it holds (or it
 *  never got one). Open it yourself on-chain within 2 minutes, or you forfeit your 5%
 *  anti-grief deposit when the reveal window lapses. Needs the salt from this browser.
 *
 *  Review 2026-10-03: the report usually means the server never received (or lost) the salt,
 *  so this first re-POSTs it to /reveal-team — free, and if accepted the resolver reveals
 *  both teams and the report is moot. The on-chain `openOwnCommit` (gas) is offered only if
 *  the report still stands after that. */
function OpenCommitAction({ battleId, address, teamId }: { battleId: string; address: string; teamId: string }) {
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status } = useCalldataTx();
  const queryClient = useQueryClient();
  const lower = address.toLowerCase();
  const salt = typeof window !== 'undefined' ? sessionStorage.getItem(saltKey(battleId, lower)) : null;
  const storedTeamId = (typeof window !== 'undefined' ? sessionStorage.getItem(teamKey(battleId, lower)) : null) ?? teamId;

  const [resend, setResend] = useState<'pending' | 'sent' | 'failed'>(salt ? 'pending' : 'failed');
  const [resendError, setResendError] = useState<string | null>(null);
  const [fallbackReady, setFallbackReady] = useState(!salt);
  const resentOnce = useRef(false);

  useEffect(() => {
    if (!salt || resentOnce.current) return;
    resentOnce.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    (async () => {
      try {
        const auth = await getAuthHeaders();
        await api.combat.revealTeam(battleId, storedTeamId, salt, auth);
        if (cancelled) return;
        setResend('sent');
        void queryClient.invalidateQueries({ queryKey: ['battle', battleId] });
        // If the report is still standing when this fires (this component is still mounted in
        // the open_commit phase), the free path did not clear it: offer the on-chain one.
        timer = setTimeout(() => { if (!cancelled) setFallbackReady(true); }, RESEND_GRACE_MS);
      } catch (err) {
        if (cancelled) return;
        setResend('failed');
        setResendError(err instanceof Error ? err.message : String(err));
        setFallbackReady(true);
      }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [battleId, storedTeamId, salt, getAuthHeaders, queryClient]);

  const handleOpen = useCallback(async () => {
    if (!salt) return;
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.openCommit(battleId, storedTeamId, salt, auth);
    await executeTx(steps);
  }, [battleId, storedTeamId, salt, getAuthHeaders, executeTx]);

  const busy = status === 'pending' || status === 'confirming';
  return (
    <div className="border border-coral/40 rounded-md p-6 text-center space-y-3 bg-coral/5">
      <p className="text-sm font-medium">The server could not open your team commit</p>
      <p className="text-xs text-text-secondary">
        Open it yourself within 2 minutes, or you lose your 5% anti-grief deposit when the reveal window ends.
      </p>
      {!salt ? (
        <p className="text-xs text-muted-foreground">This browser no longer has the salt for this commit.</p>
      ) : resend === 'pending' ? (
        <p className="text-xs text-muted-foreground">
          <Loader2 className="size-3 inline animate-spin mr-1" /> Re-sending your team to the server first (free)…
        </p>
      ) : resend === 'sent' && !fallbackReady ? (
        <p className="text-xs text-muted-foreground">
          <Loader2 className="size-3 inline animate-spin mr-1" /> Sent. Waiting for the server to reveal both teams…
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {resend === 'failed'
              ? `Re-sending it did not work${resendError ? ` (${resendError})` : ''}.`
              : 'The report is still standing.'}{' '}
            Open your commit on-chain to clear it.
          </p>
          <Button onClick={handleOpen} disabled={busy} size="sm">
            {busy ? <><Loader2 className="size-3 animate-spin mr-1" /> Submitting...</> : 'Open my commit'}
          </Button>
        </>
      )}
    </div>
  );
}

/** Get the latest HP values for a side from round data. */
