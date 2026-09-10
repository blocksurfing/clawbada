/**
 * Keys and per-service environments. Anvil key 0 is the deployer and every operator role
 * (matchmaker / resolver / VRF / boost admin all fall back to OPERATOR_PRIVATE_KEY off
 * mainnet); addr 1 is the DEV_WALLET; keys 2 and 3 are the two scripted players.
 */
import { ANVIL_ACCOUNTS } from './anvil';
import type { Deployment } from './forge';

export const KEYS = {
  deployer: ANVIL_ACCOUNTS[0],
  devWallet: ANVIL_ACCOUNTS[1],
  playerA: ANVIL_ACCOUNTS[2],
  playerB: ANVIL_ACCOUNTS[3],
} as const;

export interface StackConfig {
  rpcUrl: string;
  databaseUrl: string;
  drandUrl: string;
  apiPort: number;
  deployment: Deployment;
  boostAnchorTs: bigint;
}

export function addressEnv(d: Deployment): Record<string, string> {
  const c = d.contracts;
  return {
    CLAW_TOKEN_ADDRESS: c.ClawToken, LOBSTER_NFT_ADDRESS: c.LobsterNFT, TEAM_MANAGER_ADDRESS: c.TeamManager,
    BREEDING_LAB_ADDRESS: c.BreedingLab, MINING_POOL_ADDRESS: c.MiningPool, MARKETPLACE_ADDRESS: c.Marketplace,
    TREASURY_ADDRESS: c.Treasury, FAUCET_ADDRESS: c.Faucet, BATTLE_ARENA_ADDRESS: c.BattleArena,
    BATTLE_VRF_ADDRESS: c.BattleVRF, EVOLUTION_LAB_ADDRESS: c.EvolutionLab, REPAIR_SHOP_ADDRESS: c.RepairShop,
  };
}

function common(cfg: StackConfig): Record<string, string> {
  return {
    ...addressEnv(cfg.deployment),
    DATABASE_URL: cfg.databaseUrl,
    CHAIN_ENV: 'testnet',
    BASE_SEPOLIA_RPC_URL: cfg.rpcUrl,
    DRAND_CHAIN_URL: cfg.drandUrl,
    BOOST_EPOCH_ANCHOR_TS: cfg.boostAnchorTs.toString(),
    NODE_ENV: 'test', // JSON logs (pino-pretty is dev-only) — parseable by the harness
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'info',
  };
}

export function apiEnv(cfg: StackConfig): Record<string, string> {
  return {
    ...common(cfg),
    API_PORT: String(cfg.apiPort),
    MATCHMAKER_ADDRESS: KEYS.deployer.address,
    TRUST_PROXY: 'true',                 // harness-only: per-wallet X-Forwarded-For beats the per-IP rate limits
    BATTLE_SESSIONS_ENABLED: 'true',
    BATTLE_SESSION_POLL_MS: '1000',
    BATTLE_SHOT_CLOCK_MS: '60000',
    BOT_THINK_MS: '0',
    PRACTICE_ENABLED: 'true',
  };
}

export function engineEnv(cfg: StackConfig): Record<string, string> {
  return {
    ...common(cfg),
    OPERATOR_PRIVATE_KEY: KEYS.deployer.key,
    FINALIZE_POLL_MS: '2000',
  };
}

export function indexerEnv(cfg: StackConfig): Record<string, string> {
  return { ...common(cfg), INDEXER_START_BLOCK: '0' };
}
