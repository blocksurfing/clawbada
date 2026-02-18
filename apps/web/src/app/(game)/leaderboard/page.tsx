'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { formatAddress, formatClaw } from '@/lib/format';
import { Trophy } from 'lucide-react';

export default function LeaderboardPage() {
  const { data: battleData } = useQuery({
    queryKey: ['leaderboard', 'battle'],
    queryFn: () => api.leaderboard.battles(50),
  });

  const { data: miningData } = useQuery({
    queryKey: ['leaderboard', 'mining'],
    queryFn: () => api.leaderboard.mining(50),
  });

  const battleEntries = battleData?.leaderboard ?? [];
  const miningEntries = miningData?.leaderboard ?? [];

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
          {battleEntries.length === 0 ? (
            <div className="border border-border rounded-md p-12 text-center">
              <p className="text-sm text-muted-foreground">No battle data yet.</p>
            </div>
          ) : (
            battleEntries.map((entry) => (
              <div key={entry.address} className="flex items-center justify-between border border-border rounded-md px-4 py-3">
                <div className="flex items-center gap-3">
                  <RankBadge rank={entry.rank} />
                  <span className="font-mono text-sm">{formatAddress(entry.address)}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono font-semibold text-claw-gold">{entry.elo}</span>
                  <span className="text-muted-foreground">
                    <span className="text-teal">{entry.wins}W</span>
                    {' / '}
                    <span className="text-destructive">{entry.losses}L</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{entry.winRate}</span>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="mining" className="mt-4 space-y-1">
          {miningEntries.length === 0 ? (
            <div className="border border-border rounded-md p-12 text-center">
              <p className="text-sm text-muted-foreground">No mining data yet.</p>
            </div>
          ) : (
            miningEntries.map((entry) => (
              <div key={entry.owner} className="flex items-center justify-between border border-border rounded-md px-4 py-3">
                <div className="flex items-center gap-3">
                  <RankBadge rank={entry.rank} />
                  <span className="font-mono text-sm">{formatAddress(entry.owner)}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono font-semibold">{entry.totalExpeditions} runs</span>
                  <span className="font-mono text-claw-gold">{formatClaw(entry.totalReward)}</span>
                </div>
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
