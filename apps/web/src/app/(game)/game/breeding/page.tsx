'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LobsterData } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { LobsterCard } from '@/components/game/lobster-card';
import { TransactionButton } from '@/components/game/transaction-button';
import { formatClaw } from '@/lib/format';
import { Heart } from 'lucide-react';

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <Heart className="size-8 text-muted-foreground mb-3" />
        <h1 className="text-2xl font-bold mb-2">Breeding Lab</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet to breed lobsters.</p>
      </div>
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
    <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Breeding Lab</h1>
        <p className="text-sm text-muted-foreground mt-1">Pair two lobsters to breed new offspring</p>
      </div>

      {/* Parent selection */}
      <div className="border border-border rounded-md p-6 space-y-5">
        <h2 className="font-semibold">Select Parents</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Parent A</p>
            {parentA ? (
              <SelectedParent lobster={lobsters.find((l) => l.tokenId === parentA)!} onClear={() => setParentA(null)} />
            ) : (
              <div className="h-28 border border-dashed border-border rounded-md flex items-center justify-center text-sm text-muted-foreground">
                Select below
              </div>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Parent B</p>
            {parentB ? (
              <SelectedParent lobster={lobsters.find((l) => l.tokenId === parentB)!} onClear={() => setParentB(null)} />
            ) : (
              <div className="h-28 border border-dashed border-border rounded-md flex items-center justify-center text-sm text-muted-foreground">
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
      </div>

      {/* Preview */}
      {preview && parentA && parentB && (
        <div className="border border-border rounded-md p-6 space-y-4">
          <h2 className="font-semibold">Breeding Preview</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total Cost</span>
              <div className="font-medium font-mono">{formatClaw(preview.totalCost)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Offspring Gen</span>
              <div className="font-medium">Gen {preview.offspringGeneration}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Legend Chance</span>
              <div className="font-medium">{preview.legendChance}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Parent A Breeds</span>
              <div className="font-medium">{preview.parentA.breedsRemaining}/5</div>
            </div>
          </div>

          <div>
            <span className="text-sm text-muted-foreground">Class Probabilities</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(preview.classProbabilities).map(([cls, pct]) => (
                <Badge key={cls} variant="outline" className="text-xs font-mono">
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
        </div>
      )}
    </div>
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
      <div className="text-xs text-muted-foreground mt-1">
        Breeds: {lobster.breedCount}/5 · Gen {lobster.generation}
      </div>
    </div>
  );
}
