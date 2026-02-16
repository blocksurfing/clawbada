/**
 * Extract ABIs from Foundry build artifacts and generate typed TypeScript files.
 *
 * Reads from: out/<Contract>.sol/<Contract>.json
 * Writes to:  src/abis/<contractName>.ts
 *
 * Usage: bun run scripts/extract-abis.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const OUT_DIR = join(ROOT, 'out');
const ABIS_DIR = join(import.meta.dir, '..', 'src', 'abis');

const CONTRACTS = [
  'ClawToken',
  'LobsterNFT',
  'TeamManager',
  'BreedingLab',
  'MiningPool',
  'Marketplace',
  'Treasury',
  'Faucet',
  'BattleArena',
  'BattleResolver',
  'BattleVRF',
  'EvolutionLab',
  'RepairShop',
  'DNALib',
] as const;

function toKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function main() {
  if (!existsSync(ABIS_DIR)) {
    mkdirSync(ABIS_DIR, { recursive: true });
  }

  const exports: string[] = [];

  for (const contract of CONTRACTS) {
    const artifactPath = join(OUT_DIR, `${contract}.sol`, `${contract}.json`);

    if (!existsSync(artifactPath)) {
      console.warn(`  SKIP: ${artifactPath} not found`);
      continue;
    }

    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    const abi = JSON.stringify(artifact.abi, null, 2);

    const kebab = toKebab(contract);
    const constName = `${contract}Abi`;
    const content = `export const ${constName} = ${abi} as const;\n`;

    const outPath = join(ABIS_DIR, `${kebab}.ts`);
    writeFileSync(outPath, content);
    console.log(`  OK: ${outPath}`);

    exports.push(`export { ${constName} } from './${kebab}';`);
  }

  // Write barrel index
  const indexPath = join(ABIS_DIR, 'index.ts');
  writeFileSync(indexPath, exports.join('\n') + '\n');
  console.log(`  OK: ${indexPath}`);

  console.log(`\nDone: ${exports.length} ABIs extracted.`);
}

main();
