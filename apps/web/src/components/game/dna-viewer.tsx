'use client';

import { CLASS_NAMES_LIST } from '@clawbada/game-logic';
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

interface DNAViewerProps {
  lobsterClass: number;
  bodyParts: BodyPartGenes[];
  purity: number;
  className?: string;
}

function AlleleChip({ allele, isMatch, label }: { allele: Allele; isMatch: boolean; label: string }) {
  const className = CLASS_NAMES_LIST[allele.classAffinity] ?? 'Unknown';
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
        isMatch
          ? 'bg-claw-gold/15 text-claw-gold font-medium border border-claw-gold/20'
          : 'bg-muted/50 text-muted-foreground border border-transparent',
      )}
      title={`${label}: ${className}, Variant ${allele.variant}`}
    >
      <span className={cn(
        'font-bold text-[10px] uppercase tracking-wide rounded px-1 py-0.5',
        isMatch ? 'bg-claw-gold/20 text-claw-gold' : 'bg-muted text-muted-foreground',
      )}>
        {label}
      </span>
      <span className="truncate">{className}</span>
      <span className="text-[10px] opacity-50 shrink-0">v{allele.variant}</span>
    </div>
  );
}

export function DNAViewer({ lobsterClass, bodyParts, purity, className }: DNAViewerProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">DNA Breakdown</span>
        <span className="text-sm text-claw-gold font-medium">
          Purity {purity}/6
        </span>
      </div>
      <div className="space-y-2.5">
        {bodyParts.map((bp, i) => {
          const domMatch = bp.dominant.classAffinity === lobsterClass;
          return (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{BODY_PARTS[i]}</span>
                <span className="text-xs text-muted-foreground">{STAT_AFFINITY[i]}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <AlleleChip allele={bp.dominant} isMatch={domMatch} label="D" />
                <AlleleChip allele={bp.r1} isMatch={bp.r1.classAffinity === lobsterClass} label="R1" />
                <AlleleChip allele={bp.r2} isMatch={bp.r2.classAffinity === lobsterClass} label="R2" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
