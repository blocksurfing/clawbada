/** The process-wide per-IP share of live off-chain battles (lib/live-battle-budget.ts), over the real session manager. */
import { battleSessions } from './battle-session';
import { LiveBattleBudget } from './live-battle-budget';

export { TOO_MANY_BATTLES_MESSAGE } from './live-battle-budget';

export const liveBattles = new LiveBattleBudget((battleId) => battleSessions.get(battleId) !== undefined);
