'use client';

import { useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TeamData, type BattleHistoryItem } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TransactionButton } from '@/components/game/transaction-button';
import { BattleMoves } from '@/components/game/battle-moves';
import { BattleViewer } from '@/components/game/battle-viewer';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { useBattleWs } from '@/hooks/use-battle-ws';
import { useQueueState } from '@/hooks/use-queue-state';
import { useTeamPower } from '@/hooks/use-team-power';
import { useAllPoolDepths, poolDepthFor } from '@/hooks/use-pool-depth';
import { TeamPowerBadge } from '@/components/game/team-power-badge';
import { QueueRadiusBar } from '@/components/game/queue-radius-bar';
import { MatchFoundHud } from '@/components/game/match-found-hud';
import type { BattleLobsterConfig } from '@/lib/battle-anim/types';
import { formatClaw, formatClawWei, formatAddress } from '@/lib/format';
import { BACKGROUNDS, getArenaBackground } from '@/lib/assets';
import { Swords, Radio, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

// Pick a random arena scene on page load (Evolved tier default for queue view)
const arenaScene = getArenaBackground(1);

const STAKE_BRACKETS = [
  { label: 'Low', value: '2500', color: 'bg-teal/15 text-teal' },
  { label: 'Mid', value: '10000', color: 'bg-ocean/15 text-ocean' },
  { label: 'High', value: '50000', color: 'bg-claw-gold/15 text-claw-gold' },
] as const;

// B-36: per-bracket auto-skip durations on the match-found HUD. Higher stakes
// give the player a bit more time to verify the opponent before the page
// navigates. Indices align with STAKE_BRACKETS (0=Low, 1=Mid, 2=High).
const AUTO_SKIP_MS_BY_BRACKET = [3000, 5000, 7000] as const;

export default function BattlePage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('queue');
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);

  const { data: teamsData, isPending: teamsLoading } = useQuery({
    queryKey: ['teams', address],
    queryFn: () => api.teams.list(address!),
    enabled: !!address,
  });

  const { data: historyData } = useQuery({
    queryKey: ['battleHistory', address],
    queryFn: () => api.combat.history(address!, 20),
    enabled: !!address && tab === 'history',
  });

  // B-32: detect an in-progress battle for this wallet on mount. If the user
  // reloaded the page mid-deposit (or mid-anything in phases 1-5), route them
  // straight to the active battle screen — without this, the matched battleId
  // is lost and the player is stranded in the queue tab even though a battle
  // exists server-side. Phase 1-5 = Deposit / TeamCommit / TeamReveal / Active
  // / AwaitingFinalize. Settled (6) and Cancelled (7) are filtered out.
  // (Phase enum is hardcoded vs the current contract — re-audit if S2 adds
  // new in-progress phase values.)
  const { data: activeBattlesData } = useQuery({
    queryKey: ['activeBattles', address],
    queryFn: () => api.combat.history(address!, 5),
    enabled: !!address,
    staleTime: 30_000,
  });
  const inProgressBattle = (activeBattlesData?.battles ?? []).find(
    (b) => b.phase >= 1 && b.phase <= 5,
  );

  // B-42 fix: one-shot ref guard so the auto-route fires AT MOST ONCE per
  // page session — typically on initial mount when recovering from a reload.
  // Without this guard, the query's refetch (every 30s, on focus, etc.) can
  // pick up a freshly-matched battle and instantly route, racing against
  // (and bypassing) the B-07 matched-state HUD pause. After the first fire,
  // the matched-state HUD's onApprove is the ONLY path to set activeBattleId,
  // preserving the 3s power-reveal beat.
  const inProgressRoutedRef = useRef(false);

  useEffect(() => {
    if (inProgressBattle && !activeBattleId && !inProgressRoutedRef.current) {
      inProgressRoutedRef.current = true;
      setActiveBattleId(inProgressBattle.battleId);
      setTab('active');
    }
  }, [inProgressBattle, activeBattleId]);

  if (!address) {
    return (
      <PageBackground variant="deep" scene={arenaScene} sceneDark>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Swords className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Battle Arena</h1>
          <p className="text-sm text-text-secondary">Connect your wallet to battle.</p>
        </div>
      </PageBackground>
    );
  }

  const teams = teamsData?.teams ?? [];

  return (
    <PageBackground variant="deep" scene={arenaScene} sceneDark>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <img src="/assets/icons/Battle.svg" alt="" width={28} height={28} style={{ imageRendering: 'pixelated' as const }} />
            <h1 className="font-pixel text-xl text-foreground">Battle Arena</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">PvP combat — wager $CLAW, winner takes the pot</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="active">
              Active {activeBattleId && <span className="ml-1 size-1.5 rounded-full bg-teal inline-block" />}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="mt-4">
            <QueueView
              teams={teams}
              teamsLoading={teamsLoading}
              address={address}
              onMatchFound={(battleId) => {
                // B-41 note: setting activeBattleId + switching tabs unmounts
                // QueueView (radix Tabs default), tearing down its address-room
                // WebSocket. ActiveBattleView's useBattleWs then opens a fresh
                // (battle-room + address-room) connection. Brief gap of
                // ~50-200ms with no live WS subscription. Server doesn't
                // typically push events during this window (it's right after
                // match-found), but if WS-driven UX expands later, consider
                // hoisting the WS to a stable parent so the connection
                // survives the tab swap.
                setActiveBattleId(battleId);
                setTab('active');
              }}
            />
          </TabsContent>

          <TabsContent value="active" className="mt-4">
            {activeBattleId ? (
              <ActiveBattleView
                battleId={activeBattleId}
                address={address}
                onComplete={() => {
                  setActiveBattleId(null);
                  queryClient.invalidateQueries({ queryKey: ['battleHistory'] });
                }}
              />
            ) : (
              <FrostedPanel className="py-12 text-center">
                <Swords className="size-6 mx-auto mb-3 text-text-secondary" />
                <p className="text-sm text-text-secondary">No active battle. Join the queue to find an opponent.</p>
              </FrostedPanel>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <BattleHistoryView battles={historyData?.battles ?? []} />
          </TabsContent>
        </Tabs>
      </div>
    </PageBackground>
  );
}

function QueueView({
  teams,
  teamsLoading,
  address,
  onMatchFound,
}: {
  teams: TeamData[];
  teamsLoading: boolean;
  address: string;
  onMatchFound: (battleId: string) => void;
}) {
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedBracket, setSelectedBracket] = useState('2500');

  // V3 S1: queue lifecycle is owned by the state machine in `useQueueState`.
  const { state: queueState, joinQueue, leaveQueue, reset } = useQueueState();

  // B-06 fix: tick once per second while queued so the elapsed-time display
  // stays live. Only runs when actually queued — no idle interval.
  //
  // B-20 fix: synchronously seed `tickNow` when entering the queued state.
  // Without this, `tickNow` retains its stale mount-time value until the
  // first 1s interval fires, briefly displaying a nonsensical (often
  // negative) elapsed-time at the moment the user enters queue.
  const [tickNow, setTickNow] = useState(() => Date.now());
  useEffect(() => {
    if (queueState.kind !== 'queued') return;
    setTickNow(Date.now()); // immediate sync seed
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [queueState.kind]);

  // Power preview for the currently-selected team. Pure local computation.
  const selectedTeamData = teams.find((t) => t.teamId === selectedTeam);
  const powerSummary = useTeamPower(selectedTeamData?.lobsters);

  // Pool-depth snapshot for the typical-wait hint under each stake bracket.
  const { data: poolDepths } = useAllPoolDepths();

  const bracketIndex = STAKE_BRACKETS.findIndex((b) => b.value === selectedBracket);

  // B-07: the MatchFoundHud now owns the matched→active-battle transition
  // timing. It auto-fires onApprove (== onMatchFound here) after a 3-second
  // countdown, OR fires immediately when the user clicks "Approve & Deposit".
  // No more useEffect-driven instant nav — the HUD shows for the full pause
  // so the player actually sees their opponent's power and the severity chrome.

  const handleJoinQueue = useCallback(async () => {
    if (!selectedTeam || !powerSummary.battleEligible) return;
    await joinQueue(selectedTeam, selectedBracket);
  }, [selectedTeam, selectedBracket, powerSummary.battleEligible, joinQueue]);

  // Teams the player can actually queue with — V3 entry rule (Evolved+).
  const queueableTeams = teams.filter((t) => !t.active);

  // ── Render branches by queue state ─────────────────────────

  if (queueState.kind === 'matched') {
    // B-07: auto-skip with manual override buttons. The HUD owns the timer;
    // "Continue to deposit" preempts immediately, "Walk away" returns to
    // idle (server-side deposit-window timeout will refund the orphan).
    //
    // B-36: duration scales by stake bracket (Low=3s, Mid=5s, High=7s) so
    // higher-value matches give the player a bit more time to size up the
    // opponent before being navigated.
    //
    // B-38: the inline arrows below capture `queueState` from the matched
    // closure — battleId is stable for the duration of this matched render,
    // so the closures are correct even though they're freshly-allocated each
    // render. If you ever derive other props from `queueState` here, watch
    // for stale-closure footguns and lift to a useCallback / pass `match`.
    const autoSkipMs =
      AUTO_SKIP_MS_BY_BRACKET[queueState.bracket] ?? AUTO_SKIP_MS_BY_BRACKET[0];
    return (
      <MatchFoundHud
        match={queueState}
        autoSkipMs={autoSkipMs}
        onApprove={() => onMatchFound(queueState.battleId)}
        onWalkAway={reset}
      />
    );
  }

  if (queueState.kind === 'queued') {
    const elapsedSec = Math.floor((tickNow - queueState.since) / 1000);
    const depth = poolDepths
      ? poolDepthFor(poolDepths, queueState.bracket, queueState.power)
      : undefined;
    return (
      <FrostedPanel className="space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Searching for Opponent</h2>
          <span className="font-mono text-xs text-text-secondary tabular-nums">
            {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
          </span>
        </div>

        <QueueRadiusBar
          ownPower={queueState.power}
          radius={queueState.radius}
          poolDepthInRange={depth}
        />

        <div className="flex items-center justify-between pt-3 border-t border-[rgba(255,210,128,0.1)]">
          <span className="text-xs text-text-secondary">
            Bracket: {STAKE_BRACKETS[queueState.bracket]?.label} · stake {formatClaw(STAKE_BRACKETS[queueState.bracket]?.value ?? '0')}
          </span>
          <button
            onClick={() => leaveQueue()}
            className="frosted-panel px-3 py-1.5 text-xs text-text-secondary hover:text-foreground transition-colors"
          >
            Cancel &amp; refund
          </button>
        </div>
      </FrostedPanel>
    );
  }

  if (queueState.kind === 'cancelling') {
    return (
      <FrostedPanel className="py-12 text-center">
        <Loader2 className="size-5 mx-auto mb-3 animate-spin text-text-secondary" />
        <p className="text-sm text-text-secondary">Cancelling queue…</p>
      </FrostedPanel>
    );
  }

  if (queueState.kind === 'cancelled') {
    return (
      <FrostedPanel className="space-y-3 py-8 text-center">
        <p className="text-sm text-foreground">Queue cancelled.</p>
        <p className="text-xs text-text-secondary">{queueState.reason.replace(/_/g, ' ')}</p>
        <button
          onClick={reset}
          className="frosted-panel-highlight mx-auto block px-4 py-2 text-xs font-pixel text-claw-gold transition-colors"
        >
          Back to queue
        </button>
      </FrostedPanel>
    );
  }

  if (queueState.kind === 'errored') {
    return (
      <FrostedPanel className="space-y-3 py-8 text-center" variant="danger">
        <p className="text-sm text-foreground">Couldn't join queue</p>
        <p className="text-xs text-destructive">{queueState.error}</p>
        <button
          onClick={reset}
          className="frosted-panel-highlight mx-auto block px-4 py-2 text-xs font-pixel text-claw-gold transition-colors"
        >
          Try again
        </button>
      </FrostedPanel>
    );
  }

  // Default: idle — show the team-builder + bracket-picker form.
  const isJoining = queueState.kind === 'joining';

  // B-24 fix: distinguish "loading" from "loaded but empty". Without this
  // branch, the empty-state UI flashes briefly while the teams query is
  // still in flight (teams = [] before the query resolves).
  if (teamsLoading) {
    return (
      <FrostedPanel className="py-12 text-center">
        <Loader2 className="size-5 mx-auto animate-spin text-text-secondary" />
      </FrostedPanel>
    );
  }

  // B-09 fix: explicit empty-state when no teams are available to queue.
  // Previously the user saw an empty <Select> with a disabled "Join Queue"
  // button and no explanation.
  if (queueableTeams.length === 0) {
    return (
      <FrostedPanel className="space-y-3 py-12 text-center">
        <Swords className="size-6 mx-auto text-text-secondary" />
        <p className="text-sm text-foreground">No teams available to battle</p>
        <p className="text-xs text-text-secondary max-w-md mx-auto">
          All your teams are locked in another activity (mining, an active battle), or you haven't built one yet.
          Wait for a team to free up, or build a new team from your roster.
        </p>
        <Link
          href="/game/teams"
          className="frosted-panel-highlight inline-block px-4 py-2 text-xs font-pixel text-claw-gold transition-colors mt-2"
        >
          Manage teams
        </Link>
      </FrostedPanel>
    );
  }

  return (
    <FrostedPanel className="space-y-5">
      <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Join Matchmaking</h2>

      {/* Stake bracket cards — annotated with pool depth at current power */}
      <div className="grid grid-cols-3 gap-2">
        {STAKE_BRACKETS.map((b, idx) => {
          const depth =
            poolDepths && powerSummary.power != null
              ? poolDepthFor(poolDepths, idx, powerSummary.power)
              : null;
          return (
            <button
              key={b.value}
              onClick={() => setSelectedBracket(b.value)}
              className={`p-3 rounded-lg text-center transition-all ${
                selectedBracket === b.value
                  ? 'frosted-panel-highlight'
                  : 'frosted-panel hover:border-[rgba(255,210,128,0.3)]'
              }`}
            >
              <span className="font-pixel text-[10px] text-text-secondary block">{b.label}</span>
              <span className="font-mono text-sm text-foreground block mt-1">{formatClaw(b.value)}</span>
              <Badge className={`${b.color} border-0 text-[9px] mt-1.5`}>
                Win {formatClaw(Number(b.value) * 2 * 0.9)}
              </Badge>
              {depth !== null && (
                <span className="block text-[9px] text-text-secondary mt-1 tabular-nums">
                  {depth} active in your bucket
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">Select Team</label>
        <Select value={selectedTeam} onValueChange={setSelectedTeam}>
          <SelectTrigger className="bg-ocean-mid/50 border-border">
            <SelectValue placeholder="Choose a team..." />
          </SelectTrigger>
          <SelectContent>
            {queueableTeams.map((team) => (
              <SelectItem key={team.teamId} value={team.teamId}>
                Team #{team.teamId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Power preview for the selected team */}
        {selectedTeam && (
          <div className="flex items-center justify-between gap-3">
            <TeamPowerBadge summary={powerSummary} />
            {!powerSummary.battleEligible && powerSummary.ineligibleReason && (
              <span className="text-[11px] text-destructive flex-1 text-right">
                {powerSummary.ineligibleReason}
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-text-secondary">All lobsters must be Evolved+</p>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[rgba(255,210,128,0.1)]">
        <span className="text-sm text-text-secondary">
          Stake: <span className="text-foreground font-mono">{formatClaw(selectedBracket)}</span>
        </span>
        <button
          onClick={handleJoinQueue}
          disabled={!selectedTeam || !powerSummary.battleEligible || isJoining}
          className="frosted-panel-highlight px-4 py-2 text-xs font-pixel text-claw-gold hover:border-[rgba(255,210,128,0.3)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {isJoining && <Loader2 className="size-3 animate-spin" />}
          {isJoining ? 'Joining…' : 'Join Queue'}
        </button>
      </div>
    </FrostedPanel>
  );
}

function ActiveBattleView({
  battleId,
  address,
  onComplete,
}: {
  battleId: string;
  address: string;
  onComplete: () => void;
}) {
  const ws = useBattleWs(battleId, address);

  const { data: battleData } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => api.combat.getBattle(battleId),
    refetchInterval: 5_000,
  });

  const { data: roundsData } = useQuery({
    queryKey: ['battleRounds', battleId],
    queryFn: () => api.combat.getRounds(battleId),
    refetchInterval: 3_000,
  });

  // PR-B X1: chain is null when battles.status=0 (pending_create).
  // Fetch team data for battle animation
  const teamIdA = battleData?.chain?.teamIdA;
  const teamIdB = battleData?.chain?.teamIdB;
  const { data: teamA } = useQuery({
    queryKey: ['team', teamIdA],
    queryFn: () => api.teams.get(teamIdA!),
    enabled: !!teamIdA,
  });
  const { data: teamB } = useQuery({
    queryKey: ['team', teamIdB],
    queryFn: () => api.teams.get(teamIdB!),
    enabled: !!teamIdB,
  });

  const settled = ws.events.some((e) => e.event === 'battle_settled');
  const rounds = roundsData?.rounds ?? [];

  // Build lobster configs for animation
  const lobsterConfigs = buildLobsterConfigs(teamA, teamB);
  const battleTier = lobsterConfigs.length > 0
    ? Math.max(1, Math.min(...lobsterConfigs.map(c => c.tier)))
    : 1;

  return (
    <FrostedPanel variant="danger" className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-pixel text-sm text-foreground">Battle #{battleId}</h2>
          <Link href={`/battle/${battleId}`} className="text-xs text-ocean hover:underline">
            spectate
          </Link>
        </div>
        {ws.connected && (
          <Badge className="bg-teal/15 text-teal border-0 text-[10px]">
            <Radio className="size-3 mr-1" /> Live
          </Badge>
        )}
      </div>

      <div className="text-sm space-y-1">
        {battleData?.chain && (
          <>
            <div>
              <span className="text-text-secondary">Stake: </span>
              {/* F-12-a: chain.stakeAmount is wei (chain read); use wei-aware formatter. */}
              <span className="font-mono text-text-accent">{formatClawWei(battleData.chain.stakeAmount)}</span>
            </div>
            <div>
              <span className="text-text-secondary">Opponent: </span>
              <span className="font-mono text-foreground">{formatAddress(
                battleData.chain.playerA.toLowerCase() === address.toLowerCase()
                  ? battleData.chain.playerB
                  : battleData.chain.playerA
              )}</span>
            </div>
          </>
        )}
        {battleData && !battleData.chain && (
          <div className="text-text-secondary text-xs italic">Creating battle on chain...</div>
        )}
      </div>

      {/* Battle Animation Viewer */}
      {rounds.length > 0 && lobsterConfigs.length === 6 && (
        <BattleViewer
          rounds={rounds}
          lobsters={lobsterConfigs}
          tier={battleTier}
          scene={0}
          autoPlay
          compact
        />
      )}

      {/* Battle move actions */}
      {battleData && !settled && (
        <BattleMoves
          battleId={battleId}
          address={address}
          battleData={battleData}
          rounds={rounds}
        />
      )}

      {/* Round results */}
      {rounds.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="font-pixel text-[10px] text-text-accent uppercase tracking-wider">Rounds</h3>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {rounds.map((round) => (
              <div key={round.round} className="text-xs p-2 bg-ocean-mid/50 rounded font-mono">
                <span className="text-foreground">R{round.round}</span>{' '}
                <span className="text-text-secondary">
                  [{round.teamAHp.join(', ')}] vs [{round.teamBHp.join(', ')}]
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WS events */}
      {ws.events.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="font-pixel text-[10px] text-text-accent uppercase tracking-wider">Events</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {ws.events.map((evt, i) => (
              <div key={i} className="text-xs text-text-secondary font-mono">
                <span className="text-foreground">{evt.event}</span>{' '}
                {new Date(evt.receivedAt).toLocaleTimeString()}
              </div>
            ))}
          </div>
        </div>
      )}

      {settled && (
        <button
          onClick={onComplete}
          className="frosted-panel px-4 py-2 text-xs text-text-secondary hover:text-foreground transition-colors"
        >
          Back to Queue
        </button>
      )}
    </FrostedPanel>
  );
}

/** Build BattleLobsterConfig[] from two teams' lobster data */
function buildLobsterConfigs(
  teamA: TeamData | undefined,
  teamB: TeamData | undefined,
): BattleLobsterConfig[] {
  const configs: BattleLobsterConfig[] = [];
  for (const [side, team] of [['a', teamA], ['b', teamB]] as const) {
    const lobsters = team?.lobsters ?? [];
    for (let slot = 0; slot < 3; slot++) {
      const l = lobsters[slot];
      configs.push({
        id: `${side}${slot}`,
        dna: l?.dna ?? '0',
        classId: l?.class ?? 0,
        tier: l?.evolutionTier ?? 1,
        side,
        slot,
        maxHp: l ? Number(l.stats.hp) * 5 : 1000,
      });
    }
  }
  return configs;
}

function BattleHistoryView({ battles }: { battles: BattleHistoryItem[] }) {
  if (battles.length === 0) {
    return (
      <FrostedPanel className="py-12 text-center">
        <Swords className="size-6 mx-auto mb-3 text-text-secondary" />
        <p className="text-sm text-text-secondary">No battle history yet. Enter the arena to write your story.</p>
      </FrostedPanel>
    );
  }

  return (
    <div className="space-y-2">
      {battles.map((battle) => (
        <FrostedPanel key={battle.battleId} className="flex items-center justify-between p-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Badge className={`font-pixel text-[10px] border-0 ${
                battle.result === 'win'
                  ? 'bg-teal/15 text-teal'
                  : 'bg-destructive/15 text-destructive'
              }`}>
                {battle.result === 'win' ? 'WIN' : 'LOSS'}
              </Badge>
              <Badge className="bg-ocean-surface/50 text-text-secondary border-0 text-[10px]">{battle.bracket}</Badge>
            </div>
            <span className="text-xs text-text-secondary">
              vs {formatAddress(battle.opponent ?? '0x' + '0'.repeat(40))}
              {battle.timestamp != null && (
                <> · {new Date(battle.timestamp * 1000).toLocaleDateString()}</>
              )}
            </span>
          </div>
          <span className={`text-sm font-mono font-medium ${battle.result === 'win' ? 'text-teal' : 'text-destructive'}`}>
            {battle.result === 'win' ? '+' : '-'}{formatClaw(battle.payout ?? '0')}
          </span>
        </FrostedPanel>
      ))}
    </div>
  );
}
