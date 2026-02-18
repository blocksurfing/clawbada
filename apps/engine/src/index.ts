/**
 * Clawbada Game Engine
 *
 * Off-chain game services:
 * - Battle combat resolution (deterministic, VRF-seeded)
 * - Matchmaking (ELO-based, bracket-scoped)
 * - Mining timer (expedition completion notifications)
 * - Season monitoring (budget tracking, warnings)
 * - VRF beacon polling (drand integration)
 */
import { CombatResolver } from './combat/resolver';
import { BattleStateMachine } from './combat/state-machine';
import { MatchmakingQueue } from './matchmaking/queue';
import { MiningTimer } from './mining/timer';
import { SeasonManager } from './seasons/manager';
import { DrandClient } from './vrf/drand';

async function main() {
  console.log('Clawbada Engine starting...');

  // ──── Initialize services ────
  const drand = new DrandClient();
  const resolver = new CombatResolver();
  const stateMachine = new BattleStateMachine(resolver, drand);
  const matchmaking = new MatchmakingQueue();
  const mining = new MiningTimer();
  const seasons = new SeasonManager();

  // ──── Wire callbacks ────

  // When matchmaking finds a match → tell the state machine to track it
  matchmaking.setMatchHandler((battleId, playerA, playerB, stakeAmount) => {
    stateMachine.trackBattle(battleId, playerA, playerB, stakeAmount);
    console.log(`Battle #${battleId} tracked: ${playerA} vs ${playerB}`);
  });

  // When an expedition completes → log it (WebSocket notification in API layer)
  mining.setCompletionHandler((expeditionId, owner) => {
    console.log(`Expedition #${expeditionId} ready to claim for ${owner}`);
  });

  // ──── Start services ────

  // 1. Load active mining expeditions from DB
  try {
    await mining.loadActive();
  } catch (err) {
    console.warn('Mining timer: DB not available, skipping load', (err as Error).message);
  }

  // 2. Start matchmaking loop
  matchmaking.start();

  // 3. Start season monitor
  seasons.startMonitor();

  // 4. Verify drand connectivity
  try {
    const beacon = await drand.fetchLatest();
    console.log(`drand connected: round ${beacon.round}`);
  } catch (err) {
    console.warn('drand: not reachable, battles will fail until connectivity is restored');
  }

  // 5. Log current season
  try {
    const season = await seasons.getCurrentSeason();
    if (season) {
      const budget = await seasons.checkBudget();
      console.log(
        `Season ${season.season}: ${budget?.percentUsed.toFixed(1)}% budget used, ` +
          `~${budget?.estimatedDaysRemaining} days remaining`,
      );
    } else {
      console.log('No active season found in DB');
    }
  } catch (err) {
    console.warn('Season check: DB not available');
  }

  console.log('Clawbada Engine ready');
  console.log('  - Combat resolver: active');
  console.log('  - Matchmaking: active (2s poll interval)');
  console.log(`  - Mining timer: ${mining.activeCount} expeditions tracked`);
  console.log('  - Season monitor: active (5min poll interval)');

  // ──── Graceful shutdown ────
  const shutdown = () => {
    console.log('Shutting down...');
    matchmaking.stop();
    seasons.stop();
    mining.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Engine fatal error:', err);
  process.exit(1);
});
