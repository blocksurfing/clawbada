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

  // TODO: Start all watchers
  // 1. Connect to database
  // 2. Load last processed block per contract from indexer_state
  // 3. Backfill any missed blocks
  // 4. Start live event watching via viem watchContractEvent

  for (const watcher of watchers) {
    await watcher.start();
  }

  console.log(`Clawbada Indexer ready — ${watchers.length} watchers active`);

  process.on('SIGINT', async () => {
    console.log('Shutting down watchers...');
    for (const watcher of watchers) {
      await watcher.stop();
    }
    process.exit(0);
  });
}

main().catch(console.error);
