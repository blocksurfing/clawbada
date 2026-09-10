/** Assertion accumulator: never throws, prints a table at the end, drives the exit code. */
export interface Check { phase: string; name: string; ok: boolean; detail?: string }

export class Checks {
  readonly items: Check[] = [];
  constructor(private phase = 'setup') {}
  setPhase(p: string) { this.phase = p; }
  check(ok: boolean, name: string, detail?: string): boolean {
    this.items.push({ phase: this.phase, name, ok, detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} [${this.phase}] ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
  }
  eq<T>(actual: T, expected: T, name: string): boolean {
    const ok = actual === expected;
    return this.check(ok, name, ok ? String(actual) : `expected ${String(expected)}, got ${String(actual)}`);
  }
  get failed(): Check[] { return this.items.filter((c) => !c.ok); }
  report(): void {
    const w = Math.max(...this.items.map((c) => c.name.length), 10);
    console.log('\n' + '─'.repeat(w + 24));
    for (const c of this.items) console.log(`${c.ok ? ' ok ' : 'FAIL'} ${c.phase.padEnd(10)} ${c.name.padEnd(w)} ${c.detail ?? ''}`);
    console.log('─'.repeat(w + 24));
    console.log(`${this.items.length - this.failed.length}/${this.items.length} checks passed${this.failed.length ? ` — ${this.failed.length} FAILED` : ''}`);
  }
}
