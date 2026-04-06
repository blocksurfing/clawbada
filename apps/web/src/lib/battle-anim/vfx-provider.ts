import type { VFXProvider, VFXEffect, SpriteMeta } from './types';

/**
 * VFX Provider registry.
 * Resolves VFX rendering for a given class + tier combo.
 * Sprite sheet providers take priority over procedural fallbacks.
 *
 * Keys: `"${classId}_${tier}"` for sprite sheets, `"${classId}"` for procedural.
 */
const providers = new Map<string, VFXProvider>();

/** Register a procedural VFX provider for a class (fallback when no sprite sheet). */
export function registerProceduralProvider(
  classId: number,
  provider: VFXProvider,
): void {
  providers.set(`${classId}`, provider);
}

/**
 * Register a sprite-sheet VFX provider for a specific class + tier combo.
 * Takes priority over procedural when both exist.
 */
export function registerSpriteProvider(
  classId: number,
  tier: number,
  spriteSheet: HTMLImageElement,
  meta: SpriteMeta,
): void {
  const provider: VFXProvider = {
    tick: (_fx, _dt) => {
      // Sprite sheets advance by progress — no particle physics needed
    },
    render: (fx, ctx, cs, layer) => {
      if (layer !== meta.layer) return;
      if (!spriteSheet.complete) return;

      const frameIdx = Math.min(
        Math.floor(fx.progress * meta.frameCount),
        meta.frameCount - 1,
      );
      const srcX = frameIdx * meta.frameWidth;

      const dstX = (fx.target?.x ?? fx.origin.x) * cs;
      const dstY = (fx.target?.y ?? fx.origin.y) * cs;
      const dstW = meta.frameWidth * cs;
      const dstH = meta.frameHeight * cs;

      ctx.drawImage(
        spriteSheet,
        srcX,
        0,
        meta.frameWidth,
        meta.frameHeight,
        dstX - dstW / 2,
        dstY - dstH / 2,
        dstW,
        dstH,
      );
    },
  };

  providers.set(`${classId}_${tier}`, provider);
}

/**
 * Get the VFX provider for a class + tier.
 * Checks for sprite sheet first, then procedural fallback.
 */
export function getProvider(classId: number, tier: number): VFXProvider | null {
  // Sprite sheet has priority
  return (
    providers.get(`${classId}_${tier}`) ??
    providers.get(`${classId}`) ??
    null
  );
}

/** No-op provider for classes without VFX definitions. */
export const NOOP_PROVIDER: VFXProvider = {
  tick: () => {},
  render: () => {},
};

/**
 * Auto-discover and register sprite sheet providers from /assets/animated/.
 * Call once at startup. Non-existent files are silently skipped.
 *
 * Expected file naming: `vfx-{className}-{tierName}-sheet.png`
 * Expected metadata: `vfx-{className}-{tierName}-meta.json`
 */
export async function autoLoadSpriteSheets(
  classNames: string[],
  tierNames: string[] = ['evolved', 'elite', 'apex'],
): Promise<void> {
  const basePath = '/assets/animated';

  for (let classId = 0; classId < classNames.length; classId++) {
    const className = classNames[classId].toLowerCase();
    for (let tierIdx = 0; tierIdx < tierNames.length; tierIdx++) {
      const tierName = tierNames[tierIdx];
      const tier = tierIdx + 1; // Evolved=1, Elite=2, Apex=3
      const sheetPath = `${basePath}/vfx-${className}-${tierName}-sheet.png`;
      const metaPath = `${basePath}/vfx-${className}-${tierName}-meta.json`;

      try {
        const metaRes = await fetch(metaPath);
        if (!metaRes.ok) continue;
        const meta = (await metaRes.json()) as SpriteMeta;

        const img = new Image();
        img.src = sheetPath;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
        });

        registerSpriteProvider(classId, tier, img, meta);
      } catch {
        // No sprite sheet for this combo — procedural fallback will be used
      }
    }
  }
}
