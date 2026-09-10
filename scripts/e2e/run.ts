#!/usr/bin/env bun
/**
 * Clawbada local end-to-end: Anvil + contracts + Postgres + API + engine + indexer, two
 * scripted players, one staked battle to payout, onboarding and a mining expedition.
 *
 *   bun run e2e                          # from the repo root
 *   bun run e2e -- --keep --verbose      # leave everything running for inspection
 *   bun run e2e -- --stake 10000         # Mid bracket (30 min dispute window, warped)
 *   bun run e2e -- --live-drand          # real api.drand.sh instead of the stub
 *
 * Exit codes: 0 pass · 1 assertions failed · 2 infra/setup failure · 3 phase timeout.
 */
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Checks } from './lib/checks';
import { TimeoutError } from './lib/wait';
import { infraPhase, type Stack } from './phases/00-infra';
import { onboardingPhase } from './phases/10-onboarding';
import { battlePhase } from './phases/20-battle';
import { miningPhase } from './phases/30-mining';
import { assertPhase } from './phases/40-assert';

export interface Flags { keep: boolean; liveDrand: boolean; verbose: boolean; stake: '2500' | '10000' | '50000'; anvilPort: number; apiPort: number }

function parseFlags(argv: string[]): Flags {
  const f: Flags = { keep: false, liveDrand: false, verbose: false, stake: '2500', anvilPort: 8545, apiPort: 3001 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') f.keep = true;
    else if (a === '--live-drand') f.liveDrand = true;
    else if (a === '--verbose') f.verbose = true;
    else if (a === '--stake') f.stake = argv[++i] as Flags['stake'];
    else if (a === '--anvil-port') f.anvilPort = Number(argv[++i]);
    else if (a === '--api-port') f.apiPort = Number(argv[++i]);
    else if (a !== '--') { console.error(`unknown flag ${a}`); process.exit(2); }
  }
  if (!['2500', '10000', '50000'].includes(f.stake)) { console.error('--stake must be 2500, 10000 or 50000'); process.exit(2); }
  return f;
}

const flags = parseFlags(process.argv.slice(2));
const repoRoot = resolve(import.meta.dir, '..', '..');
const tag = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const runDir = join(import.meta.dir, '.runs', tag);
mkdirSync(runDir, { recursive: true });
console.log(`e2e run ${tag} — logs in ${runDir}`);

const checks = new Checks('infra');
let stack: Stack | null = null;
let exitCode = 0;

const teardown = async () => {
  if (!stack) return;
  if (flags.keep) { console.log(`--keep: leaving services up. api ${stack.apiUrl} · anvil ${stack.anvil.rpcUrl} · db ${stack.db.url}`); return; }
  await stack.stop();
};
process.on('SIGINT', async () => { console.log('\ninterrupted — tearing down'); await teardown(); process.exit(130); });

try {
  stack = await infraPhase({ repoRoot, runDir, flags, checks });
  checks.setPhase('onboard');
  const players = await onboardingPhase(stack, checks);
  checks.setPhase('battle');
  const battle = await battlePhase(stack, players, flags, checks);
  checks.setPhase('mining');
  const mining = await miningPhase(stack, players, battle, checks);
  checks.setPhase('assert');
  await assertPhase(stack, players, battle, mining, checks);
} catch (err) {
  const e = err as Error;
  console.error(`\n✖ ${e.name}: ${e.message}`);
  if (e.stack && flags.verbose) console.error(e.stack);
  if (stack) console.error(`service logs: ${runDir}`);
  exitCode = err instanceof TimeoutError ? 3 : stack ? 1 : 2;
}

checks.report();
if (exitCode === 0 && checks.failed.length > 0) exitCode = 1;
await teardown();
console.log(exitCode === 0 ? '\nE2E PASSED' : `\nE2E FAILED (exit ${exitCode})`);
process.exit(exitCode);
