'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LobsterData } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatClaw, tierLabel } from '@/lib/format';
import { BACKGROUNDS } from '@/lib/assets';
import { ArrowUpCircle, ArrowRight } from 'lucide-react';

export default function EvolutionPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [selectedLobster, setSelectedLobster] = useState<string | null>(null);
  const [fuel1, setFuel1] = useState<string | null>(null);
  const [fuel2, setFuel2] = useState<string | null>(null);

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  const { data: costData } = useQuery({
    queryKey: ['evolutionCost', selectedLobster],
    queryFn: () => api.evolution.cost(selectedLobster!),
    enabled: !!selectedLobster,
  });

  const lobsters = lobstersData?.lobsters ?? [];
  const selected = lobsters.find((l) => l.tokenId === selectedLobster);

  const evolvable = lobsters.filter((l) => l.evolutionTier < 3 && !l.locked);
  const fuelTier = costData?.fuelTier ?? 0;
  const fuelCandidates = lobsters.filter(
    (l) => l.evolutionTier === fuelTier && l.tokenId !== selectedLobster && l.tokenId !== fuel1 && l.tokenId !== fuel2 && !l.locked,
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
    queryClient.invalidateQueries({ queryKey: ['evolutionCost'] });
    setSelectedLobster(null);
    setFuel1(null);
    setFuel2(null);
  };

  if (!address) {
    return (
      <PageBackground variant="deep" scene={BACKGROUNDS.evolution}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <ArrowUpCircle className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Evolution Lab</h1>
          <p className="text-sm text-text-secondary">Connect your wallet to evolve lobsters.</p>
        </div>
      </PageBackground>
    );
  }

  return (
    <PageBackground variant="deep" scene={BACKGROUNDS.evolution}>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <img src="/assets/icons/Evolve.svg" alt="" width={28} height={28} style={{ imageRendering: 'pixelated' as const }} />
            <h1 className="font-pixel text-xl text-foreground">Evolution Lab</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Evolve your lobsters — burn 2 fuel lobsters + $CLAW to unlock higher tiers
          </p>
        </div>

        {/* Tier progression */}
        <div className="flex items-center justify-center gap-2 text-xs">
          {['Base', 'Evolved', 'Elite', 'Apex'].map((tier, i) => (
            <span key={tier} className="flex items-center gap-2">
              <span className={`font-pixel px-2 py-1 rounded ${i === 0 ? 'bg-ocean-surface/50 text-text-secondary' : i === 1 ? 'bg-teal/15 text-teal' : i === 2 ? 'bg-ocean/15 text-ocean' : 'bg-claw-gold/15 text-claw-gold'}`}>
                {tier}
              </span>
              {i < 3 && <ArrowRight className="size-3 text-text-secondary" />}
            </span>
          ))}
        </div>

        {/* Step 1: Select lobster */}
        <div className="space-y-3">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">1. Select Lobster to Evolve</h2>
          {evolvable.length === 0 ? (
            <FrostedPanel className="text-center py-4">
              <p className="text-sm text-text-secondary">
                No lobsters eligible for evolution. They may be locked or already Apex.
              </p>
            </FrostedPanel>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {evolvable.map((l) => (
                <LobsterPick
                  key={l.tokenId}
                  lobster={l}
                  selected={l.tokenId === selectedLobster}
                  onClick={() => {
                    setSelectedLobster(l.tokenId === selectedLobster ? null : l.tokenId);
                    setFuel1(null);
                    setFuel2(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Cost preview */}
        {costData && selected && (
          <FrostedPanel variant="highlight" className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="text-foreground">{tierLabel(costData.currentTier)}</span>
              <ArrowRight className="size-4 text-claw-gold" />
              <span className="text-claw-gold font-pixel">{tierLabel(costData.nextTier)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-text-secondary">$CLAW Cost</p>
                <p className="font-mono text-text-accent">{formatClaw(costData.clawCost)}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Fuel Required</p>
                <p className="text-foreground">{costData.fuelCount} {tierLabel(costData.fuelTier)} lobsters (burned)</p>
              </div>
            </div>
            {costData.previewStats && (
              <div>
                <p className="text-xs text-text-secondary mb-1">Stats After Evolution</p>
                <div className="flex gap-2 text-xs font-mono">
                  <span className="text-foreground">HP:{costData.previewStats.hp}</span>
                  <span className="text-coral">ATK:{costData.previewStats.attack}</span>
                  <span className="text-ocean">ARM:{costData.previewStats.armor}</span>
                  <span className="text-teal">SPD:{costData.previewStats.speed}</span>
                  <span className="text-claw-gold">CRT:{costData.previewStats.critical}</span>
                </div>
              </div>
            )}
          </FrostedPanel>
        )}

        {/* Step 2: Select fuel */}
        {selectedLobster && costData && (
          <div className="space-y-3">
            <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">
              2. Select {costData.fuelCount} Fuel Lobsters ({tierLabel(costData.fuelTier)})
            </h2>
            <p className="text-xs text-text-secondary">These lobsters will be permanently burned.</p>
            {fuelCandidates.length === 0 ? (
              <FrostedPanel className="text-center py-4">
                <p className="text-sm text-text-secondary">
                  No eligible fuel lobsters at {tierLabel(fuelTier)} tier.
                </p>
              </FrostedPanel>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {fuelCandidates.map((l) => (
                  <LobsterPick
                    key={l.tokenId}
                    lobster={l}
                    selected={l.tokenId === fuel1 || l.tokenId === fuel2}
                    onClick={() => {
                      if (l.tokenId === fuel1) { setFuel1(null); return; }
                      if (l.tokenId === fuel2) { setFuel2(null); return; }
                      if (!fuel1) { setFuel1(l.tokenId); return; }
                      if (!fuel2) { setFuel2(l.tokenId); return; }
                    }}
                    destructive
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Evolve */}
        {selectedLobster && fuel1 && fuel2 && (
          <div className="flex justify-center pt-2">
            <TransactionButton
              label="Evolve Lobster"
              fetchSteps={(auth) => api.evolution.evolve(selectedLobster, fuel1, fuel2, auth)}
              onSuccess={invalidate}
            />
          </div>
        )}
      </div>
    </PageBackground>
  );
}

function LobsterPick({
  lobster,
  selected,
  onClick,
  destructive,
}: {
  lobster: LobsterData;
  selected: boolean;
  onClick: () => void;
  destructive?: boolean;
}) {
  const borderColor = selected
    ? destructive
      ? 'frosted-panel-danger'
      : 'frosted-panel-highlight'
    : 'frosted-panel hover:border-[rgba(255,210,128,0.3)]';

  return (
    <button onClick={onClick} className={`text-left p-3 transition-colors ${borderColor}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-mono text-foreground">#{lobster.tokenId}</span>
        <span className="font-pixel text-[10px] text-text-secondary">{tierLabel(lobster.evolutionTier)}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-text-secondary">{lobster.className}</span>
        {lobster.legend > 0 && <Badge className="bg-claw-gold/15 text-claw-gold border-0 text-[9px]">Legend</Badge>}
        {lobster.soulbound && <Badge className="bg-ocean-surface/50 text-text-secondary border-0 text-[9px]">Soulbound</Badge>}
      </div>
    </button>
  );
}
