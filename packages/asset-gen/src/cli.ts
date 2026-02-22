#!/usr/bin/env bun
/**
 * clawbada-asset-gen CLI
 *
 * Commands:
 *   render <dna>                    Render single lobster
 *   batch <dna> <count>             Batch render sequential DNAs
 *   variant <part> <class> <variant> Render one body part variant
 *   sheet <part> <class>            16-variant sprite sheet
 *   preview-all                     Grid of all templates × variants
 *   validate-templates              Check all JSON templates
 */

import { parseArgs } from 'util';
import { mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import {
  renderLobster,
  renderPart,
  dnaToRenderParams,
  loadTemplate,
  clearTemplateCache,
  NATIVE_SIZE,
  NUM_BODY_PARTS,
  NUM_CLASSES,
  VARIANTS_PER_TEMPLATE,
  BODY_PART_NAMES,
  CLASS_NAMES,
} from './index';
import { gridToPng, saveGridAsPng } from './render/renderer-sharp';
import { upscale } from './utils/upscale';
import { createGrid, blitOver } from './render/pixel-grid';
import { generateVariant } from './variants/generator';
import { resolveColorsRaw } from './pipeline/color-pipeline';
import { validateTemplate } from './templates/schema';
import { loadAllTemplates } from './templates/loader';
import type { PixelGrid } from './types';
import type { RoleGrid } from './variants/mutations';

// ──────────── Helpers ────────────

function parseDNA(str: string): bigint {
  if (str.startsWith('0x') || str.startsWith('0X')) {
    return BigInt(str);
  }
  return BigInt(str);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function bodyPartIndex(name: string): number {
  const idx = BODY_PART_NAMES.indexOf(name as typeof BODY_PART_NAMES[number]);
  if (idx === -1) {
    const asNum = parseInt(name, 10);
    if (!isNaN(asNum) && asNum >= 0 && asNum < NUM_BODY_PARTS) return asNum;
    throw new Error(`Unknown body part: ${name}. Valid: ${BODY_PART_NAMES.join(', ')} or 0-5`);
  }
  return idx;
}

function classIndex(name: string): number {
  const idx = CLASS_NAMES.indexOf(name as typeof CLASS_NAMES[number]);
  if (idx === -1) {
    const asNum = parseInt(name, 10);
    if (!isNaN(asNum) && asNum >= 0 && asNum < NUM_CLASSES) return asNum;
    throw new Error(`Unknown class: ${name}. Valid: ${CLASS_NAMES.join(', ')} or 0-9`);
  }
  return idx;
}

// ──────────── Commands ────────────

async function cmdRender(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      size: { type: 'string', short: 's', default: '192' },
      tier: { type: 'string', short: 't', default: '0' },
      output: { type: 'string', short: 'o', default: 'lobster.png' },
      parts: { type: 'string', short: 'p' },
    },
    allowPositionals: true,
  });

  if (positionals.length < 1) {
    console.error('Usage: clawbada-asset-gen render <dna> [--size 192] [--tier 0] [--output lobster.png]');
    process.exit(1);
  }

  const dna = parseDNA(positionals[0]);
  const size = parseInt(values.size!, 10);
  const tier = parseInt(values.tier!, 10);
  const partsFilter = values.parts ? values.parts.split(',').map((s) => bodyPartIndex(s.trim())) : undefined;

  console.log(`Rendering DNA: ${dna.toString(16).slice(0, 16)}... at ${size}×${size}, tier ${tier}`);
  const grid = await renderLobster(dna, tier, { size, partsFilter });
  await saveGridAsPng(grid, values.output!);
  console.log(`Saved: ${values.output}`);
}

async function cmdBatch(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      outdir: { type: 'string', short: 'd', default: './output' },
      size: { type: 'string', short: 's', default: '192' },
      tier: { type: 'string', short: 't', default: '0' },
      concurrency: { type: 'string', short: 'c', default: '4' },
    },
    allowPositionals: true,
  });

  if (positionals.length < 2) {
    console.error('Usage: clawbada-asset-gen batch <startDna> <count> [--outdir ./output]');
    process.exit(1);
  }

  const startDna = parseDNA(positionals[0]);
  const count = parseInt(positionals[1], 10);
  const size = parseInt(values.size!, 10);
  const tier = parseInt(values.tier!, 10);
  const concurrency = parseInt(values.concurrency!, 10);
  const outdir = resolve(values.outdir!);

  ensureDir(outdir);
  console.log(`Batch rendering ${count} lobsters to ${outdir}`);

  let completed = 0;
  const tasks: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const dna = startDna + BigInt(i);
    const task = async () => {
      const grid = await renderLobster(dna, tier, { size });
      const filename = `lobster_${dna.toString(16).padStart(64, '0')}.png`;
      await saveGridAsPng(grid, join(outdir, filename));
      completed++;
      if (completed % 10 === 0 || completed === count) {
        console.log(`  ${completed}/${count} rendered`);
      }
    };

    tasks.push(task());

    // Throttle concurrency
    if (tasks.length >= concurrency) {
      await Promise.race(tasks);
      // Remove completed tasks
      for (let j = tasks.length - 1; j >= 0; j--) {
        const status = await Promise.race([tasks[j].then(() => true), Promise.resolve(false)]);
        if (status) tasks.splice(j, 1);
      }
    }
  }

  await Promise.all(tasks);
  console.log(`Done. ${count} PNGs saved to ${outdir}`);
}

