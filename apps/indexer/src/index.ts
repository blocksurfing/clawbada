// ── Env validation (fail fast) ──
{
  const required = ['DATABASE_URL'];
  const isMainnet = process.env.CHAIN_ENV === 'mainnet';
  required.push(isMainnet ? 'BASE_RPC_URL' : 'BASE_SEPOLIA_RPC_URL');

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[indexer] Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('Copy .env.example to .env and fill in values.');
    process.exit(1);
  }
}

/**
 * Clawbada Indexer
 *
 * Watches on-chain contract events and syncs state to the database.
 * Each contract has a dedicated watcher that decodes events and
 * writes to the appropriate tables.
 *
 * Block tracking ensures no events are missed across restarts.
 */
import { LobsterWatcher } from './watchers/lobster-watcher';
import { TeamWatcher } from './watchers/team-watcher';
import { MiningWatcher } from './watchers/mining-watcher';
import { BattleWatcher } from './watchers/battle-watcher';
import { MarketplaceWatcher } from './watchers/marketplace-watcher';
import { BreedingWatcher } from './watchers/breeding-watcher';
import { TreasuryWatcher } from './watchers/treasury-watcher';

async function main() {
  console.log('Clawbada Indexer starting...');

  const watchers = [
    new LobsterWatcher(),
    new TeamWatcher(),
    new MiningWatcher(),
    new BattleWatcher(),
    new MarketplaceWatcher(),
    new BreedingWatcher(),
    new TreasuryWatcher(),
  ];

  // Start all watchers sequentially (each does its own backfill)
  for (const watcher of watchers) {
    try {
      await watcher.start();
    } catch (err) {
      console.error(`Failed to start ${watcher.config.contractName} watcher:`, err);
    }
  }

  console.log(`Clawbada Indexer ready — ${watchers.length} watchers active`);

  const shutdown = async () => {
    console.log('Shutting down watchers...');
    for (const watcher of watchers) {
      await watcher.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Indexer fatal error:', err);
  process.exit(1);
});
