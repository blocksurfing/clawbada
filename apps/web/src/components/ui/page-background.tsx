import { cn } from '@/lib/utils';

const gradients = {
  shallow: [
    'bg-[#1a4570]',
    'before:absolute before:inset-0',
    'before:bg-[radial-gradient(ellipse_at_50%_-20%,rgba(88,166,255,0.30)_0%,rgba(63,185,160,0.10)_40%,transparent_70%)]',
  ].join(' '),
  reef: [
    'bg-[#133652]',
    'before:absolute before:inset-0',
    'before:bg-[radial-gradient(ellipse_at_50%_0%,rgba(63,185,160,0.15)_0%,rgba(249,112,102,0.08)_35%,transparent_65%)]',
  ].join(' '),
  deep: [
    'bg-[#0e2038]',
    'before:absolute before:inset-0',
    'before:bg-[radial-gradient(ellipse_at_50%_0%,rgba(88,166,255,0.12)_0%,transparent_50%)]',
  ].join(' '),
  cavern: [
    'bg-[#0a0a0b]',
    'before:absolute before:inset-0',
    'before:bg-[radial-gradient(ellipse_at_50%_0%,rgba(30,30,35,0.5)_0%,transparent_50%)]',
  ].join(' '),
} as const;

interface PageBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof gradients;
  /**
   * Optional scene background image path (e.g. from BACKGROUNDS constants).
   * Rendered behind the gradient at low opacity for visual depth.
   * Falls back gracefully if the image doesn't exist.
   */
  scene?: string;
  /** Use the darkened version of the scene image (even lower opacity) */
  sceneDark?: boolean;
}

export function PageBackground({
  variant = 'reef',
  scene,
  sceneDark,
  className,
  children,
  ...props
}: PageBackgroundProps) {
  return (
    <div
      className={cn(
        'relative min-h-full before:pointer-events-none',
        gradients[variant],
        className,
      )}
      {...props}
    >
      {scene && (
        <div
          className={cn('scene-bg', sceneDark && 'scene-bg-dark')}
          style={{ backgroundImage: `url(${scene})` }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
