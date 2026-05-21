'use client';

import { use, useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api, type LobsterData } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnimatedLobster } from '@/components/game/animated-lobster';
import { StatBars } from '@/components/game/stat-bars';
import { DNAViewer } from '@/components/game/dna-viewer';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatClaw, tierLabel } from '@/lib/format';
import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { Sparkles, Link as LinkIcon, Lock, ChevronLeft, ArrowUpCircle, Wrench } from 'lucide-react';

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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
    queryClient.invalidateQueries({ queryKey: ['evolutionCost'] });
    queryClient.invalidateQueries({ queryKey: ['repairCost'] });
  };

  if (!address) {
    return (
      <PageBackground variant="reef">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <p className="text-sm text-text-secondary">Connect your wallet to view lobster details.</p>
        </div>
      </PageBackground>
    );
  }

  if (!lobster) {
    return (
      <PageBackground variant="reef">
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <p className="text-sm text-text-secondary">Lobster #{id} not found in your collection.</p>
          <Link href="/game" className="text-coral text-sm mt-2 inline-block hover:underline">Back to Dashboard</Link>
        </div>
      </PageBackground>
    );
  }

  const isOwner = address && lobster.owner.toLowerCase() === address.toLowerCase();
  const fuelLobsters = lobstersData?.lobsters.filter(
    (l) => l.tokenId !== id && !l.locked && l.evolutionTier === lobster.evolutionTier,
  ) ?? [];

  return (
    <PageBackground variant="reef">
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <Link href="/game" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-foreground transition-colors">
          <ChevronLeft className="size-4" /> Back
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Image spotlight */}
          <div className="space-y-3">
            <FrostedPanel className="relative flex items-center justify-center aspect-square max-w-[384px] overflow-hidden">
              <AnimatedLobster
                dna={lobster.dna}
                evolutionTier={lobster.evolutionTier}
                displaySize={384}
                frameSize={240}
                frames={16}
              />

              <div className="absolute top-2 left-2 flex gap-1">
                {lobster.legend > 0 && (
                  <Badge className="bg-claw-gold text-black text-xs">
                    <Sparkles className="size-3 mr-0.5" /> Legend
                  </Badge>
                )}
                {lobster.soulbound && (
                  <Badge className="bg-ocean-surface/80 text-text-secondary border-0 text-xs">
                    <LinkIcon className="size-3 mr-0.5" /> Soulbound
                  </Badge>
                )}
                {lobster.locked && (
                  <Badge className="bg-ocean-surface/80 text-text-secondary border-0 text-xs">
                    <Lock className="size-3 mr-0.5" /> Locked
                  </Badge>
                )}
              </div>
            </FrostedPanel>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className="bg-coral/15 text-coral border-0 text-xs">{CLASS_NAMES_LIST[lobster.class]}</Badge>
              <Badge className="bg-ocean-surface/50 text-text-secondary border-0 text-xs">{tierLabel(lobster.evolutionTier)}</Badge>
              <Badge className="bg-ocean-surface/50 text-text-secondary border-0 text-xs">Gen {lobster.generation}</Badge>
              <Badge className="bg-ocean-surface/50 text-text-secondary border-0 text-xs">Breeds: {lobster.breedCount}/5</Badge>
              <Badge className="bg-claw-gold/15 text-claw-gold border-0 text-xs">
                {'★'.repeat(lobster.purity)}{'☆'.repeat(6 - lobster.purity)}
              </Badge>
            </div>
          </div>

          {/* Stats panel */}
          <div className="space-y-4">
            <div>
              <h1 className="font-pixel text-xl text-foreground">Lobster #{id}</h1>
              <p className="text-sm text-text-secondary">
                {lobster.className} — {lobster.classRole}
              </p>
            </div>

            <FrostedPanel className="p-4">
              <h2 className="font-pixel text-[10px] text-text-accent uppercase tracking-wider mb-3">Stats</h2>
              <StatBars stats={lobster.stats} />
            </FrostedPanel>

            {lobster.damage > 0 && (
              <FrostedPanel variant={lobster.damage >= 80 ? 'danger' : 'default'} className="p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Battle Damage</span>
                  <span className={lobster.damage >= 80 ? 'text-destructive font-medium' : 'text-foreground'}>
                    {lobster.damage}/100
                    {lobster.damage >= 80 && ' — Blocked'}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-ocean-mid overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      lobster.damage >= 80 ? 'bg-destructive' : lobster.damage >= 40 ? 'bg-claw-gold' : 'bg-teal'
                    }`}
                    style={{ width: `${Math.min(lobster.damage, 100)}%` }}
                  />
                </div>
              </FrostedPanel>
            )}

            <FrostedPanel className="p-4">
              <h2 className="font-pixel text-[10px] text-text-accent uppercase tracking-wider mb-3">DNA</h2>
              <DNAViewer
                lobsterClass={lobster.class}
                bodyParts={lobster.bodyParts}
                purity={lobster.purity}
              />
            </FrostedPanel>
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
    </PageBackground>
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
    <FrostedPanel variant="highlight" className="space-y-3">
      <div className="flex items-center gap-2">
        <ArrowUpCircle className="size-4 text-claw-gold" />
        <h3 className="font-pixel text-xs text-foreground">Evolve to {evolutionCost.nextTierName}</h3>
      </div>
      <div className="text-sm text-text-secondary">
        Cost: <span className="text-foreground font-mono">{formatClaw(evolutionCost.clawCost)}</span>
        {' + '}{evolutionCost.fuelCount} {evolutionCost.fuelTierName} lobsters (burned)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={fuel1} onValueChange={setFuel1}>
          <SelectTrigger className="bg-ocean-mid/50 border-border"><SelectValue placeholder="Fuel #1" /></SelectTrigger>
          <SelectContent>
            {fuelLobsters.map((l) => (
              <SelectItem key={l.tokenId} value={l.tokenId}>#{l.tokenId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fuel2} onValueChange={setFuel2}>
          <SelectTrigger className="bg-ocean-mid/50 border-border"><SelectValue placeholder="Fuel #2" /></SelectTrigger>
          <SelectContent>
            {availableForFuel2.map((l) => (
              <SelectItem key={l.tokenId} value={l.tokenId}>#{l.tokenId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fuelLobsters.length < 2 && (
        <p className="text-xs text-text-secondary">Need at least 2 eligible fuel lobsters.</p>
      )}
      <TransactionButton
        label="Evolve"
        disabled={!fuel1 || !fuel2}
        fetchSteps={(auth) => api.evolution.evolve(lobsterId, fuel1, fuel2, auth)}
        onSuccess={onSuccess}
      />
    </FrostedPanel>
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
    <FrostedPanel variant="danger" className="space-y-3">
      <div className="flex items-center gap-2">
        <Wrench className="size-4 text-coral" />
        <h3 className="font-pixel text-xs text-foreground">Repair</h3>
      </div>
      <div className="text-sm space-y-1">
        <div className="text-text-secondary">
          Damage: <span className={repairCost.battleBlocked ? 'text-destructive font-medium' : 'text-foreground'}>{repairCost.currentDamage}/100</span>
        </div>
        <div className="text-text-secondary">
          Rate: <span className="text-foreground font-mono">{formatClaw(repairCost.ratePerPoint)}</span>/point
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm text-text-secondary">Repair {points} points</label>
        <input
          type="range"
          min={1}
          max={repairCost.currentDamage}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          className="w-full accent-coral"
        />
        <div className="text-sm font-mono text-foreground">Cost: {formatClaw(cost)}</div>
      </div>
      <TransactionButton
        label={`Repair ${points} pts`}
        fetchSteps={(auth) => api.repair.repair(lobsterId, points, auth)}
        onSuccess={onSuccess}
      />
    </FrostedPanel>
  );
}
