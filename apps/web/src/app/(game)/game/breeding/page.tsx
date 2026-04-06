'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LobsterData } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { LobsterCard } from '@/components/game/lobster-card';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatClaw } from '@/lib/format';
import { BACKGROUNDS } from '@/lib/assets';
import { Egg } from 'lucide-react';

export default function BreedingPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const [parentA, setParentA] = useState<string | null>(null);
  const [parentB, setParentB] = useState<string | null>(null);

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  const { data: preview } = useQuery({
    queryKey: ['breedPreview', parentA, parentB],
    queryFn: () => api.breeding.preview(parentA!, parentB!),
    enabled: !!parentA && !!parentB,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
    setParentA(null);
    setParentB(null);
  };

  if (!address) {
    return (
      <PageBackground variant="reef" scene={BACKGROUNDS.breeding}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Egg className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Breeding Lab</h1>
          <p className="text-sm text-text-secondary">Connect your wallet to breed lobsters.</p>
        </div>
      </PageBackground>
    );
  }

  const lobsters = lobstersData?.lobsters ?? [];
  const breedable = lobsters.filter((l) => l.breedCount < 5);

  const selectParent = (tokenId: string) => {
    if (parentA === tokenId) { setParentA(null); return; }
    if (parentB === tokenId) { setParentB(null); return; }
    if (!parentA) { setParentA(tokenId); return; }
    if (!parentB) { setParentB(tokenId); return; }
  };

  return (
    <PageBackground variant="reef" scene={BACKGROUNDS.breeding}>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <h1 className="font-pixel text-xl text-foreground">Breeding Lab</h1>
          <p className="text-sm text-text-secondary mt-1">Pair two lobsters to breed new offspring</p>
        </div>

        {/* Parent selection */}
        <FrostedPanel className="space-y-5">
          <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Select Parents</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-text-secondary mb-2">Parent A</p>
              {parentA ? (
                <SelectedParent lobster={lobsters.find((l) => l.tokenId === parentA)!} onClear={() => setParentA(null)} />
              ) : (
                <div className="h-28 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-text-secondary">
                  Select below
                </div>
              )}
            </div>
            <div>
              <p className="text-sm text-text-secondary mb-2">Parent B</p>
              {parentB ? (
                <SelectedParent lobster={lobsters.find((l) => l.tokenId === parentB)!} onClear={() => setParentB(null)} />
              ) : (
                <div className="h-28 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-text-secondary">
                  Select below
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {breedable.map((lob) => (
              <LobsterCard
                key={lob.tokenId}
                tokenId={lob.tokenId}
                dna={lob.dna}
                lobsterClass={lob.class}
                evolutionTier={lob.evolutionTier}
                purity={lob.purity}
                legend={lob.legend}
                damage={lob.damage}
                locked={lob.locked}
                soulbound={lob.soulbound}
                size="sm"
                selected={lob.tokenId === parentA || lob.tokenId === parentB}
                onClick={() => selectParent(lob.tokenId)}
              />
            ))}
          </div>
        </FrostedPanel>

        {/* Preview */}
        {preview && parentA && parentB && (
          <FrostedPanel variant="highlight" className="space-y-4">
            <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Breeding Preview</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-text-secondary text-xs">Total Cost</span>
                <div className="font-medium font-mono text-text-accent">{formatClaw(preview.totalCost)}</div>
              </div>
              <div>
                <span className="text-text-secondary text-xs">Offspring Gen</span>
                <div className="font-medium text-foreground">Gen {preview.offspringGeneration}</div>
              </div>
              <div>
                <span className="text-text-secondary text-xs">Legend Chance</span>
                <div className="font-medium text-claw-gold">{preview.legendChance}</div>
              </div>
              <div>
                <span className="text-text-secondary text-xs">Parent A Breeds</span>
                <div className="font-medium text-foreground">{preview.parentA.breedsRemaining}/5</div>
              </div>
            </div>

            <div>
              <span className="text-sm text-text-secondary">Class Probabilities</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(preview.classProbabilities).map(([cls, pct]) => (
                  <Badge key={cls} className="bg-ocean-surface/50 text-text-secondary border-0 text-xs font-mono">
                    {cls}: {Math.round(pct * 100)}%
                  </Badge>
                ))}
              </div>
            </div>

            <TransactionButton
              label={`Breed — ${formatClaw(preview.totalCost)}`}
              fetchSteps={(auth) => api.breeding.breed(parentA!, parentB!, auth)}
              onSuccess={invalidate}
            />
          </FrostedPanel>
        )}
      </div>
    </PageBackground>
  );
}

function SelectedParent({ lobster, onClear }: { lobster: LobsterData; onClear: () => void }) {
  return (
    <div>
      <LobsterCard
        tokenId={lobster.tokenId}
        dna={lobster.dna}
        lobsterClass={lobster.class}
        evolutionTier={lobster.evolutionTier}
        purity={lobster.purity}
        legend={lobster.legend}
        damage={lobster.damage}
        locked={lobster.locked}
        soulbound={lobster.soulbound}
        size="sm"
        onClick={onClear}
        selected
      />
      <div className="text-xs text-text-secondary mt-1">
        Breeds: {lobster.breedCount}/5 · Gen {lobster.generation}
      </div>
    </div>
  );
}
