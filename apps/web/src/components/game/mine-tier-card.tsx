import { cn } from '@/lib/utils';
import { formatClaw, tierLabel } from '@/lib/format';
import { Pickaxe } from 'lucide-react';
import { MINE_BACKGROUNDS } from '@/lib/assets';

const TIER_ACCENTS = [
  'text-text-secondary',
  'text-teal',
  'text-ocean',
  'text-claw-gold',
] as const;

interface MineTierCardProps {
  tier: number;
  reward: number;
  available: boolean;
  onSelect: () => void;
}

export function MineTierCard({ tier, reward, available, onSelect }: MineTierCardProps) {
  return (
    <button
      onClick={onSelect}
      disabled={!available}
      className={cn(
        'overflow-hidden text-left transition-all w-full group rounded-lg border border-[rgba(255,210,128,0.15)]',
        available
          ? 'cursor-pointer hover:border-[rgba(255,210,128,0.3)] card-hover'
          : 'opacity-50 cursor-not-allowed',
      )}
    >
      {/* Scene image — fully unobstructed, no overlays */}
      <div className="relative h-36 sm:h-44 overflow-hidden">
        <img
          src={MINE_BACKGROUNDS[tier]}
          alt={`${tierLabel(tier)} mine scene`}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      {/* Info section */}
      <div className="p-4 pt-3 space-y-2 bg-[rgba(42,31,20,0.90)]">
        <div className="flex items-center justify-between">
          <h3 className={cn('font-pixel text-sm', TIER_ACCENTS[tier])}>
            {tierLabel(tier)} Mine
          </h3>
          <Pickaxe className={cn('size-4', TIER_ACCENTS[tier])} />
        </div>
        <div>
          <p className="text-lg font-pixel text-text-accent">{formatClaw(reward)}</p>
          <p className="text-[10px] text-text-secondary">per expedition</p>
        </div>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>4h duration</span>
          <span>{tierLabel(tier)}+ required</span>
        </div>
        {available && (
          <div className="pt-1">
            <span className="text-xs font-medium text-coral">Send Team →</span>
          </div>
        )}
      </div>
    </button>
  );
}
