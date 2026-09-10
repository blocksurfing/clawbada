export class TimeoutError extends Error {
  constructor(label: string, ms: number) { super(`timed out after ${ms} ms waiting for: ${label}`); this.name = 'TimeoutError'; }
}

/** Poll `pred` until it returns a truthy value; resolves to that value. */
export async function waitFor<T>(pred: () => Promise<T | null | undefined | false>, opts: { timeoutMs: number; everyMs?: number; label: string }): Promise<T> {
  const every = opts.everyMs ?? 500;
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v as T;
    if (Date.now() - t0 > opts.timeoutMs) throw new TimeoutError(opts.label, opts.timeoutMs);
    await Bun.sleep(every);
  }
}

export const sleep = (ms: number) => Bun.sleep(ms);
