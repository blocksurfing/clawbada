'use client';

import { useLobsterImage } from '@/hooks/use-lobster-image';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { tierLabel } from '@/lib/format';
import { Lock, AlertTriangle, Sparkles, Link as LinkIcon } from 'lucide-react';

const CLASS_NAMES = [
  'Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter',
  'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember',
] as const;

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

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all',
        onClick && 'cursor-pointer hover:ring-2 hover:ring-ring',
        selected && 'ring-2 ring-primary',
        className,
      )}
      onClick={onClick}
    >
      <div
        className="relative bg-muted flex items-center justify-center"
        style={{ width: px, height: px }}
      >
        {loading ? (
          <div className="animate-pulse bg-muted-foreground/20 w-full h-full" />
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
          <div className="text-muted-foreground text-xs">No image</div>
        )}

        {/* Status icons */}
        <div className="absolute top-1 right-1 flex gap-1">
          {locked && (
            <div className="bg-background/80 rounded p-0.5" title="Locked">
              <Lock className="size-3 text-muted-foreground" />
            </div>
          )}
          {soulbound && (
            <div className="bg-background/80 rounded p-0.5" title="Soulbound">
              <LinkIcon className="size-3 text-muted-foreground" />
            </div>
          )}
          {legend > 0 && (
            <div className="bg-yellow-500/80 rounded p-0.5" title="Legend">
              <Sparkles className="size-3 text-white" />
            </div>
          )}
        </div>

        {damage >= 80 && (
          <div className="absolute bottom-1 right-1 bg-destructive/80 rounded p-0.5" title={`Damage: ${damage}/100`}>
            <AlertTriangle className="size-3 text-white" />
          </div>
        )}
      </div>

      <div className="p-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium truncate">#{tokenId}</span>
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {tierLabel(evolutionTier)}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {CLASS_NAMES[lobsterClass] ?? 'Unknown'}
          </Badge>
          <div className="flex gap-0.5" title={`Purity: ${purity}/6`}>
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'size-1.5 rounded-full',
                  i < purity ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
