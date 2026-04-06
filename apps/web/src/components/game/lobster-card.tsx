'use client';

import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { useLobsterImage } from '@/hooks/use-lobster-image';
import { cn } from '@/lib/utils';
import { tierLabel } from '@/lib/format';
import { Lock, Sparkles, Link as LinkIcon } from 'lucide-react';

const SIZE_MAP = { sm: 2, md: 4, lg: 8 } as const;
const PX_MAP = { sm: 96, md: 192, lg: 384 } as const;

interface LobsterCardProps {
  tokenId: string;
  dna: string;
  className?: string;
  lobsterClass: number;
  evolutionTier: number;
  purity: number;
  legend: number;
  damage: number;
  locked: boolean;
  soulbound: boolean;
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export function LobsterCard({
  tokenId,
  dna,
  className,
  lobsterClass,
  evolutionTier,
  purity,
  legend,
  damage,
  locked,
  soulbound,
  selected,
  onClick,
  size = 'md',
}: LobsterCardProps) {
  const { dataUrl, loading } = useLobsterImage(dna, evolutionTier, SIZE_MAP[size]);
  const px = PX_MAP[size];
  const isLegend = legend > 0;
  const isDamaged = damage > 0;
  const isBlocked = damage >= 80;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg transition-all frosted-panel p-0',
        onClick && 'cursor-pointer hover:border-[rgba(255,210,128,0.3)]',
        selected && 'ring-2 ring-coral border-coral/40',
        isLegend && 'animate-pulse-glow',
        className,
      )}
      onClick={onClick}
    >
      {/* Image area */}
      <div
        className="relative bg-ocean-mid/50 flex items-center justify-center"
        style={{ width: px, height: px }}
      >
        {loading ? (
          <div className="animate-pulse bg-ocean-surface/40 w-full h-full" />
        ) : dataUrl ? (
          <img
            src={dataUrl}
            alt={`Lobster #${tokenId}`}
            width={px}
            height={px}
            className="image-rendering-pixelated"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <div className="text-text-secondary text-xs">No image</div>
        )}

        {/* Tier ribbon */}
        <div className="absolute top-1 left-1">
          <span className={cn(
            'font-pixel text-[9px] px-1.5 py-0.5 rounded',
            evolutionTier === 0 && 'bg-ocean-surface/80 text-text-secondary',
            evolutionTier === 1 && 'bg-teal/20 text-teal',
            evolutionTier === 2 && 'bg-ocean/20 text-ocean',
            evolutionTier === 3 && 'bg-claw-gold/20 text-claw-gold',
          )}>
            {tierLabel(evolutionTier)}
          </span>
        </div>

        {/* Status icons */}
        <div className="absolute top-1 right-1 flex gap-1">
          {locked && (
            <div className="bg-ocean-deep/70 rounded p-0.5" title="Locked">
              <Lock className="size-3 text-text-secondary" />
            </div>
          )}
          {soulbound && (
            <div className="bg-ocean-deep/70 rounded p-0.5" title="Soulbound">
              <LinkIcon className="size-3 text-text-secondary" />
            </div>
          )}
          {isLegend && (
            <div className="bg-claw-gold/80 rounded p-0.5" title="Legend">
              <Sparkles className="size-3 text-white" />
            </div>
          )}
        </div>

        {/* Damage bar at bottom of image */}
        {isDamaged && (
          <div className="absolute bottom-0 inset-x-0 h-1.5 bg-ocean-deep/60">
            <div
              className={cn(
                'h-full transition-all',
                isBlocked ? 'bg-destructive' : damage >= 40 ? 'bg-claw-gold' : 'bg-teal',
              )}
              style={{ width: `${Math.min(damage, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="p-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground truncate">#{tokenId}</span>
          <span className="text-[10px] text-text-secondary">
            {CLASS_NAMES_LIST[lobsterClass] ?? 'Unknown'}
          </span>
        </div>
        {/* Purity stars */}
        <div className="flex gap-0.5" title={`Purity: ${purity}/6`}>
          {Array.from({ length: 6 }, (_, i) => (
            <span
              key={i}
              className={cn(
                'text-[8px] leading-none',
                i < purity ? 'text-claw-gold' : 'text-ocean-surface',
              )}
            >
              ★
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
