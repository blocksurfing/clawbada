// ── Env validation (fail fast) ──
{
  const required = ['DATABASE_URL', 'OPERATOR_PRIVATE_KEY'];
  const isMainnet = process.env.CHAIN_ENV === 'mainnet';
  required.push(isMainnet ? 'BASE_RPC_URL' : 'BASE_SEPOLIA_RPC_URL');

  const missing = required.filter((k) => !process.env[k] || process.env[k] === '0x');
  if (missing.length > 0) {
    console.error(`[engine] Missing required environment variables:\n  ${missing.join('\n  ')}`);
    console.error('Copy .env.example to .env and fill in values.');
    process.exit(1);
  }
}

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
import { log } from './logger';
import { CombatResolver } from './combat/resolver';
import { BattleStateMachine } from './combat/state-machine';
import { MatchmakingQueue } from './matchmaking/queue';
import { MiningTimer } from './mining/timer';
import { SeasonManager } from './seasons/manager';
import { DrandClient } from './vrf/drand';

async function main() {
  log.info('Clawbada Engine starting');

  // ──── Initialize services ────
  const drand = new DrandClient();
  const resolver = new CombatResolver();
  const stateMachine = new BattleStateMachine(resolver, drand);
  const matchmaking = new MatchmakingQueue();
  const mining = new MiningTimer();
  const seasons = new SeasonManager();

  // ──── Wire callbacks ────

  // Season rollover → log new season
  seasons.setRolloverHandler((season, emission, baseReward) => {
    log.info({ season, emission: emission.toString(), baseReward: baseReward.toString() }, 'New season started');
  });

  // When matchmaking finds a match → tell the state machine to track it
  matchmaking.setMatchHandler((battleId, playerA, playerB, stakeAmount) => {
    stateMachine.trackBattle(battleId, playerA, playerB, stakeAmount);
    log.info({ battleId: battleId.toString(), playerA, playerB }, 'Battle tracked');
  });

  // When an expedition completes → log it (WebSocket notification in API layer)
  mining.setCompletionHandler((expeditionId, owner) => {
    log.info({ expeditionId: expeditionId.toString(), owner }, 'Expedition ready to claim');
  });

  // ──── Start services ────

  // 1. Load active mining expeditions from DB
  try {
    await mining.loadActive();
  } catch (err) {
    log.warn({ err }, 'Mining timer: DB not available, skipping load');
  }

  // 2. Start matchmaking loop
  matchmaking.start();

  // 3. Start season monitor
  seasons.startMonitor();

  // 4. Verify drand connectivity
  try {
    const beacon = await drand.fetchLatest();
    log.info({ round: beacon.round }, 'drand connected');
  } catch (err) {
    log.warn({ err }, 'drand not reachable, battles will fail until connectivity is restored');
  }

  // 5. Log current season
  try {
    const season = await seasons.getCurrentSeason();
    if (season) {
      const budget = await seasons.checkBudget();
      log.info(
        { season: season.season, percentUsed: budget?.percentUsed.toFixed(1), estimatedDaysRemaining: budget?.estimatedDaysRemaining },
        'Current season status',
      );
    } else {
      log.info('No active season found in DB');
    }
  } catch (err) {
    log.warn({ err }, 'Season check: DB not available');
  }

  log.info({ activeExpeditions: mining.activeCount }, 'Clawbada Engine ready');

  // ──── Graceful shutdown ────
  const shutdown = () => {
    log.info('Shutting down');
    matchmaking.stop();
    seasons.stop();
    mining.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Engine fatal error');
  process.exit(1);
});
