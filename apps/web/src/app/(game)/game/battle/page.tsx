'use client';

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TeamData, type BattleHistoryItem } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TransactionButton } from '@/components/game/transaction-button';
import { useBattleWs } from '@/hooks/use-battle-ws';
import { useAuth } from '@/hooks/use-auth';
import { useCalldataTx } from '@/hooks/use-calldata-tx';
import { formatClaw, formatAddress } from '@/lib/format';
import { Swords, Radio, Loader2 } from 'lucide-react';

const STAKE_BRACKETS = [
  { label: 'Low', value: '2500' },
  { label: 'Mid', value: '10000' },
  { label: 'High', value: '50000' },
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
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <Swords className="size-8 text-muted-foreground mb-3" />
        <h1 className="text-2xl font-bold mb-2">Battle Arena</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet to battle.</p>
      </div>
    );
  }

  const teams = teamsData?.teams ?? [];

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Battle Arena</h1>
        <p className="text-sm text-muted-foreground mt-1">PvP combat — wager $CLAW, winner takes the pot</p>
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
            <div className="border border-border rounded-md p-12 text-center">
              <p className="text-sm text-muted-foreground">No active battle. Join the queue to find an opponent.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <BattleHistoryView battles={historyData?.battles ?? []} />
        </TabsContent>
      </Tabs>
    </div>
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
    <div className="border border-border rounded-md p-6 space-y-5">
      <h2 className="font-semibold">Join Matchmaking</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Team</label>
          <Select value={selectedTeam} onValueChange={setSelectedTeam}>
            <SelectTrigger>
              <SelectValue placeholder="Select team" />
            </SelectTrigger>
            <SelectContent>
              {evolvedTeams.map((team) => (
                <SelectItem key={team.teamId} value={team.teamId}>
                  Team #{team.teamId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">All lobsters must be Evolved+</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Stake Bracket</label>
          <Select value={selectedBracket} onValueChange={setSelectedBracket}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAKE_BRACKETS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label} — {formatClaw(b.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className="text-sm text-muted-foreground">
          Winner takes <span className="text-foreground font-mono">{formatClaw(Number(selectedBracket) * 2 * 0.9)}</span>
        </span>
        <Button onClick={handleJoinQueue} disabled={!selectedTeam || queuing} size="sm">
          {queuing && <Loader2 className="size-3 animate-spin mr-1" />}
          {queuing ? 'Finding match...' : 'Join Queue'}
        </Button>
      </div>
    </div>
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
  const { getAuthHeaders } = useAuth();
  const { execute: executeTx, status: txStatus } = useCalldataTx();

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

  const handleDeposit = useCallback(async () => {
    const auth = await getAuthHeaders();
    const { steps } = await api.combat.deposit(battleId, auth);
    await executeTx(steps);
  }, [battleId, getAuthHeaders, executeTx]);

  const settled = ws.events.some((e) => e.type === 'battle_settled');

  return (
    <div className="border border-border rounded-md p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Battle #{battleId}</h2>
        {ws.connected && (
          <Badge variant="outline" className="text-teal text-xs">
            <Radio className="size-3 mr-1" /> Live
          </Badge>
        )}
      </div>

      <div className="text-sm space-y-1">
        <div>
          <span className="text-muted-foreground">Phase: </span>
          <span className="font-medium">
            {settled
              ? 'Settled'
              : ws.lastEvent?.type === 'round_result'
                ? `Round ${(ws.lastEvent.data as Record<string, unknown>).round}`
                : ws.lastEvent?.type ?? 'Waiting...'}
          </span>
        </div>
        {battleData && (
          <>
            <div>
              <span className="text-muted-foreground">Stake: </span>
              <span className="font-mono">{formatClaw(battleData.chain.stakeAmount)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Opponent: </span>
              <span className="font-mono">{formatAddress(
                battleData.chain.playerA.toLowerCase() === address.toLowerCase()
                  ? battleData.chain.playerB
                  : battleData.chain.playerA
              )}</span>
            </div>
          </>
        )}
      </div>

      {!settled && (
        <Button
          size="sm"
          onClick={handleDeposit}
          disabled={txStatus === 'pending' || txStatus === 'confirming'}
        >
          {txStatus === 'pending' || txStatus === 'confirming' ? (
            <><Loader2 className="size-3 animate-spin mr-1" /> Processing...</>
          ) : (
            'Deposit Stake'
          )}
        </Button>
      )}

      {(roundsData?.rounds ?? []).length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm text-muted-foreground uppercase tracking-wide">Rounds</h3>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {(roundsData?.rounds ?? []).map((round) => (
              <div key={round.round} className="text-xs p-2 bg-secondary rounded font-mono">
                <span className="text-foreground">R{round.round}</span>{' '}
                <span className="text-muted-foreground">
                  [{round.teamAHp.join(', ')}] vs [{round.teamBHp.join(', ')}]
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ws.events.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm text-muted-foreground uppercase tracking-wide">Events</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {ws.events.map((event, i) => (
              <div key={i} className="text-xs text-muted-foreground font-mono">
                <span className="text-foreground">{event.type}</span>{' '}
                {new Date(event.timestamp).toLocaleTimeString()}
              </div>
            ))}
          </div>
        </div>
      )}

      {settled && (
        <Button onClick={onComplete} size="sm">Back to Queue</Button>
      )}
    </div>
  );
}

function BattleHistoryView({ battles }: { battles: BattleHistoryItem[] }) {
  if (battles.length === 0) {
    return (
      <div className="border border-border rounded-md p-12 text-center">
        <p className="text-sm text-muted-foreground">No battle history yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {battles.map((battle) => (
        <div key={battle.battleId} className="border border-border rounded-md p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Badge className={battle.result === 'win' ? 'bg-teal/15 text-teal border-0' : 'bg-destructive/15 text-destructive border-0'}>
                {battle.result === 'win' ? 'Victory' : 'Defeat'}
              </Badge>
              <Badge variant="outline" className="text-xs">{battle.bracket}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              vs {formatAddress(battle.opponent)} · {new Date(battle.timestamp * 1000).toLocaleDateString()}
            </span>
          </div>
          <span className={`text-sm font-mono font-medium ${battle.result === 'win' ? 'text-teal' : 'text-destructive'}`}>
            {battle.result === 'win' ? '+' : '-'}{formatClaw(battle.payout)}
          </span>
        </div>
      ))}
    </div>
  );
}
