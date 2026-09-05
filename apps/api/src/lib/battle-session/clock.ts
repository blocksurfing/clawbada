/**
 * Shot-clock timers with injectable primitives so the session logic is testable
 * with a fake clock. One timer per key (session id); re-arming replaces.
 */
export interface ClockDeps {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const realDeps: ClockDeps = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export class ShotClock {
  private readonly timers = new Map<string, { handle: unknown; deadline: number }>();

  constructor(private readonly deps: ClockDeps = realDeps) {}

  now(): number {
    return this.deps.now();
  }

  /** Arm (or re-arm) the timer for `key`; returns the epoch-ms deadline. */
  arm(key: string, ms: number, cb: () => void): number {
    this.cancel(key);
    const deadline = this.deps.now() + ms;
    const handle = this.deps.setTimeout(() => {
      this.timers.delete(key);
      cb();
    }, ms);
    this.timers.set(key, { handle, deadline });
    return deadline;
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (!t) return;
    this.deps.clearTimeout(t.handle);
    this.timers.delete(key);
  }

  deadline(key: string): number | null {
    return this.timers.get(key)?.deadline ?? null;
  }

  clearAll(): void {
    for (const key of [...this.timers.keys()]) this.cancel(key);
  }
}

/** Deterministic clock for tests: `advance(ms)` fires due timers in order. */
export class FakeClock implements ClockDeps {
  private t = 0;
  private seq = 0;
  private pending: { at: number; seq: number; cb: () => void; id: number }[] = [];

  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }
  now = (): number => this.t;
  setTimeout = (cb: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.pending.push({ at: this.t + Math.max(0, ms), seq: id, cb, id });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.pending = this.pending.filter((p) => p.id !== handle);
  };
  /** Advance time, firing timers whose deadline has passed, in deadline order. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.pending.filter((p) => p.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.pending = this.pending.filter((p) => p.id !== due.id);
      this.t = Math.max(this.t, due.at);
      due.cb();
    }
    this.t = target;
  }
  pendingCount(): number {
    return this.pending.length;
  }
}
