#!/usr/bin/env bun
/**
 * sync-deploy — reads a Foundry deployment JSON and writes contract addresses to .env.
 *
 * Usage:
 *   bun run sync-deploy base-sepolia
 *   bun run sync-deploy base
 *   bun run sync-deploy localhost
 *
 * Reads:  deployments/<network>.json  (written by Deploy.s.sol)
 * Writes: .env at monorepo root (creates if missing, updates existing vars)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');

// ── Map from Foundry JSON keys (PascalCase) to .env var names ──

const CONTRACT_ENV_MAP: Record<string, string> = {
  ClawToken: 'CLAW_TOKEN_ADDRESS',
  LobsterNFT: 'LOBSTER_NFT_ADDRESS',
  TeamManager: 'TEAM_MANAGER_ADDRESS',
  BreedingLab: 'BREEDING_LAB_ADDRESS',
  MiningPool: 'MINING_POOL_ADDRESS',
  Marketplace: 'MARKETPLACE_ADDRESS',
  Treasury: 'TREASURY_ADDRESS',
  Faucet: 'FAUCET_ADDRESS',
  BattleArena: 'BATTLE_ARENA_ADDRESS',
  BattleVRF: 'BATTLE_VRF_ADDRESS',
  EvolutionLab: 'EVOLUTION_LAB_ADDRESS',
  RepairShop: 'REPAIR_SHOP_ADDRESS',
};

// ── Parse args ──

const network = process.argv[2];
if (!network) {
  console.error('Usage: bun run sync-deploy <network>');
  console.error('  Networks: base-sepolia, base, localhost');
  process.exit(1);
}

// ── Read deployment JSON ──

const deploymentPath = resolve(ROOT, 'deployments', `${network}.json`);
if (!existsSync(deploymentPath)) {
  console.error(`Deployment file not found: ${deploymentPath}`);
  console.error(`Run the deploy script first: forge script contracts/script/Deploy.s.sol --rpc-url ${network} --broadcast`);
  process.exit(1);
}

const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
const contracts: Record<string, string> = deployment.contracts;

if (!contracts) {
  console.error('Invalid deployment file: missing "contracts" key');
  process.exit(1);
}

// ── Read or create .env ──

const envPath = resolve(ROOT, '.env');
let envContent = '';
if (existsSync(envPath)) {
  envContent = readFileSync(envPath, 'utf-8');
}

// ── Update .env with contract addresses ──

let updated = 0;

for (const [contractName, envVar] of Object.entries(CONTRACT_ENV_MAP)) {
  const address = contracts[contractName];
  if (!address) {
    console.warn(`  Warning: ${contractName} not found in deployment file`);
    continue;
  }

  // Replace existing line or append
  const regex = new RegExp(`^${envVar}=.*$`, 'm');
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${envVar}=${address}`);
  } else {
    envContent += `\n${envVar}=${address}`;
  }
  updated++;
}

// Also set CHAIN_ENV based on network
const chainEnv = network === 'base' ? 'mainnet' : 'testnet';
const chainEnvRegex = /^CHAIN_ENV=.*$/m;
if (chainEnvRegex.test(envContent)) {
  envContent = envContent.replace(chainEnvRegex, `CHAIN_ENV=${chainEnv}`);
} else {
  envContent += `\nCHAIN_ENV=${chainEnv}`;
}

writeFileSync(envPath, envContent);

console.log(`Synced ${updated} contract addresses from deployments/${network}.json → .env`);
console.log(`CHAIN_ENV set to: ${chainEnv}`);

// ── Print summary ──

console.log('');
for (const [contractName, envVar] of Object.entries(CONTRACT_ENV_MAP)) {
  const address = contracts[contractName];
  if (address) {
    console.log(`  ${envVar}=${address}`);
  }
}
