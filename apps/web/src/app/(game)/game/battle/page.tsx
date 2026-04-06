'use client';

import { useState, useCallback } from 'react';
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
import { useAuth } from '@/hooks/use-auth';
import type { BattleLobsterConfig } from '@/lib/battle-anim/types';
import { formatClaw, formatAddress } from '@/lib/format';
import { BACKGROUNDS, getArenaBackground } from '@/lib/assets';
import { Swords, Radio, Loader2 } from 'lucide-react';
import Link from 'next/link';

// Pick a random arena scene on page load (Evolved tier default for queue view)
const arenaScene = getArenaBackground(1);

const STAKE_BRACKETS = [
  { label: 'Low', value: '2500', color: 'bg-teal/15 text-teal' },
  { label: 'Mid', value: '10000', color: 'bg-ocean/15 text-ocean' },
  { label: 'High', value: '50000', color: 'bg-claw-gold/15 text-claw-gold' },
] as const;

export default function BattlePage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('queue');
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);

  const { data: teamsData } = useQuery({
    queryKey: ['teams', address],
    queryFn: () => api.teams.list(address!),
    enabled: !!address,
  });

  const { data: historyData } = useQuery({
    queryKey: ['battleHistory', address],
    queryFn: () => api.combat.history(address!, 20),
    enabled: !!address && tab === 'history',
  });

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
            <Swords className="size-5 text-coral" />
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
              address={address}
              onMatchFound={(battleId) => {
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
  address,
  onMatchFound,
}: {
  teams: TeamData[];
  address: string;
  onMatchFound: (battleId: string) => void;
}) {
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedBracket, setSelectedBracket] = useState('2500');
  const [queuing, setQueuing] = useState(false);
  const { getAuthHeaders } = useAuth();

  const handleJoinQueue = useCallback(async () => {
    setQueuing(true);
    try {
      const auth = await getAuthHeaders();
      const result = await api.combat.joinQueue(selectedTeam, selectedBracket, auth);
      if (result.status === 'matched' && result.battleId) {
        onMatchFound(result.battleId);
      }
    } catch {
      // Error shown via other means
    } finally {
      setQueuing(false);
    }
  }, [selectedTeam, selectedBracket, getAuthHeaders, onMatchFound]);

  const evolvedTeams = teams.filter((t) => !t.active);

  return (
    <FrostedPanel className="space-y-5">
      <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Join Matchmaking</h2>

      {/* Stake bracket cards */}
      <div className="grid grid-cols-3 gap-2">
        {STAKE_BRACKETS.map((b) => (
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
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">Select Team</label>
        <Select value={selectedTeam} onValueChange={setSelectedTeam}>
          <SelectTrigger className="bg-ocean-mid/50 border-border">
            <SelectValue placeholder="Choose a team..." />
          </SelectTrigger>
          <SelectContent>
            {evolvedTeams.map((team) => (
              <SelectItem key={team.teamId} value={team.teamId}>
                Team #{team.teamId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-text-secondary">All lobsters must be Evolved+</p>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-[rgba(255,210,128,0.1)]">
        <span className="text-sm text-text-secondary">
          Stake: <span className="text-foreground font-mono">{formatClaw(selectedBracket)}</span>
        </span>
        <button
          onClick={handleJoinQueue}
          disabled={!selectedTeam || queuing}
          className="frosted-panel-highlight px-4 py-2 text-xs font-pixel text-claw-gold hover:border-[rgba(255,210,128,0.3)] transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {queuing && <Loader2 className="size-3 animate-spin" />}
          {queuing ? 'Finding match...' : 'Join Queue'}
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

  // Fetch team data for battle animation
  const teamIdA = battleData?.chain.teamIdA;
  const teamIdB = battleData?.chain.teamIdB;
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

  const settled = ws.events.some((e) => e.type === 'battle_settled');
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
        {battleData && (
          <>
            <div>
              <span className="text-text-secondary">Stake: </span>
              <span className="font-mono text-text-accent">{formatClaw(battleData.chain.stakeAmount)}</span>
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
            {ws.events.map((event, i) => (
              <div key={i} className="text-xs text-text-secondary font-mono">
                <span className="text-foreground">{event.type}</span>{' '}
                {new Date(event.timestamp).toLocaleTimeString()}
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
              vs {formatAddress(battle.opponent)} · {new Date(battle.timestamp * 1000).toLocaleDateString()}
            </span>
          </div>
          <span className={`text-sm font-mono font-medium ${battle.result === 'win' ? 'text-teal' : 'text-destructive'}`}>
            {battle.result === 'win' ? '+' : '-'}{formatClaw(battle.payout)}
          </span>
        </FrostedPanel>
      ))}
    </div>
  );
}