async function cmdVariant(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      size: { type: 'string', short: 's', default: '192' },
      output: { type: 'string', short: 'o' },
      breedtype: { type: 'string', short: 'b', default: '0' },
    },
    allowPositionals: true,
  });

  if (positionals.length < 3) {
    console.error('Usage: clawbada-asset-gen variant <part> <class> <variant> [--size 192] [--output file.png]');
    process.exit(1);
  }

  const part = bodyPartIndex(positionals[0]);
  const cls = classIndex(positionals[1]);
  const variant = parseInt(positionals[2], 10);
  const size = parseInt(values.size!, 10);
  const breedType = parseInt(values.breedtype!, 10);
  const output = values.output ?? `${BODY_PART_NAMES[part]}_${CLASS_NAMES[cls]}_v${variant}.png`;

  console.log(`Rendering ${BODY_PART_NAMES[part]} / ${CLASS_NAMES[cls]} / variant ${variant}`);
  const grid = await renderPart(part, cls, variant, breedType);
  if (!grid) {
    console.error(`Template not found: ${BODY_PART_NAMES[part]}/${CLASS_NAMES[cls]}`);
    process.exit(1);
  }
  const output_grid = size !== NATIVE_SIZE ? upscale(grid, size) : grid;
  await saveGridAsPng(output_grid, output);
  console.log(`Saved: ${output}`);
}

async function cmdSheet(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      size: { type: 'string', short: 's', default: '96' },
      output: { type: 'string', short: 'o' },
    },
    allowPositionals: true,
  });

  if (positionals.length < 2) {
    console.error('Usage: clawbada-asset-gen sheet <part> <class> [--size 96] [--output file.png]');
    process.exit(1);
  }

  const part = bodyPartIndex(positionals[0]);
  const cls = classIndex(positionals[1]);
  const cellSize = parseInt(values.size!, 10);
  const output = values.output ?? `sheet_${BODY_PART_NAMES[part]}_${CLASS_NAMES[cls]}.png`;

  // 4×4 grid of all 16 variants
  const cols = 4;
  const rows = 4;
  const sheetWidth = cols * cellSize;
  const sheetHeight = rows * cellSize;
  const sheet = createGrid(sheetWidth, sheetHeight);

  console.log(`Generating 16-variant sheet for ${BODY_PART_NAMES[part]} / ${CLASS_NAMES[cls]}`);

  for (let v = 0; v < VARIANTS_PER_TEMPLATE; v++) {
    const partGrid = await renderPart(part, cls, v);
    if (!partGrid) {
      console.error(`Template not found: ${BODY_PART_NAMES[part]}/${CLASS_NAMES[cls]}`);
      process.exit(1);
    }
    const cell = cellSize !== NATIVE_SIZE ? upscale(partGrid, cellSize) : partGrid;
    const col = v % cols;
    const row = Math.floor(v / cols);
    blitOver(sheet, cell, col * cellSize, row * cellSize);
  }

  await saveGridAsPng(sheet, output);
  console.log(`Saved: ${output} (${sheetWidth}×${sheetHeight})`);
}

