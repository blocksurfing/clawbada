'use client';

import { use, useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, type LobsterData } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLobsterImage } from '@/hooks/use-lobster-image';
import { StatBars } from '@/components/game/stat-bars';
import { DNAViewer } from '@/components/game/dna-viewer';
import { TransactionButton } from '@/components/game/transaction-button';
import { formatClaw, tierLabel } from '@/lib/format';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { Sparkles, Link as LinkIcon, Lock, ChevronLeft } from 'lucide-react';

export default function LobsterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  const lobster = lobstersData?.lobsters.find((l) => l.tokenId === id);

  const { data: evolutionCost } = useQuery({
    queryKey: ['evolutionCost', id],
    queryFn: () => api.evolution.cost(id),
    enabled: !!lobster && lobster.evolutionTier < 3,
  });

  const { data: repairCost } = useQuery({
    queryKey: ['repairCost', id],
    queryFn: () => api.repair.cost(id),
    enabled: !!lobster && lobster.damage > 0,
  });

  const { dataUrl, loading: imageLoading } = useLobsterImage(
    lobster?.dna,
    lobster?.evolutionTier ?? 0,
    8,
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
    queryClient.invalidateQueries({ queryKey: ['evolutionCost'] });
    queryClient.invalidateQueries({ queryKey: ['repairCost'] });
  };

  if (!address) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Connect your wallet to view lobster details.</p>
      </div>
    );
  }

  if (!lobster) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">Lobster #{id} not found in your collection.</p>
        <Link href="/game" className="text-coral text-sm underline mt-2 inline-block">Back to Dashboard</Link>
      </div>
    );
  }

  const isOwner = address && lobster.owner.toLowerCase() === address.toLowerCase();
  const fuelLobsters = lobstersData?.lobsters.filter(
    (l) => l.tokenId !== id && !l.locked && l.evolutionTier === lobster.evolutionTier,
  ) ?? [];

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
      <Link href="/game" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Back
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Image */}
        <div className="space-y-3">
          <div className="relative bg-secondary rounded-lg flex items-center justify-center aspect-square max-w-[384px] border border-border">
            {imageLoading ? (
              <div className="animate-pulse bg-muted-foreground/20 w-full h-full rounded-lg" />
            ) : dataUrl ? (
              <img
                src={dataUrl}
                alt={`Lobster #${id}`}
                className="w-full h-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="text-muted-foreground text-sm">No image</div>
            )}

            <div className="absolute top-2 left-2 flex gap-1">
              {lobster.legend > 0 && (
                <Badge className="bg-claw-gold text-black text-xs">
                  <Sparkles className="size-3 mr-0.5" /> Legend
                </Badge>
              )}
              {lobster.soulbound && (
                <Badge variant="secondary" className="text-xs">
                  <LinkIcon className="size-3 mr-0.5" /> Soulbound
                </Badge>
              )}
              {lobster.locked && (
                <Badge variant="secondary" className="text-xs">
                  <Lock className="size-3 mr-0.5" /> Locked
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className="bg-coral text-white text-xs">{CLASS_NAMES_LIST[lobster.class]}</Badge>
            <Badge variant="outline" className="text-xs">{tierLabel(lobster.evolutionTier)}</Badge>
            <Badge variant="outline" className="text-xs">Gen {lobster.generation}</Badge>
            <Badge variant="outline" className="text-xs">Breeds: {lobster.breedCount}/5</Badge>
            <Badge variant="outline" className="text-xs">Purity: {lobster.purity}/6</Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold">Lobster #{id}</h1>
            <p className="text-sm text-muted-foreground">
              {lobster.className} — {lobster.classRole}
            </p>
          </div>

          <StatBars stats={lobster.stats} />

          {lobster.damage > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Damage</span>
                <span className={lobster.damage >= 80 ? 'text-destructive font-medium' : ''}>
                  {lobster.damage}/100
                  {lobster.damage >= 80 && ' — Battle blocked'}
                </span>
              </div>
              <Progress value={lobster.damage} className="h-2" />
            </div>
          )}

          <DNAViewer
            lobsterClass={lobster.class}
            bodyParts={lobster.bodyParts}
            purity={lobster.purity}
          />
        </div>
      </div>

      {/* Actions */}
      {isOwner && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lobster.evolutionTier < 3 && evolutionCost && (
            <EvolutionSection
              lobsterId={id}
              evolutionCost={evolutionCost}
              fuelLobsters={fuelLobsters}
              onSuccess={invalidate}
            />
          )}
          {lobster.damage > 0 && repairCost && (
            <RepairSection
              lobsterId={id}
              repairCost={repairCost}
              onSuccess={invalidate}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EvolutionSection({
  lobsterId,
  evolutionCost,
  fuelLobsters,
  onSuccess,
}: {
  lobsterId: string;
  evolutionCost: { nextTierName: string; clawCost: string; fuelCount: number; fuelTierName: string };
  fuelLobsters: LobsterData[];
  onSuccess: () => void;
}) {
  const [fuel1, setFuel1] = useState('');
  const [fuel2, setFuel2] = useState('');

  const availableForFuel2 = fuelLobsters.filter((l) => l.tokenId !== fuel1);

  return (
    <div className="border border-border rounded-md p-5 space-y-3">
      <h3 className="font-semibold text-sm">Evolve to {evolutionCost.nextTierName}</h3>
      <div className="text-sm text-muted-foreground">
        Cost: <span className="text-foreground font-mono">{formatClaw(evolutionCost.clawCost)}</span>
        {' + '}{evolutionCost.fuelCount} {evolutionCost.fuelTierName} lobsters (burned)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={fuel1} onValueChange={setFuel1}>
          <SelectTrigger><SelectValue placeholder="Fuel #1" /></SelectTrigger>
          <SelectContent>
            {fuelLobsters.map((l) => (
              <SelectItem key={l.tokenId} value={l.tokenId}>#{l.tokenId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fuel2} onValueChange={setFuel2}>
          <SelectTrigger><SelectValue placeholder="Fuel #2" /></SelectTrigger>
          <SelectContent>
            {availableForFuel2.map((l) => (
              <SelectItem key={l.tokenId} value={l.tokenId}>#{l.tokenId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fuelLobsters.length < 2 && (
        <p className="text-xs text-muted-foreground">Need at least 2 eligible fuel lobsters.</p>
      )}
      <TransactionButton
        label="Evolve"
        disabled={!fuel1 || !fuel2}
        fetchSteps={(auth) => api.evolution.evolve(lobsterId, fuel1, fuel2, auth)}
        onSuccess={onSuccess}
      />
    </div>
  );
}

function RepairSection({
  lobsterId,
  repairCost,
  onSuccess,
}: {
  lobsterId: string;
  repairCost: { currentDamage: number; fullRepairCost: string; ratePerPoint: string; battleBlocked: boolean };
  onSuccess: () => void;
}) {
  const [points, setPoints] = useState<number>(repairCost.currentDamage);

  const cost = Number(repairCost.ratePerPoint) * points;

  return (
    <div className="border border-border rounded-md p-5 space-y-3">
      <h3 className="font-semibold text-sm">Repair</h3>
      <div className="text-sm space-y-1">
        <div className="text-muted-foreground">
          Damage: <span className={repairCost.battleBlocked ? 'text-destructive font-medium' : 'text-foreground'}>{repairCost.currentDamage}/100</span>
        </div>
        <div className="text-muted-foreground">
          Rate: <span className="text-foreground font-mono">{formatClaw(repairCost.ratePerPoint)}</span>/point
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">Repair {points} points</label>
        <input
          type="range"
          min={1}
          max={repairCost.currentDamage}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          className="w-full"
        />
        <div className="text-sm font-mono">Cost: {formatClaw(cost)}</div>
      </div>
      <TransactionButton
        label={`Repair ${points} pts`}
        fetchSteps={(auth) => api.repair.repair(lobsterId, points, auth)}
        onSuccess={onSuccess}
      />
    </div>
  );
}
