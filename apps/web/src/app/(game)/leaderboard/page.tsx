'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatAddress, formatClaw } from '@/lib/format';
import { BACKGROUNDS } from '@/lib/assets';
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
    <PageBackground variant="deep" scene={BACKGROUNDS.leaderboard}>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="size-5 text-claw-gold" />
            <h1 className="font-pixel text-xl text-foreground">Leaderboard</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">Top agents and players by season</p>
        </div>

        <Tabs defaultValue="battle">
          <TabsList>
            <TabsTrigger value="battle">Battle (ELO)</TabsTrigger>
            <TabsTrigger value="mining">Mining</TabsTrigger>
          </TabsList>

          <TabsContent value="battle" className="mt-4 space-y-1.5">
            {battleEntries.length === 0 ? (
              <FrostedPanel className="py-12 text-center">
                <Trophy className="size-6 mx-auto mb-3 text-text-secondary" />
                <p className="text-sm text-text-secondary">No battle data yet. Enter the arena to claim a rank.</p>
              </FrostedPanel>
            ) : (
              battleEntries.map((entry) => (
                <FrostedPanel key={entry.address} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <RankBadge rank={entry.rank} />
                    <span className="font-mono text-sm text-foreground">{formatAddress(entry.address)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-mono font-semibold text-claw-gold">{entry.elo}</span>
                    <span className="text-text-secondary">
                      <span className="text-teal">{entry.wins}W</span>
                      {' / '}
                      <span className="text-destructive">{entry.losses}L</span>
                    </span>
                    <span className="text-text-secondary text-xs">{entry.winRate}</span>
                  </div>
                </FrostedPanel>
              ))
            )}
          </TabsContent>

          <TabsContent value="mining" className="mt-4 space-y-1.5">
            {miningEntries.length === 0 ? (
              <FrostedPanel className="py-12 text-center">
                <Trophy className="size-6 mx-auto mb-3 text-text-secondary" />
                <p className="text-sm text-text-secondary">No mining data yet. Send your first expedition.</p>
              </FrostedPanel>
            ) : (
              miningEntries.map((entry) => (
                <FrostedPanel key={entry.owner} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <RankBadge rank={entry.rank} />
                    <span className="font-mono text-sm text-foreground">{formatAddress(entry.owner)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-mono font-medium text-foreground">{entry.totalExpeditions} runs</span>
                    <span className="font-mono text-claw-gold">{formatClaw(entry.totalReward)}</span>
                  </div>
                </FrostedPanel>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageBackground>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-claw-gold/20 font-pixel text-xs text-claw-gold">
        1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-ocean-surface/50 font-pixel text-xs text-text-secondary">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-coral/15 font-pixel text-xs text-coral">
        3
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 text-xs text-text-secondary font-mono">
      {rank}
    </span>
  );
}
