import { cn } from '@/lib/utils';

interface FrostedSkeletonProps {
  className?: string;
  /** Number of skeleton lines to render */
  lines?: number;
}

/** Pulsing frosted panel placeholder for loading states */
export function FrostedSkeleton({ className, lines = 1 }: FrostedSkeletonProps) {
  if (lines > 1) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="frosted-skeleton h-4 rounded"
            style={{ width: `${Math.max(40, 100 - i * 15)}%`, animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    );
  }

  return <div className={cn('frosted-skeleton', className)} />;
}

/** Card-shaped skeleton for grid layouts */
export function FrostedSkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('frosted-skeleton p-4 space-y-3', className)}>
      <div className="h-3 bg-ocean-mid/30 rounded w-1/3" />
      <div className="h-8 bg-ocean-mid/20 rounded" />
      <div className="h-3 bg-ocean-mid/30 rounded w-2/3" />
    </div>
  );
}
