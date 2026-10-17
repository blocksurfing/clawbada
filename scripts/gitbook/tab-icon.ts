/**
 * The browser-tab icon, rendered from Nzib's wordmark emblem (apps/web/public/ui/brand/logo-wordmark-512.png — the
 * book's cover art and the Shell's brand mark). The emblem is trimmed of its transparent margins, centred on a rounded
 * tile in the page navy and scaled ONCE from a 512-px composite, so it keeps a solid silhouette on light and dark tab
 * bars and the same shape at 16, 32, 48 and 180 px (a transparent emblem smears into a dark tab bar at 16 px).
 *
 * Used by scripts/gitbook/build.ts (data URIs in the book's <head>, so the single-file HTML stays self-contained) and
 * scripts/build-tab-icons.ts (the web app's icon.png / apple-icon.png / favicon.ico under apps/web/src/app).
 */

/** The emblem, under apps/web/public. */
export const TAB_ICON_SOURCE = 'ui/brand/logo-wordmark-512.png';
/** The tile colour: `--page` in apps/web (the book page and the Shell background). */
export const TAB_ICON_TILE = '#192c53';

const TILE = 512;
const EMBLEM = 448; // the emblem's longest side inside the tile (7/8)
const RADIUS = 96; // 18.75 % corner, the home-screen convention

/** sharp is resolved at runtime from packages/asset-gen (bun keeps it there) — see loadSharp in build.ts. */
export type Sharp = any;

/** The 512-px composite every size is scaled from. */
export async function tabIconComposite(sharp: Sharp, logoPath: string): Promise<Buffer> {
  const trimmed = await sharp(logoPath).trim().toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info as { width: number; height: number };
  const side = Math.max(width, height);
  // Two passes on purpose: sharp applies resize before extend whatever the call order, so padding in the same
  // pipeline would land after the scale and the emblem would come out 448 × 562.
  const squared: Buffer = await sharp(trimmed.data)
    .extend({
      top: Math.floor((side - height) / 2),
      bottom: Math.ceil((side - height) / 2),
      left: Math.floor((side - width) / 2),
      right: Math.ceil((side - width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const emblem: Buffer = await sharp(squared).resize(EMBLEM, EMBLEM, { kernel: 'lanczos3' }).png().toBuffer();
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" rx="${RADIUS}" ry="${RADIUS}" fill="${TAB_ICON_TILE}"/></svg>`,
  );
  return sharp(tile).composite([{ input: emblem, gravity: 'centre' }]).png().toBuffer();
}

/** One PNG of the composite at `size` × `size`. */
export async function tabIconPng(sharp: Sharp, composite: Buffer, size: number): Promise<Buffer> {
  return sharp(composite).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico container holding PNG-compressed entries (every current browser reads these; Windows has since Vista). */
export function icoFromPngs(entries: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // width (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    dir.writeUInt8(0, o + 2); // no palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}