async function cmdPreviewAll(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: 'string', short: 'o', default: 'preview_all.png' },
      cellsize: { type: 'string', default: '48' },
    },
    allowPositionals: true,
  });

  const cellSize = parseInt(values.cellsize!, 10);

  // Grid: rows = 6 body parts × 16 variants, cols = 10 classes
  // Actually: 60 templates (rows: body parts, cols: classes), each cell = 4×4 of 16 variants
  // Simpler: one mega-grid. Rows = 6 parts. Per part: 10 classes × 16 variants = 160 cols.
  // Even simpler: rows = body parts (6), cols = classes (10). Each cell contains 16 sub-variants in a 4×4 mini-grid.

  const miniSize = cellSize;
  const miniCols = 4;
  const miniRows = 4;
  const cellW = miniSize * miniCols;
  const cellH = miniSize * miniRows;
  const gridCols = NUM_CLASSES;
  const gridRows = NUM_BODY_PARTS;
  const totalW = gridCols * cellW;
  const totalH = gridRows * cellH;

  console.log(`Generating preview grid: ${totalW}×${totalH} (${gridCols}×${gridRows} cells, each ${cellW}×${cellH})`);
  const megaGrid = createGrid(totalW, totalH);

  for (let bp = 0; bp < NUM_BODY_PARTS; bp++) {
    for (let cls = 0; cls < NUM_CLASSES; cls++) {
      const template = await loadTemplate(bp, cls);
      if (!template) {
        console.log(`  Skipping ${BODY_PART_NAMES[bp]}/${CLASS_NAMES[cls]} (no template)`);
        continue;
      }

      for (let v = 0; v < VARIANTS_PER_TEMPLATE; v++) {
        const roleGrid = generateVariant(template, v);
        let partGrid = resolveColorsRaw(roleGrid, cls);
        if (miniSize !== NATIVE_SIZE) {
          partGrid = upscale(partGrid, miniSize);
        }

        const miniCol = v % miniCols;
        const miniRow = Math.floor(v / miniCols);
        const offsetX = cls * cellW + miniCol * miniSize;
        const offsetY = bp * cellH + miniRow * miniSize;
        blitOver(megaGrid, partGrid, offsetX, offsetY);
      }

      console.log(`  ${BODY_PART_NAMES[bp]}/${CLASS_NAMES[cls]} ✓`);
    }
  }

  await saveGridAsPng(megaGrid, values.output!);
  console.log(`Saved: ${values.output} (${totalW}×${totalH})`);
}

async function cmdValidateTemplates(args: string[]): Promise<void> {
  let valid = 0;
  let invalid = 0;
  let missing = 0;

  for (let bp = 0; bp < NUM_BODY_PARTS; bp++) {
    for (let cls = 0; cls < NUM_CLASSES; cls++) {
      const partName = BODY_PART_NAMES[bp];
      const className = CLASS_NAMES[cls];

      try {
        const template = await loadTemplate(bp, cls);
        if (!template) {
          console.log(`  - ${partName}/${className} (not found)`);
          missing++;
        } else {
          console.log(`  ✓ ${partName}/${className} (${template.pixels.length} pixels, ${template.mutationZones.length} zones)`);
          valid++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ✗ ${partName}/${className}: ${msg}`);
        invalid++;
      }
    }
  }

  console.log(`\nResults: ${valid} valid, ${missing} missing, ${invalid} invalid`);
  console.log(`Total expected: 60 (${NUM_BODY_PARTS} parts × ${NUM_CLASSES} classes)`);

  if (invalid > 0) {
    process.exit(1);
  }
}

// ──────────── Main ────────────

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  render: cmdRender,
  batch: cmdBatch,
  variant: cmdVariant,
  sheet: cmdSheet,
  'preview-all': cmdPreviewAll,
  'validate-templates': cmdValidateTemplates,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
clawbada-asset-gen — Procedural Pixel Art Generator

Commands:
  render <dna>                      Render single lobster
    --size, -s <n>                  Output size (default: 192)
    --tier, -t <n>                  Evolution tier 0-3 (default: 0)
    --output, -o <path>             Output file (default: lobster.png)
    --parts, -p <list>              Comma-separated parts filter

  batch <startDna> <count>          Batch render sequential DNAs
    --outdir, -d <dir>              Output directory (default: ./output)
    --size, -s <n>                  Output size (default: 192)
    --tier, -t <n>                  Evolution tier (default: 0)
    --concurrency, -c <n>           Parallel renders (default: 4)

  variant <part> <class> <variant>  Render one body part variant
    --size, -s <n>                  Output size (default: 192)
    --output, -o <path>             Output file
    --breedtype, -b <n>             Breed type color shift (default: 0)

  sheet <part> <class>              16-variant sprite sheet
    --size, -s <n>                  Cell size (default: 96)
    --output, -o <path>             Output file

  preview-all                       Grid of all templates × variants
    --output, -o <path>             Output file (default: preview_all.png)
    --cellsize <n>                  Per-variant cell size (default: 48)

  validate-templates                Check all JSON templates for errors

Body parts: carapace, claws, tail, antennae, eyes, legs (or 0-5)
Classes: bulwark, mantis, leviathan, tempest, specter, sentinel, reaver, abyss, kraken, ember (or 0-9)
`);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}. Run with --help for usage.`);
    process.exit(1);
  }

  await handler(args.slice(1));
}

main().catch((e) => {
  console.error('Error:', e.message ?? e);
  process.exit(1);
});
