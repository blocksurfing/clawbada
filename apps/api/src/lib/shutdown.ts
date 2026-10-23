/**
 * Graceful shutdown for Cloud Run (and ctrl-C locally).
 *
 * Cloud Run stops routing to an instance, sends SIGTERM, and SIGKILLs it 10 s later. Bun is PID 1 in the
 * container (the Dockerfile CMD `exec`s it) and PID 1 ignores SIGTERM unless a handler is installed, so
 * without this file every rollout is a hard kill: shot clocks and queued turn writes die mid-flight and
 * every socket sees an abrupt close. With it:
 *   1. stop taking new work — the listener (best effort, see rememberServer) and the matchmaker ticker;
 *   2. tell every WebSocket to go away (1001) BEFORE the sessions stop, so no turn can be accepted that
 *      would never be persisted (BattleSession.submit refuses after stop() as a second line);
 *   3. stop every session's clocks, then await each session's persist queue — the per-turn writeTurns()
 *      transactions and, for a battle that finished in the last instant, its finish / settle write;
 *   4. drain the DB pool, give the close frames a moment to flush, exit 0.
 * A hard-exit timer (8 s < Cloud Run's 10 s) guarantees the process never outlives the grace period; a
 * second signal is logged and ignored. The clients reconnect to the new revision on their own
 * (apps/web/src/hooks/use-battle-session.ts, use-battle-ws.ts) and re-sync from the server's snapshot.
 */
import { closeDb } from '@clawbada/db';
import { log } from '../logger';
import { battleWS } from './ws';
import { stopMatchmakerTicker } from './matchmaker/tick';
import { battleSessions } from './battle-session';

const HARD_EXIT_MS = 8_000;
const CLOSE_DRAIN_MS = 250;

/** Bun's `server.stop(closeActiveConnections?)`, typed loosely so this file imports nothing from Bun. */
interface BunServerLike {
  stop(closeActiveConnections?: boolean): void;
}

let serverRef: BunServerLike | null = null;
let shuttingDown = false;

/**
 * Bun's auto-serve (the `export default { fetch, websocket }` in index.ts) never hands the module its
 * Server; the only place it appears is the second argument of fetch(). The fetch handler calls this on
 * every request (a no-op after the first). If no request ever arrived nothing is lost: by the time SIGTERM
 * comes Cloud Run has already stopped routing to this instance, and process.exit() releases the port.
 */
export function rememberServer(server: BunServerLike | undefined): void {
  if (server && !serverRef && typeof server.stop === 'function') serverRef = server;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    log.warn({ signal }, 'shutdown_signal_repeated');
    return;
  }
  shuttingDown = true;
  const t0 = Date.now();
  const hardExit = setTimeout(() => {
    log.error({ signal, elapsedMs: Date.now() - t0 }, 'shutdown_hard_exit');
    process.exit(1);
  }, HARD_EXIT_MS);
  hardExit.unref();

  log.info({ signal, liveSessions: battleSessions.liveCount(), sockets: battleWS.socketCount() }, 'shutdown_started');
  try {
    try {
      serverRef?.stop();   // stop accepting; open sockets stay until closeAll below
    } catch (err) {
      log.warn({ err }, 'shutdown_server_stop_failed');
    }
    stopMatchmakerTicker();
    const closed = battleWS.closeAll(1001, 'Server restarting');
    battleSessions.stop();
    await battleSessions.flushed();
    await closeDb(2);
    log.info({ closed, elapsedMs: Date.now() - t0 }, 'shutdown_drained');
  } catch (err) {
    log.error({ err, elapsedMs: Date.now() - t0 }, 'shutdown_failed');
  }
  await new Promise((r) => setTimeout(r, CLOSE_DRAIN_MS));
  clearTimeout(hardExit);
  (log as { flush?: () => void }).flush?.();
  process.exit(0);
}

export function installShutdownHandlers(): void {
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      void shutdown(sig);
    });
  }
}
