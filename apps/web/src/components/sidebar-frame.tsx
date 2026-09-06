import { cn } from '@/lib/utils';

const TILE = '/sidebar-wood';

const pixelated = { imageRendering: 'pixelated' as const };

export function SidebarFrame({
  children,
  className,
  scale = 1,
}: {
  children: React.ReactNode;
  className?: string;
  /** 1 = pixel-perfect retina (96px tiles). 0.5 = half-scale (48px tiles). */
  scale?: number;
}) {
  const MID = Math.round(96 * scale);
  const TL_H = Math.round(112 * scale);
  const TR_W = Math.round(104 * scale);
  const TR_H = Math.round(108 * scale);
  const BL_H = Math.round(100 * scale);
  const BR_H = Math.round(104 * scale);
  const BOT_EDGE_H = Math.round(100 * scale);

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Decorative wood frame — non-interactive background layer */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        {/* Middle fill (base layer) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${TILE}/middle-01.png)`,
            backgroundRepeat: 'repeat',
            backgroundSize: `${MID}px ${MID}px`,
            ...pixelated,
          }}
        />

        {/* Top edge */}
        <div
          className="absolute"
          style={{
            top: 0,
            left: MID,
            right: TR_W,
            height: MID,
            backgroundImage: `url(${TILE}/top-01.png)`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: `${MID}px ${MID}px`,
            ...pixelated,
          }}
        />

        {/* Bottom edge */}
        <div
          className="absolute"
          style={{
            bottom: 0,
            left: MID,
            right: MID,
            height: BOT_EDGE_H,
            backgroundImage: `url(${TILE}/bottom-03.png)`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: `${MID}px ${BOT_EDGE_H}px`,
            ...pixelated,
          }}
        />

        {/* Left edge */}
        <div
          className="absolute"
          style={{
            top: TL_H,
            bottom: BL_H,
            left: 0,
            width: MID,
            backgroundImage: `url(${TILE}/left-01.png)`,
            backgroundRepeat: 'repeat-y',
            backgroundSize: `${MID}px ${MID}px`,
            ...pixelated,
          }}
        />

        {/* Right edge */}
        <div
          className="absolute"
          style={{
            top: TR_H,
            bottom: BR_H,
            right: 0,
            width: MID,
            backgroundImage: `url(${TILE}/right-02.png)`,
            backgroundRepeat: 'repeat-y',
            backgroundSize: `${MID}px ${MID}px`,
            ...pixelated,
          }}
        />

        {/* Corners */}
        {/* eslint-disable @next/next/no-img-element */}
        <img
          alt=""
          src={`${TILE}/top-left.png`}
          className="absolute top-0 left-0"
          style={{ width: MID, height: TL_H, ...pixelated }}
        />
        <img
          alt=""
          src={`${TILE}/top-right.png`}
          className="absolute top-0 right-0"
          style={{ width: TR_W, height: TR_H, ...pixelated }}
        />
        <img
          alt=""
          src={`${TILE}/bottom-left.png`}
          className="absolute bottom-0 left-0"
          style={{ width: MID, height: BL_H, ...pixelated }}
        />
        <img
          alt=""
          src={`${TILE}/bottom-right.png`}
          className="absolute bottom-0 right-0"
          style={{ width: MID, height: BR_H, ...pixelated }}
        />
        {/* eslint-enable @next/next/no-img-element */}
      </div>

      {/* Interactive content */}
      <div className="relative flex h-full flex-col">{children}</div>
    </div>
  );
}
