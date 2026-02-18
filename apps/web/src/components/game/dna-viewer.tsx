'use client';

import { cn } from '@/lib/utils';

const CLASS_NAMES = [
  'Bulwark', 'Mantis', 'Leviathan', 'Tempest', 'Specter',
  'Sentinel', 'Reaver', 'Abyss', 'Kraken', 'Ember',
] as const;

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
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
        isMatch ? 'bg-primary/15 text-primary font-medium' : 'bg-muted text-muted-foreground',
      )}
      title={`${label}: Class ${CLASS_NAMES[allele.classAffinity]}, Variant ${allele.variant}`}
    >
      <span className="font-mono text-[10px]">{label}</span>
      <span>{CLASS_NAMES[allele.classAffinity]?.[0] ?? '?'}</span>
      <span className="text-[10px] opacity-60">v{allele.variant}</span>
    </div>
  );
}

export function DNAViewer({ lobsterClass, bodyParts, purity, className }: DNAViewerProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">DNA Breakdown</span>
        <span className="text-xs text-muted-foreground">
          Purity: {purity}/6
        </span>
      </div>
      <div className="space-y-1.5">
        {bodyParts.map((bp, i) => {
          const domMatch = bp.dominant.classAffinity === lobsterClass;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="w-20 flex flex-col">
                <span className="text-xs font-medium">{BODY_PARTS[i]}</span>
                <span className="text-[10px] text-muted-foreground">{STAT_AFFINITY[i]}</span>
              </div>
              <div className="flex gap-1">
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
