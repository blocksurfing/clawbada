import { cn } from '@/lib/utils';

const variants = {
  default: 'frosted-panel',
  highlight: 'frosted-panel-highlight',
  danger: 'frosted-panel-danger',
} as const;

/** 9-slice frame set filenames by variant (when pixel art frames are delivered) */
const FRAME_SETS: Record<string, string> = {
  default: '/assets/panels/frame-default',
  highlight: '/assets/panels/frame-highlight',
  danger: '/assets/panels/frame-danger',
};

interface FrostedPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
  /** Enable pixel art 9-slice frame (requires frame PNGs in /assets/panels/) */
  pixelFrame?: boolean;
}

export function FrostedPanel({
  variant = 'default',
  pixelFrame,
  className,
  children,
  ...props
}: FrostedPanelProps) {
  if (pixelFrame) {
    const base = FRAME_SETS[variant] ?? FRAME_SETS.default;
    return (
      <div
        className={cn('nine-slice p-4', className)}
        style={{ borderImageSource: `url(${base}-border.png)` }}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn(variants[variant], 'p-4', className)} {...props}>
      {children}
    </div>
  );
}
