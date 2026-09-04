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
import { MiningTimer } from './mining/timer';
import { SeasonManager } from './seasons/manager';
import { DrandClient } from './vrf/drand';
import { OperatorWorker } from './operator/worker';
import { createBattleHandler } from './operator/jobs/create-battle';
import { resolveRoundHandler } from './operator/jobs/resolve-round';
import { setTeamBoostsHandler } from './operator/jobs/set-team-boosts';
import { activateBoostEpochHandler } from './operator/jobs/activate-boost-epoch';
import { wrapHandler } from './operator/errors';
import { BoostEpochService } from './boost/service';
import { EpochClock } from './boost/epoch-clock';
import { db } from '@clawbada/db';
import { getMiningPool, getPublicClient } from '@clawbada/chain';

async function main() {
  log.info('Clawbada Engine starting');

  // ──── Initialize services ────
  const drand = new DrandClient();
  const resolver = new CombatResolver();
  // stateMachine intentionally kept around — PR-C registers a resolve_round
  // handler that delegates to it. Today it's idle (no caller invokes
  // trackBattle since the legacy engine matchmaker was deleted).
  const stateMachine = new BattleStateMachine(resolver, drand);
  void stateMachine;
  const mining = new MiningTimer();
  const seasons = new SeasonManager();

  // ──── Wire callbacks ────

  // Season rollover → log new season
  seasons.setRolloverHandler((season, emission, baseReward) => {
    log.info({ season, emission: emission.toString(), baseReward: baseReward.toString() }, 'New season started');
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

  // 2. Matchmaking lives in the API (V3 S1 Power Matchmaking, canonical at
  //    apps/api/src/lib/matchmaker/tick.ts). The legacy engine matchmaker
  //    module was deleted in PR-A; the operator worker below picks up the
  //    on-chain createBattle responsibility in PR-B.

  // 3. Start operator worker (PR-A foundation for X1+X2). No handlers
  //    registered yet — PR-B/C will register create_battle / resolve_round /
  //    settle_battle. Starting the empty scaffold now means handler wiring
  //    is the only change in PR-B/C — the lifecycle, claim semantics, and
  //    recovery path are already exercised in prod.
  //
  //    Codex PR-A MEDIUM-A3: fail fast if start() throws. Once handlers
  //    are registered (PR-B/C), an engine running without the worker is
  //    silently broken — all operator-signed work backs up indefinitely.
  //    Let the supervisor (docker/k8s) restart the process so the failure
  //    is observable.
  const operatorWorker = new OperatorWorker();
  // PR-B: handler for `create_battle` jobs queued by the API matchmaker.
  // wrapHandler routes thrown errors through classifyError so a permanent
  // contract revert (e.g. InvalidPowerScore) goes dead-no-retry instead
  // of burning all 5 transient retry slots.
  operatorWorker.registerHandler('create_battle', wrapHandler(createBattleHandler));
  // PR-C: handler for `resolve_round` jobs queued by the indexer when it
  // sees both MoveRevealed events for a round on chain. The handler reads
  // chain state, replays prior rounds from on_chain_events, resolves the
  // current round, persists battle_rounds, and submits advanceRound (or
  // settle if the resolver reports finished). Closes X2.
  operatorWorker.registerHandler('resolve_round', wrapHandler(resolveRoundHandler));
  // Battle-rank mining boost: the weekly epoch job below enqueues these; the
  // handlers sign with the BOOST_ADMIN key (falls back to OPERATOR on testnet).
  operatorWorker.registerHandler('set_team_boosts', wrapHandler(setTeamBoostsHandler));
  operatorWorker.registerHandler('activate_boost_epoch', wrapHandler(activateBoostEpochHandler));
  await operatorWorker.start();

  // 4. Start season monitor
  seasons.startMonitor();

  // 4b. Weekly boost epoch job (60s tick). Only reads the chain here; writes go
  //     through the operator outbox above. The epoch anchor may not be indexed
  //     yet on a fresh deploy — the service retries it each tick instead of
  //     failing the engine.
  const isTestnet = process.env.CHAIN_ENV !== 'mainnet';
  const boostPool = getMiningPool(getPublicClient(isTestnet));
  const boostEpochs = new BoostEpochService({
    db,
    chain: { currentBoostEpoch: async () => Number(await boostPool.read.currentBoostEpoch()) },
    clockFactory: () => EpochClock.fromDb(db),
  });
  boostEpochs.start();

  // 5. Verify drand connectivity
  try {
    const beacon = await drand.fetchLatest();
    log.info({ round: beacon.round }, 'drand connected');
  } catch (err) {
    log.warn({ err }, 'drand not reachable, battles will fail until connectivity is restored');
  }

  // 6. Log current season
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
  const shutdown = async () => {
    log.info('Shutting down');
    seasons.stop();
    boostEpochs.stop();
    mining.stopAll();
    await operatorWorker.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'Engine fatal error');
  process.exit(1);
});
