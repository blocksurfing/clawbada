'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { MineTierCard } from '@/components/game/mine-tier-card';
import { formatClaw, formatCountdown, tierLabel } from '@/lib/format';
import { MINE_BACKGROUNDS } from '@/lib/assets';
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
  const [selectedTier, setSelectedTier] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expeditions'] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
  };

  if (!address) {
    return (
      <PageBackground variant="reef" scene={MINE_BACKGROUNDS[0]} sceneDark>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Pickaxe className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Mining</h1>
          <p className="text-sm text-text-secondary">Connect your wallet to start mining.</p>
        </div>
      </PageBackground>
    );
  }

  const expeditions = expeditionsData?.expeditions ?? [];
  const activeExpeditions = expeditions.filter((e) => !e.claimed);
  const availableTeams = (teamsData?.teams ?? []).filter((t) => !t.active);

  return (
    <PageBackground variant="reef" scene={MINE_BACKGROUNDS[0]} sceneDark>
      <div className="p-4 md:p-8 space-y-8 max-w-4xl mx-auto">
        <div>
          <h1 className="font-pixel text-xl text-foreground">Mining</h1>
          <p className="text-sm text-text-secondary mt-1">Send teams on 4-hour expeditions to earn $CLAW</p>
        </div>

        {/* Active expeditions */}
        {activeExpeditions.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Active Expeditions</h2>
            <div className="space-y-2">
              {activeExpeditions.map((exp) => (
                <ActiveExpeditionCard key={exp.expeditionId} expedition={exp} onClaim={invalidate} />
              ))}
            </div>
          </div>
        )}

        {/* Mine tier selection */}
        <div className="space-y-3">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Choose Mine</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((tier) => (
              <MineTierCard
                key={tier}
                tier={tier}
                reward={BASE_REWARD * TIER_WEIGHTS[tier]}
                available={availableTeams.length > 0}
                onSelect={() => setSelectedTier(tier)}
              />
            ))}
          </div>
        </div>

        {/* Team picker (appears when mine is selected) */}
        {selectedTier !== null && (
          <FrostedPanel variant="highlight" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-pixel text-sm text-text-accent">
                {tierLabel(selectedTier)} Mine — {formatClaw(BASE_REWARD * TIER_WEIGHTS[selectedTier])}
              </h3>
              <button
                onClick={() => setSelectedTier(null)}
                className="text-xs text-text-secondary hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-text-secondary">Select Team</label>
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger className="bg-ocean-mid/50 border-border">
                  <SelectValue placeholder="Choose a team..." />
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
                <p className="text-xs text-text-secondary">No available teams. Create one in Teams.</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[rgba(255,210,128,0.1)]">
              <div className="text-sm text-text-secondary">
                Duration: <span className="text-foreground">4 hours</span>
                <span className="mx-2">·</span>
                Requires: <span className="text-foreground">{tierLabel(selectedTier)}+</span>
              </div>
              <TransactionButton
                label="Start Expedition"
                disabled={!selectedTeam}
                fetchSteps={(auth) => api.mining.start(selectedTeam, selectedTier, auth)}
                onSuccess={() => { invalidate(); setSelectedTier(null); setSelectedTeam(''); }}
              />
            </div>
          </FrostedPanel>
        )}
      </div>
    </PageBackground>
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
    <FrostedPanel className="flex items-center justify-between p-3">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-pixel text-[10px] text-text-accent">{tierLabel(expedition.mineTier)} Mine</span>
          <span className="text-xs text-text-secondary">Team #{expedition.teamId}</span>
        </div>
        <div className="text-sm font-medium text-text-accent font-mono">{formatClaw(expedition.reward)}</div>
      </div>
      {isComplete ? (
        <TransactionButton
          label="Claim"
          fetchSteps={(auth) => api.mining.claim(expedition.expeditionId, auth)}
          onSuccess={onClaim}
        />
      ) : (
        <div className="flex items-center gap-1.5 text-sm text-text-secondary font-mono">
          <Clock className="size-3" />
          {countdown}
        </div>
      )}
    </FrostedPanel>
  );
}
