/**
 * Process-wide BattleSessionManager wired to the real store, chain readers,
 * drand, and the WebSocket room manager. Import `battleSessions` from here;
 * construct `BattleSessionManager` directly in tests.
 */
import { DrandBeaconClient, loadSeedMasterSecret } from '@clawbada/chain';
import type { v3 } from '@clawbada/game-logic';
import { log as baseLog } from '../../logger';
import { readBattle, readLobster, readTeam } from '../chain';
import { battleWS } from '../ws';
import { getLayoutById } from '../../data/arenas';
import { BattleSessionManager, DEFAULT_BOT_THINK_MS, DEFAULT_FIRST_TURN_GRACE_MS, DEFAULT_POLL_MS, DEFAULT_SHOT_CLOCK_MS } from './manager';
import { SessionStore } from './store';

export * from './protocol';
export * from './clock';
export * from './session';
export * from './store';
export * from './manager';

const log = baseLog.child({ module: 'battle-session' });

/** D-01: BATTLE_SEED_SECRET, shared with the engine. Resolved when a staked battle starts, not
 *  at boot: production only REQUIRES it once on-chain battles exist, and must not crash a
 *  practice-only deployment. A missing value is reported loudly at boot instead. */
let warnedSeed = false;
function seedMasterSecret(): string {
  const { secret, ephemeral } = loadSeedMasterSecret();
  if (ephemeral && !warnedSeed) {
    warnedSeed = true;
    log.warn({}, 'BATTLE_SEED_SECRET is not set: using a per-process random secret. The engine must share it or real battles will not start.');
  }
  return secret;
}
if (!process.env.BATTLE_SEED_SECRET && process.env.NODE_ENV === 'production') {
  log.error({}, 'BATTLE_SEED_SECRET is not set: staked battles cannot start until it is (practice battles are unaffected)');
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const battleSessions = new BattleSessionManager({
  store: new SessionStore(),
  emit: (sessionId, event, data) => battleWS.broadcast(sessionId, event, data),
  chain: {
    readTeam: (teamId) => readTeam(teamId),
    readLobster: (tokenId) => readLobster(tokenId),
    readBattlePhase: async (battleId) => (await readBattle(battleId)).phase,
    readBattleSeed: async (battleId) => { const b = await readBattle(battleId); return { seedCommit: b.seedCommit, revealedAt: b.revealedAt }; },
    // D-06: feeds the settlement_alert pushed to players of a battle that is still live here.
    readProposal: async (battleId) => { const b = await readBattle(battleId); return { proposedWinner: b.proposedWinner, payoutDeadline: b.payoutDeadline, disputed: b.disputed }; },
  },
  drand: new DrandBeaconClient(),
  seedMasterSecret,
  log,
  shotClockMs: envInt('BATTLE_SHOT_CLOCK_MS', DEFAULT_SHOT_CLOCK_MS),
  botThinkMs: envInt('BOT_THINK_MS', DEFAULT_BOT_THINK_MS),
  firstTurnGraceMs: envInt('BATTLE_FIRST_TURN_GRACE_MS', DEFAULT_FIRST_TURN_GRACE_MS),
  pollMs: envInt('BATTLE_SESSION_POLL_MS', DEFAULT_POLL_MS),
  layoutById: (id) => getLayoutById(id) as v3.ArenaLayout | undefined,
});
