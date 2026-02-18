'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TransactionButton } from '@/components/game/transaction-button';
import { formatClaw, formatCountdown, tierLabel } from '@/lib/format';
import { Pickaxe, Clock } from 'lucide-react';

const TIER_WEIGHTS = [1, 3, 10, 25] as const;
const BASE_REWARD = 1250;

export default function MiningPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: expeditionsData } = useQuery({
    queryKey: ['expeditions', address],
    queryFn: () => api.mining.list(address!),
    enabled: !!address,
    refetchInterval: 15_000,
  });

  const { data: teamsData } = useQuery({
    queryKey: ['teams', address],
    queryFn: () => api.teams.list(address!),
    enabled: !!address,
  });

  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<number>(0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expeditions'] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <Pickaxe className="size-8 text-muted-foreground mb-3" />
        <h1 className="text-2xl font-bold mb-2">Mining</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet to start mining.</p>
      </div>
    );
  }

  const expeditions = expeditionsData?.expeditions ?? [];
  const activeExpeditions = expeditions.filter((e) => !e.claimed);
  const availableTeams = (teamsData?.teams ?? []).filter((t) => !t.active);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Mining</h1>
        <p className="text-sm text-muted-foreground mt-1">Send teams on 4-hour expeditions to earn $CLAW</p>
      </div>

      {/* Active expeditions */}
      {activeExpeditions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Active Expeditions</h2>
          {activeExpeditions.map((exp) => (
            <ActiveExpeditionCard key={exp.expeditionId} expedition={exp} onClaim={invalidate} />
          ))}
        </div>
      )}

      {/* Start new expedition */}
      <div className="border border-border rounded-md p-6 space-y-5">
        <h2 className="font-semibold">Start Expedition</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Team</label>
            <Select value={selectedTeam} onValueChange={setSelectedTeam}>
              <SelectTrigger>
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent>
                {availableTeams.map((team) => (
                  <SelectItem key={team.teamId} value={team.teamId}>
                    Team #{team.teamId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableTeams.length === 0 && (
              <p className="text-xs text-muted-foreground">No available teams.</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Mine Tier</label>
            <Select value={String(selectedTier)} onValueChange={(v) => setSelectedTier(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3].map((tier) => (
                  <SelectItem key={tier} value={String(tier)}>
                    {tierLabel(tier)} — {formatClaw(BASE_REWARD * TIER_WEIGHTS[tier])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              All 3 lobsters must be {tierLabel(selectedTier)}+
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="text-sm">
            <span className="text-muted-foreground">Reward: </span>
            <span className="font-medium font-mono">{formatClaw(BASE_REWARD * TIER_WEIGHTS[selectedTier])}</span>
            <span className="text-muted-foreground ml-3">Duration: 4h</span>
          </div>
          <TransactionButton
            label="Start"
            disabled={!selectedTeam}
            fetchSteps={(auth) => api.mining.start(selectedTeam, selectedTier, auth)}
            onSuccess={invalidate}
          />
        </div>
      </div>
    </div>
  );
}

function ActiveExpeditionCard({
  expedition,
  onClaim,
}: {
  expedition: { expeditionId: string; reward: string; completionTime: number; mineTier: number; teamId: string };
  onClaim: () => void;
}) {
  const [countdown, setCountdown] = useState(formatCountdown(expedition.completionTime));
  const isComplete = expedition.completionTime <= Math.floor(Date.now() / 1000);

  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      setCountdown(formatCountdown(expedition.completionTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [expedition.completionTime, isComplete]);

  return (
    <div className="border border-border rounded-md p-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant="outline" className="text-xs">{tierLabel(expedition.mineTier)} Mine</Badge>
          <span className="text-xs text-muted-foreground">Team #{expedition.teamId}</span>
        </div>
        <div className="text-sm font-medium font-mono">{formatClaw(expedition.reward)}</div>
      </div>
      {isComplete ? (
        <TransactionButton
          label="Claim"
          fetchSteps={(auth) => api.mining.claim(expedition.expeditionId, auth)}
          onSuccess={onClaim}
        />
      ) : (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-mono">
          <Clock className="size-3" />
          {countdown}
        </div>
      )}
    </div>
  );
}
