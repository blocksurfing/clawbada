/** Re-export from `@clawbada/game-logic` so engine's legacy state-machine
 *  and indexer's BattleSettled accounting share one canonical implementation
 *  (Codex PR-C FU F-01: moving accounting to indexer required cross-app
 *  access to calculateNewElo, so we lifted it to the shared package). */
export { calculateNewElo, getDefaultElo } from '@clawbada/game-logic';
