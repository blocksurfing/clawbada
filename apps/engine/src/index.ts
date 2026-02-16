import { CombatResolver } from './combat/resolver';
import { BattleStateMachine } from './combat/state-machine';
import { MatchmakingQueue } from './matchmaking/queue';
import { MiningTimer } from './mining/timer';
import { SeasonManager } from './seasons/manager';
import { DrandClient } from './vrf/drand';

async function main() {
  console.log('Clawbada Engine starting...');

  const drand = new DrandClient();
  const resolver = new CombatResolver();
  const stateMachine = new BattleStateMachine(resolver);
  const matchmaking = new MatchmakingQueue();
  const mining = new MiningTimer();
  const seasons = new SeasonManager();

  // TODO: Start all services
  // - Connect to database
  // - Start drand beacon polling
  // - Start matchmaking loop
  // - Start mining timer checker
  // - Start season monitor

  console.log('Clawbada Engine ready');

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
  });
}

main().catch(console.error);
