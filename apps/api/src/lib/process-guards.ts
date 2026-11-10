/**
 * The last line of defence for the one process every live battle shares.
 *
 * Bun, like Node, ends the process on a promise rejection nobody handles and on an exception thrown out of a
 * timer or socket callback. For this server that means every socket closed and every battle in memory
 * interrupted — for a bug in one request or one battle's clock. A request handler's own errors never get here
 * (catchErrors, app.onError); what does is a promise that was created and then abandoned, or a throw inside a
 * callback nothing wraps. Both are always a bug to fix, so they are logged at error level, and the process keeps
 * serving everyone else.
 *
 * Dependency-free (the logger is passed in) so the test can run it in a child process on its own.
 */
export interface GuardLog {
  error(obj: Record<string, unknown>, msg: string): void;
}

let installed = false;

/** Log through `log`; if the logger itself fails, fall back to stderr — a guard must never throw. */
function report(log: GuardLog, msg: string, err: unknown): void {
  try {
    log.error({ err }, msg);
  } catch {
    try {
      console.error(msg, err);
    } catch {
      // nothing left to try
    }
  }
}

export function installProcessGuards(log: GuardLog): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => report(log, 'unhandled_rejection', reason));
  process.on('uncaughtException', (err) => report(log, 'uncaught_exception', err));
}
