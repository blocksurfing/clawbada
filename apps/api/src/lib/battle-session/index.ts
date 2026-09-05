/**
 * Process-wide BattleSessionManager wired to the real store, chain readers,
 * drand, and the WebSocket room manager. Import `battleSessions` from here;
 * construct `BattleSessionManager` directly in tests.
 */
import { DrandBeaconClient } from '@clawbada/chain';
import type { v3 } from '@clawbada/game-logic';
import { log as baseLog } from '../../logger';
import { readBattle, readLobster, readTeam } from '../chain';
import { battleWS } from '../ws';
import { getLayoutById } from '../../data/arenas';
import { BattleSessionManager, DEFAULT_BOT_THINK_MS, DEFAULT_POLL_MS, DEFAULT_SHOT_CLOCK_MS } from './manager';
import { SessionStore } from './store';

export * from './protocol';
export * from './clock';
export * from './session';
export * from './store';
export * from './manager';

const log = baseLog.child({ module: 'battle-session' });

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
  },
  drand: new DrandBeaconClient(),
  log,
  shotClockMs: envInt('BATTLE_SHOT_CLOCK_MS', DEFAULT_SHOT_CLOCK_MS),
  botThinkMs: envInt('BOT_THINK_MS', DEFAULT_BOT_THINK_MS),
  pollMs: envInt('BATTLE_SESSION_POLL_MS', DEFAULT_POLL_MS),
  layoutById: (id) => getLayoutById(id) as v3.ArenaLayout | undefined,
});
