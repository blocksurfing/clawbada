'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { TransactionButton } from '@/components/game/transaction-button';
import { FrostedPanel } from '@/components/ui/frosted-panel';
import { PageBackground } from '@/components/ui/page-background';
import { formatClaw, tierLabel } from '@/lib/format';
import { BACKGROUNDS } from '@/lib/assets';
import { Wrench, AlertTriangle } from 'lucide-react';

export default function RepairPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [selectedLobster, setSelectedLobster] = useState<string | null>(null);
  const [repairPoints, setRepairPoints] = useState<number | undefined>(undefined);

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  const { data: costData } = useQuery({
    queryKey: ['repairCost', selectedLobster, repairPoints],
    queryFn: () => api.repair.cost(selectedLobster!, repairPoints),
    enabled: !!selectedLobster,
  });

  const lobsters = lobstersData?.lobsters ?? [];
  const damaged = lobsters.filter((l) => l.damage > 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
    queryClient.invalidateQueries({ queryKey: ['repairCost'] });
    setSelectedLobster(null);
    setRepairPoints(undefined);
  };

  if (!address) {
    return (
      <PageBackground variant="reef" scene={BACKGROUNDS.repair}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <Wrench className="size-8 text-text-secondary mb-3" />
          <h1 className="font-pixel text-2xl text-foreground mb-2">Repair Shop</h1>
          <p className="text-sm text-text-secondary">Connect your wallet to repair lobsters.</p>
        </div>
      </PageBackground>
    );
  }

  return (
    <PageBackground variant="reef" scene={BACKGROUNDS.repair}>
      <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <img src="/assets/icons/Repair.svg" alt="" width={28} height={28} style={{ imageRendering: 'pixelated' as const }} />
            <h1 className="font-pixel text-xl text-foreground">Repair Shop</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Fix battle damage — lobsters with 80+ damage can't enter battle
          </p>
        </div>

        {damaged.length === 0 ? (
          <FrostedPanel className="py-12 text-center">
            <Wrench className="size-6 mx-auto mb-3 text-text-secondary" />
            <p className="text-sm text-text-secondary">
              No damaged lobsters. Your roster is in perfect shape!
            </p>
          </FrostedPanel>
        ) : (
          <div className="space-y-3">
            <h2 className="font-pixel text-xs text-text-accent uppercase tracking-wider">Select Damaged Lobster</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {damaged.map((l) => {
                const blocked = l.damage >= 80;
                return (
                  <button
                    key={l.tokenId}
                    onClick={() => {
                      setSelectedLobster(l.tokenId === selectedLobster ? null : l.tokenId);
                      setRepairPoints(undefined);
                    }}
                    className={`text-left p-3 transition-colors ${
                      l.tokenId === selectedLobster
                        ? 'frosted-panel-danger'
                        : 'frosted-panel hover:border-[rgba(255,210,128,0.3)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono text-foreground">#{l.tokenId}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-pixel text-[10px] text-text-secondary">{tierLabel(l.evolutionTier)}</span>
                        {blocked && (
                          <Badge className="bg-destructive/15 text-destructive border-0 text-[10px]">
                            <AlertTriangle className="size-2.5 mr-0.5" /> Blocked
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-text-secondary">{l.className}</span>
                      <DamageBar damage={l.damage} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Repair controls */}
        {selectedLobster && costData && (
          <FrostedPanel variant="danger" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Repair #{selectedLobster}</span>
              <span className="text-xs text-text-secondary">
                Damage: {costData.currentDamage}/100
              </span>
            </div>

            {/* Repair slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>Points to repair</span>
                <span className="font-mono text-foreground">{costData.pointsToRepair}</span>
              </div>
              <input
                type="range"
                min={1}
                max={costData.currentDamage}
                value={repairPoints ?? costData.currentDamage}
                onChange={(e) => setRepairPoints(Number(e.target.value))}
                className="w-full accent-coral"
              />
              <div className="flex justify-between text-[10px] text-text-secondary">
                <span>1 point</span>
                <span>Full repair ({costData.currentDamage})</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-text-secondary">Repair Cost</p>
                <p className="font-mono text-coral">{formatClaw(costData.cost)}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Rate</p>
                <p className="font-mono text-foreground">{costData.ratePerPoint} $CLAW/point ({costData.tierName})</p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>Damage after: {costData.damageAfterRepair}/100</span>
              {costData.battleBlocked && costData.damageAfterRepair < 80 && (
                <Badge className="bg-teal/15 text-teal border-0 text-[10px]">Unblocks battle</Badge>
              )}
            </div>

            <TransactionButton
              label={`Repair for ${formatClaw(costData.cost)}`}
              fetchSteps={(auth) => api.repair.repair(selectedLobster, repairPoints, auth)}
              onSuccess={invalidate}
            />
          </FrostedPanel>
        )}
      </div>
    </PageBackground>
  );
}

function DamageBar({ damage }: { damage: number }) {
  const pct = Math.min(damage, 100);
  const color = pct >= 80 ? 'bg-destructive' : pct >= 40 ? 'bg-claw-gold' : 'bg-teal';

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-ocean-mid overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-text-secondary">{damage}</span>
    </div>
  );
}
