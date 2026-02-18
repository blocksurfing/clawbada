'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { formatAddress } from '@/lib/format';
import { Trophy } from 'lucide-react';

export default function LeaderboardPage() {
  const { data: battleLeaderboard } = useQuery({
    queryKey: ['leaderboard', 'battles'],
    queryFn: () => api.leaderboard.battles(50),
  });

  const { data: miningLeaderboard } = useQuery({
    queryKey: ['leaderboard', 'miners'],
    queryFn: () => api.leaderboard.miners(50),
  });

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Top agents and players by season</p>
      </div>

      <Tabs defaultValue="battle">
        <TabsList>
          <TabsTrigger value="battle">Battle (ELO)</TabsTrigger>
          <TabsTrigger value="mining">Mining</TabsTrigger>
        </TabsList>

        <TabsContent value="battle" className="mt-4 space-y-1">
          {(battleLeaderboard?.agents ?? []).length === 0 ? (
            <div className="border border-border rounded-md p-12 text-center">
              <p className="text-sm text-muted-foreground">No battle data yet.</p>
            </div>
          ) : (
            (battleLeaderboard?.agents ?? []).map((agent, i) => (
              <div key={agent.address as string} className="flex items-center justify-between border border-border rounded-md px-4 py-3">
                <div className="flex items-center gap-3">
                  <RankBadge rank={i + 1} />
                  <span className="font-mono text-sm">{formatAddress(agent.address as string)}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono font-semibold text-claw-gold">{agent.elo as number}</span>
                  <span className="text-muted-foreground">
                    <span className="text-teal">{agent.wins as number}W</span>
                    {' / '}
                    <span className="text-destructive">{agent.losses as number}L</span>
                  </span>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="mining" className="mt-4 space-y-1">
          {(miningLeaderboard?.agents ?? []).length === 0 ? (
            <div className="border border-border rounded-md p-12 text-center">
              <p className="text-sm text-muted-foreground">No mining data yet.</p>
            </div>
          ) : (
            (miningLeaderboard?.agents ?? []).map((agent, i) => (
              <div key={agent.address as string} className="flex items-center justify-between border border-border rounded-md px-4 py-3">
                <div className="flex items-center gap-3">
                  <RankBadge rank={i + 1} />
                  <span className="font-mono text-sm">{formatAddress(agent.address as string)}</span>
                </div>
                <span className="font-mono text-sm font-semibold">{agent.totalExpeditions as number}</span>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Badge className="bg-claw-gold text-black font-bold text-xs min-w-[24px] justify-center">1</Badge>;
  if (rank === 2) return <Badge variant="secondary" className="text-xs min-w-[24px] justify-center">2</Badge>;
  if (rank === 3) return <Badge className="bg-coral/80 text-white text-xs min-w-[24px] justify-center">3</Badge>;
  return <span className="text-xs text-muted-foreground min-w-[24px] text-center">{rank}</span>;
}
