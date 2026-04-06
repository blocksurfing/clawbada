'use client';

import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
import { CLASS_CARD_COLORS } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

const BODY_PARTS = ['Carapace', 'Claws', 'Tail', 'Antennae', 'Eyes', 'Legs'] as const;
const STAT_AFFINITY = ['HP', 'Attack', 'Speed', 'Critical', 'Armor', 'HP'] as const;

interface Allele {
  classAffinity: number;
  variant: number;
}

interface BodyPartGenes {
  dominant: Allele;
  r1: Allele;
  r2: Allele;
}

interface BodyPartsGridProps {
  lobsterClass: number;
  bodyParts: BodyPartGenes[];
  className?: string;
}

export function BodyPartsGrid({ lobsterClass, bodyParts, className }: BodyPartsGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2.5', className)}>
      {bodyParts.map((bp, i) => {
        const domClass = bp.dominant.classAffinity;
        const isMatch = domClass === lobsterClass;
        const classColor = CLASS_CARD_COLORS[domClass] ?? '#4682B4';
        const className = CLASS_NAMES_LIST[domClass] ?? 'Unknown';

        return (
          <div
            key={i}
            className={cn(
              'rounded-lg p-3 border transition-colors',
              isMatch
                ? 'border-claw-gold/30 bg-claw-gold/5'
                : 'border-border bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2.5">
              {/* Class color circle */}
              <div
                className={cn(
                  'size-8 rounded-full shrink-0 flex items-center justify-center border-2',
                  isMatch ? 'border-claw-gold' : 'border-transparent',
                )}
                style={{ backgroundColor: `${classColor}40` }}
              >
                <div
                  className="size-4 rounded-full"
                  style={{ backgroundColor: classColor }}
                />
              </div>

              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{BODY_PARTS[i]}</div>
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    'text-xs font-medium',
                    isMatch ? 'text-claw-gold' : 'text-text-secondary',
                  )}>
                    {className}
                  </span>
                  <span className="text-[10px] text-text-secondary/60">
                    {STAT_AFFINITY[i]}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
