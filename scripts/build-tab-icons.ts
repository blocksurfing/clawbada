#!/usr/bin/env bun
/**
 * Write the web app's browser-tab icon files from Nzib's wordmark emblem (one rounded navy tile, see gitbook/tab-icon.ts):
 *   apps/web/src/app/icon.png          32 px            — Next.js links it on every page (<link rel="icon" sizes="32x32">)
 *   apps/web/src/app/apple-icon.png   180 px            — <link rel="apple-touch-icon">, home-screen bookmarks
 *   apps/web/src/app/favicon.ico      16 / 32 / 48 px   — the bare /favicon.ico fetch, on every hostname (docs.clawbada.com too)
 * The book embeds the same icon as data URIs (scripts/gitbook/build.ts), so the two never drift.
 *
 * Usage: bun run tab-icons        (re-run after the logo changes; needs bun install for sharp)
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TAB_ICON_SOURCE, icoFromPngs, tabIconComposite, tabIconPng } from './gitbook/tab-icon.ts';

const REPO = resolve(import.meta.dir, '..');
const PUBLIC = join(REPO, 'apps/web/public');
const APP = join(REPO, 'apps/web/src/app');

const sharp = (await import(Bun.resolveSync('sharp', join(REPO, 'packages/asset-gen')))).default;
const composite = await tabIconComposite(sharp, join(PUBLIC, TAB_ICON_SOURCE));
const [png16, png32, png48, png180] = await Promise.all([16, 32, 48, 180].map((size) => tabIconPng(sharp, composite, size)));

const outputs: [string, Buffer][] = [
  [join(APP, 'icon.png'), png32],
  [join(APP, 'apple-icon.png'), png180],
  [join(APP, 'favicon.ico'), icoFromPngs([{ size: 16, png: png16 }, { size: 32, png: png32 }, { size: 48, png: png48 }])],
];
for (const [path, buf] of outputs) {
  writeFileSync(path, buf);
  console.log(`wrote ${path} (${buf.length} B)`);
}
